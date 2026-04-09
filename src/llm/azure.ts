// src/llm/azure.ts -- Azure AI Inference implementation of LLMProvider

import ModelClient, { isUnexpected } from '@azure-rest/ai-inference';
import { AzureKeyCredential } from '@azure/core-auth';
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

/**
 * LLMProvider implementation backed by the Azure AI Inference REST client.
 * Uses `@azure-rest/ai-inference` (REST Level Client pattern) which does NOT
 * throw on HTTP errors -- `isUnexpected()` type guard is used to detect errors.
 * Error responses are converted to thrown Error objects with numeric `.status`
 * so the retry module can classify them.
 */
export class AzureAIProvider implements LLMProvider {
  private readonly client: ReturnType<typeof ModelClient>;
  private readonly model: string;
  private readonly maxTokens: number;

  constructor(config: LLMConfig) {
    // azureEndpoint and apiKey guaranteed by validator for azure provider
    this.client = ModelClient(
      config.azureEndpoint!,
      new AzureKeyCredential(config.apiKey!),
    );
    // azureDeployment is the Azure-specific deployment name;
    // model is used for CONTEXT_LIMITS lookup
    this.model = config.azureDeployment ?? config.model;
    this.maxTokens = config.maxTokens;
  }

  /**
   * Send a text completion request.
   * Maps system prompt as the first message with role 'system' (Azure/OpenAI convention).
   * Extracts text from the first choice and maps usage statistics.
   */
  async complete(params: CompletionParams): Promise<CompletionResult> {
    return callWithRetry(async () => {
      const response = await this.client.path('/chat/completions').post({
        body: {
          model: this.model,
          messages: this.buildMessages(params.system, params.messages),
          max_tokens: params.maxTokens,
          ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
        },
      });

      if (isUnexpected(response)) {
        this.throwFromResponse(response);
      }

      const choice = response.body.choices[0];
      return {
        text: choice.message.content ?? '',
        usage: this.mapUsage(response.body.usage),
        stopReason: choice.finish_reason ?? 'unknown',
      };
    });
  }

  /**
   * Send a completion request with tool definitions for structured JSON output.
   * Maps ToolDefinition to Azure's function tool format and parses tool call arguments.
   */
  async completeWithTools(params: ToolCompletionParams): Promise<ToolCompletionResult> {
    return callWithRetry(async () => {
      const response = await this.client.path('/chat/completions').post({
        body: {
          model: this.model,
          messages: this.buildMessages(params.system, params.messages),
          max_tokens: params.maxTokens,
          tools: params.tools.map((t) => ({
            type: 'function' as const,
            function: {
              name: t.name,
              description: t.description,
              parameters: t.input_schema,
            },
          })),
          tool_choice: this.mapToolChoice(params.toolChoice),
          ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
        },
      });

      if (isUnexpected(response)) {
        this.throwFromResponse(response);
      }

      const choice = response.body.choices[0];
      const toolCall = choice.message.tool_calls?.[0];

      if (!toolCall) {
        throw new Error('Azure AI did not return a tool_call response');
      }

      // Azure returns function arguments as a JSON string -- must parse
      const toolInput = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;

      return {
        toolName: toolCall.function.name,
        toolInput,
        usage: this.mapUsage(response.body.usage),
        stopReason: choice.finish_reason ?? 'unknown',
      };
    });
  }

  /**
   * Count tokens for a prompt without executing it.
   * Azure AI Inference has no native token counting endpoint.
   * Uses heuristic estimation (same approach as Anthropic provider).
   */
  async countTokens(params: Omit<CompletionParams, 'maxTokens'>): Promise<TokenCountResult> {
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
   * Build Azure messages array with system prompt as first message.
   * ContentBlock arrays are flattened to text-only (Azure does not support
   * Anthropic-style content blocks in the REST inference API).
   */
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

  /**
   * Map tool choice from internal format to Azure format.
   * { type: 'tool', name: 'X' } -> { type: 'function', function: { name: 'X' } }
   * { type: 'auto' } -> 'auto'
   */
  private mapToolChoice(
    choice: ToolCompletionParams['toolChoice'],
  ): 'auto' | { type: 'function'; function: { name: string } } {
    if (choice.type === 'auto') return 'auto';
    return { type: 'function', function: { name: choice.name } };
  }

  /**
   * Map Azure usage response to internal TokenUsage.
   * Azure does not support prompt caching, so cache fields are 0.
   */
  private mapUsage(usage: { prompt_tokens: number; completion_tokens: number }): TokenUsage {
    return {
      inputTokens: usage.prompt_tokens,
      outputTokens: usage.completion_tokens,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
    };
  }

  /**
   * Convert an Azure error response (from isUnexpected()) into a thrown error
   * with numeric .status and .headers for the retry module.
   *
   * CRITICAL: Azure response.status is a string (e.g., "429"), but our retry
   * module's getHttpStatus() expects a numeric .status property. This method
   * bridges that gap by parsing the string status to a number.
   */
  private throwFromResponse(response: { status: string; body: any; headers: any }): never {
    const message = response.body?.error?.message ?? 'Azure AI request failed';
    const error = new Error(`Azure AI error [${response.status}]: ${message}`);
    (error as any).status = parseInt(response.status, 10);
    (error as any).headers = response.headers;
    throw error;
  }
}
