// src/llm/usage-tracker.ts -- Cumulative token usage accounting across LLM calls

import type { TokenUsage } from './types.js';

/**
 * Accumulates TokenUsage statistics across multiple LLM calls.
 * Use one tracker per high-level operation (e.g., one ingest run)
 * to get a complete cost/usage picture.
 */
export class UsageTracker {
  private inputTokens = 0;
  private outputTokens = 0;
  private cacheCreationTokens = 0;
  private cacheReadTokens = 0;
  private callCount = 0;

  /**
   * Record usage from a single LLM call.
   */
  track(usage: TokenUsage): void {
    this.inputTokens += usage.inputTokens;
    this.outputTokens += usage.outputTokens;
    this.cacheCreationTokens += usage.cacheCreationTokens;
    this.cacheReadTokens += usage.cacheReadTokens;
    this.callCount += 1;
  }

  /**
   * Get the accumulated totals as a TokenUsage object.
   */
  getTotal(): TokenUsage {
    return {
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      cacheCreationTokens: this.cacheCreationTokens,
      cacheReadTokens: this.cacheReadTokens,
    };
  }

  /**
   * Get the number of LLM calls tracked so far.
   */
  getCallCount(): number {
    return this.callCount;
  }

  /**
   * Get a human-readable summary of accumulated usage.
   */
  getSummary(): string {
    const total = this.inputTokens + this.outputTokens;
    const lines = [
      `--- Usage Summary (${this.callCount} call${this.callCount === 1 ? '' : 's'}) ---`,
      `Input tokens:        ${this.inputTokens.toLocaleString()}`,
      `Output tokens:       ${this.outputTokens.toLocaleString()}`,
      `Cache write tokens:  ${this.cacheCreationTokens.toLocaleString()}`,
      `Cache read tokens:   ${this.cacheReadTokens.toLocaleString()}`,
      `Total processed:     ${total.toLocaleString()}`,
    ];
    return lines.join('\n');
  }

  /**
   * Reset all counters to zero.
   */
  reset(): void {
    this.inputTokens = 0;
    this.outputTokens = 0;
    this.cacheCreationTokens = 0;
    this.cacheReadTokens = 0;
    this.callCount = 0;
  }
}
