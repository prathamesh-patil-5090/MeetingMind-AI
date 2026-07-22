import type { ChatMessage } from '@meetingmind/shared';
import {
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

interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
}

/**
 * OpenRouter-backed provider. Uses OpenAI-compatible chat completions + vision.
 */
export class OpenRouterAIProvider implements AIProvider {
  readonly name = 'openrouter';

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly visionModel: string;

  constructor(config: AIProviderConfig) {
    if (!config.apiKey) {
      throw new Error('OpenRouterAIProvider requires apiKey');
    }
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? 'https://openrouter.ai/api/v1';
    this.model = config.model ?? 'qwen/qwen-2.5-72b-instruct';
    this.visionModel =
      config.visionModel ?? 'qwen/qwen2.5-vl-72b-instruct';
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
      system: 'Respond with valid JSON only. No markdown fences.',
      temperature: 0.2,
    });

    return this.parseSummarizeJson(raw, input.title);
  }

  async analyzeVision(input: VisionAnalyzeInput): Promise<VisionAnalyzeResult> {
    const { readFile } = await import('fs/promises');
    const { basename } = await import('path');
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

    return withProviderRetries('openrouter-vision', async () => {
      let response: Response;
      try {
        response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://meetingmind.local',
            'X-Title': 'MeetingMind AI',
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
        });
      } catch (err) {
        throw classifyFetchFailure(err);
      }

      if (!response.ok) {
        await throwForHttpError('openrouter', response, `vision:${this.visionModel}`);
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const raw = data.choices?.[0]?.message?.content ?? '';
      return this.parseVisionJson(raw);
    });
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
    return this.chatCompletions(input.messages, input.temperature, input.maxTokens);
  }

  async embed(input: EmbedInput): Promise<EmbedResult> {
    // Phase 2: wire OpenRouter / dedicated embedding model.
    const dimensions = 8;
    const vectors = input.texts.map(() => new Array<number>(dimensions).fill(0));
    return { vectors, dimensions };
  }

  async complete(input: CompleteInput): Promise<string> {
    const messages: ChatMessage[] = [];
    if (input.system) {
      messages.push({ role: 'system', content: input.system });
    }
    messages.push({ role: 'user', content: input.prompt });
    return this.chatCompletions(messages, input.temperature, input.maxTokens);
  }

  async transcribe(_input: TranscribeInput): Promise<TranscribeResult> {
    throw new Error(
      'Speech-to-text is not available on OpenRouter. Use AI_PROVIDER=groq for Whisper.',
    );
  }

  private async chatCompletions(
    messages: ChatMessage[],
    temperature = 0.3,
    maxTokens = 2048,
  ): Promise<string> {
    return withProviderRetries('openrouter-chat', async () => {
      const body = {
        model: this.model,
        temperature,
        max_tokens: maxTokens,
        messages: messages as OpenRouterMessage[],
      };

      let response: Response;
      try {
        response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://meetingmind.local',
            'X-Title': 'MeetingMind AI',
          },
          body: JSON.stringify(body),
        });
      } catch (err) {
        throw classifyFetchFailure(err);
      }

      if (!response.ok) {
        await throwForHttpError('openrouter', response, `chat:${this.model}`);
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error('OpenRouter returned empty content');
      }
      return content;
    });
  }

  private parseSummarizeJson(raw: string, title?: string): SummarizeResult {
    const cleaned = stripModelThinking(raw)
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    try {
      const parsed = JSON.parse(cleaned) as Partial<SummarizeResult>;
      return {
        executive: stripModelThinking(
          parsed.executive ?? `Summary for ${title ?? 'meeting'}`,
        ),
        detailed: stripModelThinking(parsed.detailed ?? cleaned),
        topics: parsed.topics ?? [],
        actionItems: parsed.actionItems ?? [],
        decisions: parsed.decisions ?? [],
        risks: parsed.risks ?? [],
        questions: parsed.questions ?? [],
      };
    } catch {
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
