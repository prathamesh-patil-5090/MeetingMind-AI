import { createReadStream } from 'fs';
import { basename } from 'path';
import { stat } from 'fs/promises';
import type { ChatMessage } from '@meetingmind/shared';
import { ApiKeyPool, parseApiKeyList, type GroqRequestLane } from './api-key-pool';
import {
  ProviderHttpError,
  classifyFetchFailure,
  throwForHttpError,
  withProviderRetries,
} from './http-errors';
import type {
  AIProvider,
  AIProviderConfig,
  ChatInput,
  CompleteInput,
  EmbedInput,
  EmbedResult,
  SummarizeInput,
  SummarizeResult,
  TranscribeInput,
  TranscribeResult,
  VisionAnalyzeInput,
  VisionAnalyzeResult,
} from './types';

interface GroqChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface GroqVerboseSegment {
  id?: number;
  start: number;
  end: number;
  text: string;
}

interface GroqVerboseTranscription {
  text: string;
  language?: string;
  duration?: number;
  segments?: GroqVerboseSegment[];
}

const DEFAULT_CHAT_MODEL = 'qwen/qwen3.6-27b';
const DEFAULT_WHISPER_MODEL = 'whisper-large-v3-turbo';
const DEFAULT_VISION_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';
const DEFAULT_BASE_URL = 'https://api.groq.com/openai/v1';

/**
 * Groq Console provider — Whisper STT + LLM + optional vision.
 * Supports multiple API keys with rotation on rate limits.
 * @see https://console.groq.com/docs/speech-to-text
 */
export class GroqAIProvider implements AIProvider {
  readonly name = 'groq';

  private readonly keyPool: ApiKeyPool;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly whisperModel: string;
  private readonly visionModel: string;

  constructor(config: AIProviderConfig) {
    const keys = parseApiKeyList(
      ...(config.apiKeys ?? []),
      config.apiKey,
    );
    if (!keys.length) {
      throw new Error('GroqAIProvider requires GROQ_API_KEY or GROQ_API_KEYS');
    }
    this.keyPool = new ApiKeyPool(keys, config.laneOverrides);
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.model = config.model ?? DEFAULT_CHAT_MODEL;
    this.whisperModel = config.whisperModel ?? DEFAULT_WHISPER_MODEL;
    this.visionModel = config.visionModel ?? DEFAULT_VISION_MODEL;
  }

  get keyCount(): number {
    return this.keyPool.size;
  }

  getLaneMap(): Record<GroqRequestLane, number> {
    return this.keyPool.laneMap();
  }

  async summarize(input: SummarizeInput): Promise<SummarizeResult> {
    const prompt = [
      'You are MeetingMind. Produce structured JSON only with keys:',
      'executive, detailed, topics (string[]), actionItems (string[]),',
      'decisions (string[]), risks (string[]), questions (string[]).',
      '',
      `Title: ${input.title ?? 'Untitled meeting'}`,
      '',
      'Transcript:',
      input.transcript,
      input.ocrText ? `\nOCR:\n${input.ocrText}` : '',
      input.visionNotes?.length ? `\nVision notes:\n${input.visionNotes.join('\n')}` : '',
    ].join('\n');

    const raw = await this.complete({
      prompt,
      system:
        'Respond with valid JSON only. No markdown fences. Do not include thinking, analysis, or <think> tags. /no_think',
      temperature: 0.2,
      maxTokens: 4096,
      route: 'chat',
    });

    return this.parseSummarizeJson(raw, input.title);
  }

  async analyzeVision(input: VisionAnalyzeInput): Promise<VisionAnalyzeResult> {
    const { readFile } = await import('fs/promises');
    const bytes = await readFile(input.imagePath);
    const ext = basename(input.imagePath).split('.').pop()?.toLowerCase() ?? 'jpg';
    const mime =
      ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    const dataUrl = `data:${mime};base64,${bytes.toString('base64')}`;

    const prompt =
      input.prompt ??
      [
        'Analyze this meeting screenshot. Return JSON only with keys:',
        'description (string), detectedType (one of: slide|diagram|spreadsheet|browser|whiteboard|document|other),',
        'extractedTextHints (string[] of visible text / labels).',
      ].join(' ');

    const response = await this.fetchWithErrors(
      `${this.baseUrl}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.visionModel,
          temperature: 0.1,
          max_tokens: 1024,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                { type: 'image_url', image_url: { url: dataUrl } },
              ],
            },
          ],
        }),
      },
      'vision',
      'vision' as GroqRequestLane,
    );

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = data.choices?.[0]?.message?.content ?? '';
    return this.parseVisionJson(raw);
  }

  private parseVisionJson(raw: string): VisionAnalyzeResult {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    try {
      const parsed = JSON.parse(cleaned) as Partial<VisionAnalyzeResult>;
      const allowed = new Set([
        'slide',
        'diagram',
        'spreadsheet',
        'browser',
        'whiteboard',
        'document',
        'other',
      ]);
      const detectedType = allowed.has(String(parsed.detectedType))
        ? (parsed.detectedType as VisionAnalyzeResult['detectedType'])
        : 'other';
      return {
        description: parsed.description ?? cleaned.slice(0, 500),
        detectedType,
        extractedTextHints: parsed.extractedTextHints ?? [],
      };
    } catch {
      return {
        description: cleaned.slice(0, 800) || 'No vision description returned.',
        detectedType: 'other',
        extractedTextHints: [],
      };
    }
  }

  async chat(input: ChatInput): Promise<string> {
    return this.chatCompletions(
      input.messages,
      input.temperature,
      input.maxTokens,
      input.route ?? 'chat',
    );
  }

  async embed(input: EmbedInput): Promise<EmbedResult> {
    // Groq does not ship embedding models; use a local deterministic vector until a vector DB + embedder is wired.
    const dimensions = 32;
    const vectors = input.texts.map((text) => {
      const vec = new Array<number>(dimensions).fill(0);
      for (let i = 0; i < text.length; i += 1) {
        vec[i % dimensions] += text.charCodeAt(i) / 255;
      }
      return vec;
    });
    return { vectors, dimensions };
  }

  async complete(input: CompleteInput): Promise<string> {
    const messages: ChatMessage[] = [];
    if (input.system) {
      messages.push({ role: 'system', content: input.system });
    }
    messages.push({ role: 'user', content: input.prompt });
    return this.chatCompletions(
      messages,
      input.temperature,
      input.maxTokens,
      input.route ?? 'chat',
      { jsonMode: input.route === 'chat' || input.route === 'extract' },
    );
  }

  async transcribe(input: TranscribeInput): Promise<TranscribeResult> {
    const info = await stat(input.filePath);
    if (info.size === 0) {
      throw new Error(`Audio file is empty: ${input.filePath}`);
    }
    // Groq max ~25MB per request
    if (info.size > 25 * 1024 * 1024) {
      throw new Error(
        `Audio file exceeds Groq 25MB limit (${Math.round(info.size / 1024 / 1024)}MB): ${input.filePath}`,
      );
    }

    return withProviderRetries('groq-whisper', async () => {
      const form = new FormData();
      const blob = await fileToBlob(input.filePath);
      form.append('file', blob, basename(input.filePath));
      form.append('model', this.whisperModel);
      form.append('response_format', 'verbose_json');
      form.append('temperature', '0');
      if (input.language) {
        form.append('language', input.language);
      }
      if (input.prompt) {
        form.append('prompt', input.prompt);
      }

      const response = await this.fetchWithErrors(
        `${this.baseUrl}/audio/transcriptions`,
        {
          method: 'POST',
          body: form,
        },
        'whisper-transcribe',
        'whisper',
      );

      const data = (await response.json()) as GroqVerboseTranscription;
      const segments =
        data.segments?.map((seg) => ({
          startMs: Math.round(seg.start * 1000),
          endMs: Math.round(seg.end * 1000),
          text: seg.text.trim(),
          speakerLabel: null as string | null,
        })) ??
        (data.text
          ? [
              {
                startMs: 0,
                endMs: Math.round((data.duration ?? 0) * 1000),
                text: data.text.trim(),
                speakerLabel: null as string | null,
              },
            ]
          : []);

      return {
        text: data.text?.trim() ?? segments.map((s) => s.text).join(' '),
        language: data.language,
        durationSeconds: data.duration,
        segments,
        engine: 'groq-whisper',
        model: this.whisperModel,
      };
    });
  }

  private async chatCompletions(
    messages: ChatMessage[],
    temperature = 0.3,
    maxTokens = 2048,
    lane: GroqRequestLane = 'chat',
    opts: { jsonMode?: boolean } = {},
  ): Promise<string> {
    return withProviderRetries(`groq-${lane}`, async () => {
      const body: Record<string, unknown> = {
        model: this.model,
        temperature,
        max_tokens: maxTokens,
        messages: messages as GroqChatMessage[],
        // Qwen 3.x on Groq: disable reasoning so JSON jobs aren't eaten by <think>.
        reasoning_effort: 'none',
      };
      if (opts.jsonMode) {
        body.response_format = { type: 'json_object' };
      }

      const response = await this.fetchWithErrors(
        `${this.baseUrl}/chat/completions`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        },
        `chat:${this.model}`,
        lane,
      );

      const data = (await response.json()) as {
        choices?: Array<{
          message?: {
            content?: string | null;
            reasoning?: string | null;
            reasoning_content?: string | null;
          };
        }>;
      };
      const message = data.choices?.[0]?.message;
      let content = message?.content?.trim() ?? '';
      if (!content) {
        content = stripModelThinking(
          message?.reasoning_content || message?.reasoning || '',
        );
      } else {
        content = stripModelThinking(content);
      }
      if (!content) {
        throw new Error('Groq returned empty content');
      }
      return content;
    });
  }

  private async fetchWithErrors(
    url: string,
    init: RequestInit,
    operation: string,
    lane: GroqRequestLane = 'general',
  ): Promise<Response> {
    const attempts = Math.max(1, this.keyPool.size);
    let lastError: unknown;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const key = this.keyPool.acquire(lane);
      const headers = new Headers(init.headers);
      headers.set('Authorization', `Bearer ${key}`);

      // eslint-disable-next-line no-console
      console.log(
        `[groq] lane=${lane} key=${this.keyPool.fingerprint(key)} op=${operation}`,
      );

      let response: Response;
      try {
        response = await fetch(url, { ...init, headers });
      } catch (err) {
        throw classifyFetchFailure(err);
      }

      if (response.ok) {
        this.keyPool.advanceLane(lane);
        return response;
      }

      try {
        await throwForHttpError(
          'groq',
          response,
          `${operation} lane=${lane} key=${this.keyPool.fingerprint(key)}`,
        );
      } catch (err) {
        lastError = err;
        if (
          err instanceof ProviderHttpError &&
          (err.kind === 'rate_limit' || err.kind === 'quota') &&
          this.keyPool.size > 1
        ) {
          const next = this.keyPool.markRateLimited(
            key,
            lane,
            err.retryAfterSec ?? 60,
          );
          // eslint-disable-next-line no-console
          console.warn(
            `[groq] ${err.kind} lane=${lane} on ${this.keyPool.fingerprint(key)} — failover to ${this.keyPool.fingerprint(next)}`,
          );
          continue;
        }
        throw err;
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error('All Groq API keys failed');
  }

  private parseSummarizeJson(raw: string, title?: string): SummarizeResult {
    const cleaned = stripModelThinking(raw)
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    const parsed = tryParseSummarizeObject(cleaned);
    if (parsed) {
      const executive = preferCleanSummaryField(
        parsed.executive,
        parsed.detailed,
        `Summary for ${title ?? 'meeting'}`,
      );
      const detailed = preferCleanSummaryField(
        parsed.detailed,
        parsed.executive,
        cleaned,
      );
      return {
        executive,
        detailed,
        topics: parsed.topics ?? [],
        actionItems: parsed.actionItems ?? [],
        decisions: parsed.decisions ?? [],
        risks: parsed.risks ?? [],
        questions: parsed.questions ?? [],
      };
    }

    return {
      executive: cleaned.slice(0, 400),
      detailed: cleaned,
      topics: [],
      actionItems: [],
      decisions: [],
      risks: [],
      questions: [],
    };
  }
}

function tryParseSummarizeObject(text: string): Partial<{
  executive: string;
  detailed: string;
  topics: string[];
  actionItems: string[];
  decisions: string[];
  risks: string[];
  questions: string[];
}> | null {
  const candidates = [text];
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    candidates.push(text.slice(start, end + 1));
  }
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as Record<string, unknown>;
      if (
        typeof parsed.executive === 'string' ||
        typeof parsed.detailed === 'string'
      ) {
        return parsed as Partial<{
          executive: string;
          detailed: string;
          topics: string[];
          actionItems: string[];
          decisions: string[];
          risks: string[];
          questions: string[];
        }>;
      }
    } catch {
      // try next
    }
  }
  return null;
}

function looksLikePromptEcho(text: string | undefined): boolean {
  if (!text) return true;
  return (
    /here'?s a thinking process/i.test(text) ||
    /analyze user input/i.test(text) ||
    /required keys/i.test(text) ||
    /output format/i.test(text) ||
    /<think\b/i.test(text)
  );
}

function preferCleanSummaryField(
  primary: string | undefined,
  fallback: string | undefined,
  lastResort: string,
): string {
  const a = stripModelThinking(primary ?? '');
  if (a && !looksLikePromptEcho(a)) return a;
  const nested = tryParseSummarizeObject(fallback ?? '');
  if (nested?.executive && !looksLikePromptEcho(nested.executive)) {
    return stripModelThinking(nested.executive);
  }
  if (nested?.detailed && !looksLikePromptEcho(nested.detailed)) {
    return stripModelThinking(nested.detailed);
  }
  const b = stripModelThinking(fallback ?? '');
  if (b && !looksLikePromptEcho(b)) return b;
  return stripModelThinking(lastResort).slice(0, 500);
}

function stripModelThinking(text: string): string {
  let out = text
    .replace(/<think\b[^>]*>[\s\S]*?<\/(?:think|thinking)>/gi, '')
    .replace(/<\/?(?:think|thinking)\b[^>]*>/gi, '');
  const unclosed = out.search(/<think\b/i);
  if (unclosed >= 0) {
    const after = out.slice(unclosed);
    const jsonStart = after.search(/\{[\s\S]*"(?:executive|detailed)"/);
    out =
      out.slice(0, unclosed) + (jsonStart >= 0 ? after.slice(jsonStart) : '');
  }
  return out.trim();
}

async function fileToBlob(filePath: string): Promise<Blob> {
  // Stream into Buffer for FormData compatibility across Node versions.
  const chunks: Buffer[] = [];
  const stream = createReadStream(filePath);
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const buffer = Buffer.concat(chunks);
  const ext = basename(filePath).split('.').pop()?.toLowerCase();
  const type = mimeForExt(ext);
  return new Blob([buffer], { type });
}

function mimeForExt(ext?: string): string {
  switch (ext) {
    case 'wav':
      return 'audio/wav';
    case 'mp3':
      return 'audio/mpeg';
    case 'm4a':
      return 'audio/mp4';
    case 'ogg':
      return 'audio/ogg';
    case 'flac':
      return 'audio/flac';
    case 'webm':
      return 'audio/webm';
    case 'mp4':
      return 'video/mp4';
    case 'mpeg':
    case 'mpga':
      return 'audio/mpeg';
    default:
      return 'application/octet-stream';
  }
}
