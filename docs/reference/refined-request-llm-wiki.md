# LLM Wiki - Refined Request Specification

## Project Name and Summary

**LLM Wiki** is a TypeScript CLI tool that builds and maintains a persistent, structured personal knowledge base (wiki) using LLMs. Instead of RAG-style retrieval at query time, the system incrementally compiles knowledge from raw source documents into an interlinked collection of markdown files. When a new source is added, the LLM reads it, extracts key information, and integrates it into the existing wiki -- updating entity pages, revising topic summaries, noting contradictions, and strengthening evolving synthesis. The wiki sits between the user and raw sources as a curated, always-current knowledge layer.

---

## Goals and Non-Goals

### Goals (In Scope)

1. Build a TypeScript CLI tool (`wiki`) that manages the full lifecycle of a personal knowledge base
2. Implement the three-layer architecture: raw sources, wiki, and schema
3. Support three core operations: Ingest, Query, and Lint
4. Maintain an automatically-updated index (`index.md`) and append-only log (`log.md`)
5. Generate Obsidian-compatible markdown (wiki-link syntax `[[page]]`, frontmatter metadata)
6. Provide a configurable schema document that controls wiki structure, conventions, and workflows
7. Support multiple source types: text files, markdown, PDFs, images (via LLM vision), data files
8. Track provenance -- every wiki claim traces back to its source document(s)
9. Integrate with git for version history of wiki changes

### Non-Goals (Explicitly Out of Scope)

1. **No embedded vector database or RAG pipeline** -- this is compile-time knowledge integration, not query-time retrieval
2. **No web UI** -- CLI only (Obsidian serves as the reading/browsing interface)
3. **No real-time collaboration** -- single-user tool
4. **No built-in LLM hosting** -- the tool calls external LLM APIs (Anthropic, Azure OpenAI, etc.)
5. **No automatic source discovery/crawling** -- user manually adds sources
6. **No Marp slide generation** -- deferred to a future phase
7. **No built-in markdown search engine (qmd)** -- deferred; index.md serves as the primary navigation mechanism initially

---

## Functional Requirements

### Source Management

- **FR-01**: The CLI must accept a source file path (or directory of files) and register it in the sources layer
- **FR-02**: The system must maintain a source registry (`sources/registry.json`) tracking all ingested sources with metadata: file path, hash, ingestion timestamp, status, generated wiki pages
- **FR-03**: Sources must be treated as immutable -- the tool must never modify files in the sources directory
- **FR-04**: Supported source formats: `.md`, `.txt`, `.pdf`, `.json`, `.csv`, `.png`, `.jpg`, `.jpeg`, `.webp` (images processed via LLM vision)
- **FR-05**: The system must detect duplicate sources by content hash and warn the user
- **FR-06**: The system must support re-ingesting an updated source (same path, different content), triggering wiki updates

### Ingest Operation

- **FR-07**: The `ingest` command must read the source document, generate a summary page in the wiki, and place it under `wiki/sources/`
- **FR-08**: During ingest, the system must identify entities (people, organizations, concepts, technologies, events) mentioned in the source and create or update dedicated entity pages under `wiki/entities/`
- **FR-09**: During ingest, the system must identify topics/concepts and create or update topic pages under `wiki/topics/`
- **FR-10**: During ingest, the system must update `wiki/index.md` with entries for all new or modified pages
- **FR-11**: During ingest, the system must append a structured log entry to `wiki/log.md`
- **FR-12**: During ingest, the system must insert cross-references (Obsidian wiki-links `[[PageName]]`) between related pages
- **FR-13**: When updating an existing wiki page, the system must preserve existing content and merge new information, noting contradictions explicitly with a `> [!warning] Contradiction` callout
- **FR-14**: Each wiki page must include YAML frontmatter with: `title`, `type` (source-summary | entity | topic | synthesis | comparison), `created`, `updated`, `sources` (list of source references), `tags`

### Query Operation

- **FR-15**: The `query` command must accept a natural-language question and search the wiki for relevant pages
- **FR-16**: Query must use `index.md` as the primary lookup mechanism to identify candidate pages
- **FR-17**: Query must read relevant wiki pages and synthesize an answer with citations in the format `[[PageName]]`
- **FR-18**: Query must output the answer to stdout in markdown format
- **FR-19**: Query must support a `--save` flag that files the answer as a new wiki page under `wiki/queries/` and updates the index

### Lint Operation

- **FR-20**: The `lint` command must scan the wiki for orphan pages (pages not referenced in `index.md` or by any other page)
- **FR-21**: Lint must detect broken wiki-links (references to pages that do not exist)
- **FR-22**: Lint must detect stale claims -- source-summary pages whose source file has been modified since last ingest (based on content hash comparison)
- **FR-23**: Lint must detect missing cross-references -- pages that mention entities/concepts that have dedicated pages but lack wiki-links
- **FR-24**: Lint must produce a structured report to stdout and optionally write it to `wiki/lint-report.md`
- **FR-25**: Lint must detect contradictions across pages (pages that assert conflicting facts about the same entity/topic)

### Index and Log

- **FR-26**: `index.md` must contain a categorized catalog of all wiki pages: link, one-line summary, type, last-updated date
- **FR-27**: `log.md` must be append-only with entries in the format: `[YYYY-MM-DD HH:mm] [ACTION] description` where ACTION is one of: `INGEST`, `UPDATE`, `QUERY`, `LINT`, `CREATE_PAGE`, `UPDATE_PAGE`, `DELETE_PAGE`
- **FR-28**: The CLI must provide a `status` command that shows wiki statistics: total pages by type, total sources, last ingest date, pending lint issues count

### Wiki Maintenance

- **FR-29**: The CLI must provide a `rebuild-index` command that regenerates `index.md` from scratch by scanning all wiki pages
- **FR-30**: The CLI must provide a `remove-source` command that removes a source and its associated summary page (with confirmation prompt), updates the index, and logs the action
- **FR-31**: The CLI must provide a `list-sources` command that displays all registered sources with their status

---

## Technical Requirements

- **TR-01**: Language: TypeScript (strict mode, ES2022+ target)
- **TR-02**: Runtime: Node.js LTS (>=20)
- **TR-03**: Package manager: npm
- **TR-04**: No fallback values for configuration -- missing required configuration must raise an exception with a clear error message
- **TR-05**: LLM integration via direct API calls (Anthropic SDK `@anthropic-ai/sdk`, Azure OpenAI SDK `@azure/openai`)
- **TR-06**: File I/O via Node.js `fs/promises` -- no database required
- **TR-07**: CLI framework: `commander` or `yargs`
- **TR-08**: PDF parsing: `pdf-parse` or equivalent
- **TR-09**: Content hashing: SHA-256 via Node.js `crypto`
- **TR-10**: YAML frontmatter parsing/generation: `gray-matter`
- **TR-11**: All tools documented in CLAUDE.md per project conventions
- **TR-12**: Test scripts placed in `test_scripts/` directory

---

## Architecture

### Three-Layer Structure

```
<wiki-root>/
  sources/                    # Layer 1: Raw Sources (immutable)
    registry.json             # Source metadata registry
    <source-files>            # Original documents (or symlinks)
  
  wiki/                       # Layer 2: The Wiki (LLM-owned)
    index.md                  # Content catalog
    log.md                    # Chronological action log
    sources/                  # Source summary pages
      summary-<source-name>.md
    entities/                 # Entity pages (people, orgs, tech)
      <entity-name>.md
    topics/                   # Topic/concept pages
      <topic-name>.md
    synthesis/                # Cross-cutting analysis pages
      <synthesis-name>.md
    queries/                  # Saved query results
      <query-title>.md
    lint-report.md            # Latest lint output
  
  schema/                     # Layer 3: The Schema (configuration)
    wiki-schema.md            # Structure & conventions for the LLM
    prompts/                  # Prompt templates for each operation
      ingest.md
      query.md
      lint.md
      update-page.md
      create-entity.md
      create-topic.md
  
  config.json                 # Tool configuration (API keys, model, etc.)
```

### Data Flow

1. **Ingest**: `source file` --> LLM reads source + schema + relevant existing pages --> LLM generates/updates wiki pages --> index and log updated
2. **Query**: `user question` --> LLM reads index.md --> LLM reads relevant wiki pages --> LLM synthesizes answer --> output (optionally saved)
3. **Lint**: CLI scans wiki file system --> structural checks (orphans, broken links) --> LLM checks for contradictions and missing links --> report generated

### LLM Interaction Model

- Each operation constructs a prompt from the schema templates, injecting relevant context (source content, existing pages, user question)
- The LLM returns structured output (JSON or markdown with frontmatter) that the CLI parses and writes to disk
- The CLI orchestrates multi-step workflows (e.g., ingest may require: summarize source --> identify entities --> update each entity page --> update index)
- Token budget management: the CLI must track approximate token usage and split large sources into chunks if they exceed the model's context window

---

## Core Operations - Detailed Specification

### Ingest

**Input**: Source file path (or directory)

**Steps**:
1. Validate source file exists and is a supported format
2. Compute SHA-256 hash; check against registry for duplicates
3. Register source in `sources/registry.json` with status `ingesting`
4. Read source content (text extraction for PDFs, base64 encoding for images)
5. Load wiki schema and ingest prompt template
6. Load `index.md` to provide LLM with current wiki context
7. Send to LLM: source content + schema + index + prompt asking for:
   - Source summary (markdown with frontmatter)
   - List of entities identified (name, type, brief description)
   - List of topics identified (name, brief description)
   - Suggested cross-references
8. Write source summary page to `wiki/sources/`
9. For each entity: check if page exists --> if yes, send existing page + new info to LLM for merge --> if no, create new page
10. For each topic: same as entities
11. Update `wiki/index.md` with new/modified page entries
12. Append log entries to `wiki/log.md`
13. Update source registry status to `ingested`

**Output**: Summary of actions taken (pages created, pages updated, entities found)

### Query

**Input**: Natural-language question string

**Steps**:
1. Load `wiki/index.md`
2. Send to LLM: question + index content + query prompt template
3. LLM returns list of relevant page paths
4. Read those wiki pages
5. Send to LLM: question + page contents + synthesis prompt
6. LLM returns answer in markdown with `[[wiki-link]]` citations
7. Output answer to stdout
8. If `--save` flag: write answer as new page under `wiki/queries/`, update index, append to log

**Output**: Markdown-formatted answer with citations

### Lint

**Input**: None (operates on entire wiki)

**Steps**:
1. Scan all `.md` files in `wiki/` directory tree
2. Parse each file: extract frontmatter, extract wiki-links
3. Structural checks:
   - Orphan detection: pages not in index and not linked from any other page
   - Broken link detection: wiki-links that reference non-existent pages
   - Stale source detection: compare source file hashes against registry
   - Frontmatter validation: ensure required fields present
4. Semantic checks (LLM-assisted):
   - Load entity/topic pages in batches
   - Ask LLM to identify contradictions and missing cross-references
5. Generate report with categorized findings (errors, warnings, suggestions)
6. Write report to stdout and optionally to `wiki/lint-report.md`

**Output**: Structured lint report

---

## Data Models

### Source Registry Entry (`sources/registry.json`)

```typescript
interface SourceEntry {
  id: string;                    // UUID
  filePath: string;              // Absolute or relative path to source file
  fileName: string;              // Original filename
  format: string;                // File extension
  contentHash: string;           // SHA-256 hash
  ingestedAt: string;            // ISO 8601 timestamp
  updatedAt: string;             // ISO 8601 timestamp
  status: 'pending' | 'ingesting' | 'ingested' | 'failed' | 'stale';
  generatedPages: string[];      // Relative paths to wiki pages created from this source
  metadata: Record<string, string>; // Optional user-provided metadata
}

interface SourceRegistry {
  sources: SourceEntry[];
  lastUpdated: string;           // ISO 8601 timestamp
}
```

### Wiki Page Frontmatter

```typescript
interface WikiPageFrontmatter {
  title: string;
  type: 'source-summary' | 'entity' | 'topic' | 'synthesis' | 'comparison' | 'query-result';
  created: string;               // ISO 8601
  updated: string;               // ISO 8601
  sources: string[];             // Source IDs or file references
  tags: string[];
  aliases?: string[];            // Alternative names (for Obsidian)
  status?: 'draft' | 'reviewed' | 'stable';
}
```

### Index Entry

```typescript
interface IndexEntry {
  path: string;                  // Relative path from wiki root
  title: string;
  type: string;
  summary: string;               // One-line description
  updated: string;               // ISO 8601
  tags: string[];
}
```

### Log Entry

```typescript
interface LogEntry {
  timestamp: string;             // ISO 8601
  action: 'INGEST' | 'UPDATE' | 'QUERY' | 'LINT' | 'CREATE_PAGE' | 'UPDATE_PAGE' | 'DELETE_PAGE';
  description: string;
  relatedPages?: string[];
  sourceId?: string;
}
```

### Configuration

```typescript
interface WikiConfig {
  llm: {
    provider: 'anthropic' | 'azure' | 'vertex';
    model: string;
    apiKey?: string;             // Can also come from env var
    azureEndpoint?: string;      // Required if provider is 'azure'
    azureDeployment?: string;    // Required if provider is 'azure'
    maxTokens: number;           // Max tokens per LLM call
  };
  wiki: {
    rootDir: string;             // Absolute path to wiki root directory
    sourcesDir: string;          // Relative to rootDir
    wikiDir: string;             // Relative to rootDir
    schemaDir: string;           // Relative to rootDir
  };
  obsidian: {
    enabled: boolean;            // Whether to generate Obsidian-compatible output
    vaultPath?: string;          // Path to Obsidian vault (if different from rootDir)
  };
}
```

---

## CLI Interface

```
wiki <command> [options]

Commands:
  wiki init                      Initialize a new wiki in the current directory
  wiki ingest <source>           Ingest a source file or directory into the wiki
  wiki query <question>          Query the wiki with a natural-language question
  wiki lint                      Run health checks on the wiki
  wiki status                    Show wiki statistics
  wiki list-sources              List all registered sources
  wiki remove-source <id|name>   Remove a source and its wiki pages
  wiki rebuild-index             Regenerate index.md from wiki pages

Global Options:
  --config <path>                Path to config.json (default: ./config.json)
  --verbose                      Enable verbose output
  --dry-run                      Show what would be done without making changes
  --help                         Show help
  --version                      Show version

Ingest Options:
  --recursive                    Scan directory recursively for source files
  --format <type>                Force source format (auto-detected by default)
  --tags <tags...>               Tags to apply to generated wiki pages
  --metadata <key=value...>      Additional metadata for the source

Query Options:
  --save                         Save the answer as a wiki page
  --pages <n>                    Maximum number of wiki pages to consult (default from config)

Lint Options:
  --fix                          Attempt to auto-fix issues (e.g., update broken links)
  --output <path>                Write report to file (default: stdout only)
  --category <type>              Only check specific category: orphans | links | stale | contradictions
```

---

## Configuration

Configuration is loaded from `config.json` at the wiki root directory. There are **no fallback values** -- all required fields must be present or the CLI raises an exception.

### Configuration Sources (Priority Order)

1. **CLI arguments** (highest priority) -- `--config` overrides config file path
2. **Environment variables** -- `WIKI_LLM_PROVIDER`, `WIKI_LLM_API_KEY`, `WIKI_LLM_MODEL`, `WIKI_AZURE_ENDPOINT`, `WIKI_AZURE_DEPLOYMENT`
3. **Config file** (`config.json`) -- lowest priority

### Required Configuration

| Parameter | Env Variable | Purpose | Notes |
|-----------|-------------|---------|-------|
| `llm.provider` | `WIKI_LLM_PROVIDER` | LLM API provider | `anthropic`, `azure`, or `vertex` |
| `llm.model` | `WIKI_LLM_MODEL` | Model identifier | e.g., `claude-sonnet-4-20250514` |
| `llm.apiKey` | `WIKI_LLM_API_KEY` | API authentication key | Store in env var, not config file. Consider adding `llm.apiKeyExpiry` (ISO 8601) for proactive renewal warnings. |
| `llm.maxTokens` | `WIKI_LLM_MAX_TOKENS` | Max tokens per LLM request | Integer |
| `wiki.rootDir` | `WIKI_ROOT_DIR` | Wiki root directory path | Absolute path |

### Conditional Configuration

| Parameter | Env Variable | Required When | Purpose |
|-----------|-------------|---------------|---------|
| `llm.azureEndpoint` | `WIKI_AZURE_ENDPOINT` | provider = `azure` | Azure OpenAI endpoint URL |
| `llm.azureDeployment` | `WIKI_AZURE_DEPLOYMENT` | provider = `azure` | Azure deployment name |

### Optional Configuration

| Parameter | Purpose | Notes |
|-----------|---------|-------|
| `llm.apiKeyExpiry` | Proactive renewal warning | ISO 8601 date; CLI warns if within 7 days of expiry |
| `obsidian.enabled` | Obsidian compatibility mode | Enables wiki-link syntax, aliases in frontmatter |
| `obsidian.vaultPath` | Obsidian vault location | Only if wiki is inside a larger vault |

---

## Integration Points

### Obsidian Compatibility

- Wiki-link syntax: `[[PageName]]` and `[[PageName|Display Text]]`
- YAML frontmatter with `aliases` field for alternative page names
- Tags in frontmatter for Obsidian tag navigation
- Dataview-compatible frontmatter fields (all typed correctly)
- File naming: kebab-case with no special characters (Obsidian-safe)
- All internal links use relative paths from wiki root

### Git Integration

- The wiki root should be a git repository (user's responsibility to initialize)
- The `ingest` command should output a suggested commit message after completing
- The `lint` command can detect uncommitted changes as a health indicator
- `.gitignore` should exclude: `config.json` (contains API keys if not using env vars), any temp/cache files

### Search (Future)

- `index.md` is structured to be machine-parseable for future search tool integration
- Page frontmatter includes all fields needed for faceted search
- File naming conventions support glob-based searching

---

## Acceptance Criteria

### Init

- [ ] `wiki init` creates the full directory structure (sources/, wiki/, schema/) with template files
- [ ] `wiki init` generates a default `config.json` with all required fields set to empty strings and clear comments
- [ ] `wiki init` generates a default `schema/wiki-schema.md` with structure conventions
- [ ] `wiki init` generates prompt templates in `schema/prompts/`
- [ ] Running `wiki init` in an existing wiki directory warns and does not overwrite

### Ingest

- [ ] `wiki ingest path/to/article.md` creates a source summary page in `wiki/sources/`
- [ ] Entities mentioned in the source get dedicated pages in `wiki/entities/`
- [ ] Topics mentioned in the source get dedicated pages in `wiki/topics/`
- [ ] `wiki/index.md` is updated with all new pages
- [ ] `wiki/log.md` has a timestamped entry for the ingest action
- [ ] `sources/registry.json` contains the new source with correct hash and status
- [ ] Re-ingesting the same unchanged source shows "already ingested" message
- [ ] Re-ingesting a modified source updates affected wiki pages
- [ ] Cross-references between pages use `[[wiki-link]]` syntax
- [ ] All generated pages have valid YAML frontmatter

### Query

- [ ] `wiki query "What is X?"` returns a markdown answer citing wiki pages
- [ ] `wiki query --save "What is X?"` creates a page in `wiki/queries/` and updates the index
- [ ] Query with no relevant pages returns "No relevant information found in the wiki"

### Lint

- [ ] `wiki lint` detects orphan pages not in index
- [ ] `wiki lint` detects broken `[[wiki-links]]`
- [ ] `wiki lint` detects sources modified since last ingest
- [ ] `wiki lint` detects missing frontmatter fields
- [ ] `wiki lint --fix` repairs broken links where possible
- [ ] Report categorizes findings by severity (error, warning, suggestion)

### Configuration

- [ ] Missing required config field raises an exception with the field name
- [ ] Environment variables override config file values
- [ ] CLI arguments override environment variables
- [ ] API key expiry warning appears when key is within 7 days of expiry

### General

- [ ] All CLI commands show help with `--help`
- [ ] `--dry-run` shows planned actions without modifying any files
- [ ] `--verbose` provides detailed progress output
- [ ] Tool is documented in CLAUDE.md per project conventions

---

## Open Questions

1. **LLM Provider Priority**: Should the initial implementation support all three providers (Anthropic, Azure, Vertex) or start with Anthropic only and add others incrementally?

2. **Source Storage Strategy**: Should sources be copied into the `sources/` directory, or should the registry simply track their original paths (with the risk of sources being moved/deleted)?

3. **Chunking Strategy**: For large sources that exceed the LLM context window, what chunking strategy should be used? Options: fixed token count, section-based (for markdown), page-based (for PDFs).

4. **Concurrent Ingest**: Should `wiki ingest` support ingesting multiple sources in parallel, or is sequential processing sufficient for the first version?

5. **Schema Evolution**: How should the schema document (`wiki-schema.md`) be versioned? If the user changes the schema, should existing pages be re-processed?

6. **Page Naming Conflicts**: What happens when two different entities have the same name? Options: disambiguation suffix (e.g., `mercury-planet.md` vs `mercury-element.md`), subdirectories by entity type.

7. **Image Source Handling**: For image sources processed via LLM vision, should the image be embedded in the summary page (as a relative link), or only described textually?

8. **Token Budget Per Operation**: What is the expected token budget per ingest operation? A single source touching 10-15 pages could require multiple LLM calls. Should there be a configurable limit on LLM calls per ingest?

9. **Wiki Page Size Limit**: Should there be a maximum page size? Entity pages that accumulate information from many sources could grow very large. Should the system split them?

10. **Offline Mode**: Should the `lint` structural checks (orphans, broken links, stale sources) work without an LLM connection, with only the semantic checks (contradictions) requiring the LLM?
