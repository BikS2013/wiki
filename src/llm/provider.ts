// src/llm/provider.ts -- Abstract interface for LLM providers

import type {
  CompletionParams,
  CompletionResult,
  ToolCompletionParams,
  ToolCompletionResult,
  TokenCountResult,
} from './types.js';

/**
 * Abstract interface that all LLM provider implementations must satisfy.
 * Consumers depend on this interface, never on a concrete provider class.
 */
export interface LLMProvider {
  /**
   * Send a completion request and return text output.
   * Used for summary generation, page merging, query synthesis.
   */
  complete(params: CompletionParams): Promise<CompletionResult>;

  /**
   * Send a completion request with tool definitions, forcing structured JSON output.
   * Used for entity/topic extraction.
   */
  completeWithTools(params: ToolCompletionParams): Promise<ToolCompletionResult>;

  /**
   * Count tokens for a prompt without executing it. Free API call.
   * Used for pre-call budget verification near context limits.
   */
  countTokens(params: Omit<CompletionParams, 'maxTokens'>): Promise<TokenCountResult>;
}
