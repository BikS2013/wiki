// src/config/validator.ts -- Validate required fields, conditional fields, API key expiry

import { WikiConfig, ConfigurationError } from './types.js';

const VALID_PROVIDERS = ['anthropic', 'azure', 'vertex'] as const;

/**
 * Validates a partial configuration object and returns a fully typed WikiConfig.
 * Throws ConfigurationError with the offending field name for any violation.
 */
export function validateConfig(config: Partial<WikiConfig>): WikiConfig {
  // --- LLM section ---
  if (!config.llm?.provider) {
    throw new ConfigurationError('llm.provider', 'Missing required configuration: llm.provider');
  }

  if (!(VALID_PROVIDERS as readonly string[]).includes(config.llm.provider)) {
    throw new ConfigurationError(
      'llm.provider',
      `Invalid provider: ${config.llm.provider}. Must be one of: ${VALID_PROVIDERS.join(', ')}`,
    );
  }

  if (!config.llm.model) {
    throw new ConfigurationError('llm.model', 'Missing required configuration: llm.model');
  }

  // apiKey is required for 'anthropic' and 'azure', NOT required for 'vertex' (uses ADC)
  if (config.llm.provider === 'anthropic' && !config.llm.apiKey) {
    throw new ConfigurationError(
      'llm.apiKey',
      'Missing required configuration: llm.apiKey (required when provider is anthropic)',
    );
  }
  if (config.llm.provider === 'azure' && !config.llm.apiKey) {
    throw new ConfigurationError(
      'llm.apiKey',
      'Missing required configuration: llm.apiKey (required when provider is azure)',
    );
  }

  if (
    config.llm.maxTokens === undefined ||
    config.llm.maxTokens === null ||
    !Number.isInteger(config.llm.maxTokens) ||
    config.llm.maxTokens < 1
  ) {
    throw new ConfigurationError(
      'llm.maxTokens',
      'llm.maxTokens must be a positive integer',
    );
  }

  // Azure-specific required fields
  if (config.llm.provider === 'azure') {
    if (!config.llm.azureEndpoint) {
      throw new ConfigurationError(
        'llm.azureEndpoint',
        'Missing required configuration: llm.azureEndpoint (required when provider is azure)',
      );
    }
    if (!config.llm.azureDeployment) {
      throw new ConfigurationError(
        'llm.azureDeployment',
        'Missing required configuration: llm.azureDeployment (required when provider is azure)',
      );
    }
  }

  // Vertex-specific required fields
  if (config.llm.provider === 'vertex') {
    if (!config.llm.vertexProjectId) {
      throw new ConfigurationError(
        'llm.vertexProjectId',
        'Missing required configuration: llm.vertexProjectId (required when provider is vertex)',
      );
    }
    if (!config.llm.vertexLocation) {
      throw new ConfigurationError(
        'llm.vertexLocation',
        'Missing required configuration: llm.vertexLocation (required when provider is vertex)',
      );
    }
  }

  // --- Wiki section ---
  if (!config.wiki?.rootDir) {
    throw new ConfigurationError('wiki.rootDir', 'Missing required configuration: wiki.rootDir');
  }

  if (!isAbsolutePath(config.wiki.rootDir)) {
    throw new ConfigurationError(
      'wiki.rootDir',
      `wiki.rootDir must be an absolute path, got: ${config.wiki.rootDir}`,
    );
  }

  if (!config.wiki.sourcesDir) {
    throw new ConfigurationError(
      'wiki.sourcesDir',
      'Missing required configuration: wiki.sourcesDir',
    );
  }

  if (!config.wiki.wikiDir) {
    throw new ConfigurationError(
      'wiki.wikiDir',
      'Missing required configuration: wiki.wikiDir',
    );
  }

  if (!config.wiki.schemaDir) {
    throw new ConfigurationError(
      'wiki.schemaDir',
      'Missing required configuration: wiki.schemaDir',
    );
  }

  // --- Obsidian section ---
  if (!config.obsidian || config.obsidian.enabled === undefined) {
    throw new ConfigurationError(
      'obsidian.enabled',
      'Missing required configuration: obsidian.enabled',
    );
  }

  // Return the validated config with all required fields guaranteed present
  return config as WikiConfig;
}

/**
 * Checks API key expiry and emits warnings/errors to stderr.
 * Does NOT throw -- callers should continue normally after this check.
 */
export function checkApiKeyExpiry(config: WikiConfig): void {
  // Vertex uses Application Default Credentials, no API key to expire
  if (config.llm.provider === 'vertex') {
    return;
  }

  if (!config.llm.apiKeyExpiry) {
    return;
  }

  const expiryDate = new Date(config.llm.apiKeyExpiry);
  if (isNaN(expiryDate.getTime())) {
    process.stderr.write(
      `[WARN] llm.apiKeyExpiry is not a valid date: ${config.llm.apiKeyExpiry}\n`,
    );
    return;
  }

  const now = new Date();
  const msPerDay = 24 * 60 * 60 * 1000;
  const daysUntilExpiry = (expiryDate.getTime() - now.getTime()) / msPerDay;

  if (daysUntilExpiry < 0) {
    process.stderr.write(
      `[ERROR] API key expired on ${config.llm.apiKeyExpiry}. Please renew your API key.\n`,
    );
  } else if (daysUntilExpiry <= 7) {
    const daysLeft = Math.ceil(daysUntilExpiry);
    process.stderr.write(
      `[WARN] API key expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'} (${config.llm.apiKeyExpiry}). Please renew soon.\n`,
    );
  }
}

/**
 * Check whether a path is absolute (Unix or Windows).
 */
function isAbsolutePath(p: string): boolean {
  // Unix absolute: starts with /
  // Windows absolute: starts with drive letter like C:\ or C:/
  return p.startsWith('/') || /^[a-zA-Z]:[/\\]/.test(p);
}
