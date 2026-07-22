import { DEFAULT_API_BASE_URL } from '@meetingmind/shared';

let cachedBaseUrl: string | null = null;

async function getBaseUrl(): Promise<string> {
  if (cachedBaseUrl) return cachedBaseUrl;
  if (typeof window !== 'undefined' && window.meetingMind) {
    const info = await window.meetingMind.getAppInfo();
    cachedBaseUrl = info.apiBaseUrl;
    return cachedBaseUrl;
  }
  cachedBaseUrl = (import.meta.env.VITE_API_URL as string | undefined) ?? DEFAULT_API_BASE_URL;
  return cachedBaseUrl;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const base = await getBaseUrl();
  const headers = new Headers(init?.headers);
  // Let the browser set multipart boundary when body is FormData.
  if (!(init?.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const response = await fetch(`${base}/api${path}`, {
    ...init,
    headers,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export interface MeetingListItem {
  id: string;
  title: string;
  platform: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
  recordingPath?: string | null;
  audioPath?: string | null;
  storageDir?: string | null;
  summary?: { executive: string; detailed: string; topics?: string[] } | null;
  _count?: {
    actionItems: number;
    decisions: number;
    transcriptSegs: number;
  };
}

async function mediaUrl(meetingId: string, kind: 'recording' | 'audio'): Promise<string> {
  const base = await getBaseUrl();
  return `${base}/api/meetings/${meetingId}/media/${kind}`;
}

export const api = {
  health: () => request<{ ok: boolean }>('/health'),
  listMeetings: (q?: string) =>
    request<MeetingListItem[]>(`/meetings${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  getMeeting: (id: string) => request<MeetingDetail>(`/meetings/${id}`),
  createMeeting: (body: { title?: string; platform?: string }) =>
    request<MeetingListItem>('/meetings', { method: 'POST', body: JSON.stringify(body) }),
  importMeeting: (file: File, title?: string) => {
    const form = new FormData();
    form.append('file', file);
    if (title) form.append('title', title);
    return request<MeetingListItem>('/meetings/import', {
      method: 'POST',
      body: form,
    });
  },
  startRecording: (id: string) =>
    request<MeetingListItem>(`/meetings/${id}/start-recording`, { method: 'POST' }),
  endMeeting: (
    id: string,
    body?: { recordingPath?: string; audioPath?: string },
  ) =>
    request<MeetingListItem>(`/meetings/${id}/end`, {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
    }),
  attachRecording: (id: string, file: Blob, filename = 'recording.webm') => {
    const form = new FormData();
    form.append('file', file, filename);
    return request<MeetingListItem>(`/meetings/${id}/recording`, {
      method: 'POST',
      body: form,
    });
  },
  processMeeting: (id: string) =>
    request<{ meetingId: string; status: string }>(`/meetings/${id}/process`, {
      method: 'POST',
    }),
  pipelineStatus: (id: string) =>
    request<
      Array<{ stage: string; status: string; error: string | null }>
    >(`/pipeline/${id}`),
  search: (q: string, limit = 20) =>
    request<
      Array<{
        meetingId: string;
        meetingTitle: string;
        snippet: string;
        score: number;
        source: string;
      }>
    >(`/search?q=${encodeURIComponent(q)}&limit=${limit}`),
  mediaUrl,
};

export interface MeetingDetail extends MeetingListItem {
  transcriptSegs: Array<{
    id: string;
    startMs: number;
    endMs: number;
    speakerLabel: string | null;
    text: string;
  }>;
  actionItems: Array<{ id: string; text: string; assignee: string | null; completed: boolean }>;
  decisions: Array<{ id: string; text: string }>;
  risks: Array<{ id: string; text: string }>;
  questions: Array<{ id: string; text: string }>;
  topics: Array<{ id: string; name: string }>;
  timelineEvents?: Array<{
    id: string;
    timestampMs: number;
    label: string;
    description: string | null;
  }>;
  ocrResults?: Array<{ id: string; text: string }>;
  visionAnalyses?: Array<{
    id: string;
    description: string;
    detectedType: string | null;
  }>;
  pipelineJobs: Array<{ stage: string; status: string; error: string | null }>;
}
