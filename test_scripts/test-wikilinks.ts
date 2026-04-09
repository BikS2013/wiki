// test_scripts/test-wikilinks.ts -- Tests for wiki/wikilinks.ts

import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  extractWikiLinks,
  extractWikiLinkObjects,
  generateWikiLink,
  insertWikiLinks,
  validateWikiLinks,
} from '../src/wiki/wikilinks.js';

// ---------------------------------------------------------------------------
// extractWikiLinks
// ---------------------------------------------------------------------------

describe('extractWikiLinks', () => {
  it('extracts simple wiki-links [[Page]]', () => {
    const content = 'See [[Machine Learning]] for details.';
    const links = extractWikiLinks(content);
    assert.deepStrictEqual(links, ['Machine Learning']);
  });

  it('extracts wiki-links with display text [[Page|Display]]', () => {
    const content = 'Check [[Neural Networks|NNs]] and [[Deep Learning]].';
    const links = extractWikiLinks(content);
    assert.deepStrictEqual(links, ['Neural Networks', 'Deep Learning']);
  });

  it('extracts multiple links on the same line', () => {
    const content = '[[Alpha]] and [[Beta]] and [[Gamma]]';
    const links = extractWikiLinks(content);
    assert.deepStrictEqual(links, ['Alpha', 'Beta', 'Gamma']);
  });

  it('returns empty array for content with no links', () => {
    const links = extractWikiLinks('No links here.');
    assert.deepStrictEqual(links, []);
  });

  it('handles nested brackets correctly (only outermost)', () => {
    // Nested brackets should not match as wiki-links
    const content = 'Some [text with [brackets]] not a link.';
    const links = extractWikiLinks(content);
    assert.deepStrictEqual(links, []);
  });

  it('includes duplicates when the same link appears multiple times', () => {
    const content = '[[Alpha]] and [[Alpha]] again.';
    const links = extractWikiLinks(content);
    assert.strictEqual(links.length, 2);
    assert.strictEqual(links[0], 'Alpha');
    assert.strictEqual(links[1], 'Alpha');
  });

  it('trims whitespace from targets', () => {
    const content = '[[  Spaced Page  ]] and [[Trimmed|  Display  ]]';
    const links = extractWikiLinks(content);
    assert.strictEqual(links[0], 'Spaced Page');
    assert.strictEqual(links[1], 'Trimmed');
  });
});

// ---------------------------------------------------------------------------
// extractWikiLinkObjects
// ---------------------------------------------------------------------------

describe('extractWikiLinkObjects', () => {
  it('returns WikiLink objects with target, displayText, and raw', () => {
    const content = '[[Machine Learning|ML]] and [[Deep Learning]]';
    const links = extractWikiLinkObjects(content);
    assert.strictEqual(links.length, 2);

    assert.strictEqual(links[0].target, 'Machine Learning');
    assert.strictEqual(links[0].displayText, 'ML');
    assert.strictEqual(links[0].raw, '[[Machine Learning|ML]]');

    assert.strictEqual(links[1].target, 'Deep Learning');
    assert.strictEqual(links[1].displayText, undefined);
    assert.strictEqual(links[1].raw, '[[Deep Learning]]');
  });
});

// ---------------------------------------------------------------------------
// generateWikiLink
// ---------------------------------------------------------------------------

describe('generateWikiLink', () => {
  it('generates [[pageName]] without display text', () => {
    assert.strictEqual(generateWikiLink('Machine Learning'), '[[Machine Learning]]');
  });

  it('generates [[pageName|displayText]] with display text', () => {
    assert.strictEqual(
      generateWikiLink('Machine Learning', 'ML'),
      '[[Machine Learning|ML]]',
    );
  });

  it('omits pipe syntax when displayText equals pageName', () => {
    assert.strictEqual(
      generateWikiLink('Machine Learning', 'Machine Learning'),
      '[[Machine Learning]]',
    );
  });

  it('omits pipe syntax when displayText is undefined', () => {
    assert.strictEqual(
      generateWikiLink('Page'),
      '[[Page]]',
    );
  });
});

// ---------------------------------------------------------------------------
// insertWikiLinks
// ---------------------------------------------------------------------------

describe('insertWikiLinks', () => {
  it('inserts wiki-link for first occurrence of a mention', () => {
    const content = 'Machine learning is great. Machine learning is powerful.';
    const linkMap = new Map([['Machine learning', 'Machine Learning']]);
    const result = insertWikiLinks(content, linkMap);

    // First occurrence should be linked
    assert.ok(result.includes('[[Machine Learning|Machine learning]]'));

    // Count how many times the link appears (should be exactly once)
    const linkCount = (result.match(/\[\[Machine Learning/g) || []).length;
    assert.strictEqual(linkCount, 1);
  });

  it('does not double-link text already inside [[...]]', () => {
    const content = 'See [[Machine Learning]] for Machine Learning details.';
    const linkMap = new Map([['Machine Learning', 'Machine Learning']]);
    const result = insertWikiLinks(content, linkMap);

    // The already-linked instance should remain, and the second one gets linked
    // The key thing: no double-bracket nesting
    assert.ok(!result.includes('[[[['));
  });

  it('returns content unchanged when linkMap is empty', () => {
    const content = 'Some text.';
    const linkMap = new Map<string, string>();
    assert.strictEqual(insertWikiLinks(content, linkMap), content);
  });

  it('links multiple different mentions', () => {
    const content = 'Python and JavaScript are languages.';
    const linkMap = new Map([
      ['Python', 'Python'],
      ['JavaScript', 'JavaScript'],
    ]);
    const result = insertWikiLinks(content, linkMap);
    assert.ok(result.includes('[[Python]]'));
    assert.ok(result.includes('[[JavaScript]]'));
  });

  it('matches case-insensitively', () => {
    const content = 'python is popular.';
    const linkMap = new Map([['Python', 'Python']]);
    const result = insertWikiLinks(content, linkMap);
    assert.ok(result.includes('[[Python|python]]'));
  });

  it('handles distinct mentions without interference', () => {
    const content = 'Python is great. JavaScript is also great.';
    const linkMap = new Map([
      ['Python', 'Python'],
      ['JavaScript', 'JavaScript'],
    ]);
    const result = insertWikiLinks(content, linkMap);
    assert.ok(result.includes('[[Python]]'));
    assert.ok(result.includes('[[JavaScript]]'));
  });
});

// ---------------------------------------------------------------------------
// validateWikiLinks
// ---------------------------------------------------------------------------

describe('validateWikiLinks', () => {
  it('classifies links as valid or broken', () => {
    const content = '[[Alpha]] and [[Beta]] and [[Missing]]';
    const existingPages = new Set(['Alpha', 'Beta']);
    const { valid, broken } = validateWikiLinks(content, existingPages);

    assert.strictEqual(valid.length, 2);
    assert.strictEqual(broken.length, 1);
    assert.strictEqual(broken[0].target, 'Missing');
  });

  it('performs case-insensitive comparison', () => {
    const content = '[[alpha]]';
    const existingPages = new Set(['Alpha']);
    const { valid, broken } = validateWikiLinks(content, existingPages);
    assert.strictEqual(valid.length, 1);
    assert.strictEqual(broken.length, 0);
  });
});
