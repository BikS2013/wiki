// src/llm/azure.ts -- Azure OpenAI implementation of LLMProvider

import type { LLMProvider } from './provider.js';
import type {
  CompletionParams,
  CompletionResult,
  ToolCompletionParams,
  ToolCompletionResult,
  TokenCountResult,
  TokenUsage,
  MessageParam,
} from './types.js';
import type { LLMConfig } from '../config/types.js';
import { callWithRetry } from './retry.js';
import { estimateTokens } from './tokens.js';

const AZURE_API_VERSION = '2025-01-01-preview';

/**
 * LLMProvider implementation backed by Azure OpenAI REST API.
 * Uses direct fetch calls for maximum compatibility with newer models
 * (e.g., gpt-5.1 which requires max_completion_tokens instead of max_tokens).
 */
export class AzureAIProvider implements LLMProvider {
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly deployment: string;
  private readonly model: string;

  constructor(config: LLMConfig) {
    this.endpoint = config.azureEndpoint!;
    this.apiKey = config.apiKey!;
    this.deployment = config.azureDeployment ?? config.model;
    this.model = config.model;
  }

  async complete(params: CompletionParams): Promise<CompletionResult> {
    return callWithRetry(async () => {
      const body = {
        messages: this.buildMessages(params.system, params.messages),
        max_completion_tokens: params.maxTokens,
        ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
      };

      const result = await this.post(body);
      const choice = result.choices[0];

      return {
        text: choice.message.content ?? '',
        usage: this.mapUsage(result.usage),
        stopReason: choice.finish_reason ?? 'unknown',
      };
    });
  }

  async completeWithTools(params: ToolCompletionParams): Promise<ToolCompletionResult> {
    return callWithRetry(async () => {
      const body = {
        messages: this.buildMessages(params.system, params.messages),
        max_completion_tokens: params.maxTokens,
        tools: params.tools.map((t) => ({
          type: 'function',
          function: {
            name: t.name,
            description: t.description,
            parameters: t.input_schema,
          },
        })),
        tool_choice: this.mapToolChoice(params.toolChoice),
        ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
      };

      const result = await this.post(body);
      const choice = result.choices[0];
      const toolCall = choice.message.tool_calls?.[0];

      if (!toolCall) {
        throw new Error('Azure OpenAI did not return a tool_call response');
      }

      const toolInput = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;

      return {
        toolName: toolCall.function.name,
        toolInput,
        usage: this.mapUsage(result.usage),
        stopReason: choice.finish_reason ?? 'unknown',
      };
    });
  }

  async countTokens(params: Omit<CompletionParams, 'maxTokens'>): Promise<TokenCountResult> {
    const systemText = params.system;
    const messageText = params.messages
      .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
      .join('\n');
    return { inputTokens: estimateTokens(systemText + '\n' + messageText) };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * POST to Azure OpenAI chat completions endpoint.
   * Throws an error with numeric .status on failure for retry classification.
   */
  private async post(body: Record<string, unknown>): Promise<any> {
    const url = `${this.endpoint}/openai/deployments/${this.deployment}/chat/completions?api-version=${AZURE_API_VERSION}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'api-key': this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const json = await response.json();

    if (!response.ok) {
      const message = json?.error?.message ?? `Azure OpenAI request failed`;
      const error = new Error(`Azure AI error [${response.status}]: ${message}`);
      (error as any).status = response.status;
      throw error;
    }

    return json;
  }

  private buildMessages(
    system: string,
    messages: MessageParam[],
  ): Array<{ role: string; content: string }> {
    const azureMessages: Array<{ role: string; content: string }> = [
      { role: 'system', content: system },
    ];

    for (const m of messages) {
      const content = typeof m.content === 'string'
        ? m.content
        : m.content.filter((b) => b.type === 'text').map((b) => b.text!).join('');
      azureMessages.push({ role: m.role, content });
    }

    return azureMessages;
  }

  private mapToolChoice(
    choice: ToolCompletionParams['toolChoice'],
  ): 'auto' | { type: 'function'; function: { name: string } } {
    if (choice.type === 'auto') return 'auto';
    return { type: 'function', function: { name: choice.name } };
  }

  private mapUsage(usage: { prompt_tokens: number; completion_tokens: number }): TokenUsage {
    return {
      inputTokens: usage.prompt_tokens,
      outputTokens: usage.completion_tokens,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
    };
  }
}
