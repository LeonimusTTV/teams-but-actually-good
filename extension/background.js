/* eslint-disable no-undef */
/**
 * Background script for Teams but (actually) good.
 *
 * - Manages dynamic content script registration (injection.js) based on the
 *   extensionEnabled storage flag.  The script is never listed in manifest
 *   content_scripts for Chrome — it is registered/unregistered via
 *   chrome.scripting so that toggling the extension on/off works without
 *   reloading the extension.
 *
 *   On Firefox the script IS listed as a static content_script in the manifest
 *   (the only way to get world: "MAIN" working reliably).  Toggling is handled
 *   via chrome.scripting.updateContentScripts({ enabled }).
 *
 * - When devModeEnabled is true (Chrome only), keeps a WebSocket connection to
 *   the local dev server (scripts/dev.ts).  When the server sends "reload",
 *   the extension reloads so Chrome re-reads content scripts from disk before
 *   the Teams tab is refreshed.
 *
 * - MV3 service workers are suspended by Chrome after a short idle period,
 *   silently dropping the WebSocket.  A chrome.alarms keepalive (fired every
 *   ~25 s) wakes the SW and re-establishes the connection when in dev mode.
 *
 * - Periodically checks GitHub for a newer release version and shows a badge
 *   on the extension icon when an update is available.  This is the best
 *   achievable update notification for sideloaded extensions (true auto-update
 *   requires the Chrome Web Store / Firefox AMO).
 */

const IS_FIREFOX = navigator.userAgent.includes("Firefox");

const DEV_SERVER_URL = "ws://127.0.0.1:9223";
const KEEPALIVE_ALARM = "tbg-dev-keepalive";
const UPDATE_CHECK_ALARM = "tbg-update-check";
const UPDATE_CHECK_INTERVAL_MINUTES = 240; // every 4 hours
const CONTENT_SCRIPT_ID = "tbg-injection";
const ONBOARDING_USAGE_URL = "https://docs.teamsbutactuallygood.dev/usage";
const TEAMS_WEB_APP_URL = "https://teams.cloud.microsoft/";
const RELEASES_API_URL = "https://api.github.com/repos/LeonimusTTV/teams-but-actually-good/releases/latest";
const META_URL = "https://github.com/LeonimusTTV/teams-but-actually-good/releases/latest/download/injection.meta.json";
const TEAMS_MATCHES = [
  "*://teams.cloud.microsoft/*",
  "*://*.teams.cloud.microsoft/*",
  "*://teams.microsoft.com/*",
  "*://*.teams.microsoft.com/*",
  "*://teams.live.com/*",
  "*://*.teams.live.com/*",
];

function normalizeVersion(v) {
  if (typeof v !== "string") return "";
  return v.trim().replace(/^v/i, "");
}

async function checkForUpdates() {
  try {
    const currentVersion = normalizeVersion(chrome.runtime.getManifest().version);
    let latestVersion = "";

    try {
      const response = await fetch(RELEASES_API_URL, {
        cache: "no-store",
        headers: { Accept: "application/vnd.github+json" },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const release = await response.json();
      latestVersion = normalizeVersion(release?.tag_name || "");
    } catch {
      // Fallback to injection.meta.json if the API is unreachable.
      const response = await fetch(META_URL, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const meta = await response.json();
      latestVersion = normalizeVersion(meta?.version || "");
    }

    if (latestVersion && latestVersion !== currentVersion) {
      chrome.action.setBadgeText({ text: "↑" });
      chrome.action.setBadgeBackgroundColor({ color: "#F59E0B" });
      chrome.action.setTitle({ title: `Teams but (actually) good — Update available (v${latestVersion})` });
    } else {
      chrome.action.setBadgeText({ text: "" });
      chrome.action.setTitle({ title: "Teams but (actually) good" });
    }
  } catch {
    // Network error: leave badge unchanged.
  }
}

// Module-level ref so we can check readyState across alarm wakeups.
let ws = null;


function connect() {
  // Already connected or mid-handshake – nothing to do.
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  try {
    ws = new WebSocket(DEV_SERVER_URL);
  } catch (err) {
    // Dev server not running
    console.error("[TBAG] Failed to connect to dev server:", err);
    ws = null;
    setTimeout(connect, 2000);
    return;
  }

  ws.onopen = async () => {
    const { autoReloadEnabled = true } = await chrome.storage.local.get({ autoReloadEnabled: true });
    ws.send(JSON.stringify({ type: "ready", autoReloadEnabled }));
  };

  ws.onmessage = (e) => {
    if (e.data === "reload") {
      chrome.runtime.reload();
    }
  };

  ws.onclose = async () => {
    ws = null;
    // Only schedule a reconnect when dev mode is still active.
    const { devModeEnabled = false } = await chrome.storage.local.get({ devModeEnabled: false });
    if (devModeEnabled) setTimeout(connect, 1000);
  };

  ws.onerror = () => {
    // onclose fires right after onerror, which already schedules a reconnect.
  };
}

function disconnectWs() {
  if (ws) {
    ws.onclose = null; // prevent the onclose handler from scheduling a reconnect
    ws.onerror = null;
    ws.close();
    ws = null;
  }
}

async function syncContentScript() {
  const { extensionEnabled = true } = await chrome.storage.local.get({ extensionEnabled: true });

  const registered = await chrome.scripting
    .getRegisteredContentScripts({ ids: [CONTENT_SCRIPT_ID] })
    .catch(() => []);
  const isRegistered = registered.length > 0;

  if (extensionEnabled && !isRegistered) {
    await chrome.scripting.registerContentScripts([
      {
        id: CONTENT_SCRIPT_ID,
        js: ["injection.js"],
        matches: TEAMS_MATCHES,
        runAt: "document_start",
        world: "MAIN",
        allFrames: false,
      },
    ]).catch((err) => console.error("[TBAG] Failed to register content script:", err));
  } else if (!extensionEnabled && isRegistered) {
    await chrome.scripting
      .unregisterContentScripts({ ids: [CONTENT_SCRIPT_ID] })
      .catch((err) => console.error("[TBAG] Failed to unregister content script:", err));
  }
}

function enableDevMode() {
  // periodInMinutes: 0.4 ≈ 24 s – keeps the SW alive between alarm firings.
  chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.4 });
  connect();
}

function disableDevMode() {
  chrome.alarms.clear(KEEPALIVE_ALARM);
  disconnectWs();
}

async function runInstallOnboarding(details) {
  if (details.reason !== "install") {
    return;
  }

  // Open docs first so users land on instructions, then preload Teams in a background tab.
  await chrome.tabs.create({ url: ONBOARDING_USAGE_URL, active: true });
  await chrome.tabs.create({ url: TEAMS_WEB_APP_URL, active: false });
}

// On install or update: register the content script if the extension is enabled.
chrome.runtime.onInstalled.addListener(async (details) => {
  await syncContentScript();

  await runInstallOnboarding(details).catch((err) => {
    console.error("[TBAG] Failed onboarding tab flow:", err);
  });

  // Schedule periodic update checks (works on both Chrome and Firefox).
  chrome.alarms.create(UPDATE_CHECK_ALARM, {
    delayInMinutes: 1,
    periodInMinutes: UPDATE_CHECK_INTERVAL_MINUTES,
  });
  checkForUpdates();

  if (!IS_FIREFOX) {
    const { devModeEnabled = false } = await chrome.storage.local.get({ devModeEnabled: false });
    if (devModeEnabled) enableDevMode();
  }
});

(async () => {
  const alarm = await chrome.alarms.get(UPDATE_CHECK_ALARM);
  if (!alarm) {
    chrome.alarms.create(UPDATE_CHECK_ALARM, {
      delayInMinutes: 1,
      periodInMinutes: UPDATE_CHECK_INTERVAL_MINUTES,
    });
  }

  if (!IS_FIREFOX) {
    const { devModeEnabled = false } = await chrome.storage.local.get({ devModeEnabled: false });
    if (devModeEnabled) enableDevMode();
  }
})();

// Handle all recurring alarms in one listener (Chrome & Firefox).
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === UPDATE_CHECK_ALARM) {
    checkForUpdates();
    return;
  }

  if (!IS_FIREFOX && alarm.name === KEEPALIVE_ALARM) {
    const { devModeEnabled = false } = await chrome.storage.local.get({ devModeEnabled: false });
    if (devModeEnabled) connect();
  }
});

// React to storage changes from the popup.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;

  if ("extensionEnabled" in changes) {
    syncContentScript().catch(console.error);
  }

  if (!IS_FIREFOX) {
    if ("devModeEnabled" in changes) {
      if (changes.devModeEnabled.newValue) {
        enableDevMode();
      } else {
        disableDevMode();
      }
    }

    if ("autoReloadEnabled" in changes && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "autoReloadEnabled", autoReloadEnabled: changes.autoReloadEnabled.newValue }));
    }
  }
});

const syncAsyncgwToken = async () => {
  chrome.cookies.getAll(
    { domain: 'asyncgw.teams.microsoft.com', name: 'authtoken_asm' },
    async (cookies) => {
      if (!cookies[0]) return

      const token = cookies[0].value

      const tabs = await chrome.tabs.query({ url: TEAMS_MATCHES })
      for (const tab of tabs) {
        if (!tab.id) continue
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (token) => {
            token = token.replace("%20", " ")
            sessionStorage.setItem('tbag_asyncgw_token', token)
          },
          args: [token]
        })
      }
    }
  )
}

syncAsyncgwToken()

chrome.cookies.onChanged.addListener((changeInfo) => {
  if (!changeInfo) return;
  const { cookie, removed } = changeInfo;
  if (!cookie) return;

  if (cookie.name === 'authtoken_asm' && cookie.domain.includes('asyncgw')) {
    removed
      ? chrome.tabs.query({ url: TEAMS_MATCHES }, (tabs) => {
        tabs.forEach(tab => tab.id && chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            sessionStorage.removeItem('tbag_asyncgw_token')
          }
        }))
      })
      : syncAsyncgwToken()
  }
})