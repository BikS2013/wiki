// src/llm/anthropic.ts -- Anthropic SDK implementation of LLMProvider

import Anthropic from '@anthropic-ai/sdk';
import type { LLMProvider } from './provider.js';
import type {
  CompletionParams,
  CompletionResult,
  ToolCompletionParams,
  ToolCompletionResult,
  TokenCountResult,
  TokenUsage,
} from './types.js';
import type { LLMConfig } from '../config/types.js';
import { callWithRetry } from './retry.js';
import { estimateTokens } from './tokens.js';

/**
 * LLMProvider implementation backed by the Anthropic Messages API.
 * Uses non-streaming calls for all operations.
 */
export class AnthropicProvider implements LLMProvider {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(config: LLMConfig) {
    this.client = new Anthropic({ apiKey: config.apiKey! });
    this.model = config.model;
  }

  /**
   * Send a text completion request.
   * Extracts text from TextBlock content blocks and maps usage statistics.
   */
  async complete(params: CompletionParams): Promise<CompletionResult> {
    return callWithRetry(async () => {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: params.maxTokens,
        system: params.system,
        messages: this.mapMessages(params.messages),
        ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
      });

      // Extract text from TextBlock content blocks
      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('');

      return {
        text,
        usage: this.mapUsage(response.usage),
        stopReason: response.stop_reason ?? 'unknown',
      };
    });
  }

  /**
   * Send a completion request with tool definitions for structured JSON output.
   * Finds the ToolUseBlock in the response and returns parsed JSON input.
   */
  async completeWithTools(params: ToolCompletionParams): Promise<ToolCompletionResult> {
    return callWithRetry(async () => {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: params.maxTokens,
        system: params.system,
        messages: this.mapMessages(params.messages),
        tools: params.tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.input_schema as Anthropic.Tool.InputSchema,
        })),
        tool_choice: params.toolChoice as Anthropic.MessageCreateParams['tool_choice'],
        ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
      });

      // Find the tool use block in the response
      const toolUseBlock = response.content.find(
        (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
      );

      if (!toolUseBlock) {
        throw new Error('LLM did not return a tool_use response');
      }

      return {
        toolName: toolUseBlock.name,
        toolInput: toolUseBlock.input as Record<string, unknown>,
        usage: this.mapUsage(response.usage),
        stopReason: response.stop_reason ?? 'unknown',
      };
    });
  }

  /**
   * Count tokens for a prompt without executing it.
   *
   * Note: The installed SDK version (0.30.x) does not include
   * client.messages.countTokens(). This implementation uses heuristic
   * estimation as a fallback. When the SDK is upgraded to a version
   * that supports countTokens, replace the body with the API call.
   */
  async countTokens(params: Omit<CompletionParams, 'maxTokens'>): Promise<TokenCountResult> {
    // Build the full prompt text for estimation
    const systemText = params.system;
    const messageText = params.messages
      .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
      .join('\n');
    const fullText = systemText + '\n' + messageText;

    return {
      inputTokens: estimateTokens(fullText),
    };
  }

  /**
   * Map internal MessageParam[] to Anthropic SDK MessageParam[].
   */
  private mapMessages(
    messages: CompletionParams['messages'],
  ): Anthropic.MessageParam[] {
    return messages.map((m) => ({
      role: m.role,
      content: m.content as string | Anthropic.ContentBlock[],
    }));
  }

  /**
   * Map Anthropic SDK usage object to internal TokenUsage.
   * Uses ?? 0 guards for cache fields that may be absent in older SDK versions.
   */
  private mapUsage(usage: Anthropic.Usage): TokenUsage {
    const raw = usage as unknown as Record<string, number | undefined>;
    return {
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cacheCreationTokens: raw['cache_creation_input_tokens'] ?? 0,
      cacheReadTokens: raw['cache_read_input_tokens'] ?? 0,
    };
  }
}
