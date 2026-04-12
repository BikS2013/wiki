// test_scripts/test-mailbox-config.ts -- Tests for mailbox configuration validation

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  validateMailboxConfig,
  validateMailboxesExist,
  checkMailboxPasswordExpiry,
} from '../src/config/validator.js';
import { loadConfig } from '../src/config/loader.js';
import { ConfigurationError, WikiConfig, MailboxConfig } from '../src/config/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal valid mailbox config object. */
function validMailbox(): Record<string, unknown> {
  return {
    host: 'imap.gmail.com',
    port: 993,
    tls: true,
    user: 'test@gmail.com',
    password: 'app-password-123',
    folders: ['INBOX'],
    connectionTimeout: 30000,
  };
}

/** Minimal valid top-level config (for loadConfig / validateMailboxesExist). */
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

/** Build a WikiConfig with mailboxes for expiry tests. */
function configWithMailboxes(
  mailboxes: Record<string, MailboxConfig>,
): WikiConfig {
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
    obsidian: { enabled: false },
    mailboxes,
  };
}

// ---------------------------------------------------------------------------
// validateMailboxConfig tests
// ---------------------------------------------------------------------------

describe('validateMailboxConfig', () => {
  it('succeeds with valid config', () => {
    const result = validateMailboxConfig('work', validMailbox());
    assert.strictEqual(result.host, 'imap.gmail.com');
    assert.strictEqual(result.port, 993);
    assert.strictEqual(result.tls, true);
    assert.strictEqual(result.user, 'test@gmail.com');
    assert.strictEqual(result.password, 'app-password-123');
    assert.deepStrictEqual(result.folders, ['INBOX']);
    assert.strictEqual(result.connectionTimeout, 30000);
  });

  it('throws ConfigurationError when host is missing', () => {
    const mb = validMailbox();
    delete mb.host;
    assert.throws(
      () => validateMailboxConfig('work', mb),
      (err: unknown) => {
        assert.ok(err instanceof ConfigurationError);
        assert.strictEqual(err.field, 'mailboxes.work.host');
        return true;
      },
    );
  });

  it('throws ConfigurationError when host is empty string', () => {
    const mb = validMailbox();
    mb.host = '';
    assert.throws(
      () => validateMailboxConfig('work', mb),
      (err: unknown) => {
        assert.ok(err instanceof ConfigurationError);
        assert.strictEqual(err.field, 'mailboxes.work.host');
        return true;
      },
    );
  });

  it('throws ConfigurationError when port is missing', () => {
    const mb = validMailbox();
    delete mb.port;
    assert.throws(
      () => validateMailboxConfig('work', mb),
      (err: unknown) => {
        assert.ok(err instanceof ConfigurationError);
        assert.strictEqual(err.field, 'mailboxes.work.port');
        return true;
      },
    );
  });

  it('throws ConfigurationError when port is zero', () => {
    const mb = validMailbox();
    mb.port = 0;
    assert.throws(
      () => validateMailboxConfig('work', mb),
      (err: unknown) => {
        assert.ok(err instanceof ConfigurationError);
        assert.strictEqual(err.field, 'mailboxes.work.port');
        return true;
      },
    );
  });

  it('throws ConfigurationError when port is negative', () => {
    const mb = validMailbox();
    mb.port = -1;
    assert.throws(
      () => validateMailboxConfig('work', mb),
      (err: unknown) => {
        assert.ok(err instanceof ConfigurationError);
        assert.strictEqual(err.field, 'mailboxes.work.port');
        return true;
      },
    );
  });

  it('throws ConfigurationError when port is non-integer', () => {
    const mb = validMailbox();
    mb.port = 993.5;
    assert.throws(
      () => validateMailboxConfig('work', mb),
      (err: unknown) => {
        assert.ok(err instanceof ConfigurationError);
        assert.strictEqual(err.field, 'mailboxes.work.port');
        return true;
      },
    );
  });

  it('throws ConfigurationError when tls is missing', () => {
    const mb = validMailbox();
    delete mb.tls;
    assert.throws(
      () => validateMailboxConfig('work', mb),
      (err: unknown) => {
        assert.ok(err instanceof ConfigurationError);
        assert.strictEqual(err.field, 'mailboxes.work.tls');
        return true;
      },
    );
  });

  it('throws ConfigurationError when user is missing', () => {
    const mb = validMailbox();
    delete mb.user;
    assert.throws(
      () => validateMailboxConfig('work', mb),
      (err: unknown) => {
        assert.ok(err instanceof ConfigurationError);
        assert.strictEqual(err.field, 'mailboxes.work.user');
        return true;
      },
    );
  });

  it('throws ConfigurationError when password is missing', () => {
    const mb = validMailbox();
    delete mb.password;
    assert.throws(
      () => validateMailboxConfig('work', mb),
      (err: unknown) => {
        assert.ok(err instanceof ConfigurationError);
        assert.strictEqual(err.field, 'mailboxes.work.password');
        return true;
      },
    );
  });

  it('throws ConfigurationError when folders is missing', () => {
    const mb = validMailbox();
    delete mb.folders;
    assert.throws(
      () => validateMailboxConfig('work', mb),
      (err: unknown) => {
        assert.ok(err instanceof ConfigurationError);
        assert.strictEqual(err.field, 'mailboxes.work.folders');
        return true;
      },
    );
  });

  it('throws ConfigurationError when folders is empty array', () => {
    const mb = validMailbox();
    mb.folders = [];
    assert.throws(
      () => validateMailboxConfig('work', mb),
      (err: unknown) => {
        assert.ok(err instanceof ConfigurationError);
        assert.strictEqual(err.field, 'mailboxes.work.folders');
        return true;
      },
    );
  });

  it('throws ConfigurationError when connectionTimeout is missing', () => {
    const mb = validMailbox();
    delete mb.connectionTimeout;
    assert.throws(
      () => validateMailboxConfig('work', mb),
      (err: unknown) => {
        assert.ok(err instanceof ConfigurationError);
        assert.strictEqual(err.field, 'mailboxes.work.connectionTimeout');
        return true;
      },
    );
  });

  it('throws ConfigurationError when connectionTimeout is zero', () => {
    const mb = validMailbox();
    mb.connectionTimeout = 0;
    assert.throws(
      () => validateMailboxConfig('work', mb),
      (err: unknown) => {
        assert.ok(err instanceof ConfigurationError);
        assert.strictEqual(err.field, 'mailboxes.work.connectionTimeout');
        return true;
      },
    );
  });

  it('throws ConfigurationError when connectionTimeout is negative', () => {
    const mb = validMailbox();
    mb.connectionTimeout = -100;
    assert.throws(
      () => validateMailboxConfig('work', mb),
      (err: unknown) => {
        assert.ok(err instanceof ConfigurationError);
        assert.strictEqual(err.field, 'mailboxes.work.connectionTimeout');
        return true;
      },
    );
  });

  it('throws ConfigurationError for null mailbox object', () => {
    assert.throws(
      () => validateMailboxConfig('work', null),
      (err: unknown) => {
        assert.ok(err instanceof ConfigurationError);
        assert.strictEqual(err.field, 'mailboxes.work');
        return true;
      },
    );
  });
});

// ---------------------------------------------------------------------------
// validateMailboxesExist tests
// ---------------------------------------------------------------------------

describe('validateMailboxesExist', () => {
  it('throws when no mailboxes configured (undefined)', () => {
    const cfg = configWithMailboxes({} as Record<string, MailboxConfig>);
    delete cfg.mailboxes;
    assert.throws(
      () => validateMailboxesExist(cfg),
      (err: unknown) => {
        assert.ok(err instanceof ConfigurationError);
        assert.strictEqual(err.field, 'mailboxes');
        return true;
      },
    );
  });

  it('throws when mailboxes is empty object', () => {
    const cfg = configWithMailboxes({});
    assert.throws(
      () => validateMailboxesExist(cfg),
      (err: unknown) => {
        assert.ok(err instanceof ConfigurationError);
        assert.strictEqual(err.field, 'mailboxes');
        return true;
      },
    );
  });

  it('succeeds with at least one mailbox', () => {
    const cfg = configWithMailboxes({
      work: validMailbox() as unknown as MailboxConfig,
    });
    // Should not throw
    validateMailboxesExist(cfg);
  });
});

// ---------------------------------------------------------------------------
// checkMailboxPasswordExpiry tests
// ---------------------------------------------------------------------------

describe('checkMailboxPasswordExpiry', () => {
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

  it('does nothing when no expiry set', () => {
    const cfg = configWithMailboxes({
      work: validMailbox() as unknown as MailboxConfig,
    });
    checkMailboxPasswordExpiry(cfg);
    assert.strictEqual(captured.length, 0);
  });

  it('emits WARN for password expiring within 7 days', () => {
    const mb = validMailbox() as unknown as MailboxConfig;
    const soon = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    mb.passwordExpiry = soon.toISOString().split('T')[0];
    const cfg = configWithMailboxes({ work: mb });
    checkMailboxPasswordExpiry(cfg);
    assert.ok(captured.some((line) => line.includes('[WARN]')));
    assert.ok(captured.some((line) => line.includes('expires in')));
    assert.ok(captured.some((line) => line.includes('work')));
  });

  it('emits ERROR for expired password', () => {
    const mb = validMailbox() as unknown as MailboxConfig;
    mb.passwordExpiry = '2020-01-01';
    const cfg = configWithMailboxes({ work: mb });
    checkMailboxPasswordExpiry(cfg);
    assert.ok(captured.some((line) => line.includes('[ERROR]')));
    assert.ok(captured.some((line) => line.includes('expired')));
    assert.ok(captured.some((line) => line.includes('work')));
  });

  it('stays silent when expiry is far in the future', () => {
    const mb = validMailbox() as unknown as MailboxConfig;
    mb.passwordExpiry = '2099-12-31';
    const cfg = configWithMailboxes({ work: mb });
    checkMailboxPasswordExpiry(cfg);
    assert.strictEqual(captured.length, 0);
  });

  it('does nothing when mailboxes is undefined', () => {
    const cfg = configWithMailboxes({} as Record<string, MailboxConfig>);
    delete cfg.mailboxes;
    checkMailboxPasswordExpiry(cfg);
    assert.strictEqual(captured.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Env var override: WIKI_MAILBOX_* creates mailbox config
// ---------------------------------------------------------------------------

describe('loadConfig (WIKI_MAILBOX_* env var override)', () => {
  let tmpDir: string;
  const savedEnv: Record<string, string | undefined> = {};

  const ENV_KEYS = [
    'WIKI_LLM_PROVIDER',
    'WIKI_LLM_MODEL',
    'WIKI_LLM_API_KEY',
    'WIKI_LLM_MAX_TOKENS',
    'WIKI_ROOT_DIR',
    'WIKI_MAILBOX_WORK_HOST',
    'WIKI_MAILBOX_WORK_PORT',
    'WIKI_MAILBOX_WORK_TLS',
    'WIKI_MAILBOX_WORK_USER',
    'WIKI_MAILBOX_WORK_PASSWORD',
    'WIKI_MAILBOX_WORK_FOLDERS',
    'WIKI_MAILBOX_WORK_TIMEOUT',
    'WIKI_MAILBOX_WORK_PASSWORD_EXPIRY',
  ];

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'wiki-mbx-'));
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(async () => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] !== undefined) {
        process.env[key] = savedEnv[key];
      } else {
        delete process.env[key];
      }
    }
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('WIKI_MAILBOX_WORK_* env vars create mailbox config', async () => {
    const cfgPath = join(tmpDir, 'config.json');
    await writeFile(cfgPath, JSON.stringify(validConfigObj()), 'utf-8');

    process.env.WIKI_MAILBOX_WORK_HOST = 'imap.example.com';
    process.env.WIKI_MAILBOX_WORK_PORT = '993';
    process.env.WIKI_MAILBOX_WORK_TLS = 'true';
    process.env.WIKI_MAILBOX_WORK_USER = 'user@example.com';
    process.env.WIKI_MAILBOX_WORK_PASSWORD = 'secret123';
    process.env.WIKI_MAILBOX_WORK_FOLDERS = 'INBOX,Wiki-Feed';
    process.env.WIKI_MAILBOX_WORK_TIMEOUT = '30000';

    const result = await loadConfig({ configPath: cfgPath });
    assert.ok(result.mailboxes);
    assert.ok(result.mailboxes!.work);
    assert.strictEqual(result.mailboxes!.work.host, 'imap.example.com');
    assert.strictEqual(result.mailboxes!.work.port, 993);
    assert.strictEqual(result.mailboxes!.work.tls, true);
    assert.strictEqual(result.mailboxes!.work.user, 'user@example.com');
    assert.strictEqual(result.mailboxes!.work.password, 'secret123');
    assert.deepStrictEqual(result.mailboxes!.work.folders, ['INBOX', 'Wiki-Feed']);
    assert.strictEqual(result.mailboxes!.work.connectionTimeout, 30000);
  });

  it('WIKI_MAILBOX_* env vars override config file mailbox values', async () => {
    const cfg = validConfigObj();
    (cfg as Record<string, unknown>).mailboxes = {
      work: validMailbox(),
    };
    const cfgPath = join(tmpDir, 'config.json');
    await writeFile(cfgPath, JSON.stringify(cfg), 'utf-8');

    process.env.WIKI_MAILBOX_WORK_HOST = 'imap.override.com';

    const result = await loadConfig({ configPath: cfgPath });
    assert.ok(result.mailboxes);
    assert.strictEqual(result.mailboxes!.work.host, 'imap.override.com');
    // Other fields should remain from the config file
    assert.strictEqual(result.mailboxes!.work.port, 993);
  });
});
