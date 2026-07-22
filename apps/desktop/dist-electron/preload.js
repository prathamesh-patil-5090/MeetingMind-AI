"use strict";
const electron = require("electron");
const meetingMind = {
  getAppInfo: () => electron.ipcRenderer.invoke("app:getInfo"),
  listCaptureSources: () => electron.ipcRenderer.invoke("capture:listSources")
};
electron.contextBridge.exposeInMainWorld("meetingMind", meetingMind);
