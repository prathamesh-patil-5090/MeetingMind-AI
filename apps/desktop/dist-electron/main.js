"use strict";
const electron = require("electron");
const child_process = require("child_process");
const fs = require("fs");
const util = require("util");
const path = require("path");
const execFileAsync = util.promisify(child_process.execFile);
process.env.DIST = path.join(__dirname, "../dist");
process.env.VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
const DEFAULT_API_BASE_URL = "http://127.0.0.1:3847";
const apiBaseUrl = process.env.MEETINGMIND_API_URL ?? DEFAULT_API_BASE_URL;
let mainWindow = null;
let recordingBar = null;
let preferredCaptureSourceId = null;
function preloadPath() {
  return path.join(__dirname, "preload.js");
}
function appIconPath() {
  const dir = path.join(__dirname, "..");
  const candidates = process.platform === "win32" ? [
    path.join(dir, "resources/icon.ico"),
    path.join(dir, "resources/icon.png"),
    path.join(dir, "public/icon.png"),
    path.join(dir, "dist/icon.png")
  ] : [
    path.join(dir, "resources/icon.png"),
    path.join(dir, "public/icon.png"),
    path.join(dir, "dist/icon.png")
  ];
  return candidates.find((p) => fs.existsSync(p));
}
function createWindow() {
  const icon = appIconPath();
  mainWindow = new electron.BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    title: "MeetingMind AI",
    show: false,
    maximizable: true,
    fullscreenable: true,
    backgroundColor: "#f4f5f8",
    autoHideMenuBar: true,
    ...icon ? { icon } : {},
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  if (process.env.VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    void mainWindow.loadFile(path.join(process.env.DIST, "index.html"));
  }
  mainWindow.once("ready-to-show", () => {
    mainWindow == null ? void 0 : mainWindow.maximize();
    mainWindow == null ? void 0 : mainWindow.show();
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}
function recordingBarUrl() {
  if (process.env.VITE_DEV_SERVER_URL) {
    return `${process.env.VITE_DEV_SERVER_URL.replace(/\/$/, "")}/recording-bar.html`;
  }
  return path.join(process.env.DIST, "recording-bar.html");
}
function createRecordingBar() {
  if (recordingBar && !recordingBar.isDestroyed()) {
    recordingBar.show();
    recordingBar.moveTop();
    return recordingBar;
  }
  const display = electron.screen.getPrimaryDisplay();
  const width = 560;
  const height = 68;
  const x = Math.round(
    display.workArea.x + (display.workArea.width - width) / 2
  );
  const y = Math.round(display.workArea.y + 14);
  recordingBar = new electron.BrowserWindow({
    width,
    height,
    x,
    y,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: true,
    focusable: true,
    show: false,
    title: "MeetingMind Recording",
    backgroundColor: "#00000000",
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  recordingBar.setAlwaysOnTop(true, "screen-saver");
  recordingBar.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  const url = recordingBarUrl();
  if (url.startsWith("http")) {
    void recordingBar.loadURL(url);
  } else {
    void recordingBar.loadFile(url);
  }
  recordingBar.once("ready-to-show", () => {
    recordingBar == null ? void 0 : recordingBar.showInactive();
  });
  recordingBar.on("closed", () => {
    recordingBar = null;
  });
  recordingBar.on("close", (e) => {
    if (recordingBar && !recordingBar.isDestroyed()) {
      e.preventDefault();
    }
  });
  return recordingBar;
}
function destroyRecordingBar() {
  if (!recordingBar || recordingBar.isDestroyed()) {
    recordingBar = null;
    return;
  }
  recordingBar.removeAllListeners("close");
  recordingBar.destroy();
  recordingBar = null;
}
function sendToMain(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}
function sendToBar(channel, payload) {
  if (recordingBar && !recordingBar.isDestroyed()) {
    recordingBar.webContents.send(channel, payload);
  }
}
function hwndFromSourceId(sourceId) {
  if (!sourceId.startsWith("window:")) return null;
  const parts = sourceId.split(":");
  return parts[1] && /^\d+$/.test(parts[1]) ? parts[1] : null;
}
async function focusWindowsHwnd(hwnd) {
  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class MmFocus {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
}
"@
$h = [IntPtr]${hwnd}
if ([MmFocus]::IsIconic($h)) { [void][MmFocus]::ShowWindowAsync($h, 9) }
else { [void][MmFocus]::ShowWindowAsync($h, 5) }
[void][MmFocus]::SetForegroundWindow($h)
Write-Output "ok"
`;
  try {
    await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { windowsHide: true, timeout: 5e3 }
    );
    return true;
  } catch {
    return false;
  }
}
async function focusMacWindowByTitle(title) {
  const escaped = title.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const script = `
tell application "System Events"
  set procs to every process whose visible is true
  repeat with p in procs
    try
      set wins to every window of p
      repeat with w in wins
        if name of w contains "${escaped.slice(0, 48)}" then
          set frontmost of p to true
          perform action "AXRaise" of w
          return "ok"
        end if
      end repeat
    end try
  end repeat
end tell
return "miss"
`;
  try {
    const { stdout } = await execFileAsync("osascript", ["-e", script], {
      timeout: 5e3
    });
    return String(stdout).includes("ok");
  } catch {
    return false;
  }
}
function launchUrlForSourceName(name) {
  const n = name.toLowerCase();
  if (n.includes("chatgpt")) return "https://chatgpt.com";
  if (n.includes("claude")) return "https://claude.ai";
  if (n.includes("gemini") || n.includes("google bard"))
    return "https://gemini.google.com";
  if (n.includes("notion")) return "https://www.notion.so";
  if (n.includes("slack")) return "https://app.slack.com";
  if (n.includes("zoom")) return "zoommtg://";
  if (n.includes("microsoft teams") || n.includes("teams")) {
    return "https://teams.microsoft.com";
  }
  return null;
}
async function focusOrOpenCaptureSource(source) {
  if (source.id.startsWith("screen:")) {
    return { ok: true, action: "screen-selected" };
  }
  if (process.platform === "win32") {
    const hwnd = hwndFromSourceId(source.id);
    if (hwnd && await focusWindowsHwnd(hwnd)) {
      return { ok: true, action: "focused-hwnd" };
    }
  } else if (process.platform === "darwin") {
    if (await focusMacWindowByTitle(source.name)) {
      return { ok: true, action: "focused-title" };
    }
  }
  const url = launchUrlForSourceName(source.name);
  if (url) {
    await electron.shell.openExternal(url);
    return { ok: true, action: "opened-url" };
  }
  return { ok: false, action: "none" };
}
electron.app.whenReady().then(() => {
  electron.Menu.setApplicationMenu(null);
  if (process.platform === "win32") {
    electron.app.setAppUserModelId("com.meetingmind.ai");
  }
  electron.session.defaultSession.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      const sources = await electron.desktopCapturer.getSources({
        types: ["screen", "window"],
        thumbnailSize: { width: 0, height: 0 },
        fetchWindowIcons: false
      });
      const preferred = preferredCaptureSourceId && sources.find((s) => s.id === preferredCaptureSourceId) || sources.find((s) => s.id.startsWith("screen:")) || sources[0];
      if (!preferred) {
        callback({});
        return;
      }
      callback({
        video: preferred,
        // Electron DisplayMediaRequestHandler audio loopback
        audio: "loopback"
      });
    }
  );
  electron.ipcMain.handle("app:getInfo", () => ({
    apiBaseUrl,
    version: electron.app.getVersion(),
    platform: process.platform
  }));
  electron.ipcMain.handle("capture:listSources", async () => {
    const sources = await electron.desktopCapturer.getSources({
      types: ["screen", "window"],
      thumbnailSize: { width: 320, height: 180 }
    });
    const ordered = [
      ...sources.filter((s) => s.id.startsWith("screen:")),
      ...sources.filter((s) => !s.id.startsWith("screen:"))
    ];
    return ordered.map((s) => ({
      id: s.id,
      name: s.name,
      displayId: s.display_id,
      thumbnailDataUrl: s.thumbnail.toDataURL(),
      kind: s.id.startsWith("screen:") ? "screen" : "window"
    }));
  });
  electron.ipcMain.handle("capture:setPreferredSource", (_evt, sourceId) => {
    preferredCaptureSourceId = sourceId || null;
    return { ok: true };
  });
  electron.ipcMain.handle(
    "capture:focusSource",
    async (_evt, payload) => {
      return focusOrOpenCaptureSource(payload);
    }
  );
  electron.ipcMain.handle("recording-bar:show", (_evt, state) => {
    createRecordingBar();
    sendToBar(
      "recording-bar:state",
      state ?? { elapsed: 0, paused: false, muted: false }
    );
    return { ok: true };
  });
  electron.ipcMain.handle("recording-bar:update", (_evt, state) => {
    sendToBar("recording-bar:state", state);
    return { ok: true };
  });
  electron.ipcMain.handle("recording-bar:hide", () => {
    destroyRecordingBar();
    return { ok: true };
  });
  electron.ipcMain.handle("recording:command", (_evt, command) => {
    sendToMain("recording:command", command);
    if (command === "show-app" && mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
    return { ok: true };
  });
  electron.ipcMain.handle("app:minimizeMain", () => {
    mainWindow == null ? void 0 : mainWindow.minimize();
    return { ok: true };
  });
  createWindow();
  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});
electron.app.on("window-all-closed", () => {
  destroyRecordingBar();
  if (process.platform !== "darwin") {
    electron.app.quit();
  }
});
