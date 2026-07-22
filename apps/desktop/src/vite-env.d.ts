/// <reference types="vite/client" />

import type { MeetingMindBridge } from '../electron/preload';

declare global {
  interface Window {
    meetingMind: MeetingMindBridge;
  }
}

export {};
