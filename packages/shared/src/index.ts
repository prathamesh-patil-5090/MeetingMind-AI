export type MeetingStatus =
  | 'detected'
  | 'recording'
  | 'processing'
  | 'ready'
  | 'failed';

export type MeetingPlatform =
  | 'google_meet'
  | 'microsoft_teams'
  | 'zoom'
  | 'discord'
  | 'slack'
  | 'unknown';

export type PipelineStage =
  | 'audio_extraction'
  | 'transcription'
  | 'diarization'
  | 'ocr'
  | 'vision'
  | 'timeline'
  | 'summary'
  | 'action_items'
  | 'decisions'
  | 'risks'
  | 'questions'
  | 'embeddings'
  | 'storage';

export type PipelineStageStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface Meeting {
  id: string;
  title: string;
  platform: MeetingPlatform;
  status: MeetingStatus;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
  recordingPath: string | null;
  audioPath: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateMeetingInput {
  title?: string;
  platform?: MeetingPlatform;
  startedAt?: string;
}

export interface TranscriptSegment {
  id: string;
  meetingId: string;
  startMs: number;
  endMs: number;
  speakerLabel: string | null;
  text: string;
}

export interface ActionItem {
  id: string;
  meetingId: string;
  text: string;
  assignee: string | null;
  dueDate: string | null;
  completed: boolean;
}

export interface Decision {
  id: string;
  meetingId: string;
  text: string;
}

export interface Risk {
  id: string;
  meetingId: string;
  text: string;
  severity: 'low' | 'medium' | 'high' | null;
}

export interface Question {
  id: string;
  meetingId: string;
  text: string;
  answered: boolean;
}

export interface MeetingSummary {
  meetingId: string;
  executive: string;
  detailed: string;
  topics: string[];
}

export interface TimelineEvent {
  id: string;
  meetingId: string;
  timestampMs: number;
  label: string;
  description: string | null;
}

export interface PipelineJob {
  id: string;
  meetingId: string;
  stage: PipelineStage;
  status: PipelineStageStatus;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface SearchHit {
  meetingId: string;
  meetingTitle: string;
  snippet: string;
  score: number;
  source: 'keyword' | 'semantic' | 'transcript' | 'summary';
}

export const DEFAULT_API_PORT = 3847;
export const DEFAULT_API_BASE_URL = `http://127.0.0.1:${DEFAULT_API_PORT}`;

export const MEETING_STORAGE_LAYOUT = {
  recording: 'recording.mp4',
  audio: 'audio.wav',
  transcript: 'transcript.json',
  summary: 'summary.json',
  metadata: 'metadata.json',
  embeddings: 'embeddings.json',
  screenshotsDir: 'screenshots',
} as const;
