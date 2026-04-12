// src/source/mailbox-state.ts -- MailboxStateManager: persistent tracking of processed emails

import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { Logger } from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

/**
 * State for a single IMAP folder within a mailbox.
 */
export interface FolderState {
  /** IMAP UIDVALIDITY value. If it changes, processedUIDs must be cleared. */
  uidValidity: number;

  /** IMAP UIDs that have been successfully processed (sorted ascending). */
  processedUIDs: number[];

  /** ISO 8601 timestamp of last successful processing in this folder. */
  lastProcessedAt: string;
}

/**
 * State for a single named mailbox (aggregates all its folders).
 */
export interface MailboxFolderState {
  folders: Record<string, FolderState>;
}

/**
 * Top-level state file structure. Persisted at sources/mailbox-state.json.
 */
export interface MailboxStateData {
  /** Per-mailbox state, keyed by mailbox name from config. */
  mailboxes: Record<string, MailboxFolderState>;

  /**
   * Global set of processed RFC 2822 Message-ID headers.
   * Used for cross-folder and cross-mailbox deduplication.
   * Stored as array on disk, loaded into a Set in memory for O(1) lookups.
   */
  processedMessageIds: string[];
}

// ---------------------------------------------------------------------------
// MailboxStateManager
// ---------------------------------------------------------------------------

/**
 * Manages the persistent mailbox state file that tracks which emails have
 * been processed. Provides UID-based and Message-ID-based deduplication.
 *
 * Follows the SourceRegistry atomic write pattern (tmp + rename).
 */
export class MailboxStateManager {
  private statePath: string;
  private state: MailboxStateData = { mailboxes: {}, processedMessageIds: [] };
  private messageIdSet: Set<string> = new Set();

  /**
   * @param statePath  Absolute path to sources/mailbox-state.json
   */
  constructor(statePath: string) {
    this.statePath = statePath;
  }

  /**
   * Load state from disk. If the file does not exist, initialize with empty state.
   * Must be called before any other method.
   */
  async load(): Promise<void> {
    try {
      const raw = await readFile(this.statePath, 'utf-8');
      this.state = JSON.parse(raw) as MailboxStateData;
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        // File doesn't exist yet -- start fresh
        this.state = { mailboxes: {}, processedMessageIds: [] };
      } else {
        throw err;
      }
    }

    // Load processedMessageIds array into a Set for O(1) lookups
    this.messageIdSet = new Set(this.state.processedMessageIds);
  }

  /**
   * Persist current state to disk atomically (write to .tmp, then rename).
   * Follows the SourceRegistry pattern.
   */
  async save(): Promise<void> {
    // Convert Set back to sorted array for deterministic JSON output
    this.state.processedMessageIds = [...this.messageIdSet].sort();

    const dir = path.dirname(this.statePath);
    await mkdir(dir, { recursive: true });

    const tmpPath = this.statePath + '.tmp';
    await writeFile(tmpPath, JSON.stringify(this.state, null, 2), 'utf-8');
    await rename(tmpPath, this.statePath);
  }

  /**
   * Check if a UID has been processed for a given mailbox/folder.
   */
  isUIDProcessed(mailboxName: string, folder: string, uid: number): boolean {
    const folderState = this.getFolderState(mailboxName, folder);
    if (!folderState) return false;
    return folderState.processedUIDs.includes(uid);
  }

  /**
   * Check if a Message-ID has been processed globally.
   * Uses an in-memory Set<string> for O(1) lookups.
   */
  isMessageIdProcessed(messageId: string): boolean {
    return this.messageIdSet.has(messageId);
  }

  /**
   * Get stored UIDVALIDITY for a folder, or null if not yet recorded.
   */
  getUIDValidity(mailboxName: string, folder: string): number | null {
    const folderState = this.getFolderState(mailboxName, folder);
    return folderState ? folderState.uidValidity : null;
  }

  /**
   * Handle UIDVALIDITY change: clear processedUIDs for the affected folder
   * and update the stored UIDVALIDITY to the new value.
   * Logs a warning via the provided logger.
   * Does NOT clear processedMessageIds (they remain valid across validity changes).
   */
  handleUIDValidityChange(
    mailboxName: string,
    folder: string,
    newValidity: number,
    logger: Logger,
  ): void {
    logger.warn(
      `UIDVALIDITY changed for ${mailboxName}/${folder}. Clearing processed UIDs for this folder. Message-ID dedup still active.`,
    );

    this.ensureMailboxFolder(mailboxName, folder);
    const folderState = this.state.mailboxes[mailboxName].folders[folder];
    folderState.processedUIDs = [];
    folderState.uidValidity = newValidity;
  }

  /**
   * Set/update UIDVALIDITY for a folder (used on first encounter).
   */
  setUIDValidity(mailboxName: string, folder: string, validity: number): void {
    this.ensureMailboxFolder(mailboxName, folder);
    this.state.mailboxes[mailboxName].folders[folder].uidValidity = validity;
  }

  /**
   * Mark an email as successfully processed.
   * Adds UID to the folder's processedUIDs and messageId to processedMessageIds.
   * Does NOT call save() -- caller is responsible for calling save() after.
   */
  markProcessed(mailboxName: string, folder: string, uid: number, messageId: string): void {
    this.ensureMailboxFolder(mailboxName, folder);
    const folderState = this.state.mailboxes[mailboxName].folders[folder];

    // Insert UID maintaining sorted order
    if (!folderState.processedUIDs.includes(uid)) {
      folderState.processedUIDs.push(uid);
      folderState.processedUIDs.sort((a, b) => a - b);
    }

    // Update timestamp
    folderState.lastProcessedAt = new Date().toISOString();

    // Add to global Message-ID set
    this.messageIdSet.add(messageId);
  }

  /**
   * Reset state for a specific mailbox or all mailboxes.
   * If mailboxName is provided, clears only that mailbox's folder state.
   * If mailboxName is undefined, clears all state (all mailboxes + processedMessageIds).
   */
  resetState(mailboxName?: string): void {
    if (mailboxName) {
      // Clear only the specified mailbox
      delete this.state.mailboxes[mailboxName];
    } else {
      // Clear all state
      this.state.mailboxes = {};
      this.state.processedMessageIds = [];
      this.messageIdSet.clear();
    }
  }

  /**
   * Get a read-only copy of the current state (for debugging/display).
   */
  getState(): Readonly<MailboxStateData> {
    // Sync the array from the Set before returning
    this.state.processedMessageIds = [...this.messageIdSet].sort();
    return this.state;
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Get the FolderState for a mailbox/folder, or undefined if not yet recorded.
   */
  private getFolderState(mailboxName: string, folder: string): FolderState | undefined {
    const mailbox = this.state.mailboxes[mailboxName];
    if (!mailbox) return undefined;
    return mailbox.folders[folder];
  }

  /**
   * Ensure the mailbox and folder structures exist in state.
   */
  private ensureMailboxFolder(mailboxName: string, folder: string): void {
    if (!this.state.mailboxes[mailboxName]) {
      this.state.mailboxes[mailboxName] = { folders: {} };
    }
    if (!this.state.mailboxes[mailboxName].folders[folder]) {
      this.state.mailboxes[mailboxName].folders[folder] = {
        uidValidity: 0,
        processedUIDs: [],
        lastProcessedAt: '',
      };
    }
  }
}
