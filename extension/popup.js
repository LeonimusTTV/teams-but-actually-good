/* eslint-disable no-undef */
const extensionToggle = document.getElementById("extensionToggle");
const devModeToggle = document.getElementById("devModeToggle");
const autoReloadToggle = document.getElementById("autoReloadToggle");
const devRows = document.getElementById("devRows");
const currentVersionValue = document.getElementById("currentVersionValue");
const latestVersionValue = document.getElementById("latestVersionValue");
const activeStatusValue = document.getElementById("activeStatusValue");
const injectionStatusValue = document.getElementById("injectionStatusValue");
const clearCacheBtn = document.getElementById("clearCacheBtn");
const clearTbagCacheBtn = document.getElementById("clearTbagCacheBtn");

const META_URL = "https://github.com/LeonimusTTV/teams-but-actually-good/releases/latest/download/injection.meta.json";
const RELEASES_API_URL = "https://api.github.com/repos/LeonimusTTV/teams-but-actually-good/releases/latest";
const TEAMS_HOST_PATTERN = /^(teams\.microsoft\.com|teams\.cloud\.microsoft|teams\.live\.com)$/i;

function setStatus(el, text, kind) {
  el.textContent = text;
  el.classList.remove("ok", "warn", "pending");
  el.classList.add(kind);
}

function normalizeVersion(version) {
  if (typeof version !== "string") return "";
  return version.trim().replace(/^v/i, "");
}

function isTeamsUrl(url) {
  if (!url) return false;
  try {
    const { hostname } = new URL(url);
    return TEAMS_HOST_PATTERN.test(hostname);
  } catch {
    return false;
  }
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

async function getInjectionMarker(tabId) {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: () => {
        const marker = document.documentElement?.getAttribute("data-tbg-injection");
        return {
          marker,
          hostname: window.location.hostname
        };
      }
    });
    return result?.result ?? null;
  } catch {
    return null;
  }
}

async function updateVersionInfo() {
  const currentVersionRaw = chrome.runtime.getManifest().version;
  const currentVersion = normalizeVersion(currentVersionRaw);
  setStatus(currentVersionValue, currentVersionRaw || "Unknown", "ok");

  try {
    let latest = "";

    try {
      const releaseResponse = await fetch(RELEASES_API_URL, {
        cache: "no-store",
        headers: { Accept: "application/vnd.github+json" }
      });

      if (!releaseResponse.ok) {
        throw new Error(`HTTP ${releaseResponse.status}`);
      }

      const release = await releaseResponse.json();
      latest = normalizeVersion(release?.tag_name || "");

      if (!latest) {
        throw new Error("Missing tag_name in latest release response");
      }
    } catch {
      // Fallback for environments where API requests are blocked.
      const response = await fetch(META_URL, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const metadata = await response.json();
      latest = normalizeVersion(metadata?.version || "");
      if (!latest) {
        throw new Error("Missing version in metadata");
      }
    }

    const kind = latest === currentVersion ? "ok" : "warn";
    setStatus(latestVersionValue, latest, kind);
  } catch {
    setStatus(latestVersionValue, "Unavailable", "warn");
  }
}

async function updateRuntimeStatus() {
  const { extensionEnabled = true } = await chrome.storage.local.get({ extensionEnabled: true });
  const activeTab = await getActiveTab();

  if (!extensionEnabled) {
    setStatus(activeStatusValue, "Disabled", "warn");
    setStatus(injectionStatusValue, "Disabled", "warn");
    return;
  }

  if (!activeTab || !isTeamsUrl(activeTab.url)) {
    setStatus(activeStatusValue, "Inactive", "warn");
    setStatus(injectionStatusValue, "N/A", "pending");
    return;
  }

  setStatus(activeStatusValue, "Active", "ok");

  const marker = await getInjectionMarker(activeTab.id);
  if (marker?.marker === "ready") {
    setStatus(injectionStatusValue, "Success", "ok");
    return;
  }

  if (marker?.marker === "booting") {
    setStatus(injectionStatusValue, "Booting", "pending");
    return;
  }

  setStatus(injectionStatusValue, "Not detected", "warn");
}

// On Firefox/Safari, hide dev options and show a notice instead.
const isFirefox = navigator.userAgent.includes("Firefox");
const isSafari = navigator.userAgent.includes("Safari") && !navigator.userAgent.includes("Chrome") && !navigator.userAgent.includes("Firefox");
if (isFirefox || isSafari) {
  document.getElementById("devSection").style.display = "none";
  document.getElementById("firefoxDevNotice").style.display = "";
}

// Load current settings (defaults match background.js assumptions).
chrome.storage.local.get(
  { extensionEnabled: true, devModeEnabled: false, autoReloadEnabled: true },
  ({ extensionEnabled, devModeEnabled, autoReloadEnabled }) => {
    extensionToggle.checked = extensionEnabled;
    devModeToggle.checked = devModeEnabled;
    autoReloadToggle.checked = autoReloadEnabled;
    devRows.style.display = devModeEnabled ? "flex" : "none";
  }
);

extensionToggle.addEventListener("change", () => {
  chrome.storage.local.set({ extensionEnabled: extensionToggle.checked });
});

devModeToggle.addEventListener("change", () => {
  const enabled = devModeToggle.checked;
  chrome.storage.local.set({ devModeEnabled: enabled });
  devRows.style.display = enabled ? "flex" : "none";
});

autoReloadToggle.addEventListener("change", () => {
  chrome.storage.local.set({ autoReloadEnabled: autoReloadToggle.checked });
});

updateVersionInfo();
updateRuntimeStatus();

// Clear the update badge now that the user has opened the popup.
chrome.action.setBadgeText({ text: "" });

clearTbagCacheBtn.addEventListener("click", async () => {
  clearTbagCacheBtn.disabled = true;
  clearTbagCacheBtn.textContent = "Clearing\u2026";

  try {
    const tab = await getActiveTab();

    if (!tab || !isTeamsUrl(tab.url)) {
      clearTbagCacheBtn.textContent = "Not on Teams";
      setTimeout(() => {
        clearTbagCacheBtn.textContent = "Clear";
        clearTbagCacheBtn.disabled = false;
      }, 2000);
      return;
    }

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: () => {
        const TBG_PREFIX = "teams-but-good:";
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith(TBG_PREFIX)) {
            keysToRemove.push(key);
          }
        }
        keysToRemove.forEach((key) => localStorage.removeItem(key));
      },
    });

    clearTbagCacheBtn.textContent = "Cleared";
    setTimeout(() => {
      clearTbagCacheBtn.textContent = "Clear";
      clearTbagCacheBtn.disabled = false;
    }, 2000);
  } catch {
    clearTbagCacheBtn.textContent = "Failed";
    setTimeout(() => {
      clearTbagCacheBtn.textContent = "Clear";
      clearTbagCacheBtn.disabled = false;
    }, 2000);
  }
});

clearCacheBtn.addEventListener("click", async () => {
  clearCacheBtn.disabled = true;
  clearCacheBtn.textContent = "Clearing\u2026";

  try {
    const tab = await getActiveTab();

    if (!tab || !isTeamsUrl(tab.url)) {
      clearCacheBtn.textContent = "Not on Teams";
      setTimeout(() => {
        clearCacheBtn.textContent = "Clear";
        clearCacheBtn.disabled = false;
      }, 2000);
      return;
    }

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: async () => {
        const TBG_PREFIX = "teams-but-good:";
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && !key.startsWith(TBG_PREFIX)) {
            keysToRemove.push(key);
          }
        }
        keysToRemove.forEach((key) => localStorage.removeItem(key));
        if (typeof indexedDB !== "undefined" && typeof indexedDB.databases === "function") {
          const dbs = await indexedDB.databases();
          await Promise.all(
            dbs.map(
              ({ name }) =>
                new Promise((resolve) => {
                  const req = indexedDB.deleteDatabase(name);
                  req.onsuccess = resolve;
                  req.onerror = resolve;
                  req.onblocked = resolve;
                })
            )
          );
        }
      },
    });

    clearCacheBtn.textContent = "Reloading\u2026";
    await chrome.tabs.reload(tab.id, { bypassCache: true });
  } catch {
    clearCacheBtn.textContent = "Failed";
    setTimeout(() => {
      clearCacheBtn.textContent = "Clear";
      clearCacheBtn.disabled = false;
    }, 2000);
  }
});
