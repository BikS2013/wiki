// src/config/loader.ts -- Load config from file, merge env vars, CLI overrides

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
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
  const configPath = resolve(options.configPath ?? 'config.json');

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
