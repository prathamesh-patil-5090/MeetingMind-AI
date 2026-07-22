import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

export interface CaptureSource {
  id: string;
  name: string;
  displayId: string;
  thumbnailDataUrl: string;
  kind?: 'screen' | 'window';
}

export interface AppInfo {
  apiBaseUrl: string;
  version: string;
  platform: string;
}

export type RecordingBarState = {
  elapsed: number;
  paused: boolean;
  muted: boolean;
};

export type RecordingCommand =
  | 'toggle-pause'
  | 'toggle-mute'
  | 'stop'
  | 'show-app';

const meetingMind = {
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke('app:getInfo'),
  listCaptureSources: (): Promise<CaptureSource[]> =>
    ipcRenderer.invoke('capture:listSources'),
  setPreferredCaptureSource: (sourceId: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('capture:setPreferredSource', sourceId),
  focusCaptureSource: (source: {
    id: string;
    name: string;
  }): Promise<{ ok: boolean; action: string }> =>
    ipcRenderer.invoke('capture:focusSource', source),
  minimizeMain: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('app:minimizeMain'),

  showRecordingBar: (state?: RecordingBarState): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('recording-bar:show', state),
  updateRecordingBar: (state: RecordingBarState): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('recording-bar:update', state),
  hideRecordingBar: (): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('recording-bar:hide'),

  /** Overlay → main process command relay. */
  recordingCommand: (command: RecordingCommand): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('recording:command', command),

  /** Main window listens for commands from the floating bar. */
  onRecordingCommand: (handler: (command: RecordingCommand) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, command: RecordingCommand) => {
      handler(command);
    };
    ipcRenderer.on('recording:command', listener);
    return () => ipcRenderer.removeListener('recording:command', listener);
  },

  /** Floating bar listens for timer / pause / mute state. */
  onRecordingBarState: (handler: (state: RecordingBarState) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, state: RecordingBarState) => {
      handler(state);
    };
    ipcRenderer.on('recording-bar:state', listener);
    return () => ipcRenderer.removeListener('recording-bar:state', listener);
  },
};

contextBridge.exposeInMainWorld('meetingMind', meetingMind);

export type MeetingMindBridge = typeof meetingMind;
