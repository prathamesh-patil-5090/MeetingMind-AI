import { MockAIProvider } from './mock.provider';
import { GroqAIProvider } from './groq.provider';
import { OpenRouterAIProvider } from './openrouter.provider';
import type { AIProvider, AIProviderConfig } from './types';

export function createAIProvider(config: AIProviderConfig): AIProvider {
  switch (config.kind) {
    case 'mock':
      return new MockAIProvider();
    case 'groq':
      return new GroqAIProvider(config);
    case 'openrouter':
      return new OpenRouterAIProvider(config);
    case 'openai':
    case 'ollama':
      throw new Error(
        `AI provider "${config.kind}" is not implemented yet. Use mock, groq, or openrouter.`,
      );
    default: {
      const _exhaustive: never = config.kind;
      throw new Error(`Unknown AI provider: ${_exhaustive}`);
    }
  }
}

export * from './types';
export * from './http-errors';
export * from './api-key-pool';
export { MockAIProvider } from './mock.provider';
export { GroqAIProvider } from './groq.provider';
export { OpenRouterAIProvider } from './openrouter.provider';
