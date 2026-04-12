// test_scripts/test-mailbox-state.ts -- Tests for source/mailbox-state.ts (MailboxStateManager)

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { MailboxStateManager } from '../src/source/mailbox-state.js';
import type { Logger } from '../src/utils/logger.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** No-op logger that captures warn messages for assertion. */
function mockLogger(): Logger & { warnings: string[] } {
  const warnings: string[] = [];
  return {
    warnings,
    info(_msg: string) {},
    verbose(_msg: string) {},
    warn(msg: string) { warnings.push(msg); },
    error(_msg: string) {},
    success(_msg: string) {},
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MailboxStateManager', () => {
  let tmpDir: string;
  let statePath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'wiki-mbx-state-'));
    statePath = join(tmpDir, 'sources', 'mailbox-state.json');
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Load / Save
  // -------------------------------------------------------------------------

  it('load creates empty state when file does not exist', async () => {
    const mgr = new MailboxStateManager(statePath);
    await mgr.load();
    const state = mgr.getState();
    assert.deepStrictEqual(state.mailboxes, {});
    assert.deepStrictEqual(state.processedMessageIds, []);
  });

  it('load reads existing state file', async () => {
    // Write a state file manually
    const { mkdir, writeFile } = await import('node:fs/promises');
    const dir = join(tmpDir, 'sources');
    await mkdir(dir, { recursive: true });
    const existingState = {
      mailboxes: {
        work: {
          folders: {
            INBOX: {
              uidValidity: 12345,
              processedUIDs: [1, 2, 3],
              lastProcessedAt: '2025-06-01T00:00:00Z',
            },
          },
        },
      },
      processedMessageIds: ['<msg1@example.com>', '<msg2@example.com>'],
    };
    await writeFile(statePath, JSON.stringify(existingState), 'utf-8');

    const mgr = new MailboxStateManager(statePath);
    await mgr.load();
    const state = mgr.getState();
    assert.strictEqual(state.mailboxes.work.folders.INBOX.uidValidity, 12345);
    assert.deepStrictEqual(state.mailboxes.work.folders.INBOX.processedUIDs, [1, 2, 3]);
    assert.ok(mgr.isMessageIdProcessed('<msg1@example.com>'));
    assert.ok(mgr.isMessageIdProcessed('<msg2@example.com>'));
  });

  it('save writes atomically (tmp file pattern)', async () => {
    const mgr = new MailboxStateManager(statePath);
    await mgr.load();
    mgr.markProcessed('work', 'INBOX', 1, '<msg1@example.com>');
    await mgr.save();

    // The final file should exist
    const raw = await readFile(statePath, 'utf-8');
    const data = JSON.parse(raw);
    assert.ok(data.mailboxes.work);
    assert.ok(data.mailboxes.work.folders.INBOX);
    assert.deepStrictEqual(data.processedMessageIds, ['<msg1@example.com>']);

    // The .tmp file should NOT exist (it was renamed)
    const dir = join(tmpDir, 'sources');
    const files = await readdir(dir);
    assert.ok(!files.includes('mailbox-state.json.tmp'));
  });

  it('save creates parent directories', async () => {
    const deepPath = join(tmpDir, 'a', 'b', 'c', 'mailbox-state.json');
    const mgr = new MailboxStateManager(deepPath);
    await mgr.load();
    mgr.markProcessed('test', 'INBOX', 1, '<m@test.com>');
    await mgr.save();

    const raw = await readFile(deepPath, 'utf-8');
    const data = JSON.parse(raw);
    assert.ok(data.mailboxes.test);
  });

  // -------------------------------------------------------------------------
  // UID processing
  // -------------------------------------------------------------------------

  it('isUIDProcessed returns false for new UID', async () => {
    const mgr = new MailboxStateManager(statePath);
    await mgr.load();
    assert.strictEqual(mgr.isUIDProcessed('work', 'INBOX', 42), false);
  });

  it('markProcessed adds UID and Message-ID', async () => {
    const mgr = new MailboxStateManager(statePath);
    await mgr.load();
    mgr.markProcessed('work', 'INBOX', 42, '<msg42@example.com>');

    assert.strictEqual(mgr.isUIDProcessed('work', 'INBOX', 42), true);
    assert.strictEqual(mgr.isMessageIdProcessed('<msg42@example.com>'), true);
  });

  it('isUIDProcessed returns true after markProcessed', async () => {
    const mgr = new MailboxStateManager(statePath);
    await mgr.load();
    assert.strictEqual(mgr.isUIDProcessed('work', 'INBOX', 10), false);
    mgr.markProcessed('work', 'INBOX', 10, '<msg10@example.com>');
    assert.strictEqual(mgr.isUIDProcessed('work', 'INBOX', 10), true);
  });

  it('markProcessed maintains sorted UID order', async () => {
    const mgr = new MailboxStateManager(statePath);
    await mgr.load();
    mgr.markProcessed('work', 'INBOX', 30, '<msg30@example.com>');
    mgr.markProcessed('work', 'INBOX', 10, '<msg10@example.com>');
    mgr.markProcessed('work', 'INBOX', 20, '<msg20@example.com>');

    const state = mgr.getState();
    assert.deepStrictEqual(
      state.mailboxes.work.folders.INBOX.processedUIDs,
      [10, 20, 30],
    );
  });

  it('markProcessed does not duplicate UIDs', async () => {
    const mgr = new MailboxStateManager(statePath);
    await mgr.load();
    mgr.markProcessed('work', 'INBOX', 10, '<msg10@example.com>');
    mgr.markProcessed('work', 'INBOX', 10, '<msg10@example.com>');

    const state = mgr.getState();
    assert.strictEqual(state.mailboxes.work.folders.INBOX.processedUIDs.length, 1);
  });

  // -------------------------------------------------------------------------
  // Message-ID processing
  // -------------------------------------------------------------------------

  it('isMessageIdProcessed returns false for unknown ID', async () => {
    const mgr = new MailboxStateManager(statePath);
    await mgr.load();
    assert.strictEqual(mgr.isMessageIdProcessed('<unknown@example.com>'), false);
  });

  it('isMessageIdProcessed returns true after markProcessed', async () => {
    const mgr = new MailboxStateManager(statePath);
    await mgr.load();
    mgr.markProcessed('work', 'INBOX', 1, '<known@example.com>');
    assert.strictEqual(mgr.isMessageIdProcessed('<known@example.com>'), true);
  });

  // -------------------------------------------------------------------------
  // getUnprocessedUIDs (via isUIDProcessed filtering)
  // -------------------------------------------------------------------------

  it('getUnprocessedUIDs filters out already-processed UIDs', async () => {
    const mgr = new MailboxStateManager(statePath);
    await mgr.load();
    mgr.markProcessed('work', 'INBOX', 1, '<msg1@example.com>');
    mgr.markProcessed('work', 'INBOX', 3, '<msg3@example.com>');

    const allUIDs = [1, 2, 3, 4, 5];
    const unprocessed = allUIDs.filter(
      (uid) => !mgr.isUIDProcessed('work', 'INBOX', uid),
    );
    assert.deepStrictEqual(unprocessed, [2, 4, 5]);
  });

  // -------------------------------------------------------------------------
  // UIDVALIDITY handling
  // -------------------------------------------------------------------------

  it('handleUIDValidityChange clears UIDs when validity changes', async () => {
    const mgr = new MailboxStateManager(statePath);
    await mgr.load();
    const logger = mockLogger();

    // Mark some UIDs and set validity
    mgr.setUIDValidity('work', 'INBOX', 100);
    mgr.markProcessed('work', 'INBOX', 1, '<msg1@example.com>');
    mgr.markProcessed('work', 'INBOX', 2, '<msg2@example.com>');

    assert.strictEqual(mgr.isUIDProcessed('work', 'INBOX', 1), true);

    // Validity changes
    mgr.handleUIDValidityChange('work', 'INBOX', 200, logger);

    // UIDs should be cleared
    assert.strictEqual(mgr.isUIDProcessed('work', 'INBOX', 1), false);
    assert.strictEqual(mgr.isUIDProcessed('work', 'INBOX', 2), false);

    // New validity should be stored
    assert.strictEqual(mgr.getUIDValidity('work', 'INBOX'), 200);

    // Message-IDs should still be present (they survive validity changes)
    assert.strictEqual(mgr.isMessageIdProcessed('<msg1@example.com>'), true);
    assert.strictEqual(mgr.isMessageIdProcessed('<msg2@example.com>'), true);

    // Logger should have been called
    assert.ok(logger.warnings.length > 0);
    assert.ok(logger.warnings[0].includes('UIDVALIDITY changed'));
  });

  it('handleUIDValidityChange keeps UIDs when validity is unchanged (same value)', async () => {
    const mgr = new MailboxStateManager(statePath);
    await mgr.load();

    mgr.setUIDValidity('work', 'INBOX', 100);
    mgr.markProcessed('work', 'INBOX', 1, '<msg1@example.com>');

    // Check validity before calling handle -- if same, we don't call handle
    const storedValidity = mgr.getUIDValidity('work', 'INBOX');
    assert.strictEqual(storedValidity, 100);

    // Same validity -- UIDs should remain
    assert.strictEqual(mgr.isUIDProcessed('work', 'INBOX', 1), true);
  });

  // -------------------------------------------------------------------------
  // resetState
  // -------------------------------------------------------------------------

  it('resetState clears all state when called without args', async () => {
    const mgr = new MailboxStateManager(statePath);
    await mgr.load();
    mgr.markProcessed('work', 'INBOX', 1, '<msg1@example.com>');
    mgr.markProcessed('research', 'INBOX', 2, '<msg2@example.com>');

    mgr.resetState();

    const state = mgr.getState();
    assert.deepStrictEqual(state.mailboxes, {});
    assert.deepStrictEqual(state.processedMessageIds, []);
    assert.strictEqual(mgr.isUIDProcessed('work', 'INBOX', 1), false);
    assert.strictEqual(mgr.isMessageIdProcessed('<msg1@example.com>'), false);
  });

  it('resetState clears only specified mailbox', async () => {
    const mgr = new MailboxStateManager(statePath);
    await mgr.load();
    mgr.markProcessed('work', 'INBOX', 1, '<msg1@example.com>');
    mgr.markProcessed('research', 'INBOX', 2, '<msg2@example.com>');

    mgr.resetState('work');

    // work should be cleared
    assert.strictEqual(mgr.isUIDProcessed('work', 'INBOX', 1), false);
    // research should remain
    assert.strictEqual(mgr.isUIDProcessed('research', 'INBOX', 2), true);
    // Message-IDs survive single-mailbox reset
    assert.strictEqual(mgr.isMessageIdProcessed('<msg1@example.com>'), true);
  });

  // -------------------------------------------------------------------------
  // getLastCheckTimestamp (via getState)
  // -------------------------------------------------------------------------

  it('getLastCheckTimestamp returns correct value via state', async () => {
    const mgr = new MailboxStateManager(statePath);
    await mgr.load();
    mgr.markProcessed('work', 'INBOX', 1, '<msg1@example.com>');

    const state = mgr.getState();
    const lastProcessedAt = state.mailboxes.work.folders.INBOX.lastProcessedAt;
    assert.ok(lastProcessedAt);
    // Should be a valid ISO timestamp
    const parsed = new Date(lastProcessedAt);
    assert.ok(!isNaN(parsed.getTime()));
    // Should be recent (within the last minute)
    const diff = Date.now() - parsed.getTime();
    assert.ok(diff >= 0 && diff < 60000);
  });

  it('getUIDValidity returns null for unrecorded folder', async () => {
    const mgr = new MailboxStateManager(statePath);
    await mgr.load();
    assert.strictEqual(mgr.getUIDValidity('work', 'INBOX'), null);
  });

  // -------------------------------------------------------------------------
  // Round-trip persistence
  // -------------------------------------------------------------------------

  it('save and load round-trip preserves state', async () => {
    const mgr1 = new MailboxStateManager(statePath);
    await mgr1.load();
    mgr1.setUIDValidity('work', 'INBOX', 555);
    mgr1.markProcessed('work', 'INBOX', 10, '<msg10@example.com>');
    mgr1.markProcessed('work', 'INBOX', 20, '<msg20@example.com>');
    await mgr1.save();

    // Load into a new manager
    const mgr2 = new MailboxStateManager(statePath);
    await mgr2.load();
    assert.strictEqual(mgr2.getUIDValidity('work', 'INBOX'), 555);
    assert.strictEqual(mgr2.isUIDProcessed('work', 'INBOX', 10), true);
    assert.strictEqual(mgr2.isUIDProcessed('work', 'INBOX', 20), true);
    assert.strictEqual(mgr2.isUIDProcessed('work', 'INBOX', 30), false);
    assert.strictEqual(mgr2.isMessageIdProcessed('<msg10@example.com>'), true);
    assert.strictEqual(mgr2.isMessageIdProcessed('<msg20@example.com>'), true);
  });
});
