# Codebase Scan: Mailbox Ingest Feature

**Date**: 2026-04-12
**Purpose**: Map the existing wiki project architecture to identify integration points for the new `mail-check` command.

---

## 1. Project Overview

- **Location**: `/Users/giorgosmarinos/aiwork/coding-platform/macbook-desktop/wiki`
- **Language**: TypeScript (ES modules, `"type": "module"`)
- **Build**: `tsc` (TypeScript compiler), output to `dist/`
- **Runtime**: Node.js with `tsx` for development
- **CLI Framework**: Commander v12
- **Package name**: `llm-wiki` v0.1.0

### Directory Layout

```
wiki/
  src/
    cli.ts                    # Commander program setup, command registration
    commands/                 # One file per CLI command
      init.ts
      ingest.ts               # Key reference for mail-check pattern
      query.ts
      lint.ts
      status.ts
      list-sources.ts
      remove-source.ts
      rebuild-index.ts
    config/
      types.ts                # WikiConfig, LLMConfig, ConfigurationError
      loader.ts               # loadConfig(): file -> env -> CLI merge
      validator.ts            # validateConfig(), checkApiKeyExpiry()
    ingest/
      pipeline.ts             # IngestPipeline class (core orchestration)
      summarizer.ts           # LLM summarization step
      extractor.ts            # Entity/topic extraction step
      merger.ts               # Merge new info into existing pages
      cross-referencer.ts      # Insert [[wiki-links]]
    source/
      reader.ts               # Read source files by format
      hasher.ts               # SHA-256 content hashing
      chunker.ts              # Text chunking
      clipboard.ts            # Clipboard ingest support
      web.ts                  # Web page ingest support
      youtube.ts              # YouTube transcript ingest
    wiki/
      registry.ts             # SourceRegistry class (sources/registry.json)
      index-manager.ts        # IndexManager for wiki/index.md
      log.ts                  # LogWriter (wiki/log.md)
      frontmatter.ts          # YAML frontmatter parsing
      wikilinks.ts            # Wiki-link utilities
      pages.ts                # Wiki page utilities
    llm/
      provider.ts             # LLMProvider interface
      factory.ts              # createProvider(config) factory
      anthropic.ts            # Anthropic provider
      azure.ts                # Azure AI provider
      vertex.ts               # Vertex AI provider
      retry.ts                # Retry logic
      tokens.ts               # Token counting
      tools.ts                # LLM tool definitions
      types.ts                # LLM types
      usage-tracker.ts        # Usage tracking
    lint/
      structural.ts           # Structural lint checks
      semantic.ts             # Semantic lint checks
      fixer.ts                # Auto-fix logic
      report.ts               # Lint report formatting
    query/
      pipeline.ts             # Query pipeline
    utils/
      logger.ts               # Logger interface + factory
      naming.ts               # toKebabCase and naming utilities
  docs/
    design/                   # Design docs, plans, config guide
    reference/                # Research, investigations, refined requests
  test_scripts/               # Test files
```

---

## 2. Module Map

### CLI Entry Point: `src/cli.ts`

- Creates a `Command` program with global options: `--config`, `--verbose`, `--dry-run`
- **Pre-action hook** (line 60): runs before every command except `init`; calls `loadConfig()` and stores the result as `program.opts()._config`
- **Command registration pattern** (two styles):
  1. **Self-registering**: export `registerXCommand(program)` (used by `init`, `ingest`)
  2. **Inline**: define in `cli.ts` calling `execute()` from the command module (used by `query`, `lint`, `status`, etc.)

### Configuration: `src/config/`

| File | Key Exports | Notes |
|------|-------------|-------|
| `types.ts` | `WikiConfig`, `LLMConfig`, `WikiPaths`, `ObsidianConfig`, `ConfigurationError` | Top-level config has `llm`, `wiki`, `obsidian` sections |
| `loader.ts` | `loadConfig(options)` | Priority: CLI > env vars > config.json. Calls `validateConfig()` + `checkApiKeyExpiry()` |
| `validator.ts` | `validateConfig(config)`, `checkApiKeyExpiry(config)` | Throws `ConfigurationError(field, message)` for missing/invalid fields. Expiry check writes to stderr, does not throw. |

**Key conventions**:
- No default/fallback values ever (project rule)
- `ConfigurationError` carries a `.field` property for diagnostics
- Env vars follow `WIKI_` prefix pattern (e.g., `WIKI_LLM_PROVIDER`)
- `checkApiKeyExpiry()` warns to stderr within 7 days of expiry

### Ingest Pipeline: `src/ingest/pipeline.ts`

**Class**: `IngestPipeline`
- Constructor: `(config: WikiConfig, provider: LLMProvider, logger: Logger)`
- Main method: `async ingest(sourcePath: string, options: IngestOptions): Promise<IngestResult>`

**IngestOptions** interface:
```typescript
interface IngestOptions {
  tags?: string[];
  metadata?: Record<string, string>;
  dryRun?: boolean;
  recursive?: boolean;
  sourceUrl?: string;
}
```

**IngestResult** interface:
```typescript
interface IngestResult {
  pagesCreated: string[];
  pagesUpdated: string[];
  entities: string[];
  topics: string[];
  sourceSummaryPath: string;
}
```

**Pipeline steps** (sequential within `ingest()`):
1. Read source file via `readSource()`
2. Copy source to `sources/files/`
3. Hash content (SHA-256)
4. Check registry for duplicates (by hash)
5. Register source with status `ingesting`
6. Load wiki schema + prompt templates
7. LLM summarization
8. Write summary page to `wiki/sources/`
9. LLM entity/topic extraction
10. Create/merge entity pages in `wiki/entities/`
11. Create/merge topic pages in `wiki/topics/`
12. Insert cross-references
13. Update `wiki/index.md` via `IndexManager`
14. Append to `wiki/log.md` via `LogWriter`
15. Update `sources-catalog.md`
16. Update registry status to `ingested`

**Error handling**: If any step fails after registration, source status is set to `failed`.

### Source Registry: `src/wiki/registry.ts`

**Class**: `SourceRegistry`
- Path: `sources/registry.json`
- Atomic saves via tmp file + rename
- CRUD methods: `add()`, `update()`, `remove()`
- Query methods: `findByHash()`, `findByPath()`, `findByUrl()`, `findById()`, `getAll()`

**SourceEntry** interface:
```typescript
interface SourceEntry {
  id: string;              // UUID v4
  filePath: string;        // Relative path within rootDir
  fileName: string;        // Original basename
  format: string;          // Extension with dot
  contentHash: string;     // SHA-256
  ingestedAt: string;      // ISO 8601
  updatedAt: string;       // ISO 8601
  status: 'pending' | 'ingesting' | 'ingested' | 'failed' | 'stale';
  generatedPages: string[];
  metadata: Record<string, string>;
  sourceUrl?: string;
}
```

### Logger: `src/utils/logger.ts`

**Interface**: `Logger` with methods: `info()`, `verbose()`, `warn()`, `error()`, `success()`
- `verbose()` only prints when verbose mode is enabled
- `warn()` and `error()` write to stderr

### Ingest Command: `src/commands/ingest.ts`

- Uses self-registering pattern: exports `registerIngestCommand(program)`
- Handles multiple input modes: file, directory, `--clipboard`, `--text`, `--url`, `--youtube`, `--update`
- Creates `IngestPipeline` instance, calls `pipeline.ingest()` for each source
- Has `printResult()` and `printAggregateResults()` helpers for output formatting

---

## 3. Conventions

### Command Registration
- Self-registering commands export `registerXCommand(program: Command): void`
- Config and logger are retrieved from `program.opts()._config` and `program.opts()._logger`
- Global options (`--verbose`, `--dry-run`, `--config`) are on the parent program

### Configuration
- All required fields must be validated; missing = throw `ConfigurationError`
- Never substitute defaults (project-wide rule)
- Env var override pattern: `WIKI_<SECTION>_<FIELD>` (e.g., `WIKI_LLM_API_KEY`)
- `loadConfig()` merges file -> env -> CLI in that priority order
- Optional sections (like the new `mailboxes`) are only validated when the relevant command runs

### Source Handling
- Source files are **copied** to `sources/files/` (wiki is self-contained)
- Duplicate detection via content hash (SHA-256)
- `metadata: Record<string, string>` on `SourceEntry` for custom key-value pairs
- Source URL stored in `sourceUrl` field for re-fetchable sources

### Testing
- Tests live in `test_scripts/` directory
- Run with `npx tsx test_scripts/test-*.ts`
- No formal test framework; tests are standalone scripts

### Build & Dependencies
- TypeScript with `tsc`, output to `dist/`
- ES modules throughout (`.js` extension in imports)
- Key deps: `commander`, `gray-matter`, `@anthropic-ai/sdk`, `@extractus/article-extractor`

---

## 4. Integration Points for Mailbox Feature

### Files to Modify

| File | Change |
|------|--------|
| `src/config/types.ts` | Add `MailboxConfig` interface and optional `mailboxes?: Record<string, MailboxConfig>` to `WikiConfig` |
| `src/config/validator.ts` | Add `validateMailboxConfig(config)` function for on-demand validation when `mail-check` runs. Add `checkPasswordExpiry()` following the `checkApiKeyExpiry()` pattern. |
| `src/config/loader.ts` | Extend `applyEnvOverrides()` to handle `WIKI_MAILBOX_<NAME>_*` env vars. Extend `applyCliOverrides()` for the new `mailboxes` section. |
| `src/cli.ts` | Register the new `mail-check` command (use self-registering pattern like `ingest`) |
| `src/wiki/log.ts` | No changes needed; `LogAction = 'INGEST'` is already available |

### Files to Create

| File | Purpose |
|------|---------|
| `src/commands/mail-check.ts` | New command module: `registerMailCheckCommand(program)`. Orchestrates mailbox connection, email discovery, and per-email ingest loop. |
| `src/source/imap.ts` | IMAP client wrapper: connect, list UIDs, fetch messages, extract body + attachments. Wraps `imapflow` + `mailparser`. |
| `src/source/mailbox-state.ts` | State file manager for `sources/mailbox-state.json`. Load/save, UID tracking, UIDVALIDITY handling, Message-ID deduplication. Atomic writes (same pattern as `SourceRegistry`). |

### Existing Modules to Reuse (No Modification Required)

| Module | How Used |
|--------|----------|
| `IngestPipeline.ingest()` | Called once per email body file and once per attachment file. The pipeline handles registration, summarization, entity extraction, cross-referencing, index updates, logging. |
| `SourceRegistry` | Email sources are registered automatically by `IngestPipeline.ingest()`. Email metadata is passed via `IngestOptions.metadata`. |
| `LogWriter` | Ingest log entries are written automatically by the pipeline. |
| `IndexManager` | Index updates are handled automatically by the pipeline. |
| `Logger` | Use `createLogger({ verbose })` same as other commands. |
| `source/reader.ts` | Attachment files saved to `sources/files/` are read through the standard reader. |
| `source/hasher.ts` | Content hashing for duplicate detection happens inside the pipeline. |
| `utils/naming.ts` | `toKebabCase()` used by pipeline for page naming. |

### Integration Pattern

The `mail-check` command should follow the `ingest` command pattern closely:

1. **Command registration**: Export `registerMailCheckCommand(program)` in `src/commands/mail-check.ts`
2. **Config access**: Retrieve config via `program.opts()._config`
3. **Mailbox validation**: Call a dedicated `validateMailboxConfig(config)` only inside the `mail-check` action (not in the global pre-action hook)
4. **Pipeline reuse**: For each email, save body as `.md` file to `sources/files/`, then call `pipeline.ingest(filePath, { metadata: { source: 'email', emailMessageId: '...', ... } })`
5. **Attachment handling**: Save each attachment to `sources/files/`, call `pipeline.ingest()` separately with `parentEmailMessageId` in metadata
6. **State tracking**: Use a dedicated `MailboxStateManager` class (modeled after `SourceRegistry` with atomic tmp+rename writes)
7. **Error handling**: Per-email try/catch; failures skip state update for that email; processing continues

### New npm Dependencies Required

| Package | Purpose |
|---------|---------|
| `imapflow` | Promise-based IMAP client with UID support and streaming |
| `mailparser` | MIME parser for body extraction and attachment handling |
| `turndown` | HTML-to-markdown conversion for HTML-only email bodies |

---

## 5. Key Symbols Reference

| Symbol | File | Line | Purpose |
|--------|------|------|---------|
| `WikiConfig` | `src/config/types.ts` | 69 | Top-level config interface (add `mailboxes?` field here) |
| `ConfigurationError` | `src/config/types.ts` | 84 | Error class with `.field` property |
| `validateConfig()` | `src/config/validator.ts` | 11 | Config validation entry point |
| `checkApiKeyExpiry()` | `src/config/validator.ts` | 135 | Expiry warning pattern to follow for passwords |
| `loadConfig()` | `src/config/loader.ts` | 20 | Config loading with env/CLI merge |
| `applyEnvOverrides()` | `src/config/loader.ts` | 120 | Env var override logic (extend for mailbox vars) |
| `IngestPipeline` | `src/ingest/pipeline.ts` | 47 | Core ingest orchestrator |
| `IngestOptions` | `src/ingest/pipeline.ts` | 26 | Options for `pipeline.ingest()` |
| `SourceRegistry` | `src/wiki/registry.ts` | 48 | Source CRUD + persistence |
| `SourceEntry` | `src/wiki/registry.ts` | 10 | Source record (metadata field for email metadata) |
| `LogWriter` | `src/wiki/log.ts` | ~line 30+ | Append-only log writer |
| `createProvider()` | `src/llm/factory.ts` | 19 | LLM provider factory |
| `createLogger()` | `src/utils/logger.ts` | 63 | Logger factory |
| `registerIngestCommand()` | `src/commands/ingest.ts` | 22 | Pattern to follow for command registration |
| `createProgram()` | `src/cli.ts` | 45 | Program factory (add mail-check import here) |
