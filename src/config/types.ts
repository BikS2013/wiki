// src/config/types.ts -- Configuration type definitions for LLM Wiki

/**
 * LLM provider configuration.
 * Defines which LLM service to use and the credentials/settings for it.
 */
export interface LLMConfig {
  /** LLM provider identifier */
  provider: 'anthropic' | 'azure' | 'vertex';

  /** Model name/identifier (e.g., 'claude-sonnet-4-20250514') */
  model: string;

  /** API key for the selected provider. Required for 'anthropic' and 'azure'; not required for 'vertex' (uses ADC). */
  apiKey?: string;

  /** ISO 8601 date string; warn if within 7 days of expiry */
  apiKeyExpiry?: string;

  /** Azure AI endpoint URL. Required when provider = 'azure' */
  azureEndpoint?: string;

  /** Azure deployment name. Required when provider = 'azure' */
  azureDeployment?: string;

  /** Google Cloud project ID. Required when provider = 'vertex'. */
  vertexProjectId?: string;

  /** Google Cloud region (e.g. 'us-central1'). Required when provider = 'vertex'. */
  vertexLocation?: string;

  /** Maximum output tokens per LLM call */
  maxTokens: number;
}

/**
 * Paths configuration for the wiki directory structure.
 * All paths except rootDir are relative to rootDir.
 */
export interface WikiPaths {
  /** Absolute path to the wiki root directory */
  rootDir: string;

  /** Directory for source files, relative to rootDir (e.g. 'sources') */
  sourcesDir: string;

  /** Directory for wiki pages, relative to rootDir (e.g. 'wiki') */
  wikiDir: string;

  /** Directory for schema/templates, relative to rootDir (e.g. 'schema') */
  schemaDir: string;
}

/**
 * Obsidian integration configuration.
 */
export interface ObsidianConfig {
  /** Whether Obsidian integration is enabled */
  enabled: boolean;

  /** Path to Obsidian vault if different from rootDir */
  vaultPath?: string;
}

/**
 * Configuration for a single IMAP mailbox.
 * All fields are required except passwordExpiry.
 */
export interface MailboxConfig {
  /** IMAP server hostname (e.g., 'imap.gmail.com') */
  host: string;

  /** IMAP server port (typically 993 for TLS, 143 for STARTTLS) */
  port: number;

  /** Whether to use TLS/SSL connection (maps to imapflow `secure`) */
  tls: boolean;

  /** IMAP authentication username (typically full email address) */
  user: string;

  /** IMAP authentication password (app password recommended) */
  password: string;

  /** IMAP folder names to scan (e.g., ['INBOX', 'Wiki-Feed']) */
  folders: string[];

  /**
   * ISO 8601 date string for password expiry.
   * Optional. When present and within 7 days of expiry, a warning
   * is emitted to stderr following the checkApiKeyExpiry() pattern.
   */
  passwordExpiry?: string;

  /** IMAP connection timeout in milliseconds */
  connectionTimeout: number;

  /**
   * IMAP folder name to move successfully processed emails into.
   * Optional. When present, emails are moved after ingest completes.
   * The folder is created automatically if it doesn't exist.
   */
  processedFolder?: string;

  /**
   * IMAP folder name to move ignored/noise emails into.
   * Optional. When present, the LLM classifies emails before processing.
   * Emails classified as noise (ads, notifications, etc.) are moved here.
   * The folder is created automatically if it doesn't exist.
   * Requires processedFolder to also be set (both or neither for classification).
   */
  ignoredFolder?: string;
}

/**
 * Top-level configuration object for LLM Wiki.
 * Composed of LLM, wiki paths, and Obsidian settings.
 */
export interface WikiConfig {
  /** LLM provider settings */
  llm: LLMConfig;

  /** Wiki directory paths */
  wiki: WikiPaths;

  /** Obsidian integration settings */
  obsidian: ObsidianConfig;

  /**
   * Optional mailbox configurations for the mail-check command.
   * Keys are mailbox names (e.g., 'work', 'research') used as identifiers
   * in state tracking and source metadata.
   * Only validated when the mail-check command is invoked.
   */
  mailboxes?: Record<string, MailboxConfig>;
}

/**
 * Error thrown when a required configuration field is missing or invalid.
 * Carries the field name to help users locate the problem.
 */
export class ConfigurationError extends Error {
  constructor(
    public readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = 'ConfigurationError';
  }
}
