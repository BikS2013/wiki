// test_scripts/test-frontmatter.ts -- Tests for wiki/frontmatter.ts

import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  parseFrontmatter,
  parsePage,
  stringifyFrontmatter,
  stringifyPage,
  updateFrontmatter,
  WikiPageFrontmatter,
} from '../src/wiki/frontmatter.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sampleFrontmatter(): WikiPageFrontmatter {
  return {
    title: 'Machine Learning',
    type: 'topic',
    created: '2025-06-15',
    updated: '2025-06-20',
    sources: ['src-001', 'src-002'],
    tags: ['ai', 'ml'],
    aliases: ['ML'],
    status: 'draft',
  };
}

function sampleMarkdown(): string {
  return `---
title: "Machine Learning"
type: "topic"
created: "2025-06-15"
updated: "2025-06-20"
sources:
  - "src-001"
  - "src-002"
tags:
  - "ai"
  - "ml"
aliases:
  - "ML"
status: "draft"
---

# Machine Learning

Machine learning is a subset of artificial intelligence.
`;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('parseFrontmatter', () => {
  it('parses frontmatter from markdown string', () => {
    const { data, content } = parseFrontmatter(sampleMarkdown());
    assert.strictEqual(data.title, 'Machine Learning');
    assert.strictEqual(data.type, 'topic');
    assert.ok(content.includes('Machine learning is a subset'));
  });

  it('date fields remain as strings (not coerced to Date objects)', () => {
    const { data } = parseFrontmatter(sampleMarkdown());
    assert.strictEqual(typeof data.created, 'string');
    assert.strictEqual(typeof data.updated, 'string');
    assert.strictEqual(data.created, '2025-06-15');
    assert.strictEqual(data.updated, '2025-06-20');
  });

  it('preserves arrays in frontmatter', () => {
    const { data } = parseFrontmatter(sampleMarkdown());
    assert.ok(Array.isArray(data.sources));
    assert.deepStrictEqual(data.sources, ['src-001', 'src-002']);
    assert.ok(Array.isArray(data.tags));
    assert.deepStrictEqual(data.tags, ['ai', 'ml']);
    assert.ok(Array.isArray(data.aliases));
    assert.deepStrictEqual(data.aliases, ['ML']);
  });

  it('preserves WikiPageFrontmatter optional fields', () => {
    const { data } = parseFrontmatter(sampleMarkdown());
    assert.strictEqual(data.status, 'draft');
  });
});

describe('parsePage', () => {
  it('returns structured ParsedPage with frontmatter, content, and raw', () => {
    const raw = sampleMarkdown();
    const parsed = parsePage(raw);
    assert.strictEqual(parsed.frontmatter.title, 'Machine Learning');
    assert.ok(parsed.content.includes('Machine learning'));
    assert.strictEqual(parsed.raw, raw);
  });
});

describe('stringifyFrontmatter / stringifyPage', () => {
  it('produces a valid markdown string with YAML frontmatter block', () => {
    const fm = sampleFrontmatter();
    const body = '\n# Machine Learning\n\nSome content here.\n';
    const result = stringifyFrontmatter(fm, body);
    assert.ok(result.startsWith('---\n'));
    // The closing --- should be followed by the body content
    assert.ok(result.includes('# Machine Learning'));
    assert.ok(result.includes('title: Machine Learning'));
  });

  it('stringifyPage is an alias for stringifyFrontmatter', () => {
    const fm = sampleFrontmatter();
    const body = '\nContent.';
    assert.strictEqual(
      stringifyPage(fm, body),
      stringifyFrontmatter(fm, body),
    );
  });
});

describe('parse/stringify roundtrip', () => {
  it('roundtrip preserves frontmatter data', () => {
    const original = sampleFrontmatter();
    const body = '\n# Title\n\nBody text.\n';
    const serialised = stringifyFrontmatter(original, body);
    const parsed = parseFrontmatter(serialised);

    assert.strictEqual(parsed.data.title, original.title);
    assert.strictEqual(parsed.data.type, original.type);
    assert.strictEqual(parsed.data.created, original.created);
    assert.strictEqual(parsed.data.updated, original.updated);
    assert.deepStrictEqual(parsed.data.sources, original.sources);
    assert.deepStrictEqual(parsed.data.tags, original.tags);
    assert.deepStrictEqual(parsed.data.aliases, original.aliases);
    assert.strictEqual(parsed.data.status, original.status);
  });

  it('roundtrip preserves body content', () => {
    const body = '\n# Heading\n\nParagraph one.\n\nParagraph two.\n';
    const serialised = stringifyFrontmatter(sampleFrontmatter(), body);
    const parsed = parseFrontmatter(serialised);
    assert.ok(parsed.content.includes('Paragraph one.'));
    assert.ok(parsed.content.includes('Paragraph two.'));
  });

  it('date strings survive a roundtrip without being coerced', () => {
    const fm = sampleFrontmatter();
    fm.created = '2025-01-01';
    fm.updated = '2025-12-31';
    const serialised = stringifyFrontmatter(fm, '\nBody');
    const parsed = parseFrontmatter(serialised);
    assert.strictEqual(typeof parsed.data.created, 'string');
    assert.strictEqual(parsed.data.created, '2025-01-01');
    assert.strictEqual(typeof parsed.data.updated, 'string');
    assert.strictEqual(parsed.data.updated, '2025-12-31');
  });
});

describe('updateFrontmatter', () => {
  it('merges partial updates into existing frontmatter', () => {
    const raw = sampleMarkdown();
    const updated = updateFrontmatter(raw, { status: 'stable', title: 'ML Revised' });
    const parsed = parseFrontmatter(updated);
    assert.strictEqual(parsed.data.status, 'stable');
    assert.strictEqual(parsed.data.title, 'ML Revised');
    // Unchanged fields should remain
    assert.strictEqual(parsed.data.type, 'topic');
  });

  it('preserves body content when updating frontmatter', () => {
    const raw = sampleMarkdown();
    const updated = updateFrontmatter(raw, { status: 'reviewed' });
    const parsed = parseFrontmatter(updated);
    assert.ok(parsed.content.includes('Machine learning is a subset'));
  });
});
