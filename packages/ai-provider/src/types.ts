import type { ChatMessage } from '@meetingmind/shared';

export interface SummarizeInput {
  transcript: string;
  title?: string;
  ocrText?: string;
  visionNotes?: string[];
}

export interface SummarizeResult {
  executive: string;
  detailed: string;
  topics: string[];
  actionItems: string[];
  decisions: string[];
  risks: string[];
  questions: string[];
}

export interface VisionAnalyzeInput {
  imagePath: string;
  prompt?: string;
}

export interface VisionAnalyzeResult {
  description: string;
  detectedType:
    | 'slide'
    | 'diagram'
    | 'spreadsheet'
    | 'browser'
    | 'whiteboard'
    | 'document'
    | 'other';
  extractedTextHints: string[];
}

export interface EmbedInput {
  texts: string[];
}

export interface EmbedResult {
  vectors: number[][];
  dimensions: number;
}

export interface CompleteInput {
  prompt: string;
  system?: string;
  temperature?: number;
  maxTokens?: number;
  /** Multi-key segregation lane (Groq). */
  route?: 'chat' | 'extract' | 'general';
  /** Force/disable JSON response_format (Groq). Default: on for chat/extract. */
  jsonMode?: boolean;
}

export interface ChatInput {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  route?: 'chat' | 'extract' | 'general';
}

export interface TranscribeInput {
  /** Absolute path to a local audio/video file (wav, mp3, webm, mp4, …). */
  filePath: string;
  language?: string;
  prompt?: string;
}

export interface TranscriptSegmentResult {
  startMs: number;
  endMs: number;
  text: string;
  speakerLabel?: string | null;
}

export interface TranscribeResult {
  text: string;
  language?: string;
  durationSeconds?: number;
  segments: TranscriptSegmentResult[];
  engine: string;
  model: string;
}

/**
 * Provider-agnostic AI surface. Business logic must depend on this
 * interface only — never on a concrete vendor SDK.
 */
export interface AIProvider {
  readonly name: string;
  summarize(input: SummarizeInput): Promise<SummarizeResult>;
  analyzeVision(input: VisionAnalyzeInput): Promise<VisionAnalyzeResult>;
  chat(input: ChatInput): Promise<string>;
  embed(input: EmbedInput): Promise<EmbedResult>;
  complete(input: CompleteInput): Promise<string>;
  transcribe(input: TranscribeInput): Promise<TranscribeResult>;
}

export type AIProviderKind = 'mock' | 'groq' | 'openrouter' | 'openai' | 'ollama';

export interface AIProviderConfig {
  kind: AIProviderKind;
  apiKey?: string;
  /** Multiple keys for rotation (Groq rate-limit failover). */
  apiKeys?: string[];
  /** Optional 0-based lane → key index overrides. */
  laneOverrides?: Partial<
    Record<'whisper' | 'chat' | 'extract' | 'vision' | 'general', number>
  >;
  baseUrl?: string;
  /** Chat / summarization model */
  model?: string;
  /** Speech-to-text model (e.g. whisper-large-v3-turbo) */
  whisperModel?: string;
  /** Vision / OCR model (e.g. meta-llama/llama-4-scout-17b-16e-instruct) */
  visionModel?: string;
  embeddingModel?: string;
}
