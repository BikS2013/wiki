// test_scripts/test-hasher.ts -- Tests for source/hasher.ts

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { hashContent, hashFile } from '../src/source/hasher.js';

// ---------------------------------------------------------------------------
// hashContent
// ---------------------------------------------------------------------------

describe('hashContent', () => {
  it('returns a 64-character lowercase hex string (SHA-256)', () => {
    const hash = hashContent('hello world');
    assert.strictEqual(hash.length, 64);
    assert.ok(/^[0-9a-f]{64}$/.test(hash));
  });

  it('returns consistent results for the same input', () => {
    const a = hashContent('test content');
    const b = hashContent('test content');
    assert.strictEqual(a, b);
  });

  it('produces different hashes for different content', () => {
    const a = hashContent('content A');
    const b = hashContent('content B');
    assert.notStrictEqual(a, b);
  });

  it('handles empty string', () => {
    const hash = hashContent('');
    assert.strictEqual(hash.length, 64);
    assert.ok(/^[0-9a-f]{64}$/.test(hash));
  });

  it('handles unicode content', () => {
    const hash = hashContent('\u00e9\u00e8\u00ea\u00eb');
    assert.strictEqual(hash.length, 64);
  });

  it('produces known SHA-256 for "hello world"', () => {
    // SHA-256 of "hello world" is well-known
    const expected = 'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9';
    const hash = hashContent('hello world');
    assert.strictEqual(hash, expected);
  });
});

// ---------------------------------------------------------------------------
// hashFile
// ---------------------------------------------------------------------------

describe('hashFile', () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('hashes file content from disk', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'hasher-'));
    const filePath = join(tmpDir, 'test.txt');
    await writeFile(filePath, 'file content', 'utf-8');

    const hash = await hashFile(filePath);
    assert.strictEqual(hash.length, 64);
    assert.ok(/^[0-9a-f]{64}$/.test(hash));
  });

  it('produces consistent hash for same file', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'hasher-'));
    const filePath = join(tmpDir, 'same.txt');
    await writeFile(filePath, 'same content', 'utf-8');

    const a = await hashFile(filePath);
    const b = await hashFile(filePath);
    assert.strictEqual(a, b);
  });

  it('produces different hashes for different files', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'hasher-'));
    const fileA = join(tmpDir, 'a.txt');
    const fileB = join(tmpDir, 'b.txt');
    await writeFile(fileA, 'content A', 'utf-8');
    await writeFile(fileB, 'content B', 'utf-8');

    const hashA = await hashFile(fileA);
    const hashB = await hashFile(fileB);
    assert.notStrictEqual(hashA, hashB);
  });
});
