import { contextBridge, ipcRenderer } from 'electron';

export interface CaptureSource {
  id: string;
  name: string;
  displayId: string;
  thumbnailDataUrl: string;
}

export interface AppInfo {
  apiBaseUrl: string;
  version: string;
  platform: string;
}

const meetingMind = {
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke('app:getInfo'),
  listCaptureSources: (): Promise<CaptureSource[]> =>
    ipcRenderer.invoke('capture:listSources'),
};

contextBridge.exposeInMainWorld('meetingMind', meetingMind);

export type MeetingMindBridge = typeof meetingMind;
