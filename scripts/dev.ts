/**
 * Dev watch script for teams-but-good
 *
 * What it does:
 *  1. Generates the plugin registry once on startup
 *  2. Starts esbuild in watch mode; on every successful build it:
 *     a. Copies dist/injection.js → extension/injection.js
 *     b. Reloads the active Teams tab via the Chrome DevTools Protocol (CDP)
 *  3. Watches src/teams-plugins/ and src/user-plugins/ for added/removed plugin folders and
 *     re-generates the registry + triggers a rebuild automatically
 *
 * Prerequisite – start Chrome with remote-debugging enabled.
 * The dev script will attempt to launch Chrome automatically if it is not
 * already running with CDP enabled.  If auto-launch fails you can start it
 * manually:
 *   macOS:   open -a "Google Chrome" --args --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-debug-profile
 *   Windows: start chrome --remote-debugging-port=9222 --user-data-dir=%TEMP%\chrome-debug-profile
 *   Linux:   google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-debug-profile
 *
 * Then just run:  bun run watch
 * (Firefox is supported for production only – use bun run build:firefox)
 */

import * as esbuild from "esbuild";
import * as fs from "fs";
import * as path from "path";
import { spawnSync, spawn } from "child_process";

const ROOT = path.resolve(__dirname, "..");
const SRC_DIR = path.join(ROOT, "src");
const DIST_DIR = path.join(ROOT, "dist");
const EXT_DIR = path.join(ROOT, "extension");
const PLUGIN_DIR = path.join(SRC_DIR, "teams-plugins");
const USER_PLUGIN_DIR = path.join(SRC_DIR, "user-plugins");
const THEME_DIR = path.join(SRC_DIR, "themes");

const CDP_PORT = 9222;

// Ordered list of binary names to try when looking for Chrome on Linux.
const LINUX_CHROME_CANDIDATES = [
  "google-chrome",
  "google-chrome-stable",
  "chromium",
  "chromium-browser",
];

function findLinuxChrome(): string | null {
  for (const bin of LINUX_CHROME_CANDIDATES) {
    const r = spawnSync("which", [bin], { encoding: "utf8" });
    if (r.status === 0 && r.stdout.trim()) return bin;
  }
  return null;
}

/**
 * Attempts to launch Chrome with CDP enabled for the current OS.
 * Returns true once the CDP port becomes reachable (up to ~5 s),
 * false if it could not be launched or timed out.
 */
async function launchChrome(): Promise<boolean> {
  const platform = process.platform;
  const dataDir =
    platform === "win32"
      ? path.join(process.env.TEMP ?? "C:\\Temp", "chrome-debug-profile")
      : "/tmp/chrome-debug-profile";
  const debugArg = `--remote-debugging-port=${CDP_PORT}`;
  const dataDirArg = `--user-data-dir=${dataDir}`;

  let cmd: string;
  let args: string[];

  if (platform === "darwin") {
    cmd = "open";
    args = ["-a", "Google Chrome", "--args", debugArg, dataDirArg];
  } else if (platform === "win32") {
    // `start` is a cmd built-in; use cmd /c to invoke it.
    cmd = "cmd";
    args = ["/c", "start", "", "chrome", debugArg, dataDirArg];
  } else {
    const bin = findLinuxChrome();
    if (!bin) {
      console.log(
        "  ⚠  Could not find Chrome/Chromium on PATH. Install it and run manually:\n" +
          `     google-chrome ${debugArg} ${dataDirArg}`,
      );
      return false;
    }
    cmd = bin;
    args = [debugArg, dataDirArg];
  }

  console.log(
    `  → Launching Chrome automatically (${[cmd, ...args].join(" ")})...`,
  );
  spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();

  // Poll until CDP is ready (up to ~5 s).
  for (let i = 0; i < 10; i++) {
    await sleep(500);
    if ((await getCDPTargets()).length > 0) return true;
  }

  console.log(
    "  ⚠  Chrome launched but CDP port not ready yet – will retry on next build.",
  );
  return false;
}

function syncManifest(): void {
  fs.copyFileSync(
    path.join(EXT_DIR, "manifest.chrome.json"),
    path.join(EXT_DIR, "manifest.json"),
  );
}

async function getCDPTargets(): Promise<any[]> {
  try {
    const res = await fetch(`http://localhost:${CDP_PORT}/json/list`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

/**
 * Sends a single CDP command to the target identified by its WebSocket URL,
 * waits for the reply (or a 3 s timeout), then closes the socket.
 */
function cdpSend(
  wsUrl: string,
  method: string,
  params: Record<string, unknown> = {},
): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      resolve();
    };

    const ws = new WebSocket(wsUrl);
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method, params }));
    ws.onmessage = finish;
    ws.onerror = finish;
    ws.onclose = finish;
    setTimeout(finish, 3000);
  });
}

async function reloadTeamsTab(): Promise<void> {
  let targets = await getCDPTargets();

  if (targets.length === 0) {
    console.log(
      "  ⚠  No CDP targets found – attempting to launch Chrome automatically...",
    );
    const launched = await launchChrome();
    if (!launched) return;
    targets = await getCDPTargets();
    if (targets.length === 0) return;
  }

  const teamsTarget = targets.find(
    (t) =>
      t.type === "page" &&
      typeof t.url === "string" &&
      t.url.includes("teams.cloud.microsoft"),
  );

  if (!teamsTarget?.webSocketDebuggerUrl) {
    console.log(
      "  ⚠  No Teams tab found via CDP (open teams.cloud.microsoft in Chrome first).",
    );
    return;
  }

  await cdpSend(teamsTarget.webSocketDebuggerUrl, "Page.reload", {
    ignoreCache: false,
  });
  console.log("  ✓ Teams tab reloaded");
}

// ─── hot-reload WebSocket server (signals extension SW to reload) ─────────────

const DEV_WS_PORT = 9223;

let currentSwClient: any = null;
let reloadResolve: (() => void) | null = null;
let autoReloadEnabled = true;

Bun.serve({
  port: DEV_WS_PORT,
  // Bind explicitly to 127.0.0.1 (IPv4 loopback) to match the extension's
  // DEV_SERVER_URL. Without this, Bun defaults to 0.0.0.0 (all IPv4 ifaces)
  // which also works, but being explicit avoids any ambiguity on Windows.
  hostname: "127.0.0.1",
  fetch(req, server) {
    if (server.upgrade(req)) return;
    return new Response("teams-but-good dev reload server", { status: 200 });
  },
  websocket: {
    open(ws) {
      currentSwClient = ws;
      console.log("  ✓ Extension SW connected to dev server");
    },
    close(ws) {
      if (currentSwClient === ws) currentSwClient = null;
    },
    message(_ws, data) {
      try {
        const msg = JSON.parse(data as string);
        if (msg.type === "ready") {
          autoReloadEnabled = msg.autoReloadEnabled ?? true;
          if (reloadResolve) {
            reloadResolve();
            reloadResolve = null;
          }
        }
      } catch {
        // ignore non-JSON messages
      }
    },
  },
});

function waitForSwReconnect(timeoutMs = 5000): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      reloadResolve = null;
      resolve(false);
    }, timeoutMs);
    reloadResolve = () => {
      clearTimeout(timer);
      resolve(true);
    };
  });
}

async function reloadExtensionAndTab(): Promise<void> {
  if (!currentSwClient) {
    // The SW may have been suspended by Chrome (MV3 idle timeout) and is now
    // waking up via the keepalive alarm.  Give it a moment to reconnect before
    // giving up.
    console.log("  → Extension SW not connected, waiting for reconnect...");
    const recovered = await waitForSwReconnect(4000);
    if (!recovered) {
      console.log(
        "  ⚠  Extension SW not connected – make sure the extension is loaded in Chrome.",
      );
      return;
    }
  }

  currentSwClient.send("reload");
  console.log("  → Reloading extension, waiting for SW to reconnect...");

  const reconnected = await waitForSwReconnect();
  if (reconnected) {
    console.log("  ✓ Extension reloaded");
  } else {
    console.log("  ⚠  SW reconnect timed out, continuing anyway");
  }

  if (autoReloadEnabled) {
    await sleep(150);
    await reloadTeamsTab();
  } else {
    console.log("  ⚠  Auto-reload disabled – skipping Teams tab reload.");
  }
}

function generateAll(): boolean {
  const result = spawnSync("bun", ["run", "scripts/generate-all.ts"], {
    cwd: ROOT,
    stdio: "inherit",
  });
  return result.status === 0;
}

function timestamp(): string {
  return new Date().toLocaleTimeString();
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Reference kept so watchers can trigger a manual rebuild when the plugin
// registry changes.
let ctx: esbuild.BuildContext | null = null;

async function startWatch(): Promise<void> {
  if (!fs.existsSync(DIST_DIR)) fs.mkdirSync(DIST_DIR, { recursive: true });

  ctx = await esbuild.context({
    entryPoints: [path.join(SRC_DIR, "injection.ts")],
    bundle: true,
    loader: { ".css": "text", ".svg": "dataurl" },
    outfile: path.join(DIST_DIR, "injection.js"),
    logLevel: "silent", // we print our own messages below
    plugins: [
      {
        name: "dev-reload",
        setup(build) {
          build.onEnd(async (result) => {
            if (result.errors.length > 0) {
              const msgs = await esbuild.formatMessages(result.errors, {
                kind: "error",
                color: true,
              });
              console.error(
                `[${timestamp()}] ✗ Build failed:\n` + msgs.join("\n"),
              );
              return;
            }

            // Copy bundle to the extension directory
            fs.copyFileSync(
              path.join(DIST_DIR, "injection.js"),
              path.join(EXT_DIR, "injection.js"),
            );

            console.log(`[${timestamp()}] ✓ Built  →  extension/injection.js`);

            await reloadExtensionAndTab();
          });
        },
      },
    ],
  });

  await ctx.watch();
}

function watchDir(dir: string): void {
  let debounce: ReturnType<typeof setTimeout> | null = null;

  fs.watch(dir, { persistent: true }, (_, filename) => {
    if (!filename) return;
    // Only care when a direct subdirectory changes (new plugin added/removed).
    // fs.watch fires for every file inside subdirs too; filter to top-level only.
    const full = path.join(dir, filename);
    let isDir = false;
    try {
      isDir = fs.statSync(full).isDirectory();
    } catch {
      isDir = false;
    }

    if (!isDir) return;

    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(async () => {
      console.log(
        `\n[${timestamp()}] Plugin directory changed – regenerating registry...`,
      );
      if (generateAll()) {
        // Cancelling and restarting is the safest way to pick up registry changes.
        if (ctx) {
          await ctx.cancel();
          await ctx.dispose();
          ctx = null;
        }
        await startWatch();
      }
    }, 300);
  });
}

console.log("┌─────────────────────────────────────────────────┐");
console.log("│  teams-but-good  –  dev watch                   │");
console.log("└─────────────────────────────────────────────────┘");
console.log("");

syncManifest();
console.log("Manifest  →  extension/manifest.json  (manifest.chrome.json)");
console.log("");
console.log("Generating plugin and theme registries...");

if (!generateAll()) {
  console.error("Plugin/theme generation failed – aborting.");
  process.exit(1);
}

await startWatch();
watchDir(PLUGIN_DIR);
if (fs.existsSync(USER_PLUGIN_DIR)) {
  watchDir(USER_PLUGIN_DIR);
}
watchDir(THEME_DIR);

// Warn early if Chrome isn't running with remote-debugging enabled.
// reloadTeamsTab() only runs after a build + SW reconnect, so without this
// check the user would never see the CDP warning on a fresh start.
await reloadTeamsTab();

console.log(`Watching  src/  for changes...`);
console.log(
  `(Chrome CDP on port ${CDP_PORT} – run Chrome with --remote-debugging-port=${CDP_PORT})`,
);
console.log(`(Extension dev server on ws://localhost:${DEV_WS_PORT})`);
console.log("");
