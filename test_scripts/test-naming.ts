// test_scripts/test-naming.ts -- Tests for utils/naming.ts

import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  toKebabCase,
  toWikiSlug,
  sanitizeFilename,
  generatePageFilename,
} from '../src/utils/naming.js';

// ---------------------------------------------------------------------------
// toKebabCase
// ---------------------------------------------------------------------------

describe('toKebabCase', () => {
  it('converts spaces to hyphens and lowercases', () => {
    assert.strictEqual(toKebabCase('Machine Learning'), 'machine-learning');
  });

  it('handles camelCase', () => {
    assert.strictEqual(toKebabCase('camelCaseExample'), 'camel-case-example');
  });

  it('handles PascalCase', () => {
    assert.strictEqual(toKebabCase('PascalCaseExample'), 'pascal-case-example');
  });

  it('collapses multiple spaces', () => {
    assert.strictEqual(toKebabCase('  Hello   World  '), 'hello-world');
  });

  it('strips non-alphanumeric characters', () => {
    assert.strictEqual(toKebabCase('Resume -- Pro Tips!'), 'resume-pro-tips');
  });

  it('collapses multiple hyphens and underscores', () => {
    assert.strictEqual(toKebabCase('foo--bar___baz'), 'foo-bar-baz');
  });

  it('handles accented characters by transliteration', () => {
    assert.strictEqual(toKebabCase('cafe'), 'cafe');
    // NFD decomposition removes combining marks
    const result = toKebabCase('caf\u00e9');
    assert.strictEqual(result, 'cafe');
  });

  it('handles empty string', () => {
    assert.strictEqual(toKebabCase(''), '');
  });

  it('handles single word', () => {
    assert.strictEqual(toKebabCase('hello'), 'hello');
  });

  it('strips leading and trailing hyphens', () => {
    assert.strictEqual(toKebabCase('---hello---'), 'hello');
  });
});

// ---------------------------------------------------------------------------
// toWikiSlug
// ---------------------------------------------------------------------------

describe('toWikiSlug', () => {
  it('preserves spaces but removes special characters', () => {
    assert.strictEqual(toWikiSlug('My Note: A Deep Dive'), 'My Note A Deep Dive');
  });

  it('collapses multiple spaces', () => {
    assert.strictEqual(toWikiSlug('  spaces   everywhere '), 'spaces everywhere');
  });

  it('removes hash, brackets, pipes, and other unsafe chars', () => {
    assert.strictEqual(toWikiSlug('Title #1 [draft]'), 'Title 1 draft');
  });

  it('removes characters unsafe in filenames', () => {
    const result = toWikiSlug('file<name>with:bad*chars?"yes"');
    assert.ok(!result.includes('<'));
    assert.ok(!result.includes('>'));
    assert.ok(!result.includes(':'));
    assert.ok(!result.includes('*'));
    assert.ok(!result.includes('?'));
    assert.ok(!result.includes('"'));
  });

  it('preserves plain text as-is', () => {
    assert.strictEqual(toWikiSlug('Simple Title'), 'Simple Title');
  });
});

// ---------------------------------------------------------------------------
// sanitizeFilename
// ---------------------------------------------------------------------------

describe('sanitizeFilename', () => {
  it('removes unsafe characters and lowercases', () => {
    assert.strictEqual(sanitizeFilename('Hello World!.md'), 'hello-world-md');
  });

  it('handles parentheses and numbers', () => {
    assert.strictEqual(sanitizeFilename('Resume (2024)'), 'resume-2024');
  });

  it('collapses and strips underscores', () => {
    assert.strictEqual(sanitizeFilename('___weird___name___'), 'weird-name');
  });

  it('transliterates accented characters', () => {
    const result = sanitizeFilename('caf\u00e9.txt');
    assert.strictEqual(result, 'cafe-txt');
  });

  it('handles empty string', () => {
    assert.strictEqual(sanitizeFilename(''), '');
  });
});

// ---------------------------------------------------------------------------
// generatePageFilename
// ---------------------------------------------------------------------------

describe('generatePageFilename', () => {
  it('generates kebab-case .md filename', () => {
    assert.strictEqual(generatePageFilename('Mercury'), 'mercury.md');
  });

  it('appends type suffix when provided', () => {
    assert.strictEqual(generatePageFilename('Mercury', 'planet'), 'mercury-planet.md');
  });

  it('handles multi-word names and types', () => {
    assert.strictEqual(
      generatePageFilename('Machine Learning', 'AI Topic'),
      'machine-learning-ai-topic.md',
    );
  });
});
