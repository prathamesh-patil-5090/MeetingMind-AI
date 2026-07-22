import type {
  AIProvider,
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

/** Deterministic offline provider for local development without API keys. */
export class MockAIProvider implements AIProvider {
  readonly name = 'mock';

  async summarize(input: SummarizeInput): Promise<SummarizeResult> {
    const preview = input.transcript.slice(0, 200) || 'No transcript yet.';
    return {
      executive: `Mock executive summary for "${input.title ?? 'Meeting'}": ${preview}`,
      detailed: `Mock detailed summary.\n\nTranscript excerpt:\n${preview}`,
      topics: ['general discussion'],
      actionItems: ['Follow up on open items'],
      decisions: ['No decisions extracted (mock)'],
      risks: [],
      questions: [],
    };
  }

  async analyzeVision(_input: VisionAnalyzeInput): Promise<VisionAnalyzeResult> {
    return {
      description: 'Mock vision analysis: screen content detected.',
      detectedType: 'other',
      extractedTextHints: [],
    };
  }

  async chat(input: ChatInput): Promise<string> {
    const last = [...input.messages].reverse().find((m) => m.role === 'user');
    return `Mock reply to: ${last?.content ?? '(empty)'}`;
  }

  async embed(input: EmbedInput): Promise<EmbedResult> {
    const dimensions = 8;
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
    return `Mock completion for: ${input.prompt.slice(0, 120)}`;
  }

  async transcribe(_input: TranscribeInput): Promise<TranscribeResult> {
    return {
      text: 'Mock transcript (set AI_PROVIDER=groq and GROQ_API_KEY for real Whisper).',
      language: 'en',
      durationSeconds: 12,
      segments: [
        {
          startMs: 0,
          endMs: 5000,
          text: 'Welcome everyone. This is a placeholder transcript.',
          speakerLabel: 'Speaker 1',
        },
        {
          startMs: 5000,
          endMs: 12000,
          text: 'We should track action items and decisions for this meeting.',
          speakerLabel: 'Speaker 2',
        },
      ],
      engine: 'mock',
      model: 'mock-whisper',
    };
  }
}
