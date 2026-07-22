"use strict";
const electron = require("electron");
const path = require("path");
process.env.DIST = path.join(__dirname, "../dist");
process.env.VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
const DEFAULT_API_BASE_URL = "http://127.0.0.1:3847";
const apiBaseUrl = process.env.MEETINGMIND_API_URL ?? DEFAULT_API_BASE_URL;
function createWindow() {
  const win = new electron.BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    title: "MeetingMind AI",
    backgroundColor: "#f4f5f8",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  if (process.env.VITE_DEV_SERVER_URL) {
    void win.loadURL(process.env.VITE_DEV_SERVER_URL);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    void win.loadFile(path.join(process.env.DIST, "index.html"));
  }
}
electron.app.whenReady().then(() => {
  electron.session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    const sources = await electron.desktopCapturer.getSources({
      types: ["screen", "window"],
      thumbnailSize: { width: 0, height: 0 }
    });
    const primary = sources[0];
    if (!primary) {
      callback({});
      return;
    }
    callback({ video: primary });
  });
  electron.ipcMain.handle("app:getInfo", () => ({
    apiBaseUrl,
    version: electron.app.getVersion(),
    platform: process.platform
  }));
  electron.ipcMain.handle("capture:listSources", async () => {
    const sources = await electron.desktopCapturer.getSources({
      types: ["window", "screen"],
      thumbnailSize: { width: 320, height: 180 }
    });
    return sources.map((s) => ({
      id: s.id,
      name: s.name,
      displayId: s.display_id,
      thumbnailDataUrl: s.thumbnail.toDataURL()
    }));
  });
  createWindow();
  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    electron.app.quit();
  }
});
