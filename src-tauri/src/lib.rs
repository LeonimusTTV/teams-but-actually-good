use reqwest::header::{ACCEPT, HeaderMap, HeaderValue, USER_AGENT};
use semver::Version;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::PathBuf;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_updater::UpdaterExt;

const DEFAULT_REPO: &str = "LeonimusTTV/teams-but-actually-good";
const GITHUB_API_BASE: &str = "https://api.github.com";

#[derive(Debug, Clone, Deserialize)]
struct GithubRelease {
    assets: Vec<GithubAsset>,
}

#[derive(Debug, Clone, Deserialize)]
struct GithubAsset {
    name: String,
    browser_download_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct InjectionMetadata {
    version: String,
    sha256: String,
    published_at: Option<String>,
    notes: Option<String>,
}

fn cached_paths(app: &AppHandle) -> Result<(PathBuf, PathBuf), String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("failed to resolve app data dir: {e}"))?;

    Ok((
        data_dir.join("injection.js"),
        data_dir.join("injection.meta.json"),
    ))
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

fn parse_version(v: &str) -> Option<Version> {
    let normalized = v.trim_start_matches('v');
    Version::parse(normalized).ok()
}

fn is_remote_newer(local: Option<&InjectionMetadata>, remote: &InjectionMetadata) -> bool {
    let remote_ver = parse_version(&remote.version);
    let local_ver = local.and_then(|m| parse_version(&m.version));

    match (local_ver, remote_ver) {
        (Some(l), Some(r)) => r > l,
        (None, Some(_)) => true,
        _ => local
            .map(|m| !m.sha256.eq_ignore_ascii_case(&remote.sha256))
            .unwrap_or(true),
    }
}

fn load_cached_metadata(app: &AppHandle) -> Option<InjectionMetadata> {
    let (_, metadata_path) = cached_paths(app).ok()?;
    let raw = fs::read_to_string(metadata_path).ok()?;
    serde_json::from_str(&raw).ok()
}

fn load_verified_cached_injection(app: &AppHandle) -> Option<String> {
    let (injection_path, metadata_path) = cached_paths(app).ok()?;

    let metadata_raw = fs::read_to_string(metadata_path).ok()?;
    let metadata: InjectionMetadata = serde_json::from_str(&metadata_raw).ok()?;

    let script = fs::read_to_string(injection_path).ok()?;
    let script_hash = sha256_hex(script.as_bytes());
    if script_hash.eq_ignore_ascii_case(&metadata.sha256) {
        Some(script)
    } else {
        None
    }
}

async fn fetch_latest_release(repo: &str) -> Result<GithubRelease, String> {
    let mut headers = HeaderMap::new();
    headers.insert(USER_AGENT, HeaderValue::from_static("teams-but-actually-good-updater"));
    headers.insert(ACCEPT, HeaderValue::from_static("application/vnd.github+json"));

    let client = reqwest::Client::builder()
        .default_headers(headers)
        .build()
        .map_err(|e| format!("failed to build HTTP client: {e}"))?;

    let url = format!("{GITHUB_API_BASE}/repos/{repo}/releases/latest");
    client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("failed to fetch latest release: {e}"))?
        .error_for_status()
        .map_err(|e| format!("github release request failed: {e}"))?
        .json::<GithubRelease>()
        .await
        .map_err(|e| format!("failed to decode release payload: {e}"))
}

async fn fetch_text(url: &str) -> Result<String, String> {
    let response = reqwest::Client::new()
        .get(url)
        .header(USER_AGENT, "teams-but-actually-good-updater")
        .send()
        .await
        .map_err(|e| format!("failed to download {url}: {e}"))?
        .error_for_status()
        .map_err(|e| format!("download failed for {url}: {e}"))?;

    response
        .text()
        .await
        .map_err(|e| format!("failed to read response body: {e}"))
}

async fn refresh_injection_from_github(app: AppHandle) -> Result<(), String> {
    let repo = std::env::var("TBG_GITHUB_REPO").unwrap_or_else(|_| DEFAULT_REPO.to_string());
    let latest = fetch_latest_release(&repo).await?;

    let js_asset = latest
        .assets
        .iter()
        .find(|a| a.name == "injection.js")
        .ok_or_else(|| "latest release does not include injection.js".to_string())?;
    let meta_asset = latest
        .assets
        .iter()
        .find(|a| a.name == "injection.meta.json")
        .ok_or_else(|| "latest release does not include injection.meta.json".to_string())?;

    let remote_meta_raw = fetch_text(&meta_asset.browser_download_url).await?;
    let remote_meta: InjectionMetadata = serde_json::from_str(&remote_meta_raw)
        .map_err(|e| format!("invalid injection metadata: {e}"))?;

    let local_meta = load_cached_metadata(&app);
    if !is_remote_newer(local_meta.as_ref(), &remote_meta) {
        return Ok(());
    }

    let remote_script = fetch_text(&js_asset.browser_download_url).await?;
    let remote_hash = sha256_hex(remote_script.as_bytes());
    if !remote_hash.eq_ignore_ascii_case(&remote_meta.sha256) {
        return Err("downloaded injection.js hash does not match metadata".to_string());
    }

    let (injection_path, metadata_path) = cached_paths(&app)?;
    if let Some(parent) = injection_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create app data dir {}: {e}", parent.display()))?;
    }

    fs::write(&injection_path, remote_script)
        .map_err(|e| format!("failed to store injection.js cache: {e}"))?;
    fs::write(&metadata_path, remote_meta_raw)
        .map_err(|e| format!("failed to store injection metadata cache: {e}"))?;

    let _ = app
        .notification()
        .builder()
        .title("Teams but (actually) good")
        .body("Teams patch updated. It will apply on next launch.")
        .show();

    Ok(())
}

struct TeamsWebviewConfig {
    injection_script: String,
    user_agent: String,
}

fn is_valid_chat_id(chat_id: &str) -> bool {
    !chat_id.is_empty()
        && chat_id.len() <= 256
        && chat_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, ':' | '@' | '.' | '_' | '-'))
}

#[tauri::command]
fn open_chat_popup(app: AppHandle, chat_id: String) -> Result<(), String> {
    if !is_valid_chat_id(&chat_id) {
        return Err("invalid chat id".to_string());
    }

    let config = app.state::<TeamsWebviewConfig>();
    let url = format!("https://teams.microsoft.com/l/chat/{chat_id}/conversations");
    let label = format!(
        "chat-popup-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or_default()
    );

    WebviewWindowBuilder::new(
        &app,
        label,
        WebviewUrl::External(url.parse().map_err(|e| format!("invalid chat url: {e}"))?),
    )
    .title("Chat")
    .inner_size(600.0, 800.0)
    .min_inner_size(400.0, 400.0)
    // Without these two, Teams fails to load in the popup: the injection
    // script hijacks the Trusted Types policy Teams' webpack loader needs,
    // and the spoofed user agent avoids the "unsupported browser" screen.
    .initialization_script(&config.injection_script)
    .user_agent(&config.user_agent)
    .build()
    .map_err(|e| format!("failed to open chat popup: {e}"))?;

    Ok(())
}

async fn check_app_update(app: AppHandle) -> Result<(), String> {
    if let Some(update) = app
        .updater()
        .map_err(|e| format!("updater init failed: {e}"))?
        .check()
        .await
        .map_err(|e| format!("updater check failed: {e}"))?
    {
        let _ = app
            .notification()
            .builder()
            .title("Teams but (actually) good")
            .body(format!("App update available: {}", update.version))
            .show();
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "windows")]
    unsafe {
        std::env::set_var(
            "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
            "--enable-features=msSingleSignOnOSForPrimaryAccountIsShared",
        );
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![open_chat_popup])
        .setup(|app| {
            let js_injection = load_verified_cached_injection(&app.handle().clone())
                .unwrap_or_else(|| include_str!("../../dist/injection.js").to_string());
            let _user_agent = if cfg!(target_os = "windows") {
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36 Edg/145.0.3800.70"
            } else if cfg!(target_os = "linux") {
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36 Edg/145.0.3800.70"
            } else {
                // macOS
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36 Edg/145.0.3800.70"
            };

            // Shared with open_chat_popup so popup windows are configured the
            // exact same way as the main window.
            app.manage(TeamsWebviewConfig {
                injection_script: js_injection.clone(),
                user_agent: _user_agent.to_string(),
            });

            let handle = app.handle().clone();

            if !cfg!(debug_assertions) {  
                println!("Checking for updates in the background...\n");
                tauri::async_runtime::spawn(async move {
                    if let Err(err) = refresh_injection_from_github(handle.clone()).await {
                        eprintln!("injection hot-update failed: {err}");
                    }

                    if let Err(err) = check_app_update(handle).await {
                        eprintln!("binary update check failed: {err}");
                    }
                });
            }

            WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::External("https://teams.cloud.microsoft/v2/?clientType=chrome".parse().unwrap()),
            )
            .title("Teams But (actually) Good")
            .inner_size(1800.0, 800.0)
            .min_inner_size(800.0, 600.0)
            .center()
            .initialization_script(&js_injection)
            .user_agent(_user_agent)
            .build()?;

            let clear_tbag = MenuItem::with_id(app, "clear_tbag", "Clear TBAG Cache", true, None::<&str>)?;
            let clear_teams = MenuItem::with_id(app, "clear_teams", "Clear Teams Cache", true, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&clear_tbag, &clear_teams, &sep, &quit_item])?;

            if let Some(icon) = app.default_window_icon() {
                TrayIconBuilder::new()
                    .icon(icon.clone())
                    .menu(&tray_menu)
                    .show_menu_on_left_click(true)
                    .on_menu_event(|app, event| match event.id.as_ref() {
                        "clear_tbag" => {
                            if let Ok((inj, meta)) = cached_paths(app) {
                                let _ = std::fs::remove_file(&inj);
                                let _ = std::fs::remove_file(&meta);
                            }
                            let _ = app
                                .notification()
                                .builder()
                                .title("Teams but (actually) good")
                                .body("TBAG cache cleared. Patch will be re-downloaded on next launch.")
                                .show();
                        }
                        "clear_teams" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.eval(r#"
                                    (async () => {
                                        try { localStorage.clear(); } catch(e) {}
                                        try { sessionStorage.clear(); } catch(e) {}
                                        try {
                                            const regs = await navigator.serviceWorker.getRegistrations();
                                            await Promise.all(regs.map(r => r.unregister()));
                                        } catch(e) {}
                                        try {
                                            const keys = await caches.keys();
                                            await Promise.all(keys.map(k => caches.delete(k)));
                                        } catch(e) {}
                                        try {
                                            const dbs = await indexedDB.databases();
                                            await Promise.all(dbs.map(db => new Promise(res => {
                                                const req = indexedDB.deleteDatabase(db.name);
                                                req.onsuccess = res;
                                                req.onerror = res;
                                            })));
                                        } catch(e) {}
                                        window.location.href = 'https://teams.cloud.microsoft/v2/?clientType=chrome';
                                    })();
                                "#);
                            }
                        }
                        "quit" => app.exit(0),
                        _ => {}
                    })
                    .build(app)?;
            }

            #[cfg(debug_assertions)] // only include this code on debug builds to open the dev console
            {
                let window: tauri::WebviewWindow = app.get_webview_window("main").unwrap();
                window.open_devtools();
                window.close_devtools();
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
