import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createAIProvider,
  parseApiKeyList,
  parseLaneOverrides,
  type AIProvider,
  type AIProviderKind,
  type GroqAIProvider,
} from '@meetingmind/ai-provider';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly provider: AIProvider;
  private readonly visionProvider: AIProvider;

  constructor(config: ConfigService) {
    let kind = (config.get<string>('AI_PROVIDER') ?? 'groq') as AIProviderKind;

    const groqKeys = collectGroqApiKeys(config);
    const laneOverrides = parseLaneOverrides({
      GROQ_LANE_WHISPER: config.get<string>('GROQ_LANE_WHISPER') ?? process.env.GROQ_LANE_WHISPER,
      GROQ_LANE_CHAT: config.get<string>('GROQ_LANE_CHAT') ?? process.env.GROQ_LANE_CHAT,
      GROQ_LANE_EXTRACT: config.get<string>('GROQ_LANE_EXTRACT') ?? process.env.GROQ_LANE_EXTRACT,
      GROQ_LANE_VISION: config.get<string>('GROQ_LANE_VISION') ?? process.env.GROQ_LANE_VISION,
      GROQ_LANE_GENERAL: config.get<string>('GROQ_LANE_GENERAL') ?? process.env.GROQ_LANE_GENERAL,
    });

    const openRouterKey = firstNonEmpty(
      config.get<string>('OPENROUTER_API_KEY'),
      process.env.OPENROUTER_API_KEY,
    );

    const apiKey = firstNonEmpty(
      groqKeys[0],
      openRouterKey,
      config.get<string>('OPENAI_API_KEY'),
    );

    if (kind !== 'mock' && !apiKey) {
      this.logger.warn(
        `AI_PROVIDER=${kind} but no API key set — falling back to mock. Add GROQ_API_KEY / GROQ_API_KEYS from console.groq.com`,
      );
      kind = 'mock';
    }

    this.provider = createAIProvider({
      kind,
      apiKey: apiKey || undefined,
      apiKeys: kind === 'groq' ? groqKeys : undefined,
      laneOverrides: kind === 'groq' ? laneOverrides : undefined,
      baseUrl:
        config.get<string>('GROQ_BASE_URL') ?? config.get<string>('OLLAMA_BASE_URL'),
      model:
        config.get<string>('GROQ_MODEL') ??
        config.get<string>('OPENROUTER_MODEL') ??
        'qwen/qwen3.6-27b',
      whisperModel: config.get<string>('GROQ_WHISPER_MODEL') ?? 'whisper-large-v3-turbo',
      visionModel:
        config.get<string>('GROQ_VISION_MODEL') ??
        'meta-llama/llama-4-scout-17b-16e-instruct',
    });

    if (kind === 'groq' && 'keyCount' in this.provider) {
      const groq = this.provider as GroqAIProvider;
      this.logger.log(`Groq API key pool: ${groq.keyCount} key(s) loaded`);
      this.logger.log(`Groq request lanes (key index): ${JSON.stringify(groq.getLaneMap())}`);
    }

    if (openRouterKey) {
      this.visionProvider = createAIProvider({
        kind: 'openrouter',
        apiKey: openRouterKey,
        model: config.get<string>('OPENROUTER_MODEL') ?? 'qwen/qwen-2.5-72b-instruct',
        visionModel:
          config.get<string>('OPENROUTER_VISION_MODEL') ??
          'qwen/qwen2.5-vl-72b-instruct',
      });
      this.logger.log(
        `Vision/OCR provider: openrouter (${config.get<string>('OPENROUTER_VISION_MODEL') ?? 'qwen/qwen2.5-vl-72b-instruct'})`,
      );
    } else {
      this.visionProvider = this.provider;
      this.logger.warn(
        'No OPENROUTER_API_KEY — OCR/vision will use the primary provider (may fail without a vision model)',
      );
    }

    this.logger.log(`AI provider ready: ${this.provider.name}`);
  }

  getProvider(): AIProvider {
    return this.provider;
  }

  getVisionProvider(): AIProvider {
    return this.visionProvider;
  }
}

function collectGroqApiKeys(config: ConfigService): string[] {
  const numbered: string[] = [];
  for (let i = 2; i <= 20; i += 1) {
    numbered.push(
      config.get<string>(`GROQ_API_KEY_${i}`) ?? '',
      process.env[`GROQ_API_KEY_${i}`] ?? '',
    );
  }

  return parseApiKeyList(
    config.get<string>('GROQ_API_KEYS'),
    process.env.GROQ_API_KEYS,
    config.get<string>('GROQ_API_KEY'),
    process.env.GROQ_API_KEY,
    ...numbered,
  );
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (value?.trim()) return value.trim();
  }
  return undefined;
}
