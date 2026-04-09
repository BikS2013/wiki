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
