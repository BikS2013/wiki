// test_scripts/test-tokens.ts -- Tests for llm/tokens.ts

import { describe, it } from 'node:test';
import assert from 'node:assert';

import { estimateTokens, PromptBudgetAnalyzer } from '../src/llm/tokens.js';

// ---------------------------------------------------------------------------
// estimateTokens
// ---------------------------------------------------------------------------

describe('estimateTokens', () => {
  it('returns a positive integer for non-empty text', () => {
    const result = estimateTokens('Hello, world!');
    assert.ok(result > 0);
    assert.ok(Number.isInteger(result));
  });

  it('returns 0 for empty string', () => {
    assert.strictEqual(estimateTokens(''), 0);
  });

  it('returns reasonable values (chars/4 with 15% margin)', () => {
    const text = 'a'.repeat(400); // 400 chars
    const result = estimateTokens(text);
    // raw = ceil(400/4) = 100, with 15% margin = ceil(100 * 1.15) = 115
    assert.strictEqual(result, 115);
  });

  it('increases proportionally with text length', () => {
    const short = estimateTokens('a'.repeat(100));
    const long = estimateTokens('a'.repeat(1000));
    assert.ok(long > short);
  });

  it('handles single character', () => {
    const result = estimateTokens('a');
    assert.ok(result >= 1);
  });
});

// ---------------------------------------------------------------------------
// PromptBudgetAnalyzer
// ---------------------------------------------------------------------------

describe('PromptBudgetAnalyzer', () => {
  it('throws for unknown model', () => {
    assert.throws(
      () => new PromptBudgetAnalyzer('unknown-model'),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes('Unknown model'));
        return true;
      },
    );
  });

  it('constructs successfully with a known model', () => {
    const analyzer = new PromptBudgetAnalyzer('claude-sonnet-4-5');
    assert.ok(analyzer);
  });

  it('reports fitsInContext = true for small prompts', () => {
    const analyzer = new PromptBudgetAnalyzer('claude-sonnet-4-5');
    const result = analyzer.analyze('System prompt.', 'User content.');
    assert.strictEqual(result.fitsInContext, true);
    assert.ok(result.remainingBudget > 0);
    assert.strictEqual(result.contextLimit, 200_000);
  });

  it('reports fitsInContext = false for oversized prompts', () => {
    // Use a huge text that definitely exceeds 200k tokens
    const analyzer = new PromptBudgetAnalyzer('claude-sonnet-4-5', 4096);
    const hugeText = 'a'.repeat(200_000 * 4); // ~200k tokens
    const result = analyzer.analyze('', hugeText);
    assert.strictEqual(result.fitsInContext, false);
    assert.ok(result.remainingBudget < 0);
  });

  it('uses custom outputReserve', () => {
    const analyzer = new PromptBudgetAnalyzer('claude-sonnet-4-5', 10000);
    const result = analyzer.analyze('', '');
    assert.strictEqual(result.outputReserve, 10000);
    assert.strictEqual(result.effectiveLimit, 200_000 - 10000);
  });

  it('uses default outputReserve of 4096', () => {
    const analyzer = new PromptBudgetAnalyzer('claude-sonnet-4-5');
    const result = analyzer.analyze('', '');
    assert.strictEqual(result.outputReserve, 4096);
  });

  it('estimatedTokens is consistent with estimateTokens function', () => {
    const analyzer = new PromptBudgetAnalyzer('claude-sonnet-4-5');
    const system = 'Be helpful.';
    const user = 'What is AI?';
    const result = analyzer.analyze(system, user);
    const expected = estimateTokens(system + '\n' + user);
    assert.strictEqual(result.estimatedTokens, expected);
  });
});

// ---------------------------------------------------------------------------
// Azure-hosted model context limits
// ---------------------------------------------------------------------------

describe('PromptBudgetAnalyzer - Azure-hosted models', () => {
  it('gpt-4o has 128k context limit', () => {
    const analyzer = new PromptBudgetAnalyzer('gpt-4o');
    const result = analyzer.analyze('', '');
    assert.strictEqual(result.contextLimit, 128_000);
  });

  it('mistral-large-latest has 128k context limit', () => {
    const analyzer = new PromptBudgetAnalyzer('mistral-large-latest');
    const result = analyzer.analyze('', '');
    assert.strictEqual(result.contextLimit, 128_000);
  });

  it('deepseek-chat has 128k context limit', () => {
    const analyzer = new PromptBudgetAnalyzer('deepseek-chat');
    const result = analyzer.analyze('', '');
    assert.strictEqual(result.contextLimit, 128_000);
  });
});

// ---------------------------------------------------------------------------
// Gemini model context limits
// ---------------------------------------------------------------------------

describe('PromptBudgetAnalyzer - Gemini models', () => {
  it('gemini-2.0-flash has 1M context limit', () => {
    const analyzer = new PromptBudgetAnalyzer('gemini-2.0-flash');
    const result = analyzer.analyze('', '');
    assert.strictEqual(result.contextLimit, 1_000_000);
  });

  it('gemini-2.5-pro has 1M context limit', () => {
    const analyzer = new PromptBudgetAnalyzer('gemini-2.5-pro');
    const result = analyzer.analyze('', '');
    assert.strictEqual(result.contextLimit, 1_000_000);
  });
});
