// src/llm/tokens.ts -- Heuristic token estimation and prompt budget analysis

/**
 * Estimate token count for a text string using a character-based heuristic.
 * Uses chars/4 with a 15% safety margin to account for tokenizer variance.
 *
 * Accuracy: ~85-95% for English prose. Less accurate for code,
 * non-Latin scripts, and heavily formatted content.
 *
 * For accurate counts, use LLMProvider.countTokens() instead.
 */
export function estimateTokens(text: string): number {
  const rawEstimate = Math.ceil(text.length / 4);
  return Math.ceil(rawEstimate * 1.15); // 15% safety margin
}

/**
 * Model context window limits (total input + output tokens).
 */
const CONTEXT_LIMITS: Record<string, number> = {
  // --- Anthropic Claude models ---
  'claude-opus-4-5': 200_000,
  'claude-sonnet-4-5': 200_000,
  'claude-sonnet-4-20250514': 200_000,
  'claude-haiku-3-5-20241022': 200_000,
  'claude-3-opus-20240229': 200_000,
  'claude-3-5-sonnet-20241022': 200_000,

  // --- Azure-hosted models ---
  'gpt-4o': 128_000,
  'gpt-4o-mini': 128_000,
  'gpt-4-turbo': 128_000,
  'gpt-4': 8_192,
  'gpt-35-turbo': 16_385,
  'mistral-large-latest': 128_000,
  'mistral-small-latest': 128_000,
  'deepseek-chat': 128_000,
  'deepseek-reasoner': 128_000,

  // --- Google Gemini models ---
  'gemini-2.0-flash': 1_000_000,
  'gemini-2.5-pro': 1_000_000,
  'gemini-2.5-flash': 1_000_000,
  'gemini-1.5-pro': 2_000_000,
  'gemini-1.5-flash': 1_000_000,
};

/** Default output token reserve when not specified. */
const DEFAULT_OUTPUT_RESERVE = 4096;

/**
 * Result of a prompt budget analysis.
 */
export interface PromptBudgetResult {
  /** Heuristic estimate of total input tokens */
  estimatedTokens: number;
  /** Model's total context window size */
  contextLimit: number;
  /** Tokens reserved for the model's output */
  outputReserve: number;
  /** Effective input limit (contextLimit - outputReserve) */
  effectiveLimit: number;
  /** Whether the estimated tokens fit within the effective limit */
  fitsInContext: boolean;
  /** Remaining token budget (can be negative if over limit) */
  remainingBudget: number;
}

/**
 * Analyzes whether a prompt fits within a model's context window
 * using heuristic token estimation.
 *
 * Use this for fast, offline pre-checks before making API calls.
 * For accurate verification near the limit, follow up with
 * LLMProvider.countTokens().
 */
export class PromptBudgetAnalyzer {
  private readonly contextLimit: number;
  private readonly outputReserve: number;

  /**
   * @param model - Model identifier for looking up context limits
   * @param outputReserve - Tokens to reserve for the model's response
   */
  constructor(model: string, outputReserve?: number) {
    const limit = CONTEXT_LIMITS[model];
    if (limit === undefined) {
      throw new Error(
        `Unknown model "${model}". Cannot determine context window limit. ` +
        `Known models: ${Object.keys(CONTEXT_LIMITS).join(', ')}`,
      );
    }
    this.contextLimit = limit;
    this.outputReserve = outputReserve ?? DEFAULT_OUTPUT_RESERVE;
  }

  /**
   * Analyze whether the given system prompt and user content
   * fit within the model's context window.
   */
  analyze(systemPrompt: string, userContent: string): PromptBudgetResult {
    const allText = systemPrompt + '\n' + userContent;
    const estimatedTokens = estimateTokens(allText);
    const effectiveLimit = this.contextLimit - this.outputReserve;
    const remainingBudget = effectiveLimit - estimatedTokens;

    return {
      estimatedTokens,
      contextLimit: this.contextLimit,
      outputReserve: this.outputReserve,
      effectiveLimit,
      fitsInContext: estimatedTokens <= effectiveLimit,
      remainingBudget,
    };
  }
}
