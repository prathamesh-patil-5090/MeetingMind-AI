import { app, BrowserWindow, desktopCapturer, ipcMain, session } from 'electron';
import path from 'path';

process.env.DIST = path.join(__dirname, '../dist');
process.env.VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

const DEFAULT_API_BASE_URL = 'http://127.0.0.1:3847';
const apiBaseUrl = process.env.MEETINGMIND_API_URL ?? DEFAULT_API_BASE_URL;

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    title: 'MeetingMind AI',
    backgroundColor: '#f4f5f8',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    void win.loadURL(process.env.VITE_DEV_SERVER_URL);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    void win.loadFile(path.join(process.env.DIST!, 'index.html'));
  }
}

app.whenReady().then(() => {
  // Allow getDisplayMedia / desktop capture in the renderer.
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 0, height: 0 },
    });
    const primary = sources[0];
    if (!primary) {
      callback({});
      return;
    }
    callback({ video: primary });
  });

  ipcMain.handle('app:getInfo', () => ({
    apiBaseUrl,
    version: app.getVersion(),
    platform: process.platform,
  }));

  ipcMain.handle('capture:listSources', async () => {
    const sources = await desktopCapturer.getSources({
      types: ['window', 'screen'],
      thumbnailSize: { width: 320, height: 180 },
    });
    return sources.map((s) => ({
      id: s.id,
      name: s.name,
      displayId: s.display_id,
      thumbnailDataUrl: s.thumbnail.toDataURL(),
    }));
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
