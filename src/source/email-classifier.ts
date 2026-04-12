// src/source/email-classifier.ts -- LLM-based email classification for mail-check

import type { LLMProvider } from '../llm/provider.js';
import type { Logger } from '../utils/logger.js';
import type { EmailEnvelope } from './imap.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EmailClassification = 'content' | 'ignore';

export interface ClassificationResult {
  classification: EmailClassification;
  reason: string;
}

// ---------------------------------------------------------------------------
// EmailClassifier
// ---------------------------------------------------------------------------

/**
 * Uses the configured LLM provider to classify emails as wiki-worthy content
 * or noise (ads, notifications, security alerts, marketing, etc.).
 *
 * Classification is based on the email envelope (subject, from, date) and
 * a preview of the body text (first ~500 chars to minimize token usage).
 */
export class EmailClassifier {
  private provider: LLMProvider;
  private logger: Logger;

  constructor(provider: LLMProvider, logger: Logger) {
    this.provider = provider;
    this.logger = logger;
  }

  /**
   * Classify an email as 'content' (should be ingested into wiki) or
   * 'ignore' (noise — ads, notifications, automated alerts, marketing).
   *
   * @param envelope  Email metadata (subject, from, date)
   * @param bodyPreview  First ~500 characters of the email body
   * @returns Classification result with reason
   */
  async classify(envelope: EmailEnvelope, bodyPreview: string): Promise<ClassificationResult> {
    const systemPrompt = [
      'You are an email classification assistant for a personal knowledge base (wiki).',
      'Your task is to determine if an email contains meaningful content worth adding to a wiki,',
      'or if it is noise that should be ignored.',
      '',
      'IGNORE these types of emails (classify as "ignore"):',
      '- Automated notifications (security alerts, login alerts, password changes)',
      '- Marketing emails and newsletters from companies',
      '- Account setup and verification emails',
      '- Social media notifications',
      '- Automated system emails (no-reply addresses)',
      '- Shipping/delivery notifications',
      '- Subscription confirmations',
      '- Spam or promotional content',
      '- Generic welcome/onboarding emails from services',
      '',
      'KEEP these types of emails (classify as "content"):',
      '- Personal correspondence with substantive information',
      '- Professional emails containing knowledge, insights, or data',
      '- Emails with meaningful attachments (documents, reports, articles)',
      '- Meeting notes, summaries, or action items',
      '- Research findings or technical discussions',
      '- Emails the user explicitly sent to this inbox for wiki processing',
      '',
      'Respond with EXACTLY one line in this format:',
      'CLASSIFICATION: content|ignore REASON: <brief reason>',
      '',
      'Example responses:',
      'CLASSIFICATION: ignore REASON: Automated security alert from Google',
      'CLASSIFICATION: content REASON: Technical discussion about API design patterns',
    ].join('\n');

    const userMessage = [
      `From: ${envelope.from}`,
      `Subject: ${envelope.subject}`,
      `Date: ${envelope.date}`,
      '',
      '--- BODY PREVIEW ---',
      bodyPreview.slice(0, 500),
      '--- END PREVIEW ---',
    ].join('\n');

    try {
      const result = await this.provider.complete({
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
        maxTokens: 100,
        temperature: 0.0,
      });

      return this.parseResponse(result.text, envelope);
    } catch (err) {
      // On classification failure, default to 'content' to avoid losing emails
      this.logger.warn(
        `Classification failed for "${envelope.subject}" — treating as content: ${(err as Error).message}`,
      );
      return {
        classification: 'content',
        reason: 'Classification failed — defaulting to content to avoid data loss',
      };
    }
  }

  /**
   * Parse the LLM response into a ClassificationResult.
   * Falls back to 'content' if the response format is unexpected.
   */
  private parseResponse(text: string, envelope: EmailEnvelope): ClassificationResult {
    const line = text.trim().split('\n')[0];
    const match = line.match(/^CLASSIFICATION:\s*(content|ignore)\s+REASON:\s*(.+)$/i);

    if (match) {
      return {
        classification: match[1].toLowerCase() as EmailClassification,
        reason: match[2].trim(),
      };
    }

    // Try looser parsing
    const lower = text.toLowerCase();
    if (lower.includes('classification: ignore') || lower.includes('classification:ignore')) {
      const reasonMatch = text.match(/REASON:\s*(.+)/i);
      return {
        classification: 'ignore',
        reason: reasonMatch ? reasonMatch[1].trim() : 'Classified as noise',
      };
    }

    // Default to content if parsing fails
    this.logger.verbose(`Could not parse classification for "${envelope.subject}", defaulting to content. Raw: ${text.slice(0, 100)}`);
    return {
      classification: 'content',
      reason: 'Classification response unclear — defaulting to content',
    };
  }
}
