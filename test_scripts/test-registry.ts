// test_scripts/test-registry.ts -- Tests for wiki/registry.ts (SourceRegistry)

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { SourceRegistry, SourceEntry } from '../src/wiki/registry.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sampleEntry(): Omit<SourceEntry, 'id'> {
  return {
    filePath: '/tmp/sources/doc.md',
    fileName: 'doc.md',
    format: '.md',
    contentHash: 'abc123def456',
    ingestedAt: '2025-06-01T00:00:00Z',
    updatedAt: '2025-06-01T00:00:00Z',
    status: 'ingested',
    generatedPages: ['topics/machine-learning.md'],
    metadata: { author: 'test' },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SourceRegistry', () => {
  let tmpDir: string;
  let registryPath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'wiki-reg-'));
    registryPath = join(tmpDir, 'sources', 'registry.json');
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Load / Save
  // -------------------------------------------------------------------------

  it('load initialises empty registry when file does not exist', async () => {
    const reg = new SourceRegistry(registryPath);
    await reg.load();
    assert.deepStrictEqual(reg.getAll(), []);
  });

  it('save persists registry to disk and load reads it back', async () => {
    const reg = new SourceRegistry(registryPath);
    await reg.load();
    reg.add(sampleEntry());
    await reg.save();

    // Read back
    const reg2 = new SourceRegistry(registryPath);
    await reg2.load();
    const entries = reg2.getAll();
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].fileName, 'doc.md');
  });

  it('save creates parent directories', async () => {
    const deepPath = join(tmpDir, 'a', 'b', 'c', 'registry.json');
    const reg = new SourceRegistry(deepPath);
    await reg.load();
    reg.add(sampleEntry());
    await reg.save();

    const raw = await readFile(deepPath, 'utf-8');
    const data = JSON.parse(raw);
    assert.strictEqual(data.sources.length, 1);
  });

  // -------------------------------------------------------------------------
  // CRUD
  // -------------------------------------------------------------------------

  it('throws when performing operations before load()', () => {
    const reg = new SourceRegistry(registryPath);
    assert.throws(
      () => reg.getAll(),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes('not been loaded'));
        return true;
      },
    );
  });

  it('add generates a UUID and returns the entry', async () => {
    const reg = new SourceRegistry(registryPath);
    await reg.load();
    const entry = reg.add(sampleEntry());
    assert.ok(entry.id);
    assert.ok(typeof entry.id === 'string');
    assert.ok(entry.id.length > 0);
    assert.strictEqual(entry.fileName, 'doc.md');
  });

  it('findById returns the correct entry', async () => {
    const reg = new SourceRegistry(registryPath);
    await reg.load();
    const added = reg.add(sampleEntry());
    const found = reg.findById(added.id);
    assert.ok(found);
    assert.strictEqual(found!.id, added.id);
  });

  it('findById returns undefined for non-existent id', async () => {
    const reg = new SourceRegistry(registryPath);
    await reg.load();
    assert.strictEqual(reg.findById('nonexistent'), undefined);
  });

  it('findByHash returns entry with matching content hash', async () => {
    const reg = new SourceRegistry(registryPath);
    await reg.load();
    const entry = reg.add(sampleEntry());
    const found = reg.findByHash('abc123def456');
    assert.ok(found);
    assert.strictEqual(found!.id, entry.id);
  });

  it('findByHash returns undefined for unknown hash', async () => {
    const reg = new SourceRegistry(registryPath);
    await reg.load();
    reg.add(sampleEntry());
    assert.strictEqual(reg.findByHash('unknown-hash'), undefined);
  });

  it('findByPath returns entry with matching file path', async () => {
    const reg = new SourceRegistry(registryPath);
    await reg.load();
    const entry = reg.add(sampleEntry());
    const found = reg.findByPath('/tmp/sources/doc.md');
    assert.ok(found);
    assert.strictEqual(found!.id, entry.id);
  });

  it('update modifies an existing entry', async () => {
    const reg = new SourceRegistry(registryPath);
    await reg.load();
    const entry = reg.add(sampleEntry());
    const updated = reg.update(entry.id, {
      status: 'stale',
      updatedAt: '2025-07-01T00:00:00Z',
    });
    assert.strictEqual(updated.status, 'stale');
    assert.strictEqual(updated.updatedAt, '2025-07-01T00:00:00Z');
    // Unchanged fields remain
    assert.strictEqual(updated.fileName, 'doc.md');
  });

  it('update throws for non-existent id', async () => {
    const reg = new SourceRegistry(registryPath);
    await reg.load();
    assert.throws(
      () => reg.update('nonexistent', { status: 'stale' }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes('not found'));
        return true;
      },
    );
  });

  it('remove deletes an entry and returns it', async () => {
    const reg = new SourceRegistry(registryPath);
    await reg.load();
    const entry = reg.add(sampleEntry());
    const removed = reg.remove(entry.id);
    assert.strictEqual(removed.id, entry.id);
    assert.strictEqual(reg.getAll().length, 0);
  });

  it('remove throws for non-existent id', async () => {
    const reg = new SourceRegistry(registryPath);
    await reg.load();
    assert.throws(
      () => reg.remove('nonexistent'),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes('not found'));
        return true;
      },
    );
  });

  it('getAll returns a copy (not a reference to internal array)', async () => {
    const reg = new SourceRegistry(registryPath);
    await reg.load();
    reg.add(sampleEntry());
    const all = reg.getAll();
    all.pop(); // Modify the returned array
    assert.strictEqual(reg.getAll().length, 1); // Original should be unaffected
  });

  it('handles multiple entries correctly', async () => {
    const reg = new SourceRegistry(registryPath);
    await reg.load();

    const e1 = reg.add({ ...sampleEntry(), fileName: 'a.md', contentHash: 'hash-a' });
    const e2 = reg.add({ ...sampleEntry(), fileName: 'b.md', contentHash: 'hash-b' });
    const e3 = reg.add({ ...sampleEntry(), fileName: 'c.md', contentHash: 'hash-c' });

    assert.strictEqual(reg.getAll().length, 3);
    assert.ok(reg.findByHash('hash-b'));
    assert.strictEqual(reg.findByHash('hash-b')!.fileName, 'b.md');

    reg.remove(e2.id);
    assert.strictEqual(reg.getAll().length, 2);
    assert.strictEqual(reg.findByHash('hash-b'), undefined);
  });
});
