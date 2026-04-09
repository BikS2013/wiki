// src/llm/vertex.ts -- Google Vertex AI (Gemini) implementation of LLMProvider

import { GoogleGenAI, FunctionCallingConfigMode } from '@google/genai';
import type { Content, FunctionDeclaration } from '@google/genai';
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

/**
 * LLMProvider implementation backed by Google Vertex AI (Gemini models).
 * Uses the @google/genai SDK with Vertex AI backend and Application Default Credentials.
 */
export class VertexAIProvider implements LLMProvider {
  private readonly ai: GoogleGenAI;
  private readonly model: string;
  private readonly maxTokens: number;

  constructor(config: LLMConfig) {
    // vertexProjectId and vertexLocation guaranteed by config validator
    this.ai = new GoogleGenAI({
      vertexai: true,
      project: config.vertexProjectId!,
      location: config.vertexLocation!,
    });
    this.model = config.model;
    this.maxTokens = config.maxTokens;
  }

  /**
   * Send a text completion request via Gemini generateContent.
   * System prompt is passed as config.systemInstruction (Gemini convention).
   */
  async complete(params: CompletionParams): Promise<CompletionResult> {
    return callWithRetry(async () => {
      const response = await this.ai.models.generateContent({
        model: this.model,
        contents: this.mapMessages(params.messages),
        config: {
          systemInstruction: params.system,
          maxOutputTokens: params.maxTokens,
          ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
        },
      });

      return {
        text: response.text ?? '',
        usage: this.mapUsage(response),
        stopReason: response.candidates?.[0]?.finishReason ?? 'unknown',
      };
    });
  }

  /**
   * Send a completion request with tool definitions for structured JSON output.
   * Maps internal ToolDefinition to Gemini FunctionDeclaration using parametersJsonSchema.
   * Forces tool use via FunctionCallingConfigMode.ANY when toolChoice specifies a tool.
   */
  async completeWithTools(params: ToolCompletionParams): Promise<ToolCompletionResult> {
    return callWithRetry(async () => {
      const response = await this.ai.models.generateContent({
        model: this.model,
        contents: this.mapMessages(params.messages),
        config: {
          systemInstruction: params.system,
          maxOutputTokens: params.maxTokens,
          tools: [{
            functionDeclarations: params.tools.map((t) => ({
              name: t.name,
              description: t.description,
              parametersJsonSchema: t.input_schema,
            } as FunctionDeclaration)),
          }],
          toolConfig: {
            functionCallingConfig: this.mapToolChoice(params.toolChoice),
          },
          ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
        },
      });

      const calls = response.functionCalls;
      if (!calls || calls.length === 0) {
        throw new Error('Vertex AI did not return a function call response');
      }

      const call = calls[0];

      return {
        toolName: call.name!,
        // call.args is already a parsed object (NOT a JSON string)
        toolInput: (call.args ?? {}) as Record<string, unknown>,
        usage: this.mapUsage(response),
        stopReason: response.candidates?.[0]?.finishReason ?? 'unknown',
      };
    });
  }

  /**
   * Count tokens for a prompt using the native Gemini countTokens API.
   * More accurate than heuristic estimation used by other providers.
   */
  async countTokens(params: Omit<CompletionParams, 'maxTokens'>): Promise<TokenCountResult> {
    const result = await this.ai.models.countTokens({
      model: this.model,
      contents: this.mapMessages(params.messages),
    });

    return {
      inputTokens: result.totalTokens ?? 0,
    };
  }

  /**
   * Map internal MessageParam[] to Gemini Content[] format.
   * - role "assistant" becomes "model" (Gemini convention)
   * - content is wrapped in parts: [{ text: ... }]
   */
  private mapMessages(messages: MessageParam[]): Content[] {
    return messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : m.role,
      parts: typeof m.content === 'string'
        ? [{ text: m.content }]
        : m.content
            .filter((block) => block.type === 'text')
            .map((block) => ({ text: block.text! })),
    }));
  }

  /**
   * Map tool choice from internal format to Gemini FunctionCallingConfig.
   * - { type: 'tool', name: 'X' } -> ANY mode with allowedFunctionNames
   * - { type: 'auto' } -> AUTO mode
   */
  private mapToolChoice(
    choice: ToolCompletionParams['toolChoice'],
  ): { mode: FunctionCallingConfigMode; allowedFunctionNames?: string[] } {
    if (choice.type === 'auto') {
      return { mode: FunctionCallingConfigMode.AUTO };
    }
    return {
      mode: FunctionCallingConfigMode.ANY,
      allowedFunctionNames: [choice.name],
    };
  }

  /**
   * Map Gemini response usage metadata to internal TokenUsage.
   * Gemini does not support prompt caching in the same way, so cache fields are 0.
   *
   * Note: usageMetadata field names may be promptTokenCount/candidatesTokenCount
   * or inputTokens/outputTokens depending on API version. We check both.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mapUsage(response: { usageMetadata?: any }): TokenUsage {
    const meta = response.usageMetadata;
    if (!meta) {
      return { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };
    }
    return {
      inputTokens: (meta.promptTokenCount ?? meta.inputTokens ?? 0) as number,
      outputTokens: (meta.candidatesTokenCount ?? meta.outputTokens ?? 0) as number,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
    };
  }
}
