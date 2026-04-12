// src/source/imap.ts -- ImapClient: self-contained IMAP wrapper for email fetching

import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { ImapFlow } from 'imapflow';
import type { Logger } from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Exported Interfaces
// ---------------------------------------------------------------------------

/**
 * Configuration passed to ImapClient constructor.
 * Derived from MailboxConfig with field name mapping (tls -> secure).
 */
export interface ImapConnectionConfig {
  host: string;
  port: number;
  secure: boolean;        // mapped from MailboxConfig.tls
  user: string;
  password: string;
  connectionTimeout: number;
}

/**
 * Envelope metadata extracted from a single email.
 */
export interface EmailEnvelope {
  uid: number;
  messageId: string;      // RFC 2822 Message-ID or synthetic SHA-256 hash
  subject: string;
  from: string;           // sender email address
  date: string;           // ISO 8601
}

/**
 * Extracted email body content.
 */
export interface EmailContent {
  body: string;           // plain text, or HTML converted to markdown
  bodyFormat: 'plain' | 'html-converted';
  usedFallback: boolean;  // true if postal-mime fallback was used
}

/**
 * Metadata for a discovered attachment (before download).
 */
export interface EmailAttachment {
  filename: string;
  mimeType: string;
  part: string;           // IMAP part number for streaming download
  size: number;
  isInline: boolean;
}

/**
 * A fully fetched email ready for processing.
 */
export interface FetchedEmail {
  envelope: EmailEnvelope;
  content: EmailContent;
  attachments: EmailAttachment[];
}

// ---------------------------------------------------------------------------
// Internal types for bodyStructure traversal
// ---------------------------------------------------------------------------

/** Minimal typing for an imapflow bodyStructure node. */
interface MessageStructureNode {
  type?: string;
  part?: string;
  disposition?: string;
  dispositionParameters?: Record<string, string>;
  parameters?: Record<string, string>;
  description?: string;
  id?: string;
  size?: number;
  childNodes?: MessageStructureNode[];
}

// ---------------------------------------------------------------------------
// Internal helpers (not exported)
// ---------------------------------------------------------------------------

/**
 * Recursively find the first text/plain body part, skipping attachment-disposition nodes.
 * Returns the IMAP part number string, or null.
 * For root single-part messages (no `part` field), returns '1'.
 */
function findPlainTextPart(node: MessageStructureNode): string | null {
  if (node.disposition === 'attachment') return null;

  if (node.type === 'text/plain' && node.disposition !== 'attachment') {
    return node.part || '1';
  }

  if (node.childNodes) {
    for (const child of node.childNodes) {
      const result = findPlainTextPart(child);
      if (result) return result;
    }
  }

  return null;
}

/**
 * Recursively find the first text/html body part, skipping attachment-disposition nodes.
 * Returns the IMAP part number string, or null.
 */
function findHtmlPart(node: MessageStructureNode): string | null {
  if (node.disposition === 'attachment') return null;

  if (node.type === 'text/html' && node.disposition !== 'attachment') {
    return node.part || '1';
  }

  if (node.childNodes) {
    for (const child of node.childNodes) {
      const result = findHtmlPart(child);
      if (result) return result;
    }
  }

  return null;
}

/**
 * Recursively collect all attachment parts from the bodyStructure tree.
 * Identifies attachments by:
 *   1. Explicit: node.disposition === 'attachment'
 *   2. Implicit: type is not text/* or multipart/*, and no disposition set
 *   3. Inline CID images: node.disposition === 'inline' with node.id present
 */
function findAllAttachments(node: MessageStructureNode): EmailAttachment[] {
  const attachments: EmailAttachment[] = [];

  if (node.disposition === 'attachment') {
    attachments.push({
      filename: extractFilename(node),
      mimeType: node.type || 'application/octet-stream',
      part: node.part || '1',
      size: node.size || 0,
      isInline: false,
    });
  } else if (node.disposition === 'inline' && node.id) {
    // Inline CID image
    attachments.push({
      filename: extractFilename(node),
      mimeType: node.type || 'application/octet-stream',
      part: node.part || '1',
      size: node.size || 0,
      isInline: true,
    });
  } else if (
    node.type &&
    !node.type.startsWith('text/') &&
    !node.type.startsWith('multipart/') &&
    !node.disposition &&
    node.part
  ) {
    // Implicit attachment: non-text, non-multipart, no disposition
    attachments.push({
      filename: extractFilename(node),
      mimeType: node.type,
      part: node.part,
      size: node.size || 0,
      isInline: false,
    });
  }

  if (node.childNodes) {
    for (const child of node.childNodes) {
      attachments.push(...findAllAttachments(child));
    }
  }

  return attachments;
}

/**
 * Extract filename from a bodyStructure node.
 * Priority: dispositionParameters.filename > parameters.name > description > 'attachment'
 * ImapFlow decodes RFC 2231 and RFC 2047 filenames via libmime automatically.
 */
function extractFilename(node: MessageStructureNode): string {
  return (
    node.dispositionParameters?.filename ||
    node.parameters?.name ||
    node.description ||
    'attachment'
  );
}

/**
 * Generate a synthetic Message-ID from SHA-256 of from+date+subject.
 * Used when the email has no Message-ID header.
 */
function generateSyntheticMessageId(from: string, date: string, subject: string): string {
  const hash = createHash('sha256')
    .update(`${from}|${date}|${subject}`)
    .digest('hex')
    .slice(0, 32);
  return `<synthetic-${hash}@wiki-generated>`;
}

/**
 * Download a single IMAP part to a Buffer.
 * Uses client.download() which auto-decodes base64/quoted-printable.
 */
async function downloadPartToBuffer(client: ImapFlow, uid: number, part: string): Promise<Buffer> {
  const { content } = await client.download(String(uid), part, { uid: true });
  const chunks: Buffer[] = [];
  for await (const chunk of content) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

// ---------------------------------------------------------------------------
// ImapClient
// ---------------------------------------------------------------------------

/**
 * Self-contained IMAP client wrapper. Handles connection, UID search,
 * message fetching, body extraction (with MIME tree traversal), attachment
 * discovery, and streaming download. No knowledge of the wiki or ingest pipeline.
 */
export class ImapClient {
  private config: ImapConnectionConfig;
  private logger: Logger;
  private client: ImapFlow | null = null;
  private lock: { release: () => void } | null = null;

  /**
   * @param config  Connection configuration (host, port, secure, user, password, timeout).
   * @param logger  Logger instance. Passwords are NEVER logged even in verbose mode.
   */
  constructor(config: ImapConnectionConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
  }

  /**
   * Connect to the IMAP server.
   * Configures imapflow with logger: false to prevent credential leakage.
   * Connection timeout is set from config.connectionTimeout.
   * @throws Error on connection failure or authentication failure.
   */
  async connect(): Promise<void> {
    this.logger.verbose(`Connecting to ${this.config.host}:${this.config.port} as ${this.config.user}`);

    this.client = new ImapFlow({
      host: this.config.host,
      port: this.config.port,
      secure: this.config.secure,
      auth: {
        user: this.config.user,
        pass: this.config.password,
      },
      logger: false,              // NEVER log credentials
      emitLogs: false,
      socketTimeout: this.config.connectionTimeout,
      greetingTimeout: this.config.connectionTimeout,
    });

    await this.client.connect();
    this.logger.verbose(`Connected to ${this.config.host}:${this.config.port}`);
  }

  /**
   * Disconnect cleanly from the IMAP server via logout().
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.logout();
      this.client = null;
    }
  }

  /**
   * Open an IMAP folder and acquire the mailbox lock.
   * @returns The UIDVALIDITY value for the opened folder.
   */
  async openFolder(folderName: string): Promise<{ uidValidity: number }> {
    this.ensureConnected();

    this.lock = await this.client!.getMailboxLock(folderName);
    const mailbox = this.client!.mailbox;

    if (!mailbox) {
      throw new Error(`Failed to open folder: ${folderName}`);
    }

    const uidValidity = Number(mailbox.uidValidity) || 0;
    this.logger.verbose(`Opened folder "${folderName}" (UIDVALIDITY: ${uidValidity})`);

    return { uidValidity };
  }

  /**
   * Release the mailbox lock for the currently open folder.
   */
  async releaseFolder(): Promise<void> {
    if (this.lock) {
      this.lock.release();
      this.lock = null;
    }
  }

  /**
   * Search for all UIDs in the currently open folder.
   * Uses client.search({ all: true }, { uid: true }).
   * @returns UIDs sorted ascending (oldest first, per FR-69).
   */
  async searchAllUIDs(): Promise<number[]> {
    this.ensureConnected();

    const result = await this.client!.search({ all: true }, { uid: true });
    // imapflow search() can return false if no matches
    const uids: number[] = (Array.isArray(result) ? result : []) as number[];
    // Ensure ascending sort (oldest first)
    return uids.sort((a: number, b: number) => a - b);
  }

  /**
   * Fetch envelope metadata for a single UID.
   * Handles missing Message-ID by generating a synthetic one.
   * @throws Error if the message is not found.
   */
  async fetchEnvelope(uid: number): Promise<EmailEnvelope> {
    this.ensureConnected();

    const msg = await this.client!.fetchOne(String(uid), { envelope: true }, { uid: true });

    if (!msg || !msg.envelope) {
      throw new Error(`Message not found: UID ${uid}`);
    }

    const env = msg.envelope;

    // Extract sender email address
    const fromAddr = env.from?.[0]?.address || 'unknown@unknown';

    // Extract date as ISO 8601
    const date = env.date ? new Date(env.date).toISOString() : new Date().toISOString();

    // Extract or generate Message-ID
    let messageId = env.messageId || '';
    if (!messageId) {
      messageId = generateSyntheticMessageId(fromAddr, date, env.subject || '');
      this.logger.warn(`Email UID ${uid} has no Message-ID. Generated synthetic: ${messageId}`);
    }

    return {
      uid,
      messageId,
      subject: env.subject || '(No Subject)',
      from: fromAddr,
      date,
    };
  }

  /**
   * Fetch the email body content for a single UID.
   * Strategy:
   *   1. Fetch bodyStructure via fetchOne(uid, { bodyStructure: true })
   *   2. Walk MIME tree: prefer text/plain, fall back to text/html + turndown
   *   3. If neither found, or on download error: fallback to postal-mime full parse
   * @throws Error if body extraction fails even with fallback.
   */
  async fetchBody(uid: number): Promise<EmailContent> {
    this.ensureConnected();

    // Fetch bodyStructure
    const msg = await this.client!.fetchOne(String(uid), { bodyStructure: true }, { uid: true });

    if (!msg || !msg.bodyStructure) {
      // Fallback: no bodyStructure available
      return this.fetchBodyWithPostalMime(uid);
    }

    const bodyStructure = msg.bodyStructure as unknown as MessageStructureNode;

    // Check if root type is message/rfc822 (trigger fallback)
    if (bodyStructure.type === 'message/rfc822') {
      this.logger.verbose(`UID ${uid}: Root type is message/rfc822, using postal-mime fallback`);
      return this.fetchBodyWithPostalMime(uid);
    }

    // Try text/plain first
    const plainPart = findPlainTextPart(bodyStructure);
    if (plainPart) {
      try {
        const buffer = await downloadPartToBuffer(this.client!, uid, plainPart);
        return {
          body: buffer.toString('utf-8'),
          bodyFormat: 'plain',
          usedFallback: false,
        };
      } catch (err) {
        this.logger.warn(`UID ${uid}: Failed to download text/plain part, trying HTML or fallback: ${(err as Error).message}`);
      }
    }

    // Try text/html with turndown conversion
    const htmlPart = findHtmlPart(bodyStructure);
    if (htmlPart) {
      try {
        const buffer = await downloadPartToBuffer(this.client!, uid, htmlPart);
        const html = buffer.toString('utf-8');

        const TurndownService = (await import('turndown')).default;
        const turndown = new TurndownService({
          headingStyle: 'atx',
          codeBlockStyle: 'fenced',
          bulletListMarker: '-',
        });
        const markdown = turndown.turndown(html);

        return {
          body: markdown,
          bodyFormat: 'html-converted',
          usedFallback: false,
        };
      } catch (err) {
        this.logger.warn(`UID ${uid}: Failed to download/convert HTML part, using postal-mime fallback: ${(err as Error).message}`);
      }
    }

    // Fallback: neither text/plain nor text/html found, or both download attempts failed
    return this.fetchBodyWithPostalMime(uid);
  }

  /**
   * Discover attachments from the bodyStructure of a single UID.
   * @returns Array of attachment metadata (filename, mimeType, part number, size, isInline).
   */
  async discoverAttachments(uid: number): Promise<EmailAttachment[]> {
    this.ensureConnected();

    const msg = await this.client!.fetchOne(String(uid), { bodyStructure: true }, { uid: true });

    if (!msg || !msg.bodyStructure) {
      return [];
    }

    return findAllAttachments(msg.bodyStructure as unknown as MessageStructureNode);
  }

  /**
   * Download a single attachment part and stream it to a file on disk.
   * Uses client.download() which auto-decodes base64/quoted-printable.
   * Streams via pipeline(content, createWriteStream(destPath)).
   * @param uid     Message UID
   * @param part    IMAP part number (e.g., '2', '1.2.3')
   * @param destPath  Absolute path to write the decoded attachment
   */
  async downloadAttachment(uid: number, part: string, destPath: string): Promise<void> {
    this.ensureConnected();

    const { content } = await this.client!.download(String(uid), part, { uid: true });
    const writeStream = createWriteStream(destPath);
    await pipeline(content, writeStream);
  }

  /**
   * Move a message by UID to a destination folder.
   * The folder is opened in the caller; this method uses messageMove() on the current lock.
   * @param uid       Message UID in the currently open folder
   * @param destFolder  Destination IMAP folder path (e.g., 'processed', 'ignored-emails')
   */
  async moveMessage(uid: number, destFolder: string): Promise<void> {
    this.ensureConnected();
    await this.client!.messageMove(String(uid), destFolder, { uid: true });
    this.logger.verbose(`Moved UID ${uid} to "${destFolder}"`);
  }

  /**
   * Create an IMAP folder if it doesn't already exist.
   * Uses mailboxCreate() which is a no-op if the folder exists on most servers.
   * @param folderName  Full IMAP folder path (e.g., 'processed', 'ignored-emails')
   */
  async createFolderIfNeeded(folderName: string): Promise<void> {
    this.ensureConnected();
    try {
      await this.client!.mailboxCreate(folderName);
      this.logger.verbose(`Created IMAP folder: "${folderName}"`);
    } catch (err) {
      // Folder likely already exists — ALREADYEXISTS is not an error
      const msg = (err as Error).message || '';
      if (msg.includes('ALREADYEXISTS') || msg.includes('already exists') || msg.includes('Mailbox already exists')) {
        this.logger.verbose(`IMAP folder already exists: "${folderName}"`);
      } else {
        throw err;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Postal-mime fallback: fetch full message source and parse with postal-mime.
   */
  private async fetchBodyWithPostalMime(uid: number): Promise<EmailContent> {
    this.logger.verbose(`UID ${uid}: Using postal-mime fallback for body extraction`);

    const msg = await this.client!.fetchOne(String(uid), { source: true }, { uid: true });

    if (!msg || !msg.source) {
      throw new Error(`Failed to fetch source for UID ${uid}`);
    }

    const source = msg.source instanceof Buffer ? msg.source : Buffer.from(msg.source);

    const PostalMime = (await import('postal-mime')).default;
    const parsed = await PostalMime.parse(source);

    // Prefer text content, fall back to HTML conversion
    if (parsed.text) {
      return {
        body: parsed.text,
        bodyFormat: 'plain',
        usedFallback: true,
      };
    }

    if (parsed.html) {
      const TurndownService = (await import('turndown')).default;
      const turndown = new TurndownService({
        headingStyle: 'atx',
        codeBlockStyle: 'fenced',
        bulletListMarker: '-',
      });
      const markdown = turndown.turndown(parsed.html);
      return {
        body: markdown,
        bodyFormat: 'html-converted',
        usedFallback: true,
      };
    }

    throw new Error(`No text or HTML body found for UID ${uid} (even with postal-mime fallback)`);
  }

  private ensureConnected(): void {
    if (!this.client) {
      throw new Error('ImapClient is not connected. Call connect() first.');
    }
  }
}
