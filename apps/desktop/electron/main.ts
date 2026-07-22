import {
  app,
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  screen,
  session,
  shell,
} from 'electron';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execFileAsync = promisify(execFile);

process.env.DIST = path.join(__dirname, '../dist');
process.env.VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

const DEFAULT_API_BASE_URL = 'http://127.0.0.1:3847';
const apiBaseUrl = process.env.MEETINGMIND_API_URL ?? DEFAULT_API_BASE_URL;

let mainWindow: BrowserWindow | null = null;
let recordingBar: BrowserWindow | null = null;
/** Preferred desktopCapturer source id for getDisplayMedia / capture. */
let preferredCaptureSourceId: string | null = null;

function preloadPath() {
  return path.join(__dirname, 'preload.js');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    title: 'MeetingMind AI',
    backgroundColor: '#f4f5f8',
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    void mainWindow.loadFile(path.join(process.env.DIST!, 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function recordingBarUrl(): string {
  if (process.env.VITE_DEV_SERVER_URL) {
    return `${process.env.VITE_DEV_SERVER_URL.replace(/\/$/, '')}/recording-bar.html`;
  }
  return path.join(process.env.DIST!, 'recording-bar.html');
}

function createRecordingBar() {
  if (recordingBar && !recordingBar.isDestroyed()) {
    recordingBar.show();
    recordingBar.moveTop();
    return recordingBar;
  }

  const display = screen.getPrimaryDisplay();
  const width = 560;
  const height = 68;
  const x = Math.round(display.workArea.x + (display.workArea.width - width) / 2);
  const y = Math.round(display.workArea.y + 14);

  recordingBar = new BrowserWindow({
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
    title: 'MeetingMind Recording',
    backgroundColor: '#00000000',
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Stay above other apps, including fullscreen meeting tools.
  recordingBar.setAlwaysOnTop(true, 'screen-saver');
  recordingBar.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // Intentionally NOT content-protected — toolbar must appear in the recording.

  const url = recordingBarUrl();
  if (url.startsWith('http')) {
    void recordingBar.loadURL(url);
  } else {
    void recordingBar.loadFile(url);
  }

  recordingBar.once('ready-to-show', () => {
    recordingBar?.showInactive();
  });

  recordingBar.on('closed', () => {
    recordingBar = null;
  });

  // Cannot be closed while recording — hide requests are ignored from UI chrome.
  recordingBar.on('close', (e) => {
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
  recordingBar.removeAllListeners('close');
  recordingBar.destroy();
  recordingBar = null;
}

function sendToMain(channel: string, payload?: unknown) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function sendToBar(channel: string, payload?: unknown) {
  if (recordingBar && !recordingBar.isDestroyed()) {
    recordingBar.webContents.send(channel, payload);
  }
}

/** Parse HWND from Electron desktopCapturer window ids: `window:12345:0`. */
function hwndFromSourceId(sourceId: string): string | null {
  if (!sourceId.startsWith('window:')) return null;
  const parts = sourceId.split(':');
  return parts[1] && /^\d+$/.test(parts[1]) ? parts[1] : null;
}

async function focusWindowsHwnd(hwnd: string): Promise<boolean> {
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
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, timeout: 5000 },
    );
    return true;
  } catch {
    return false;
  }
}

async function focusMacWindowByTitle(title: string): Promise<boolean> {
  const escaped = title.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
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
    const { stdout } = await execFileAsync('osascript', ['-e', script], {
      timeout: 5000,
    });
    return String(stdout).includes('ok');
  } catch {
    return false;
  }
}

function launchUrlForSourceName(name: string): string | null {
  const n = name.toLowerCase();
  if (n.includes('chatgpt')) return 'https://chatgpt.com';
  if (n.includes('claude')) return 'https://claude.ai';
  if (n.includes('gemini') || n.includes('google bard')) return 'https://gemini.google.com';
  if (n.includes('notion')) return 'https://www.notion.so';
  if (n.includes('slack')) return 'https://app.slack.com';
  if (n.includes('zoom')) return 'zoommtg://';
  if (n.includes('microsoft teams') || n.includes('teams')) {
    return 'https://teams.microsoft.com';
  }
  return null;
}

async function focusOrOpenCaptureSource(source: {
  id: string;
  name: string;
}): Promise<{ ok: boolean; action: string }> {
  if (source.id.startsWith('screen:')) {
    return { ok: true, action: 'screen-selected' };
  }

  // Prefer focusing the live OS window.
  if (process.platform === 'win32') {
    const hwnd = hwndFromSourceId(source.id);
    if (hwnd && (await focusWindowsHwnd(hwnd))) {
      return { ok: true, action: 'focused-hwnd' };
    }
  } else if (process.platform === 'darwin') {
    if (await focusMacWindowByTitle(source.name)) {
      return { ok: true, action: 'focused-title' };
    }
  }

  // Fallback: open a known web app (e.g. ChatGPT) in the browser.
  const url = launchUrlForSourceName(source.name);
  if (url) {
    await shell.openExternal(url);
    return { ok: true, action: 'opened-url' };
  }

  return { ok: false, action: 'none' };
}

app.whenReady().then(() => {
  // Use the user's selected source (screen or MeetingMind / any window).
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 0, height: 0 },
      fetchWindowIcons: false,
    });

    const preferred =
      (preferredCaptureSourceId &&
        sources.find((s) => s.id === preferredCaptureSourceId)) ||
      sources.find((s) => s.id.startsWith('screen:')) ||
      sources[0];

    if (!preferred) {
      callback({});
      return;
    }

    // Include loopback system audio when the platform supports it (Windows).
    callback({
      video: preferred,
      // Electron DisplayMediaRequestHandler audio loopback
      audio: 'loopback' as never,
    });
  });

  ipcMain.handle('app:getInfo', () => ({
    apiBaseUrl,
    version: app.getVersion(),
    platform: process.platform,
  }));

  ipcMain.handle('capture:listSources', async () => {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 320, height: 180 },
    });
    // Prefer screens first so MeetingMind itself is included when capturing a full display.
    const ordered = [
      ...sources.filter((s) => s.id.startsWith('screen:')),
      ...sources.filter((s) => !s.id.startsWith('screen:')),
    ];
    return ordered.map((s) => ({
      id: s.id,
      name: s.name,
      displayId: s.display_id,
      thumbnailDataUrl: s.thumbnail.toDataURL(),
      kind: s.id.startsWith('screen:') ? 'screen' : 'window',
    }));
  });

  ipcMain.handle('capture:setPreferredSource', (_evt, sourceId: string) => {
    preferredCaptureSourceId = sourceId || null;
    return { ok: true };
  });

  ipcMain.handle(
    'capture:focusSource',
    async (_evt, payload: { id: string; name: string }) => {
      return focusOrOpenCaptureSource(payload);
    },
  );

  ipcMain.handle('recording-bar:show', (_evt, state) => {
    createRecordingBar();
    sendToBar('recording-bar:state', state ?? { elapsed: 0, paused: false, muted: false });
    return { ok: true };
  });

  ipcMain.handle('recording-bar:update', (_evt, state) => {
    sendToBar('recording-bar:state', state);
    return { ok: true };
  });

  ipcMain.handle('recording-bar:hide', () => {
    destroyRecordingBar();
    return { ok: true };
  });

  ipcMain.handle('recording:command', (_evt, command: string) => {
    sendToMain('recording:command', command);
    if (command === 'show-app' && mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
    return { ok: true };
  });

  ipcMain.handle('app:minimizeMain', () => {
    mainWindow?.minimize();
    return { ok: true };
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  destroyRecordingBar();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
