// src/llm/types.ts -- Shared types for LLM interactions

/**
 * Parameters for a standard text completion request.
 */
export interface CompletionParams {
  /** System prompt providing context and instructions */
  system: string;

  /** Conversation messages (user and assistant turns) */
  messages: MessageParam[];

  /** Maximum number of tokens to generate in the response */
  maxTokens: number;

  /** Sampling temperature (0.0 = deterministic, 1.0 = creative) */
  temperature?: number;
}

/**
 * A single message in the conversation history.
 */
export interface MessageParam {
  /** Role of the message sender */
  role: 'user' | 'assistant';

  /** Message content: plain text string or array of content blocks */
  content: string | ContentBlock[];
}

/**
 * A content block within a message, supporting text and images.
 */
export interface ContentBlock {
  /** Block type discriminator */
  type: 'text' | 'image';

  /** Text content (present when type = 'text') */
  text?: string;

  /** Base64-encoded image source (present when type = 'image') */
  source?: {
    type: 'base64';
    media_type: string;
    data: string;
  };
}

/**
 * Result from a standard text completion request.
 */
export interface CompletionResult {
  /** Generated text output */
  text: string;

  /** Token usage statistics for this call */
  usage: TokenUsage;

  /** Reason the model stopped generating (e.g., 'end_turn', 'max_tokens') */
  stopReason: string;
}

/**
 * Definition of a tool that the LLM can invoke for structured output.
 */
export interface ToolDefinition {
  /** Unique tool name */
  name: string;

  /** Human-readable description of what the tool does */
  description: string;

  /** JSON Schema describing the tool's input parameters */
  input_schema: Record<string, unknown>;
}

/**
 * Parameters for a completion request that includes tool definitions.
 * Extends CompletionParams with tool-specific fields.
 */
export interface ToolCompletionParams extends CompletionParams {
  /** Available tool definitions */
  tools: ToolDefinition[];

  /** How the model should select tools: forced specific tool or auto-selection */
  toolChoice: { type: 'tool'; name: string } | { type: 'auto' };
}

/**
 * Result from a tool-use completion request.
 * Contains the structured JSON output from the selected tool.
 */
export interface ToolCompletionResult {
  /** Name of the tool that was invoked */
  toolName: string;

  /** Parsed JSON input provided by the model to the tool */
  toolInput: Record<string, unknown>;

  /** Token usage statistics for this call */
  usage: TokenUsage;

  /** Reason the model stopped generating */
  stopReason: string;
}

/**
 * Token usage breakdown for an LLM call.
 * Includes prompt caching statistics when applicable.
 */
export interface TokenUsage {
  /** Number of tokens in the input/prompt */
  inputTokens: number;

  /** Number of tokens generated in the output */
  outputTokens: number;

  /** Tokens written to the prompt cache (first-time caching cost) */
  cacheCreationTokens: number;

  /** Tokens read from the prompt cache (cache hit savings) */
  cacheReadTokens: number;
}

/**
 * Result from a token counting request (no generation performed).
 */
export interface TokenCountResult {
  /** Estimated number of input tokens for the given prompt */
  inputTokens: number;
}
