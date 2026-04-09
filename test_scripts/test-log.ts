// test_scripts/test-log.ts -- Tests for wiki/log.ts

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { appendLog, readLog, LogEntry, LogWriter } from '../src/wiki/log.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sampleEntry(overrides?: Partial<LogEntry>): LogEntry {
  return {
    timestamp: '2025-06-15T14:30:00Z',
    action: 'INGEST',
    description: 'Ingested document doc.md',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests: standalone functions
// ---------------------------------------------------------------------------

describe('appendLog', () => {
  let tmpDir: string;
  let logPath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'wiki-log-'));
    logPath = join(tmpDir, 'wiki', 'log.md');
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('creates the log file when it does not exist', async () => {
    await appendLog(logPath, sampleEntry());
    const raw = await readFile(logPath, 'utf-8');
    assert.ok(raw.includes('[INGEST]'));
    assert.ok(raw.includes('Ingested document doc.md'));
  });

  it('appends properly formatted log lines', async () => {
    await appendLog(logPath, sampleEntry());
    await appendLog(logPath, sampleEntry({
      timestamp: '2025-06-16T10:00:00Z',
      action: 'QUERY',
      description: 'Queried about AI',
    }));

    const raw = await readFile(logPath, 'utf-8');
    assert.ok(raw.includes('[INGEST]'));
    assert.ok(raw.includes('[QUERY]'));
    assert.ok(raw.includes('Ingested document doc.md'));
    assert.ok(raw.includes('Queried about AI'));
  });

  it('includes related pages in the log line', async () => {
    await appendLog(logPath, sampleEntry({
      relatedPages: ['entities/alpha.md', 'topics/beta.md'],
    }));
    const raw = await readFile(logPath, 'utf-8');
    assert.ok(raw.includes('(pages: entities/alpha.md, topics/beta.md)'));
  });

  it('includes source ID in the log line', async () => {
    await appendLog(logPath, sampleEntry({
      sourceId: 'src-uuid-123',
    }));
    const raw = await readFile(logPath, 'utf-8');
    assert.ok(raw.includes('(source: src-uuid-123)'));
  });

  it('formats timestamp as YYYY-MM-DD HH:mm', async () => {
    await appendLog(logPath, sampleEntry());
    const raw = await readFile(logPath, 'utf-8');
    // The timestamp should be formatted, not raw ISO
    assert.ok(raw.includes('[2025-06-15'));
  });
});

describe('readLog', () => {
  let tmpDir: string;
  let logPath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'wiki-log-'));
    logPath = join(tmpDir, 'wiki', 'log.md');
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('returns empty array when log file does not exist', async () => {
    const entries = await readLog(logPath);
    assert.deepStrictEqual(entries, []);
  });

  it('parses entries written by appendLog', async () => {
    await appendLog(logPath, sampleEntry());
    await appendLog(logPath, sampleEntry({
      timestamp: '2025-06-16T10:00:00Z',
      action: 'QUERY',
      description: 'What is ML?',
    }));

    const entries = await readLog(logPath);
    assert.strictEqual(entries.length, 2);
    assert.strictEqual(entries[0].action, 'INGEST');
    assert.ok(entries[0].description.includes('Ingested document'));
    assert.strictEqual(entries[1].action, 'QUERY');
    assert.ok(entries[1].description.includes('What is ML?'));
  });

  it('parses related pages from log entries', async () => {
    await appendLog(logPath, sampleEntry({
      relatedPages: ['page1.md', 'page2.md'],
    }));

    const entries = await readLog(logPath);
    assert.strictEqual(entries.length, 1);
    assert.ok(entries[0].relatedPages);
    assert.deepStrictEqual(entries[0].relatedPages, ['page1.md', 'page2.md']);
  });

  it('parses source ID from log entries', async () => {
    await appendLog(logPath, sampleEntry({
      sourceId: 'abc-123',
    }));

    const entries = await readLog(logPath);
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].sourceId, 'abc-123');
  });

  it('reconstructs ISO-ish timestamp from log format', async () => {
    await appendLog(logPath, sampleEntry());
    const entries = await readLog(logPath);
    assert.strictEqual(entries.length, 1);
    // The timestamp is reconstructed as YYYY-MM-DDTHH:mm:00Z
    assert.ok(entries[0].timestamp.includes('T'));
    assert.ok(entries[0].timestamp.endsWith('Z'));
  });
});

// ---------------------------------------------------------------------------
// Tests: LogWriter class
// ---------------------------------------------------------------------------

describe('LogWriter', () => {
  let tmpDir: string;
  let wikiDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'wiki-lw-'));
    wikiDir = join(tmpDir, 'wiki');
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('append creates log entries', async () => {
    const writer = new LogWriter(wikiDir);
    await writer.append('INIT', 'Wiki initialised.');
    await writer.append('INGEST', 'Ingested doc.md');

    const entries = await writer.readAll();
    assert.strictEqual(entries.length, 2);
    assert.strictEqual(entries[0].action, 'INIT');
    assert.strictEqual(entries[1].action, 'INGEST');
  });

  it('readLog returns raw log content', async () => {
    const writer = new LogWriter(wikiDir);
    await writer.append('INIT', 'Started.');

    const raw = await writer.readLog();
    assert.ok(raw !== null);
    assert.ok(raw!.includes('[INIT]'));
    assert.ok(raw!.includes('Started.'));
  });

  it('readLog returns null when log does not exist', async () => {
    const writer = new LogWriter(wikiDir);
    const raw = await writer.readLog();
    assert.strictEqual(raw, null);
  });

  it('getLastEntry finds the last entry matching an action', async () => {
    const writer = new LogWriter(wikiDir);
    await writer.append('INGEST', 'First ingest.');
    await writer.append('QUERY', 'A query.');
    await writer.append('INGEST', 'Second ingest.');

    const last = await writer.getLastEntry('INGEST');
    assert.ok(last);
    assert.ok(last!.description.includes('Second ingest'));

    const lastQuery = await writer.getLastEntry('QUERY');
    assert.ok(lastQuery);
    assert.ok(lastQuery!.description.includes('A query'));
  });

  it('getLastEntry returns null when no matching entry exists', async () => {
    const writer = new LogWriter(wikiDir);
    await writer.append('INIT', 'Started.');

    const result = await writer.getLastEntry('LINT');
    assert.strictEqual(result, null);
  });

  it('appendBatch writes multiple entries atomically', async () => {
    const writer = new LogWriter(wikiDir);
    const entries: LogEntry[] = [
      { timestamp: new Date().toISOString(), action: 'CREATE_PAGE', description: 'Created page A' },
      { timestamp: new Date().toISOString(), action: 'CREATE_PAGE', description: 'Created page B' },
      { timestamp: new Date().toISOString(), action: 'UPDATE_PAGE', description: 'Updated page C' },
    ];

    await writer.appendBatch(entries);

    const all = await writer.readAll();
    assert.strictEqual(all.length, 3);
    assert.ok(all[0].description.includes('Created page A'));
    assert.ok(all[2].description.includes('Updated page C'));
  });
});
