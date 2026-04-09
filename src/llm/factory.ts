// src/llm/factory.ts -- Factory function for creating LLM providers

import type { LLMProvider } from './provider.js';
import type { LLMConfig } from '../config/types.js';
import { AnthropicProvider } from './anthropic.js';
import { AzureAIProvider } from './azure.js';
import { VertexAIProvider } from './vertex.js';

/**
 * Create the appropriate LLM provider based on the configuration.
 *
 * Supported providers:
 *   - 'anthropic' -- Anthropic Claude models (direct API)
 *   - 'azure'     -- Azure AI Inference (OpenAI-compatible endpoint)
 *   - 'vertex'    -- Google Vertex AI (Gemini models via ADC)
 *
 * @throws Error if the requested provider is unknown
 */
export function createProvider(config: LLMConfig): LLMProvider {
  switch (config.provider) {
    case 'anthropic':
      return new AnthropicProvider(config);

    case 'azure':
      return new AzureAIProvider(config);

    case 'vertex':
      return new VertexAIProvider(config);

    default: {
      const exhaustive: never = config.provider;
      throw new Error(`Unknown LLM provider: ${exhaustive}`);
    }
  }
}
