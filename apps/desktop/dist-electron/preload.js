"use strict";
const electron = require("electron");
const meetingMind = {
  getAppInfo: () => electron.ipcRenderer.invoke("app:getInfo"),
  listCaptureSources: () => electron.ipcRenderer.invoke("capture:listSources"),
  setPreferredCaptureSource: (sourceId) => electron.ipcRenderer.invoke("capture:setPreferredSource", sourceId),
  focusCaptureSource: (source) => electron.ipcRenderer.invoke("capture:focusSource", source),
  minimizeMain: () => electron.ipcRenderer.invoke("app:minimizeMain"),
  showRecordingBar: (state) => electron.ipcRenderer.invoke("recording-bar:show", state),
  updateRecordingBar: (state) => electron.ipcRenderer.invoke("recording-bar:update", state),
  hideRecordingBar: () => electron.ipcRenderer.invoke("recording-bar:hide"),
  /** Overlay → main process command relay. */
  recordingCommand: (command) => electron.ipcRenderer.invoke("recording:command", command),
  /** Main window listens for commands from the floating bar. */
  onRecordingCommand: (handler) => {
    const listener = (_event, command) => {
      handler(command);
    };
    electron.ipcRenderer.on("recording:command", listener);
    return () => electron.ipcRenderer.removeListener("recording:command", listener);
  },
  /** Floating bar listens for timer / pause / mute state. */
  onRecordingBarState: (handler) => {
    const listener = (_event, state) => {
      handler(state);
    };
    electron.ipcRenderer.on("recording-bar:state", listener);
    return () => electron.ipcRenderer.removeListener("recording-bar:state", listener);
  }
};
electron.contextBridge.exposeInMainWorld("meetingMind", meetingMind);
