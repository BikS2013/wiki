// src/wiki/log.ts -- LogWriter: append-only log entries to wiki/log.md

import { readFile, appendFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Recognised log action types.
 */
export type LogAction =
  | 'INIT'
  | 'INGEST'
  | 'UPDATE'
  | 'QUERY'
  | 'LINT'
  | 'CREATE_PAGE'
  | 'UPDATE_PAGE'
  | 'DELETE_PAGE'
  | 'REMOVE_SOURCE'
  | 'REBUILD_INDEX';

/**
 * A single log entry.
 */
export interface LogEntry {
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Action category */
  action: LogAction;
  /** Human-readable description of what happened */
  description: string;
  /** Relative paths to pages involved (optional) */
  relatedPages?: string[];
  /** Source registry ID (optional) */
  sourceId?: string;
}

// ---------------------------------------------------------------------------
// Log line format
// ---------------------------------------------------------------------------

// Format: [YYYY-MM-DD HH:mm] [ACTION] description
const LOG_LINE_REGEX = /^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\] \[([A-Z_]+)\] (.+)$/;

// ---------------------------------------------------------------------------
// Standalone functions
// ---------------------------------------------------------------------------

/**
 * Append a single log entry to the log file.
 * Creates the file and parent directories if they do not exist.
 * Never modifies existing content -- append only.
 */
export async function appendLog(
  logPath: string,
  entry: LogEntry,
): Promise<void> {
  const dir = dirname(logPath);
  await mkdir(dir, { recursive: true });

  const line = formatLogLine(entry);

  try {
    await appendFile(logPath, line, 'utf-8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      // File does not exist yet; create it with header + entry
      const header = '# Wiki Log\n\n';
      await writeFile(logPath, header + line, 'utf-8');
    } else {
      throw err;
    }
  }
}

/**
 * Read all log entries from the log file.
 * Returns an empty array if the file does not exist.
 */
export async function readLog(logPath: string): Promise<LogEntry[]> {
  let raw: string;
  try {
    raw = await readFile(logPath, 'utf-8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw err;
  }

  return parseLogEntries(raw);
}

// ---------------------------------------------------------------------------
// LogWriter class (for backward compatibility and convenience)
// ---------------------------------------------------------------------------

/**
 * Manages the append-only wiki/log.md file.
 *
 * Each log entry is a timestamped line with an action tag and a message,
 * appended to the end of the log file.
 */
export class LogWriter {
  private readonly logPath: string;

  constructor(wikiDir: string) {
    this.logPath = join(wikiDir, 'log.md');
  }

  /**
   * Append a log entry to wiki/log.md.
   *
   * @param action  Action tag (e.g., 'INGEST', 'QUERY', 'REMOVE_SOURCE')
   * @param message Human-readable message describing the action
   */
  async append(action: string, message: string): Promise<void> {
    await appendLog(this.logPath, {
      timestamp: new Date().toISOString(),
      action: action as LogAction,
      description: message,
    });
  }

  /**
   * Append multiple log entries atomically.
   */
  async appendBatch(entries: LogEntry[]): Promise<void> {
    const dir = dirname(this.logPath);
    await mkdir(dir, { recursive: true });

    const lines = entries.map(formatLogLine).join('');

    try {
      await appendFile(this.logPath, lines, 'utf-8');
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        const header = '# Wiki Log\n\n';
        await writeFile(this.logPath, header + lines, 'utf-8');
      } else {
        throw err;
      }
    }
  }

  /**
   * Read the full log content as a string.
   * Returns null if the log file does not exist.
   */
  async readLog(): Promise<string | null> {
    try {
      return await readFile(this.logPath, 'utf-8');
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw err;
    }
  }

  /**
   * Read all log entries as structured objects.
   */
  async readAll(): Promise<LogEntry[]> {
    return readLog(this.logPath);
  }

  /**
   * Get the last entry matching an action type.
   */
  async getLastEntry(action: LogAction): Promise<LogEntry | null> {
    const entries = await this.readAll();
    for (let i = entries.length - 1; i >= 0; i--) {
      if (entries[i].action === action) {
        return entries[i];
      }
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Format a LogEntry as a single log line.
 */
function formatLogLine(entry: LogEntry): string {
  const ts = formatTimestamp(entry.timestamp);
  let line = `[${ts}] [${entry.action}] ${entry.description}`;

  if (entry.relatedPages && entry.relatedPages.length > 0) {
    line += ` (pages: ${entry.relatedPages.join(', ')})`;
  }

  if (entry.sourceId) {
    line += ` (source: ${entry.sourceId})`;
  }

  return line + '\n';
}

/**
 * Convert an ISO 8601 timestamp to the log-friendly `YYYY-MM-DD HH:mm` format.
 */
function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (isNaN(date.getTime())) {
    // Fallback: use the raw string trimmed
    return iso.slice(0, 16).replace('T', ' ');
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');

  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

/**
 * Parse raw log file content into an array of LogEntry objects.
 */
function parseLogEntries(raw: string): LogEntry[] {
  const entries: LogEntry[] = [];
  const lines = raw.split('\n');

  for (const line of lines) {
    const match = LOG_LINE_REGEX.exec(line.trim());
    if (!match) continue;

    const [, timestamp, action, rest] = match;

    // Extract optional (pages: ...) and (source: ...) from description
    let description = rest;
    let relatedPages: string[] | undefined;
    let sourceId: string | undefined;

    const pagesMatch = description.match(/\s*\(pages: ([^)]+)\)\s*/);
    if (pagesMatch) {
      relatedPages = pagesMatch[1].split(',').map((p) => p.trim());
      description = description.replace(pagesMatch[0], '');
    }

    const sourceMatch = description.match(/\s*\(source: ([^)]+)\)\s*/);
    if (sourceMatch) {
      sourceId = sourceMatch[1].trim();
      description = description.replace(sourceMatch[0], '');
    }

    entries.push({
      timestamp: timestamp.replace(' ', 'T') + ':00Z',
      action: action as LogAction,
      description: description.trim(),
      ...(relatedPages ? { relatedPages } : {}),
      ...(sourceId ? { sourceId } : {}),
    });
  }

  return entries;
}
