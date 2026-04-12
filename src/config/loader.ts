// src/config/loader.ts -- Load config from file, merge env vars, CLI overrides

import { readFile, access } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { WikiConfig, ConfigurationError } from './types.js';
import { validateConfig, checkApiKeyExpiry } from './validator.js';

/**
 * Load configuration from a JSON file, apply environment variable overrides,
 * apply CLI overrides (highest priority), validate, and return a WikiConfig.
 *
 * Priority (highest to lowest):
 *   1. CLI overrides (cliOverrides parameter)
 *   2. Environment variables (WIKI_LLM_PROVIDER, WIKI_LLM_MODEL, etc.)
 *   3. config.json file values
 *
 * Throws ConfigurationError if the config file is not found or any required
 * field is missing. No fallback values are ever applied.
 */
export async function loadConfig(options: {
  configPath?: string;
  cliOverrides?: Partial<WikiConfig>;
}): Promise<WikiConfig> {
  const configPath = await resolveConfigPath(options.configPath);

  // 0. Load .env file from same directory as config.json (does not override existing env vars)
  loadDotenv({ path: join(dirname(configPath), '.env') });

  // 1. Read config file
  const fileConfig = await readConfigFile(configPath);

  // 2. Apply environment variable overrides
  applyEnvOverrides(fileConfig);

  // 3. Apply CLI overrides (highest priority)
  if (options.cliOverrides) {
    applyCliOverrides(fileConfig, options.cliOverrides);
  }

  // 4. Validate
  const validated = validateConfig(fileConfig);

  // 5. Check API key expiry (non-throwing warnings)
  checkApiKeyExpiry(validated);

  return validated;
}

/**
 * Resolve the config file path. Search order:
 *   1. Explicit --config path (if provided)
 *   2. ./config.json (current working directory)
 *   3. $WIKI_ROOT_DIR/config.json (if WIKI_ROOT_DIR env var is set)
 *
 * Throws ConfigurationError if none of the locations contain a config file.
 */
async function resolveConfigPath(explicitPath?: string): Promise<string> {
  // If user provided an explicit path, use it (no fallback search)
  if (explicitPath) {
    return resolve(explicitPath);
  }

  // Try ./config.json first
  const cwdConfig = resolve('config.json');
  try {
    await access(cwdConfig);
    return cwdConfig;
  } catch {
    // Not in cwd, try WIKI_ROOT_DIR
  }

  // Try $WIKI_ROOT_DIR/config.json
  const wikiRootDir = process.env.WIKI_ROOT_DIR;
  if (wikiRootDir) {
    const rootDirConfig = join(resolve(wikiRootDir), 'config.json');
    try {
      await access(rootDirConfig);
      return rootDirConfig;
    } catch {
      // Not there either
    }
  }

  // Neither found — return cwd path so readConfigFile throws a clear error
  return cwdConfig;
}

/**
 * Read and parse a JSON configuration file.
 * Throws ConfigurationError if the file does not exist or cannot be parsed.
 */
async function readConfigFile(configPath: string): Promise<Record<string, unknown>> {
  let raw: string;
  try {
    raw = await readFile(configPath, 'utf-8');
  } catch (err: unknown) {
    if (isNodeError(err) && err.code === 'ENOENT') {
      throw new ConfigurationError(
        'configFile',
        `Configuration file not found: ${configPath}`,
      );
    }
    throw new ConfigurationError(
      'configFile',
      `Failed to read configuration file: ${configPath} -- ${(err as Error).message}`,
    );
  }

  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new ConfigurationError(
      'configFile',
      `Configuration file contains invalid JSON: ${configPath}`,
    );
  }
}

/**
 * Apply environment variable overrides to the config object.
 * Only non-empty env vars are applied.
 */
function applyEnvOverrides(config: Record<string, unknown>): void {
  // Ensure nested objects exist
  if (!config.llm || typeof config.llm !== 'object') {
    config.llm = {};
  }
  if (!config.wiki || typeof config.wiki !== 'object') {
    config.wiki = {};
  }

  const llm = config.llm as Record<string, unknown>;
  const wiki = config.wiki as Record<string, unknown>;

  if (process.env.WIKI_LLM_PROVIDER) {
    llm.provider = process.env.WIKI_LLM_PROVIDER;
  }
  if (process.env.WIKI_LLM_MODEL) {
    llm.model = process.env.WIKI_LLM_MODEL;
  }
  if (process.env.WIKI_LLM_API_KEY) {
    llm.apiKey = process.env.WIKI_LLM_API_KEY;
  }
  if (process.env.WIKI_LLM_MAX_TOKENS) {
    const parsed = parseInt(process.env.WIKI_LLM_MAX_TOKENS, 10);
    if (!isNaN(parsed)) {
      llm.maxTokens = parsed;
    }
  }
  if (process.env.WIKI_ROOT_DIR) {
    wiki.rootDir = process.env.WIKI_ROOT_DIR;
  }
  if (process.env.WIKI_AZURE_ENDPOINT) {
    llm.azureEndpoint = process.env.WIKI_AZURE_ENDPOINT;
  }
  if (process.env.WIKI_AZURE_DEPLOYMENT) {
    llm.azureDeployment = process.env.WIKI_AZURE_DEPLOYMENT;
  }
  if (process.env.WIKI_VERTEX_PROJECT_ID) {
    llm.vertexProjectId = process.env.WIKI_VERTEX_PROJECT_ID;
  }
  if (process.env.WIKI_VERTEX_LOCATION) {
    llm.vertexLocation = process.env.WIKI_VERTEX_LOCATION;
  }

  // Discover mailbox names from WIKI_MAILBOX_<NAME>_HOST env vars
  const mailboxEnvPattern = /^WIKI_MAILBOX_([A-Z0-9_]+)_HOST$/;
  for (const key of Object.keys(process.env)) {
    const match = key.match(mailboxEnvPattern);
    if (!match) continue;

    const envName = match[1];                          // e.g., 'WORK'
    const configName = envName.toLowerCase();           // e.g., 'work'

    // Ensure mailboxes section and this mailbox entry exist
    if (!config.mailboxes || typeof config.mailboxes !== 'object') {
      config.mailboxes = {};
    }
    const mailboxes = config.mailboxes as Record<string, Record<string, unknown>>;
    if (!mailboxes[configName]) {
      mailboxes[configName] = {};
    }
    const mb = mailboxes[configName];

    // Apply env var values (override config file values)
    const prefix = `WIKI_MAILBOX_${envName}`;
    if (process.env[`${prefix}_HOST`])     mb.host = process.env[`${prefix}_HOST`];
    if (process.env[`${prefix}_PORT`])     mb.port = parseInt(process.env[`${prefix}_PORT`]!, 10);
    if (process.env[`${prefix}_TLS`])      mb.tls = process.env[`${prefix}_TLS`] === 'true';
    if (process.env[`${prefix}_USER`])     mb.user = process.env[`${prefix}_USER`];
    if (process.env[`${prefix}_PASSWORD`]) mb.password = process.env[`${prefix}_PASSWORD`];
    if (process.env[`${prefix}_FOLDERS`])  mb.folders = process.env[`${prefix}_FOLDERS`]!.split(',').map(f => f.trim());
    if (process.env[`${prefix}_TIMEOUT`])  mb.connectionTimeout = parseInt(process.env[`${prefix}_TIMEOUT`]!, 10);
    if (process.env[`${prefix}_PASSWORD_EXPIRY`]) mb.passwordExpiry = process.env[`${prefix}_PASSWORD_EXPIRY`];
    if (process.env[`${prefix}_PROCESSED_FOLDER`]) mb.processedFolder = process.env[`${prefix}_PROCESSED_FOLDER`];
    if (process.env[`${prefix}_IGNORED_FOLDER`]) mb.ignoredFolder = process.env[`${prefix}_IGNORED_FOLDER`];
  }
}

/**
 * Deep-merge CLI overrides into the config object.
 * CLI overrides take highest priority.
 */
function applyCliOverrides(
  config: Record<string, unknown>,
  overrides: Partial<WikiConfig>,
): void {
  if (overrides.llm) {
    const llm = (config.llm ?? {}) as Record<string, unknown>;
    for (const [key, value] of Object.entries(overrides.llm)) {
      if (value !== undefined) {
        llm[key] = value;
      }
    }
    config.llm = llm;
  }

  if (overrides.wiki) {
    const wiki = (config.wiki ?? {}) as Record<string, unknown>;
    for (const [key, value] of Object.entries(overrides.wiki)) {
      if (value !== undefined) {
        wiki[key] = value;
      }
    }
    config.wiki = wiki;
  }

  if (overrides.obsidian) {
    const obsidian = (config.obsidian ?? {}) as Record<string, unknown>;
    for (const [key, value] of Object.entries(overrides.obsidian)) {
      if (value !== undefined) {
        obsidian[key] = value;
      }
    }
    config.obsidian = obsidian;
  }
}

/**
 * Type guard for Node.js system errors with a `code` property.
 */
function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}
