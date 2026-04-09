// test_scripts/test-chunker.ts -- Tests for source/chunker.ts

import { describe, it } from 'node:test';
import assert from 'node:assert';

import { chunkContent, ChunkOptions } from '../src/source/chunker.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Approximate token count using the same heuristic as the chunker. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Generate a string of approximately N tokens. */
function generateText(approxTokens: number): string {
  // ~4 chars per token
  return 'a'.repeat(approxTokens * 4);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('chunkContent', () => {
  it('returns single chunk when content fits within maxTokens', () => {
    const content = 'Small content.';
    const chunks = chunkContent(content, { maxTokens: 1000 });
    assert.strictEqual(chunks.length, 1);
    assert.strictEqual(chunks[0], content);
  });

  it('splits on markdown headings', () => {
    const content = [
      '## Section One',
      '',
      'Content of section one.',
      '',
      '## Section Two',
      '',
      'Content of section two.',
    ].join('\n');

    // Set maxTokens low enough to force splitting
    const chunks = chunkContent(content, { maxTokens: 15, overlap: 0 });
    assert.ok(chunks.length >= 2, `Expected at least 2 chunks, got ${chunks.length}`);
    assert.ok(chunks[0].includes('Section One'));
    assert.ok(chunks[chunks.length - 1].includes('Section Two'));
  });

  it('splits by paragraphs when a section exceeds maxTokens', () => {
    // Build a section with multiple paragraphs that collectively exceed the limit
    const para1 = generateText(100);
    const para2 = generateText(100);
    const para3 = generateText(100);
    const content = `## Big Section\n\n${para1}\n\n${para2}\n\n${para3}`;

    const chunks = chunkContent(content, { maxTokens: 150, overlap: 0 });
    assert.ok(chunks.length >= 2, `Expected at least 2 chunks, got ${chunks.length}`);
  });

  it('applies overlap between consecutive chunks', () => {
    const sections = Array.from({ length: 5 }, (_, i) =>
      `## Section ${i + 1}\n\n${'x'.repeat(200)}`,
    ).join('\n\n');

    const overlapTokens = 20;
    const chunks = chunkContent(sections, { maxTokens: 100, overlap: overlapTokens });

    // When there are multiple chunks, chunks after the first should start with
    // overlap text from the previous chunk
    if (chunks.length > 1) {
      // The second chunk should contain some text from the end of the first chunk
      // because overlap prepends tailByTokens from the previous chunk
      const overlapChars = overlapTokens * 4;
      const expectedOverlap = chunks[0].slice(-overlapChars);
      assert.ok(
        chunks[1].startsWith(expectedOverlap),
        'Second chunk should begin with overlap from first chunk',
      );
    }
  });

  it('returns content as-is when overlap is 0 and content fits', () => {
    const content = 'Small.';
    const chunks = chunkContent(content, { maxTokens: 1000, overlap: 0 });
    assert.strictEqual(chunks.length, 1);
    assert.strictEqual(chunks[0], content);
  });

  it('handles content with no headings by paragraph splitting', () => {
    const paras = Array.from({ length: 10 }, (_, i) =>
      `Paragraph ${i + 1}: ${'word '.repeat(80)}`,
    ).join('\n\n');

    const chunks = chunkContent(paras, { maxTokens: 200, overlap: 0 });
    assert.ok(chunks.length >= 2, `Expected multiple chunks, got ${chunks.length}`);
  });

  it('handles empty content', () => {
    const chunks = chunkContent('', { maxTokens: 100 });
    assert.strictEqual(chunks.length, 1);
    assert.strictEqual(chunks[0], '');
  });

  it('preserves heading text within chunks', () => {
    const content = '## Introduction\n\nHello world.\n\n## Conclusion\n\nGoodbye.';
    const chunks = chunkContent(content, { maxTokens: 10, overlap: 0 });
    const allText = chunks.join(' ');
    assert.ok(allText.includes('Introduction'));
    assert.ok(allText.includes('Conclusion'));
  });
});
