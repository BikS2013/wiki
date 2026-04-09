// test_scripts/test-index-manager.ts -- Tests for wiki/index-manager.ts

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { IndexManager, IndexEntry } from '../src/wiki/index-manager.js';
import { stringifyFrontmatter, WikiPageFrontmatter } from '../src/wiki/frontmatter.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sampleEntry(overrides?: Partial<IndexEntry>): IndexEntry {
  return {
    path: 'entities/machine-learning.md',
    title: 'Machine Learning',
    type: 'entity',
    summary: 'A summary of ML.',
    updated: '2025-06-20',
    tags: ['ai', 'ml'],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('IndexManager', () => {
  let tmpDir: string;
  let indexPath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'wiki-idx-'));
    indexPath = join(tmpDir, 'index.md');
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Load / Save
  // -------------------------------------------------------------------------

  it('load initialises empty entries when file does not exist', async () => {
    const mgr = new IndexManager();
    await mgr.load(indexPath);
    assert.deepStrictEqual(mgr.getEntries(), []);
  });

  it('save writes markdown and load reads it back', async () => {
    const mgr = new IndexManager();
    await mgr.load(indexPath);
    mgr.addEntry(sampleEntry());
    await mgr.save();

    // Verify file exists and contains expected content
    const raw = await readFile(indexPath, 'utf-8');
    assert.ok(raw.includes('# Wiki Index'));
    assert.ok(raw.includes('Machine Learning') || raw.includes('machine-learning'));

    // Reload and verify
    const mgr2 = new IndexManager();
    await mgr2.load(indexPath);
    const entries = mgr2.getEntries();
    assert.ok(entries.length >= 1);
  });

  it('save creates parent directories', async () => {
    const deepPath = join(tmpDir, 'a', 'b', 'index.md');
    const mgr = new IndexManager();
    await mgr.load(deepPath);
    mgr.addEntry(sampleEntry());
    await mgr.save();

    const raw = await readFile(deepPath, 'utf-8');
    assert.ok(raw.includes('Wiki Index'));
  });

  // -------------------------------------------------------------------------
  // CRUD
  // -------------------------------------------------------------------------

  it('addEntry adds a new entry', async () => {
    const mgr = new IndexManager();
    await mgr.load(indexPath);
    mgr.addEntry(sampleEntry());
    assert.strictEqual(mgr.getEntries().length, 1);
  });

  it('addEntry upserts when path already exists', async () => {
    const mgr = new IndexManager();
    await mgr.load(indexPath);
    mgr.addEntry(sampleEntry());
    mgr.addEntry(sampleEntry({ summary: 'Updated summary' }));
    const entries = mgr.getEntries();
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].summary, 'Updated summary');
  });

  it('updateEntry merges partial updates', async () => {
    const mgr = new IndexManager();
    await mgr.load(indexPath);
    mgr.addEntry(sampleEntry());
    mgr.updateEntry('entities/machine-learning.md', { summary: 'New summary' });
    const entries = mgr.getEntries();
    assert.strictEqual(entries[0].summary, 'New summary');
    assert.strictEqual(entries[0].title, 'Machine Learning'); // Unchanged
  });

  it('updateEntry throws for non-existent path', async () => {
    const mgr = new IndexManager();
    await mgr.load(indexPath);
    assert.throws(
      () => mgr.updateEntry('nonexistent.md', { summary: 'x' }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes('not found'));
        return true;
      },
    );
  });

  it('removeEntry removes by path', async () => {
    const mgr = new IndexManager();
    await mgr.load(indexPath);
    mgr.addEntry(sampleEntry());
    mgr.removeEntry('entities/machine-learning.md');
    assert.strictEqual(mgr.getEntries().length, 0);
  });

  it('removeEntry is a no-op for non-existent path', async () => {
    const mgr = new IndexManager();
    await mgr.load(indexPath);
    mgr.addEntry(sampleEntry());
    mgr.removeEntry('nonexistent.md'); // Should not throw
    assert.strictEqual(mgr.getEntries().length, 1);
  });

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  it('findByTitle performs case-insensitive substring search', async () => {
    const mgr = new IndexManager();
    await mgr.load(indexPath);
    mgr.addEntry(sampleEntry());
    mgr.addEntry(sampleEntry({ path: 'topics/deep-learning.md', title: 'Deep Learning', type: 'topic' }));

    const results = mgr.findByTitle('learning');
    assert.strictEqual(results.length, 2);

    const results2 = mgr.findByTitle('MACHINE');
    assert.strictEqual(results2.length, 1);
    assert.strictEqual(results2[0].title, 'Machine Learning');
  });

  it('findByType filters by page type', async () => {
    const mgr = new IndexManager();
    await mgr.load(indexPath);
    mgr.addEntry(sampleEntry({ type: 'entity' }));
    mgr.addEntry(sampleEntry({ path: 'topics/ai.md', type: 'topic', title: 'AI' }));
    mgr.addEntry(sampleEntry({ path: 'sources/doc.md', type: 'source-summary', title: 'Doc' }));

    const entities = mgr.findByType('entity');
    assert.strictEqual(entities.length, 1);

    const topics = mgr.findByType('topic');
    assert.strictEqual(topics.length, 1);
    assert.strictEqual(topics[0].title, 'AI');
  });

  it('getEntries returns a copy', async () => {
    const mgr = new IndexManager();
    await mgr.load(indexPath);
    mgr.addEntry(sampleEntry());
    const entries = mgr.getEntries();
    entries.pop();
    assert.strictEqual(mgr.getEntries().length, 1);
  });

  // -------------------------------------------------------------------------
  // Save / load roundtrip with markdown format
  // -------------------------------------------------------------------------

  it('roundtrip: entries survive save/load cycle', async () => {
    const mgr = new IndexManager();
    await mgr.load(indexPath);

    mgr.addEntry(sampleEntry({ type: 'entity', title: 'Alpha' }));
    mgr.addEntry(sampleEntry({
      path: 'topics/beta.md',
      type: 'topic',
      title: 'Beta',
      tags: ['test'],
      updated: '2025-07-01',
    }));
    mgr.addEntry(sampleEntry({
      path: 'sources/gamma.md',
      type: 'source-summary',
      title: 'Gamma',
      summary: 'Source summary.',
    }));

    await mgr.save();

    const mgr2 = new IndexManager();
    await mgr2.load(indexPath);
    const loaded = mgr2.getEntries();

    // All 3 entries should be present
    assert.strictEqual(loaded.length, 3);
    assert.ok(loaded.some((e) => e.title.includes('Alpha') || e.path.includes('machine-learning')));
  });

  // -------------------------------------------------------------------------
  // Regenerate from wiki pages
  // -------------------------------------------------------------------------

  it('regenerate scans wiki pages and rebuilds entries', async () => {
    const wikiDir = join(tmpDir, 'wiki');
    await mkdir(join(wikiDir, 'entities'), { recursive: true });
    await mkdir(join(wikiDir, 'topics'), { recursive: true });

    // Create some wiki pages with frontmatter
    const fm1: WikiPageFrontmatter = {
      title: 'Neural Networks',
      type: 'entity',
      created: '2025-06-01',
      updated: '2025-06-15',
      sources: ['src-1'],
      tags: ['ai'],
    };
    await writeFile(
      join(wikiDir, 'entities', 'neural-networks.md'),
      stringifyFrontmatter(fm1, '\nNeural networks are computational models.'),
      'utf-8',
    );

    const fm2: WikiPageFrontmatter = {
      title: 'Supervised Learning',
      type: 'topic',
      created: '2025-06-02',
      updated: '2025-06-16',
      sources: ['src-2'],
      tags: ['ml'],
    };
    await writeFile(
      join(wikiDir, 'topics', 'supervised-learning.md'),
      stringifyFrontmatter(fm2, '\nSupervised learning uses labelled data.'),
      'utf-8',
    );

    const mgr = new IndexManager();
    await mgr.load(join(wikiDir, 'index.md'));
    await mgr.regenerate(wikiDir);

    const entries = mgr.getEntries();
    assert.strictEqual(entries.length, 2);

    const nn = entries.find((e) => e.title === 'Neural Networks');
    assert.ok(nn);
    assert.strictEqual(nn!.type, 'entity');
    assert.ok(nn!.summary.includes('Neural networks'));

    const sl = entries.find((e) => e.title === 'Supervised Learning');
    assert.ok(sl);
    assert.strictEqual(sl!.type, 'topic');
  });

  it('regenerate skips index.md, log.md, and lint-report.md', async () => {
    const wikiDir = join(tmpDir, 'wiki2');
    await mkdir(wikiDir, { recursive: true });

    // Create special files that should be skipped
    await writeFile(join(wikiDir, 'index.md'), '# Index\n', 'utf-8');
    await writeFile(join(wikiDir, 'log.md'), '# Log\n', 'utf-8');
    await writeFile(join(wikiDir, 'lint-report.md'), '# Lint\n', 'utf-8');

    const mgr = new IndexManager();
    await mgr.load(join(wikiDir, 'index.md'));
    await mgr.regenerate(wikiDir);

    assert.strictEqual(mgr.getEntries().length, 0);
  });
});
