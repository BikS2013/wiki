// test_scripts/test-config.ts -- Tests for config/validator.ts and config/loader.ts

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { validateConfig, checkApiKeyExpiry } from '../src/config/validator.js';
import { loadConfig } from '../src/config/loader.js';
import { ConfigurationError, WikiConfig } from '../src/config/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal valid config object that passes all validations. */
function validConfigObj(): Record<string, unknown> {
  return {
    llm: {
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      apiKey: 'sk-ant-test-key',
      maxTokens: 4096,
    },
    wiki: {
      rootDir: '/tmp/wiki-root',
      sourcesDir: 'sources',
      wikiDir: 'wiki',
      schemaDir: 'schema',
    },
    obsidian: {
      enabled: false,
    },
  };
}

// ---------------------------------------------------------------------------
// Validator tests
// ---------------------------------------------------------------------------

describe('validateConfig', () => {
  it('accepts a valid configuration', () => {
    const cfg = validConfigObj();
    const result = validateConfig(cfg as Partial<WikiConfig>);
    assert.strictEqual(result.llm.provider, 'anthropic');
    assert.strictEqual(result.llm.maxTokens, 4096);
  });

  it('throws ConfigurationError with field name when llm.provider is missing', () => {
    const cfg = validConfigObj();
    (cfg.llm as Record<string, unknown>).provider = undefined;
    assert.throws(
      () => validateConfig(cfg as Partial<WikiConfig>),
      (err: unknown) => {
        assert.ok(err instanceof ConfigurationError);
        assert.strictEqual(err.field, 'llm.provider');
        return true;
      },
    );
  });

  it('throws ConfigurationError with field name when llm.model is missing', () => {
    const cfg = validConfigObj();
    (cfg.llm as Record<string, unknown>).model = '';
    assert.throws(
      () => validateConfig(cfg as Partial<WikiConfig>),
      (err: unknown) => {
        assert.ok(err instanceof ConfigurationError);
        assert.strictEqual(err.field, 'llm.model');
        return true;
      },
    );
  });

  it('throws ConfigurationError with field name when llm.apiKey is missing', () => {
    const cfg = validConfigObj();
    (cfg.llm as Record<string, unknown>).apiKey = '';
    assert.throws(
      () => validateConfig(cfg as Partial<WikiConfig>),
      (err: unknown) => {
        assert.ok(err instanceof ConfigurationError);
        assert.strictEqual(err.field, 'llm.apiKey');
        return true;
      },
    );
  });

  it('throws when provider is invalid', () => {
    const cfg = validConfigObj();
    (cfg.llm as Record<string, unknown>).provider = 'openai';
    assert.throws(
      () => validateConfig(cfg as Partial<WikiConfig>),
      (err: unknown) => {
        assert.ok(err instanceof ConfigurationError);
        assert.strictEqual(err.field, 'llm.provider');
        assert.ok(err.message.includes('Invalid provider'));
        return true;
      },
    );
  });

  it('throws when maxTokens is non-positive (zero)', () => {
    const cfg = validConfigObj();
    (cfg.llm as Record<string, unknown>).maxTokens = 0;
    assert.throws(
      () => validateConfig(cfg as Partial<WikiConfig>),
      (err: unknown) => {
        assert.ok(err instanceof ConfigurationError);
        assert.strictEqual(err.field, 'llm.maxTokens');
        return true;
      },
    );
  });

  it('throws when maxTokens is negative', () => {
    const cfg = validConfigObj();
    (cfg.llm as Record<string, unknown>).maxTokens = -100;
    assert.throws(
      () => validateConfig(cfg as Partial<WikiConfig>),
      (err: unknown) => {
        assert.ok(err instanceof ConfigurationError);
        assert.strictEqual(err.field, 'llm.maxTokens');
        return true;
      },
    );
  });

  it('throws when maxTokens is a float', () => {
    const cfg = validConfigObj();
    (cfg.llm as Record<string, unknown>).maxTokens = 1.5;
    assert.throws(
      () => validateConfig(cfg as Partial<WikiConfig>),
      (err: unknown) => {
        assert.ok(err instanceof ConfigurationError);
        assert.strictEqual(err.field, 'llm.maxTokens');
        return true;
      },
    );
  });

  it('throws when wiki.rootDir is not absolute', () => {
    const cfg = validConfigObj();
    (cfg.wiki as Record<string, unknown>).rootDir = 'relative/path';
    assert.throws(
      () => validateConfig(cfg as Partial<WikiConfig>),
      (err: unknown) => {
        assert.ok(err instanceof ConfigurationError);
        assert.strictEqual(err.field, 'wiki.rootDir');
        assert.ok(err.message.includes('absolute path'));
        return true;
      },
    );
  });

  it('throws when wiki.rootDir is missing', () => {
    const cfg = validConfigObj();
    (cfg.wiki as Record<string, unknown>).rootDir = '';
    assert.throws(
      () => validateConfig(cfg as Partial<WikiConfig>),
      (err: unknown) => {
        assert.ok(err instanceof ConfigurationError);
        assert.strictEqual(err.field, 'wiki.rootDir');
        return true;
      },
    );
  });

  it('azure provider requires azureEndpoint', () => {
    const cfg = validConfigObj();
    const llm = cfg.llm as Record<string, unknown>;
    llm.provider = 'azure';
    // azureEndpoint is missing
    llm.azureDeployment = 'my-deployment';
    assert.throws(
      () => validateConfig(cfg as Partial<WikiConfig>),
      (err: unknown) => {
        assert.ok(err instanceof ConfigurationError);
        assert.strictEqual(err.field, 'llm.azureEndpoint');
        return true;
      },
    );
  });

  it('azure provider requires azureDeployment', () => {
    const cfg = validConfigObj();
    const llm = cfg.llm as Record<string, unknown>;
    llm.provider = 'azure';
    llm.azureEndpoint = 'https://my-endpoint.openai.azure.com';
    // azureDeployment is missing
    assert.throws(
      () => validateConfig(cfg as Partial<WikiConfig>),
      (err: unknown) => {
        assert.ok(err instanceof ConfigurationError);
        assert.strictEqual(err.field, 'llm.azureDeployment');
        return true;
      },
    );
  });

  it('azure provider passes when both azure fields are present', () => {
    const cfg = validConfigObj();
    const llm = cfg.llm as Record<string, unknown>;
    llm.provider = 'azure';
    llm.azureEndpoint = 'https://my-endpoint.openai.azure.com';
    llm.azureDeployment = 'my-deployment';
    const result = validateConfig(cfg as Partial<WikiConfig>);
    assert.strictEqual(result.llm.provider, 'azure');
  });

  // --- Vertex provider validation ---

  it('vertex provider does NOT require apiKey', () => {
    const cfg = validConfigObj();
    const llm = cfg.llm as Record<string, unknown>;
    llm.provider = 'vertex';
    delete llm.apiKey;
    llm.vertexProjectId = 'my-gcp-project';
    llm.vertexLocation = 'us-central1';
    const result = validateConfig(cfg as Partial<WikiConfig>);
    assert.strictEqual(result.llm.provider, 'vertex');
    assert.strictEqual(result.llm.apiKey, undefined);
  });

  it('vertex provider requires vertexProjectId', () => {
    const cfg = validConfigObj();
    const llm = cfg.llm as Record<string, unknown>;
    llm.provider = 'vertex';
    delete llm.apiKey;
    llm.vertexLocation = 'us-central1';
    // vertexProjectId is missing
    assert.throws(
      () => validateConfig(cfg as Partial<WikiConfig>),
      (err: unknown) => {
        assert.ok(err instanceof ConfigurationError);
        assert.strictEqual(err.field, 'llm.vertexProjectId');
        return true;
      },
    );
  });

  it('vertex provider requires vertexLocation', () => {
    const cfg = validConfigObj();
    const llm = cfg.llm as Record<string, unknown>;
    llm.provider = 'vertex';
    delete llm.apiKey;
    llm.vertexProjectId = 'my-gcp-project';
    // vertexLocation is missing
    assert.throws(
      () => validateConfig(cfg as Partial<WikiConfig>),
      (err: unknown) => {
        assert.ok(err instanceof ConfigurationError);
        assert.strictEqual(err.field, 'llm.vertexLocation');
        return true;
      },
    );
  });

  it('vertex provider passes when both vertex fields are present', () => {
    const cfg = validConfigObj();
    const llm = cfg.llm as Record<string, unknown>;
    llm.provider = 'vertex';
    delete llm.apiKey;
    llm.vertexProjectId = 'my-gcp-project';
    llm.vertexLocation = 'us-central1';
    const result = validateConfig(cfg as Partial<WikiConfig>);
    assert.strictEqual(result.llm.provider, 'vertex');
    assert.strictEqual(result.llm.vertexProjectId, 'my-gcp-project');
    assert.strictEqual(result.llm.vertexLocation, 'us-central1');
  });

  it('anthropic provider still requires apiKey', () => {
    const cfg = validConfigObj();
    const llm = cfg.llm as Record<string, unknown>;
    llm.provider = 'anthropic';
    llm.apiKey = '';
    assert.throws(
      () => validateConfig(cfg as Partial<WikiConfig>),
      (err: unknown) => {
        assert.ok(err instanceof ConfigurationError);
        assert.strictEqual(err.field, 'llm.apiKey');
        return true;
      },
    );
  });

  it('azure provider still requires apiKey', () => {
    const cfg = validConfigObj();
    const llm = cfg.llm as Record<string, unknown>;
    llm.provider = 'azure';
    llm.apiKey = '';
    llm.azureEndpoint = 'https://my-endpoint.openai.azure.com';
    llm.azureDeployment = 'my-deployment';
    assert.throws(
      () => validateConfig(cfg as Partial<WikiConfig>),
      (err: unknown) => {
        assert.ok(err instanceof ConfigurationError);
        assert.strictEqual(err.field, 'llm.apiKey');
        return true;
      },
    );
  });
});

// ---------------------------------------------------------------------------
// API key expiry tests
// ---------------------------------------------------------------------------

describe('checkApiKeyExpiry', () => {
  let originalStderrWrite: typeof process.stderr.write;
  let captured: string[];

  beforeEach(() => {
    captured = [];
    originalStderrWrite = process.stderr.write;
    process.stderr.write = ((chunk: string | Uint8Array) => {
      captured.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
  });

  afterEach(() => {
    process.stderr.write = originalStderrWrite;
  });

  it('does nothing when apiKeyExpiry is not set', () => {
    const cfg = validateConfig(validConfigObj() as Partial<WikiConfig>);
    checkApiKeyExpiry(cfg);
    assert.strictEqual(captured.length, 0);
  });

  it('emits ERROR when API key has expired', () => {
    const cfg = validateConfig(validConfigObj() as Partial<WikiConfig>);
    cfg.llm.apiKeyExpiry = '2020-01-01';
    checkApiKeyExpiry(cfg);
    assert.ok(captured.some((line) => line.includes('[ERROR]')));
    assert.ok(captured.some((line) => line.includes('expired')));
  });

  it('emits WARN when API key expires within 7 days', () => {
    const cfg = validateConfig(validConfigObj() as Partial<WikiConfig>);
    const soon = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    cfg.llm.apiKeyExpiry = soon.toISOString().split('T')[0];
    checkApiKeyExpiry(cfg);
    assert.ok(captured.some((line) => line.includes('[WARN]')));
    assert.ok(captured.some((line) => line.includes('expires in')));
  });

  it('emits WARN for invalid date string in apiKeyExpiry', () => {
    const cfg = validateConfig(validConfigObj() as Partial<WikiConfig>);
    cfg.llm.apiKeyExpiry = 'not-a-date';
    checkApiKeyExpiry(cfg);
    assert.ok(captured.some((line) => line.includes('[WARN]')));
    assert.ok(captured.some((line) => line.includes('not a valid date')));
  });

  it('stays silent when API key expiry is far in the future', () => {
    const cfg = validateConfig(validConfigObj() as Partial<WikiConfig>);
    cfg.llm.apiKeyExpiry = '2099-12-31';
    checkApiKeyExpiry(cfg);
    assert.strictEqual(captured.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Loader tests (env var override priority)
// ---------------------------------------------------------------------------

describe('loadConfig (env var override)', () => {
  let tmpDir: string;
  const savedEnv: Record<string, string | undefined> = {};

  const ENV_KEYS = [
    'WIKI_LLM_PROVIDER',
    'WIKI_LLM_MODEL',
    'WIKI_LLM_API_KEY',
    'WIKI_LLM_MAX_TOKENS',
    'WIKI_ROOT_DIR',
    'WIKI_AZURE_ENDPOINT',
    'WIKI_AZURE_DEPLOYMENT',
    'WIKI_VERTEX_PROJECT_ID',
    'WIKI_VERTEX_LOCATION',
  ];

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'wiki-cfg-'));
    // Save current env
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(async () => {
    // Restore env
    for (const key of ENV_KEYS) {
      if (savedEnv[key] !== undefined) {
        process.env[key] = savedEnv[key];
      } else {
        delete process.env[key];
      }
    }
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('env vars override config file values', async () => {
    const cfgPath = join(tmpDir, 'config.json');
    await writeFile(cfgPath, JSON.stringify(validConfigObj()), 'utf-8');

    process.env.WIKI_LLM_MODEL = 'claude-opus-4-5';

    const result = await loadConfig({ configPath: cfgPath });
    assert.strictEqual(result.llm.model, 'claude-opus-4-5');
  });

  it('CLI overrides take priority over env vars', async () => {
    const cfgPath = join(tmpDir, 'config.json');
    await writeFile(cfgPath, JSON.stringify(validConfigObj()), 'utf-8');

    process.env.WIKI_LLM_MODEL = 'claude-opus-4-5';

    const result = await loadConfig({
      configPath: cfgPath,
      cliOverrides: {
        llm: { model: 'claude-haiku-3-5-20241022' } as WikiConfig['llm'],
      },
    });
    assert.strictEqual(result.llm.model, 'claude-haiku-3-5-20241022');
  });

  it('throws ConfigurationError when config file is not found', async () => {
    await assert.rejects(
      loadConfig({ configPath: join(tmpDir, 'nonexistent.json') }),
      (err: unknown) => {
        assert.ok(err instanceof ConfigurationError);
        assert.strictEqual(err.field, 'configFile');
        return true;
      },
    );
  });

  it('throws ConfigurationError when config file contains invalid JSON', async () => {
    const cfgPath = join(tmpDir, 'bad.json');
    await writeFile(cfgPath, '{ invalid json }', 'utf-8');
    await assert.rejects(
      loadConfig({ configPath: cfgPath }),
      (err: unknown) => {
        assert.ok(err instanceof ConfigurationError);
        assert.strictEqual(err.field, 'configFile');
        assert.ok(err.message.includes('invalid JSON'));
        return true;
      },
    );
  });
});
