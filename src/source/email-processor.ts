// src/source/email-processor.ts -- EmailProcessor: bridge between IMAP client and ingest pipeline

import { existsSync } from 'node:fs';
import { writeFile, mkdir } from 'node:fs/promises';
import { join, extname } from 'node:path';

import type { ImapClient, EmailEnvelope, EmailContent } from './imap.js';
import type { IngestPipeline, IngestResult } from '../ingest/pipeline.js';
import type { Logger } from '../utils/logger.js';


// ---------------------------------------------------------------------------
// Exported Interfaces
// ---------------------------------------------------------------------------

/**
 * Result of processing a single email through the pipeline.
 */
export interface EmailProcessingResult {
  emailMessageId: string;
  subject: string;
  bodySourcePath: string;
  attachmentSourcePaths: string[];
  ingestResults: IngestResult[];
  skippedAttachments: Array<{ filename: string; mimeType: string; reason: string }>;
}

/**
 * Options for the EmailProcessor.
 */
export interface EmailProcessorOptions {
  dryRun: boolean;
  verbose: boolean;
  sourcesDir: string;                 // absolute path to sources/files/
  supportedExtensions: Set<string>;   // from getSupportedFormats()
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Compose the email body as a markdown document.
 */
function composeBodyMarkdown(envelope: EmailEnvelope, content: EmailContent): string {
  const lines: string[] = [
    `# ${envelope.subject}`,
    '',
    `**From**: ${envelope.from}`,
    `**Date**: ${envelope.date}`,
    '',
    content.body,
  ];
  return lines.join('\n');
}

/**
 * Format a date as YYYY-MM-DD-HHmmss for filename use.
 */
function formatTimestamp(isoDate: string): string {
  const d = new Date(isoDate);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const hours = String(d.getUTCHours()).padStart(2, '0');
  const minutes = String(d.getUTCMinutes()).padStart(2, '0');
  const seconds = String(d.getUTCSeconds()).padStart(2, '0');
  return `${year}-${month}-${day}-${hours}${minutes}${seconds}`;
}

/**
 * Sanitize a string for use as a filename.
 * Removes filesystem-unsafe characters, collapses whitespace, truncates.
 */
function sanitizeForFilename(name: string): string {
  return name
    .replace(/[/\\:*?"<>|]/g, '_')    // filesystem-unsafe chars
    .replace(/\x00/g, '')              // null bytes
    .replace(/[\x01-\x1f]/g, '')       // control characters
    .replace(/\s+/g, '-')              // whitespace to hyphens
    .toLowerCase()
    .trim()
    .slice(0, 100)                     // reasonable length cap
    || 'untitled';
}

/**
 * Generate the email body filename.
 */
function generateEmailBodyFilename(envelope: EmailEnvelope): string {
  const dateStr = formatTimestamp(envelope.date);
  const sanitized = sanitizeForFilename(envelope.subject);
  return `email-${dateStr}-${sanitized}.md`;
}

/**
 * Generate the attachment filename.
 */
function generateAttachmentFilename(envelope: EmailEnvelope, originalFilename: string): string {
  const dateStr = formatTimestamp(envelope.date);
  const sanitized = sanitizeForFilename(originalFilename);
  return `email-att-${dateStr}-${sanitized}`;
}

/**
 * Deduplicate a filename by appending -1, -2, etc. if it already exists.
 */
function deduplicateFilename(dir: string, filename: string): string {
  const ext = extname(filename);
  const base = filename.slice(0, filename.length - ext.length);

  let candidate = filename;
  let counter = 1;
  while (existsSync(join(dir, candidate))) {
    candidate = `${base}-${counter}${ext}`;
    counter++;
  }

  return candidate;
}

// ---------------------------------------------------------------------------
// EmailProcessor
// ---------------------------------------------------------------------------

/**
 * Bridge between the IMAP client and the ingest pipeline. Converts fetched
 * emails into source files and invokes IngestPipeline.ingest().
 */
export class EmailProcessor {
  private pipeline: IngestPipeline;
  private options: EmailProcessorOptions;
  private logger: Logger;

  /**
   * @param pipeline  The existing IngestPipeline instance (reused across emails).
   * @param options   Processing options (dryRun, verbose, sourcesDir, supportedExtensions).
   * @param logger    Logger instance.
   */
  constructor(
    pipeline: IngestPipeline,
    options: EmailProcessorOptions,
    logger: Logger,
  ) {
    this.pipeline = pipeline;
    this.options = options;
    this.logger = logger;
  }

  /**
   * Process a single email: save body + attachments as files, ingest each.
   *
   * Does NOT update mailbox state -- the caller (MailCheckCommand) does that.
   * If any step fails, the exception propagates to the caller.
   * In dry-run mode, logs what would be done without creating files or calling pipeline.
   *
   * @param client       Connected ImapClient with a folder open.
   * @param envelope     Pre-fetched envelope metadata for this email.
   * @param mailboxName  Config mailbox name (for metadata tagging).
   * @returns Processing result with paths and ingest results.
   * @throws Error if body ingest or any attachment download/ingest fails.
   */
  async processEmail(
    client: ImapClient,
    envelope: EmailEnvelope,
    mailboxName: string,
  ): Promise<EmailProcessingResult> {
    const result: EmailProcessingResult = {
      emailMessageId: envelope.messageId,
      subject: envelope.subject,
      bodySourcePath: '',
      attachmentSourcePaths: [],
      ingestResults: [],
      skippedAttachments: [],
    };

    // Construct email metadata for the body source
    const bodyMetadata: Record<string, string> = {
      source: 'email',
      emailMessageId: envelope.messageId,
      emailFrom: envelope.from,
      emailDate: envelope.date,
      emailSubject: envelope.subject,
      mailboxName: mailboxName,
    };

    // --- Step 1: Fetch and save body ---
    const content = await client.fetchBody(envelope.uid);
    const bodyMarkdown = composeBodyMarkdown(envelope, content);

    const bodyFilename = deduplicateFilename(
      this.options.sourcesDir,
      generateEmailBodyFilename(envelope),
    );
    const bodyPath = join(this.options.sourcesDir, bodyFilename);

    if (this.options.dryRun) {
      this.logger.info(`[DRY-RUN] Would save email body to: ${bodyPath}`);
      this.logger.info(`[DRY-RUN] Would ingest email body: "${envelope.subject}"`);
    } else {
      await mkdir(this.options.sourcesDir, { recursive: true });
      await writeFile(bodyPath, bodyMarkdown, 'utf-8');
      this.logger.verbose(`Saved email body to: ${bodyPath}`);

      const ingestResult = await this.pipeline.ingest(bodyPath, {
        metadata: bodyMetadata,
      });
      result.ingestResults.push(ingestResult);
    }

    result.bodySourcePath = bodyPath;

    // --- Step 2: Discover and process attachments ---
    const attachments = await client.discoverAttachments(envelope.uid);

    // Construct attachment metadata (extends body metadata)
    const attachmentMetadata: Record<string, string> = {
      ...bodyMetadata,
      parentEmailMessageId: envelope.messageId,
    };

    for (const attachment of attachments) {
      // Check extension against supported formats
      const ext = extname(attachment.filename).toLowerCase();
      if (!ext || !this.options.supportedExtensions.has(ext)) {
        const reason = `Unsupported file extension: ${ext || '(none)'}`;
        this.logger.warn(`Skipping attachment "${attachment.filename}" (${attachment.mimeType}): ${reason}`);
        result.skippedAttachments.push({
          filename: attachment.filename,
          mimeType: attachment.mimeType,
          reason,
        });
        continue;
      }

      const attFilename = deduplicateFilename(
        this.options.sourcesDir,
        generateAttachmentFilename(envelope, attachment.filename),
      );
      const attPath = join(this.options.sourcesDir, attFilename);

      if (this.options.dryRun) {
        this.logger.info(`[DRY-RUN] Would download attachment "${attachment.filename}" to: ${attPath}`);
        this.logger.info(`[DRY-RUN] Would ingest attachment: "${attachment.filename}"`);
      } else {
        await mkdir(this.options.sourcesDir, { recursive: true });
        await client.downloadAttachment(envelope.uid, attachment.part, attPath);
        this.logger.verbose(`Downloaded attachment to: ${attPath}`);

        const ingestResult = await this.pipeline.ingest(attPath, {
          metadata: attachmentMetadata,
        });
        result.ingestResults.push(ingestResult);
      }

      result.attachmentSourcePaths.push(attPath);
    }

    return result;
  }
}
