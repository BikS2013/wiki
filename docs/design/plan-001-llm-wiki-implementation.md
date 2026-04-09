# Plan 001: LLM Wiki Implementation

**Date**: 2026-04-09
**Project**: LLM Wiki CLI
**Status**: Draft

---

## Overview

This plan breaks the LLM Wiki CLI implementation into 10 discrete phases. Each phase is independently buildable and testable. Phases 1-4 form the foundation layer and must be completed sequentially. Phases 5-9 build on the foundation and have limited parallelization opportunities (noted below). Phase 10 is final integration testing.

### Dependency Graph

```
Phase 1 (Scaffolding)
  |
  v
Phase 2 (Configuration)
  |
  v
Phase 3 (LLM Provider)        Phase 4 (Core Wiki Operations)
  |                              |
  +-----------+------------------+
              |
              v
Phase 5 (Init Command)
  |
  v
Phase 6 (Ingest Command)
  |
  +---> Phase 7 (Query Command)    [can start after Phase 6 core is done]
  |
  +---> Phase 8 (Lint Command)     [can start after Phase 6 core is done]
  |
  v
Phase 9 (Utility Commands)        [can start after Phase 5]
  |
  v
Phase 10 (Integration Testing & Polish)
```

**Parallelization notes**:
- Phases 3 and 4 are independent of each other and CAN be built in parallel once Phase 2 is complete.
- Phases 7, 8, and 9 are largely independent and CAN be built in parallel once Phase 6 core is complete.
- Phase 9 (status, list-sources) partially depends only on Phase 5 (init) and Phase 4 (registry, index reading), so simple read-only commands can start before Phase 6 is done.

---

## Phase 1: Project Scaffolding

**Goal**: Establish the project skeleton with build toolchain, CLI entry point, and directory structure.

### Files to Create

| File | Purpose |
|------|---------|
| `package.json` | Project manifest with scripts (build, dev, start) |
| `tsconfig.json` | TypeScript configuration (strict, ES2022, Node16 module resolution) |
| `src/cli.ts` | Entry point -- commander setup with program definition and global options |
| `src/commands/` | Empty directory for command modules |
| `src/llm/` | Empty directory for LLM provider modules |
| `src/wiki/` | Empty directory for wiki operation modules |
| `src/source/` | Empty directory for source processing modules |
| `src/ingest/` | Empty directory for ingest pipeline modules |
| `src/config/` | Empty directory for configuration modules |
| `src/utils/` | Empty directory for utility modules |
| `src/utils/logger.ts` | Logger utility with verbose/quiet modes |
| `.gitignore` | Ignore node_modules, dist, config.json (API keys) |

### Dependencies to Install

**Runtime**:
- `commander` -- CLI framework
- `@anthropic-ai/sdk` -- Anthropic LLM client
- `gray-matter` -- YAML frontmatter parsing
- `js-yaml` -- YAML serialization control (JSON_SCHEMA to prevent date coercion)
- `pdf-parse` (or `@cedrugs/pdf-parse`) -- PDF text extraction

**Dev**:
- `typescript` -- compiler
- `tsx` -- TypeScript execution for dev/test
- `@types/node` -- Node.js type definitions
- `@types/gray-matter` -- gray-matter types

### Acceptance Criteria

- [ ] `npm install` completes without errors
- [ ] `npm run build` compiles TypeScript to `dist/` without errors
- [ ] `npx tsx src/cli.ts --help` prints help text with program name, version, and global options
- [ ] `npx tsx src/cli.ts --version` prints the version from package.json
- [ ] Global options `--config`, `--verbose`, `--dry-run` are defined on the root program
- [ ] All command stubs are registered (init, ingest, query, lint, status, list-sources, remove-source, rebuild-index) and print placeholder messages

### Verification Commands

```bash
cd /Users/giorgosmarinos/aiwork/coding-platform/macbook-desktop/wiki
npm install
npm run build
npx tsx src/cli.ts --help
npx tsx src/cli.ts --version
npx tsx src/cli.ts init --help
npx tsx src/cli.ts ingest --help
```

---

## Phase 2: Configuration System

**Goal**: Implement config loading with strict validation, environment variable overrides, and no fallback values.

**Depends on**: Phase 1

### Files to Create

| File | Purpose |
|------|---------|
| `src/config/types.ts` | `WikiConfig` interface and sub-interfaces (`LLMConfig`, `WikiPaths`, `ObsidianConfig`) |
| `src/config/loader.ts` | Load config from file, merge env vars (priority: CLI > env > file), return validated config |
| `src/config/validator.ts` | Validate all required fields are present; throw with field name on missing. Validate conditional fields (Azure endpoint when provider=azure). Check API key expiry warning (7-day threshold). |
| `test_scripts/test-config.ts` | Unit tests: missing required field throws, env override works, conditional validation, expiry warning |

### Key Design Decisions

- **No fallback values**: Every required config field must be explicitly provided. Missing field raises `ConfigurationError` with the field name.
- **Environment variable mapping**: `WIKI_LLM_PROVIDER`, `WIKI_LLM_API_KEY`, `WIKI_LLM_MODEL`, `WIKI_LLM_MAX_TOKENS`, `WIKI_ROOT_DIR`, `WIKI_AZURE_ENDPOINT`, `WIKI_AZURE_DEPLOYMENT`
- **Priority**: CLI args > environment variables > config.json
- **API key expiry**: If `llm.apiKeyExpiry` is set and within 7 days, print a warning to stderr.
- Config file path defaults to `<cwd>/config.json` but can be overridden via `--config` CLI option.

### Acceptance Criteria

- [ ] Loading a valid config.json returns a fully typed `WikiConfig` object
- [ ] Missing `llm.provider` throws `ConfigurationError: Missing required configuration: llm.provider`
- [ ] Missing `llm.azureEndpoint` when `llm.provider` is `azure` throws a clear error
- [ ] Setting `WIKI_LLM_API_KEY=xxx` overrides the config file value
- [ ] API key expiry warning prints when key expires within 7 days
- [ ] No default/fallback values exist anywhere in the config loading code

### Verification Commands

```bash
npx tsx test_scripts/test-config.ts
# Test with missing config:
npx tsx src/cli.ts status  # Should fail with "config.json not found" or similar
```

---

## Phase 3: LLM Provider Abstraction

**Goal**: Build the provider interface, Anthropic implementation, retry logic, token estimation, and cumulative usage tracking.

**Depends on**: Phase 2

### Files to Create

| File | Purpose |
|------|---------|
| `src/llm/provider.ts` | `LLMProvider` interface: `complete()`, `completeWithTools()`, `countTokens()` |
| `src/llm/types.ts` | Shared types: `CompletionParams`, `CompletionResult`, `ToolCompletionParams`, `ToolCompletionResult`, `TokenCount` |
| `src/llm/anthropic.ts` | `AnthropicProvider` implementing `LLMProvider` using `@anthropic-ai/sdk` |
| `src/llm/factory.ts` | `createProvider(config)` factory function (returns Anthropic; Azure/Vertex stubs throw "not implemented") |
| `src/llm/tools.ts` | Tool definitions for structured extraction: `extract_entities`, `extract_topics`, `generate_summary` |
| `src/llm/retry.ts` | `callWithRetry()` utility: exponential backoff for 429/5xx, fail-fast for 401/400 |
| `src/utils/tokens.ts` | Heuristic token estimation (`estimateTokensHybrid`), `PromptBudgetAnalyzer` class using both heuristic and API `countTokens` |
| `src/utils/usage-tracker.ts` | `UsageTracker` class: accumulates input/output/cache tokens across calls, prints summary |
| `test_scripts/test-llm-provider.ts` | Tests with mock provider: tool use parsing, retry logic, token estimation |

### Key Design Decisions

- **Start with Anthropic only**. Azure and Vertex factory paths throw `Error('Provider not yet implemented: azure')`.
- **Non-streaming** for all batch operations. Streaming is deferred.
- **Tool use with `tool_choice: { type: 'tool', name: '...' }`** to force structured JSON output for extraction steps.
- **Token estimation**: Use heuristic (`chars/4 + words*1.3 hybrid`) for initial chunking pass; use `client.messages.countTokens()` API when near the context limit (within 20% of threshold).
- **Retry**: Max 3 retries, exponential backoff (1s, 2s, 4s), cap at 30s. Rate limit (429) and server errors (5xx) are retryable. Auth (401) and bad request (400) are not.

### Acceptance Criteria

- [ ] `AnthropicProvider.complete()` sends a message and returns text content
- [ ] `AnthropicProvider.completeWithTools()` forces tool use and returns parsed JSON
- [ ] Retry logic backs off on 429 errors and retries up to 3 times
- [ ] `UsageTracker` accumulates token counts across multiple calls and prints a summary
- [ ] `estimateTokensHybrid()` returns a number within 20% of actual for English prose
- [ ] Factory throws for unsupported providers

### Verification Commands

```bash
npx tsx test_scripts/test-llm-provider.ts
# Integration test (requires ANTHROPIC_API_KEY):
WIKI_TEST_LLM=true npx tsx test_scripts/test-llm-provider.ts
```

---

## Phase 4: Core Wiki Operations

**Goal**: Implement file I/O utilities, frontmatter parsing with gray-matter (JSON_SCHEMA to prevent date coercion), wiki-link extraction/generation, content hashing, source registry CRUD, index management, and log management.

**Depends on**: Phase 1 (can be built in parallel with Phase 3)

### Files to Create

| File | Purpose |
|------|---------|
| `src/wiki/frontmatter.ts` | Parse and stringify frontmatter using gray-matter with `JSON_SCHEMA` engine. `WikiPageFrontmatter` interface. Safe read-modify-write that preserves body content. |
| `src/wiki/wikilinks.ts` | Extract `[[PageName]]` and `[[PageName\|Display]]` links via regex. Generate wiki-links. Validate links against existing pages. |
| `src/wiki/pages.ts` | Read/write/list wiki pages. Enforce naming conventions (kebab-case filenames). Create pages with valid frontmatter. |
| `src/wiki/registry.ts` | `SourceRegistry` class: load/save `sources/registry.json`, add/update/remove/find source entries, duplicate detection by hash. |
| `src/wiki/index-manager.ts` | Read/write/update `wiki/index.md`. Add/remove/update entries. Generate full index from page scan. Parse index entries. |
| `src/wiki/log.ts` | Append-only log writer for `wiki/log.md`. Format: `[YYYY-MM-DD HH:mm] [ACTION] description`. |
| `src/source/reader.ts` | Read source files by format: text (.md, .txt), PDF (.pdf via pdf-parse), data (.json, .csv), image (.png, .jpg -- base64 encode for LLM vision). |
| `src/source/hasher.ts` | SHA-256 content hashing via Node.js `crypto`. |
| `src/source/chunker.ts` | Section-aware chunking: markdown by headings, PDF by pages (form-feed split), text by paragraphs. Token budget awareness using heuristic estimation. Overlap support (200-500 tokens). |
| `src/utils/naming.ts` | `toKebabCase()`, `toWikiSlug()`, `sanitizeFilename()` utilities for Obsidian-safe file naming. |
| `test_scripts/test-frontmatter.ts` | Roundtrip tests: dates stay as strings, arrays preserved, aliases field works |
| `test_scripts/test-wikilinks.ts` | Regex extraction tests, link generation, broken link detection |
| `test_scripts/test-hashing.ts` | Hash consistency, duplicate detection |
| `test_scripts/test-registry.ts` | Registry CRUD: add, find, update status, remove, duplicate detection |
| `test_scripts/test-chunking.ts` | Chunk markdown by headings, respect token budget, overlap verification |

### Key Design Decisions

- **gray-matter with JSON_SCHEMA**: Prevents YAML date auto-coercion. All dates stored as quoted ISO 8601 strings.
- **Wiki-link regex**: `/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g` captures both `[[Page]]` and `[[Page|Display]]`.
- **File naming**: kebab-case for filenames (e.g., `machine-learning.md`), with human-readable `title` in frontmatter and `aliases` for Obsidian search.
- **Registry is JSON**: `sources/registry.json` -- simple, human-readable, git-diffable.
- **Index format**: Markdown table with columns: Link, Summary, Type, Updated, Tags.
- **PDF chunking**: Split on `\f` (form-feed) character from pdf-parse v1 default output.

### Acceptance Criteria

- [ ] Frontmatter parse/stringify roundtrip preserves dates as strings (not Date objects)
- [ ] Wiki-link extraction correctly identifies `[[Page]]` and `[[Page|Display Text]]`
- [ ] Content hash is deterministic (same file = same hash)
- [ ] Registry detects duplicates by hash and warns
- [ ] Index manager can add, remove, and regenerate entries
- [ ] Log appends entries without corrupting existing content
- [ ] Source reader handles .md, .txt, .pdf, .json, .csv, .png, .jpg
- [ ] Chunker respects token budget and produces overlapping chunks

### Verification Commands

```bash
npx tsx test_scripts/test-frontmatter.ts
npx tsx test_scripts/test-wikilinks.ts
npx tsx test_scripts/test-hashing.ts
npx tsx test_scripts/test-registry.ts
npx tsx test_scripts/test-chunking.ts
```

---

## Phase 5: Init Command

**Goal**: Implement `wiki init` to create the full directory structure, default config template, schema document, and prompt templates.

**Depends on**: Phase 2 (config types), Phase 4 (page writing, registry)

### Files to Create/Modify

| File | Purpose |
|------|---------|
| `src/commands/init.ts` | Full `wiki init` implementation: create directories, write template files, warn if already initialized |
| `src/templates/config-template.json` | Default config.json template with empty required fields and comments |
| `src/templates/wiki-schema.md` | Default schema document describing wiki conventions, page types, frontmatter fields, naming rules |
| `src/templates/prompts/ingest.md` | Prompt template for source ingestion |
| `src/templates/prompts/query.md` | Prompt template for query synthesis |
| `src/templates/prompts/lint.md` | Prompt template for contradiction detection |
| `src/templates/prompts/update-page.md` | Prompt template for merging new info into existing page |
| `src/templates/prompts/create-entity.md` | Prompt template for creating a new entity page |
| `src/templates/prompts/create-topic.md` | Prompt template for creating a new topic page |
| `test_scripts/test-init.ts` | Test init creates all expected directories and files; test re-init warns without overwrite |

### Directory Structure Created by `wiki init`

```
<target-dir>/
  sources/
    registry.json            # Empty registry: { "sources": [], "lastUpdated": "..." }
  wiki/
    index.md                 # Empty index with header
    log.md                   # Empty log with header
    sources/
    entities/
    topics/
    synthesis/
    queries/
  schema/
    wiki-schema.md           # Default schema
    prompts/
      ingest.md
      query.md
      lint.md
      update-page.md
      create-entity.md
      create-topic.md
  config.json                # Template with empty fields
  .gitignore                 # Excludes config.json, node_modules, etc.
```

### Acceptance Criteria

- [ ] `wiki init` in an empty directory creates all directories and template files
- [ ] `wiki init` in an already-initialized directory warns "Wiki already initialized" and does not overwrite
- [ ] `config.json` template has all required fields set to empty strings
- [ ] `schema/wiki-schema.md` describes page types, frontmatter fields, naming conventions
- [ ] All 6 prompt templates exist in `schema/prompts/`
- [ ] `sources/registry.json` is a valid JSON file with empty sources array
- [ ] `wiki/index.md` has a header and empty table structure
- [ ] `wiki/log.md` has a header and `[INIT]` entry

### Verification Commands

```bash
mkdir /tmp/test-wiki && cd /tmp/test-wiki
npx tsx /Users/giorgosmarinos/aiwork/coding-platform/macbook-desktop/wiki/src/cli.ts init
ls -R .
cat config.json
cat schema/wiki-schema.md
cat wiki/index.md
# Test re-init:
npx tsx /Users/giorgosmarinos/aiwork/coding-platform/macbook-desktop/wiki/src/cli.ts init
# Should warn without overwriting
npx tsx /Users/giorgosmarinos/aiwork/coding-platform/macbook-desktop/wiki/test_scripts/test-init.ts
```

---

## Phase 6: Ingest Command

**Goal**: Implement the full ingest pipeline -- source registration, LLM-powered summarization, entity/topic extraction via tool use, page creation/merging, index and log updates.

**Depends on**: Phase 3 (LLM provider), Phase 4 (wiki operations), Phase 5 (init for directory structure)

### Files to Create/Modify

| File | Purpose |
|------|---------|
| `src/commands/ingest.ts` | `wiki ingest <source>` command: argument parsing, options (`--recursive`, `--tags`, `--metadata`, `--format`), orchestrates the pipeline |
| `src/ingest/pipeline.ts` | `IngestPipeline` class: orchestrates the multi-step workflow (register source -> read -> chunk if needed -> summarize -> extract -> merge -> update index/log) |
| `src/ingest/summarizer.ts` | Step 1: Send source content + schema to LLM, receive markdown summary with frontmatter |
| `src/ingest/extractor.ts` | Step 2: Send source content to LLM with tool-use (`extract_entities` tool), receive structured JSON of entities, topics, and cross-references |
| `src/ingest/merger.ts` | Step 3: For each entity/topic, check if page exists. If yes, send existing page + new info to LLM for merge (with contradiction detection). If no, create new page via LLM. |
| `src/ingest/cross-referencer.ts` | Step 4: Insert `[[wiki-links]]` into generated/updated pages based on extraction results. Programmatic (no LLM needed). |
| `test_scripts/test-ingest.ts` | Integration test: ingest a sample markdown file, verify source summary, entity pages, topic pages, index update, log entry. Uses mock LLM for unit mode, real LLM when `WIKI_TEST_LLM=true`. |
| `test_scripts/fixtures/` | Directory for test fixtures |
| `test_scripts/fixtures/sample-source.md` | Sample markdown source document for testing ingest |
| `test_scripts/fixtures/mock-llm-responses.json` | Pre-recorded LLM responses for unit testing |

### Ingest Workflow Detail

1. **Validate & Register**: Check file exists, compute hash, check registry for duplicates, register with status `ingesting`
2. **Read Source**: Use `source/reader.ts` to extract text content (PDF via pdf-parse, images via base64)
3. **Check Token Budget**: Estimate tokens. If exceeds 70% of context window, chunk the source.
4. **Load Context**: Read wiki schema, ingest prompt template, current `index.md`
5. **Step 1 - Summarize**: LLM call with source content + schema -> markdown summary page
6. **Step 2 - Extract**: LLM tool-use call -> structured JSON of entities, topics, cross-references
7. **Step 3 - Merge/Create Pages**: For each entity/topic:
   - If page exists: LLM merge call (existing page + new info -> updated page with contradiction callouts)
   - If page does not exist: LLM creation call -> new page with frontmatter
8. **Step 4 - Cross-Reference**: Programmatically insert `[[wiki-links]]` into all generated/updated pages
9. **Update Index**: Add/update entries in `wiki/index.md` for all new/modified pages
10. **Update Log**: Append `INGEST`, `CREATE_PAGE`, `UPDATE_PAGE` entries to `wiki/log.md`
11. **Update Registry**: Set source status to `ingested`, record generated pages list
12. **Print Summary**: Show pages created, pages updated, entities found, tokens used

### Multi-Chunk Ingest

When a source exceeds the token budget:
- Chunk 1: Full extraction (summary + entities + topics)
- Chunks 2-N: Incremental extraction -- send previous chunk's summary as context
- Final: Deduplicate entities by name similarity, merge all chunk results

### Re-Ingest (Updated Source)

When source path matches an existing registry entry but hash differs:
- Set status to `ingesting`
- Re-run the full pipeline
- Merge new content into existing pages (not replace)
- Update registry with new hash

### Acceptance Criteria

- [ ] `wiki ingest path/to/file.md` creates a summary page in `wiki/sources/`
- [ ] Entities from the source get pages in `wiki/entities/`
- [ ] Topics from the source get pages in `wiki/topics/`
- [ ] All pages have valid YAML frontmatter with required fields
- [ ] `wiki/index.md` contains entries for all new pages
- [ ] `wiki/log.md` has timestamped entries for the ingest
- [ ] `sources/registry.json` has the source with status `ingested` and `generatedPages` list
- [ ] Re-ingesting the same unchanged file prints "already ingested" and skips
- [ ] Re-ingesting a modified file updates affected pages
- [ ] Cross-references use `[[wiki-link]]` syntax
- [ ] Large source files are chunked and processed correctly
- [ ] `--dry-run` shows planned actions without writing files
- [ ] `--verbose` shows LLM call details and token usage
- [ ] `--tags` are applied to all generated pages

### Verification Commands

```bash
# Unit tests (mock LLM):
npx tsx test_scripts/test-ingest.ts
# Integration test (real LLM):
WIKI_TEST_LLM=true npx tsx test_scripts/test-ingest.ts
# Manual test:
cd /tmp/test-wiki
npx tsx /path/to/wiki/src/cli.ts ingest /path/to/sample-article.md --verbose
cat wiki/sources/summary-sample-article.md
cat wiki/index.md
cat wiki/log.md
cat sources/registry.json
ls wiki/entities/
ls wiki/topics/
```

---

## Phase 7: Query Command

**Goal**: Implement `wiki query` -- index-based page lookup, LLM-powered synthesis with citations, and `--save` flag.

**Depends on**: Phase 3 (LLM provider), Phase 4 (index manager, page reading), Phase 6 (needs a populated wiki to query)

### Files to Create/Modify

| File | Purpose |
|------|---------|
| `src/commands/query.ts` | `wiki query <question>` command: argument parsing, options (`--save`, `--pages`), orchestrates the query flow |
| `src/query/pipeline.ts` | `QueryPipeline` class: load index -> LLM selects pages -> read pages -> LLM synthesizes answer -> output/save |
| `test_scripts/test-query.ts` | Test query flow with mock LLM, test `--save` creates page in `wiki/queries/` |

### Query Workflow Detail

1. **Load Index**: Read `wiki/index.md`, parse into structured entries
2. **Page Selection**: Send question + index to LLM, receive list of relevant page paths (LLM returns structured JSON via tool use)
3. **Read Pages**: Read the selected wiki pages (up to `--pages` limit)
4. **Synthesis**: Send question + page contents to LLM with query prompt template, receive markdown answer with `[[wiki-link]]` citations
5. **Output**: Print answer to stdout
6. **Save** (if `--save`): Write answer as new page in `wiki/queries/` with frontmatter (type: `query-result`), update index, append to log

### Acceptance Criteria

- [ ] `wiki query "What is X?"` returns a markdown answer on stdout
- [ ] Answer includes `[[wiki-link]]` citations to referenced pages
- [ ] `wiki query --save "What is X?"` creates a page in `wiki/queries/`
- [ ] Saved query page has valid frontmatter with `type: query-result`
- [ ] Index is updated when `--save` is used
- [ ] Log is appended when `--save` is used
- [ ] Query with empty wiki returns "No relevant information found"
- [ ] `--pages` limits the number of wiki pages consulted

### Verification Commands

```bash
npx tsx test_scripts/test-query.ts
# Manual (requires populated wiki and API key):
cd /tmp/test-wiki
npx tsx /path/to/wiki/src/cli.ts query "What entities are tracked?" --verbose
npx tsx /path/to/wiki/src/cli.ts query "What entities are tracked?" --save
cat wiki/queries/
cat wiki/index.md
```

---

## Phase 8: Lint Command

**Goal**: Implement `wiki lint` -- structural checks (orphans, broken links, stale sources, frontmatter validation) and LLM-powered semantic checks (contradictions, missing cross-references).

**Depends on**: Phase 3 (LLM provider for semantic checks), Phase 4 (wiki-link extraction, page reading, registry), Phase 6 (needs a populated wiki to lint)

### Files to Create/Modify

| File | Purpose |
|------|---------|
| `src/commands/lint.ts` | `wiki lint` command: options (`--fix`, `--output`, `--category`), orchestrates checks |
| `src/lint/structural.ts` | Orphan detection, broken link detection, stale source detection, frontmatter validation |
| `src/lint/semantic.ts` | LLM-powered: contradiction detection across entity/topic pages, missing cross-reference detection |
| `src/lint/report.ts` | Report formatter: categorize findings (error, warning, suggestion), output to stdout and optionally to `wiki/lint-report.md` |
| `src/lint/fixer.ts` | Auto-fix logic for `--fix`: update broken links where unambiguous, add missing index entries |
| `test_scripts/test-lint.ts` | Test structural checks with crafted wiki (known orphans, broken links, stale sources). Test semantic checks with mock LLM. |

### Lint Checks Detail

**Structural (no LLM needed -- works offline)**:
1. **Orphan detection**: Pages not in `index.md` AND not linked from any other page
2. **Broken links**: `[[PageName]]` references where no matching `.md` file exists
3. **Stale sources**: Re-hash source files, compare against registry -- flag if hash differs
4. **Frontmatter validation**: Check required fields (`title`, `type`, `created`, `updated`, `sources`, `tags`)

**Semantic (LLM-powered)**:
5. **Contradiction detection**: Load entity/topic pages in batches, ask LLM to identify conflicting facts
6. **Missing cross-references**: Ask LLM to identify mentions of entities/topics that lack wiki-links

### Report Format

```markdown
# Wiki Lint Report
Generated: 2026-04-09 14:30

## Errors (3)
- [BROKEN_LINK] Page "machine-learning.md" links to [[Deep Learning]] but no such page exists
- [MISSING_FRONTMATTER] Page "kubernetes.md" missing required field: sources
- [STALE_SOURCE] Source "api-docs.pdf" has been modified since last ingest (hash mismatch)

## Warnings (2)
- [ORPHAN] Page "old-draft.md" is not referenced by any other page or the index
- [CONTRADICTION] Pages "react.md" and "frontend-overview.md" disagree on React's release year

## Suggestions (1)
- [MISSING_LINK] Page "typescript.md" mentions "JavaScript" but does not link to [[JavaScript]]
```

### Acceptance Criteria

- [ ] `wiki lint` detects orphan pages
- [ ] `wiki lint` detects broken `[[wiki-links]]`
- [ ] `wiki lint` detects stale sources by hash comparison
- [ ] `wiki lint` validates frontmatter required fields
- [ ] `wiki lint` detects contradictions (LLM-powered, gated by `--category contradictions`)
- [ ] Report categorizes findings by severity (error, warning, suggestion)
- [ ] `--output <path>` writes report to file
- [ ] `--fix` repairs broken links where unambiguous and adds missing index entries
- [ ] `--category orphans` runs only orphan checks
- [ ] Structural checks work without LLM API key

### Verification Commands

```bash
npx tsx test_scripts/test-lint.ts
# Manual:
cd /tmp/test-wiki
npx tsx /path/to/wiki/src/cli.ts lint --verbose
npx tsx /path/to/wiki/src/cli.ts lint --category orphans
npx tsx /path/to/wiki/src/cli.ts lint --fix
```

---

## Phase 9: Utility Commands

**Goal**: Implement `status`, `list-sources`, `remove-source`, and `rebuild-index` commands.

**Depends on**: Phase 4 (registry, index manager, log), Phase 5 (init for structure)

### Files to Create/Modify

| File | Purpose |
|------|---------|
| `src/commands/status.ts` | Show wiki stats: total pages by type, total sources, last ingest date, pending lint issues count |
| `src/commands/list-sources.ts` | Display all registered sources with: ID, filename, format, status, ingested date, generated pages count |
| `src/commands/remove-source.ts` | Remove a source by ID or name: confirmation prompt, remove registry entry, remove summary page, update index, log the action |
| `src/commands/rebuild-index.ts` | Scan all `.md` files in `wiki/`, parse frontmatter, regenerate `wiki/index.md` from scratch |
| `test_scripts/test-utility-commands.ts` | Tests for all four utility commands |

### Status Output Format

```
Wiki Status
===========
Pages:
  Source summaries:  12
  Entities:          45
  Topics:            23
  Synthesis:          3
  Query results:      7
  Total:             90

Sources:
  Total registered:  15
  Ingested:          12
  Pending:            2
  Failed:             1
  Last ingest:       2026-04-08 15:30

Health:
  Orphan pages:       2
  Broken links:       1
  Stale sources:      0
```

### Acceptance Criteria

- [ ] `wiki status` displays page counts by type, source counts by status, last ingest date
- [ ] `wiki list-sources` displays a formatted table of all sources
- [ ] `wiki remove-source <id>` prompts for confirmation, removes the source and its summary page
- [ ] `wiki remove-source` updates the index and appends to the log
- [ ] `wiki rebuild-index` scans all wiki pages and regenerates `index.md`
- [ ] `wiki rebuild-index` does not lose any existing page entries
- [ ] All commands work with `--dry-run`

### Verification Commands

```bash
npx tsx test_scripts/test-utility-commands.ts
# Manual:
cd /tmp/test-wiki
npx tsx /path/to/wiki/src/cli.ts status
npx tsx /path/to/wiki/src/cli.ts list-sources
npx tsx /path/to/wiki/src/cli.ts rebuild-index --verbose
```

---

## Phase 10: Integration Testing and Polish

**Goal**: End-to-end integration testing, documentation, edge case handling, and final polish.

**Depends on**: All previous phases

### Tasks

1. **End-to-End Integration Test**: Create a comprehensive test that:
   - Initializes a new wiki (`wiki init`)
   - Ingests 3 diverse sources (markdown, text, PDF)
   - Verifies all generated pages, index, log, and registry
   - Queries the wiki and verifies answer quality
   - Saves a query result
   - Runs lint and verifies clean report (or expected warnings)
   - Removes a source and verifies cleanup
   - Rebuilds index and verifies consistency

2. **Edge Case Handling**:
   - Empty source files
   - Very large source files (chunking)
   - Source files with no extractable entities
   - Unicode/non-ASCII content in source files and page names
   - Concurrent access to registry.json (file locking or advisory)
   - Interrupted ingest (source status stuck at `ingesting`)

3. **Documentation**:
   - Update `CLAUDE.md` with `<Wiki>` tool documentation
   - Create/update `docs/design/project-design.md` with final architecture
   - Create `docs/design/configuration-guide.md`
   - Update `Issues - Pending Items.md`

4. **CLI Polish**:
   - Colored output for errors/warnings/success
   - Progress indicators for long-running LLM operations
   - Suggested git commit message after ingest
   - Clean error messages for common failures (no API key, invalid config, network errors)

### Files to Create/Modify

| File | Purpose |
|------|---------|
| `test_scripts/test-e2e.ts` | Full end-to-end integration test |
| `test_scripts/fixtures/sample-article.md` | Markdown source for e2e testing |
| `test_scripts/fixtures/sample-notes.txt` | Text source for e2e testing |
| `test_scripts/fixtures/sample-report.pdf` | PDF source for e2e testing (small) |
| `docs/design/project-design.md` | Final architecture documentation |
| `docs/design/configuration-guide.md` | Configuration guide per project conventions |
| `CLAUDE.md` | Updated with Wiki tool documentation |
| `Issues - Pending Items.md` | Updated with any remaining items |

### Acceptance Criteria

- [ ] E2E test passes with real LLM calls (gated by `WIKI_TEST_LLM=true`)
- [ ] All edge cases handled gracefully with clear error messages
- [ ] `CLAUDE.md` documents the Wiki tool per project conventions
- [ ] `docs/design/project-design.md` reflects the final architecture
- [ ] `docs/design/configuration-guide.md` covers all config parameters
- [ ] No orphaned TODO/FIXME comments in source code
- [ ] `--help` text is clear and complete for all commands

### Verification Commands

```bash
# Full e2e (requires API key):
WIKI_TEST_LLM=true npx tsx test_scripts/test-e2e.ts
# All unit tests:
npx tsx test_scripts/test-config.ts
npx tsx test_scripts/test-frontmatter.ts
npx tsx test_scripts/test-wikilinks.ts
npx tsx test_scripts/test-hashing.ts
npx tsx test_scripts/test-registry.ts
npx tsx test_scripts/test-chunking.ts
npx tsx test_scripts/test-llm-provider.ts
npx tsx test_scripts/test-init.ts
npx tsx test_scripts/test-ingest.ts
npx tsx test_scripts/test-query.ts
npx tsx test_scripts/test-lint.ts
npx tsx test_scripts/test-utility-commands.ts
```

---

## Open Questions Resolved

Based on the investigation and research documents, the following decisions have been made for the initial implementation:

| Question | Decision | Rationale |
|----------|----------|-----------|
| LLM Provider Priority | Start with Anthropic only | Azure/Vertex can be added later behind the existing interface. Reduces initial complexity. |
| Source Storage Strategy | Registry tracks original paths (no copy) | Avoids doubling disk usage. Sources are immutable; user is responsible for not moving them. |
| Chunking Strategy | Section-aware with token budget | Markdown by headings, PDF by form-feed pages, text by paragraphs. Heuristic estimation with API verification near threshold. |
| Concurrent Ingest | Sequential processing | Sufficient for v1. Parallelism adds complexity with registry/index locking. |
| Schema Evolution | Manual re-process | No automatic migration. User can re-ingest sources after schema change. |
| Page Naming Conflicts | Entity type in filename | e.g., `mercury-planet.md` vs `mercury-element.md`. Entity type from extraction step. |
| Image Source Handling | Textual description only | Image content described in summary page. No image embedding in v1. |
| Token Budget Per Operation | Configurable via `llm.maxTokens` | No hard limit on LLM calls per ingest. Usage tracked and reported in verbose mode. |
| Wiki Page Size Limit | No limit in v1 | Deferred. Monitor page growth during usage. |
| Offline Mode | Structural lint works offline | Only semantic checks (contradictions, missing links) require LLM. |

---

## Estimated Effort

| Phase | Estimated Size | Notes |
|-------|---------------|-------|
| Phase 1: Scaffolding | Small | Boilerplate, straightforward |
| Phase 2: Configuration | Small | Validation logic, env var merging |
| Phase 3: LLM Provider | Medium | SDK integration, retry logic, token utilities |
| Phase 4: Core Wiki Ops | Medium-Large | Many small modules, thorough testing needed |
| Phase 5: Init Command | Small | Template writing, directory creation |
| Phase 6: Ingest Command | Large | Most complex phase -- multi-step LLM pipeline, page merging |
| Phase 7: Query Command | Medium | Two-step LLM flow, save logic |
| Phase 8: Lint Command | Medium | Structural checks + LLM semantic checks |
| Phase 9: Utility Commands | Small | Mostly reads from existing data structures |
| Phase 10: Integration | Medium | E2E testing, documentation, edge cases |

---

## Complete File Inventory

All source files that will be created across all phases:

```
wiki/
  package.json
  tsconfig.json
  .gitignore
  src/
    cli.ts
    commands/
      init.ts
      ingest.ts
      query.ts
      lint.ts
      status.ts
      list-sources.ts
      remove-source.ts
      rebuild-index.ts
    llm/
      provider.ts
      types.ts
      anthropic.ts
      factory.ts
      tools.ts
      retry.ts
    wiki/
      frontmatter.ts
      wikilinks.ts
      pages.ts
      registry.ts
      index-manager.ts
      log.ts
    source/
      reader.ts
      hasher.ts
      chunker.ts
    ingest/
      pipeline.ts
      summarizer.ts
      extractor.ts
      merger.ts
      cross-referencer.ts
    query/
      pipeline.ts
    lint/
      structural.ts
      semantic.ts
      report.ts
      fixer.ts
    config/
      types.ts
      loader.ts
      validator.ts
    utils/
      tokens.ts
      usage-tracker.ts
      naming.ts
      logger.ts
    templates/
      config-template.json
      wiki-schema.md
      prompts/
        ingest.md
        query.md
        lint.md
        update-page.md
        create-entity.md
        create-topic.md
  test_scripts/
    test-config.ts
    test-frontmatter.ts
    test-wikilinks.ts
    test-hashing.ts
    test-registry.ts
    test-chunking.ts
    test-llm-provider.ts
    test-init.ts
    test-ingest.ts
    test-query.ts
    test-lint.ts
    test-utility-commands.ts
    test-e2e.ts
    fixtures/
      sample-source.md
      sample-article.md
      sample-notes.txt
      sample-report.pdf
      mock-llm-responses.json
  docs/
    design/
      project-design.md
      configuration-guide.md
      plan-001-llm-wiki-implementation.md
      project-functions.md
    reference/
      (existing research documents)
```
