# LLM Wiki - Technical Design

**Version**: 1.0
**Date**: 2026-04-09
**Status**: Final Draft

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Source File Structure](#2-source-file-structure)
3. [Module Specifications](#3-module-specifications)
   - 3.1 [Entry Point: cli.ts](#31-entry-point-clits)
   - 3.2 [Configuration Module](#32-configuration-module)
   - 3.3 [LLM Provider Module](#33-llm-provider-module)
   - 3.4 [Wiki Module](#34-wiki-module)
   - 3.5 [Source Module](#35-source-module)
   - 3.6 [Ingest Module](#36-ingest-module)
   - 3.7 [Query Module](#37-query-module)
   - 3.8 [Lint Module](#38-lint-module)
   - 3.9 [Command Modules](#39-command-modules)
   - 3.10 [Utility Modules](#310-utility-modules)
   - 3.11 [Template Files](#311-template-files)
4. [Data Flow Diagrams](#4-data-flow-diagrams)
5. [Interface Contracts](#5-interface-contracts)
6. [Configuration Design](#6-configuration-design)
7. [Prompt Template Design](#7-prompt-template-design)
8. [Error Handling Strategy](#8-error-handling-strategy)
9. [Testing Strategy](#9-testing-strategy)
10. [Dependencies](#10-dependencies)
11. [Mailbox Ingest Feature (mail-check command)](#mailbox-ingest-feature-mail-check-command)
    - MI-1. [Overview](#mi-1-overview)
    - MI-2. [System Architecture](#mi-2-system-architecture)
    - MI-3. [Component Diagram](#mi-3-component-diagram)
    - MI-4. [Data Models](#mi-4-data-models)
    - MI-5. [Module Design](#mi-5-module-design)
    - MI-6. [Configuration Validation Rules](#mi-6-configuration-validation-rules)
    - MI-7. [Error Handling Strategy](#mi-7-error-handling-strategy)
    - MI-8. [File Naming Conventions](#mi-8-file-naming-conventions)
    - MI-9. [Integration with IngestPipeline](#mi-9-integration-with-ingestpipeline)
    - MI-10. [CLI Registration](#mi-10-cli-registration)
    - MI-11. [New npm Dependencies](#mi-11-new-npm-dependencies)
    - MI-12. [Files to Create and Modify](#mi-12-files-to-create-and-modify)
    - MI-13. [Testing Strategy](#mi-13-testing-strategy)
    - MI-14. [Configuration Example](#mi-14-configuration-example)
    - MI-15. [Architecture Decisions](#mi-15-architecture-decisions)

---

## 1. Architecture Overview

LLM Wiki is a TypeScript CLI tool that builds a persistent, interlinked markdown knowledge base from raw source documents using LLMs. It follows a three-layer architecture:

```
Layer 1: Sources (immutable raw documents)
Layer 2: Wiki (LLM-generated/maintained markdown pages)
Layer 3: Schema (configuration, prompt templates, conventions)
```

### Runtime Directory Structure

```
<wiki-root>/
  sources/
    registry.json               # Source metadata registry
  wiki/
    index.md                    # Categorized page catalog
    log.md                      # Append-only action log
    sources/                    # Source summary pages
    entities/                   # Entity pages (people, orgs, tech)
    topics/                     # Topic/concept pages
    synthesis/                  # Cross-cutting analysis
    queries/                    # Saved query results
    lint-report.md              # Latest lint output
  schema/
    wiki-schema.md              # Structure conventions for LLM
    prompts/                    # Prompt templates
      ingest.md
      query.md
      lint.md
      update-page.md
      create-entity.md
      create-topic.md
  config.json                   # Tool configuration
  .gitignore
```

### Technology Stack

| Concern | Technology | Rationale |
|---------|-----------|-----------|
| Language | TypeScript (strict, ES2022) | Project convention |
| Runtime | Node.js >= 20 LTS | Required by dependencies |
| CLI framework | commander | Clean subcommand model, TS support, used by sibling Gitter project |
| LLM client | @anthropic-ai/sdk | Primary provider, tool use for structured output |
| Frontmatter | gray-matter + js-yaml | De facto standard; JSON_SCHEMA prevents date coercion |
| PDF extraction | pdf-parse (or @cedrugs/pdf-parse) | Simple API, lightweight, TS types available |
| Content hashing | Node.js crypto (built-in) | SHA-256, no external dependency |
| Package manager | npm | Project convention |

---

## 2. Source File Structure

```
src/
  cli.ts                        # Entry point, commander setup, global options
  commands/
    init.ts                     # wiki init -- create directory structure and templates
    ingest.ts                   # wiki ingest <source> -- ingest pipeline orchestration
    query.ts                    # wiki query <question> -- query pipeline orchestration
    lint.ts                     # wiki lint -- structural and semantic checks
    status.ts                   # wiki status -- wiki statistics display
    list-sources.ts             # wiki list-sources -- display registered sources
    remove-source.ts            # wiki remove-source <id|name> -- remove source and pages
    rebuild-index.ts            # wiki rebuild-index -- regenerate index.md
  config/
    types.ts                    # WikiConfig, LLMConfig, WikiPaths, ObsidianConfig interfaces
    loader.ts                   # Load config from file, merge env vars, CLI overrides
    validator.ts                # Validate required fields, conditional fields, API key expiry
  llm/
    types.ts                    # CompletionParams, CompletionResult, ToolCompletionParams, etc.
    provider.ts                 # LLMProvider interface definition
    anthropic.ts                # AnthropicProvider implementation
    azure.ts                    # AzureAIProvider implementation (Azure AI Inference)
    vertex.ts                   # VertexAIProvider implementation (Google Vertex AI / Gemini)
    factory.ts                  # createProvider() factory function
    tools.ts                    # Tool definitions for structured extraction
    retry.ts                    # callWithRetry() with exponential backoff
    tokens.ts                   # Heuristic token estimation, PromptBudgetAnalyzer
  wiki/
    frontmatter.ts              # gray-matter wrapper with JSON_SCHEMA, parse/stringify
    wikilinks.ts                # Wiki-link extraction, generation, validation
    pages.ts                    # Page CRUD: create, read, update, list wiki pages
    registry.ts                 # SourceRegistry class: load/save/CRUD sources/registry.json
    index-manager.ts            # IndexManager: read/write/update/regenerate wiki/index.md
    log.ts                      # LogWriter: append-only log entries to wiki/log.md
  source/
    reader.ts                   # Read source files by format (text, PDF, image, data)
    hasher.ts                   # SHA-256 content hashing
    chunker.ts                  # Section-aware content chunking with token budget
  ingest/
    pipeline.ts                 # IngestPipeline: multi-step orchestration
    summarizer.ts               # Step 1: LLM source summarization
    extractor.ts                # Step 2: LLM entity/topic extraction via tool use
    merger.ts                   # Step 3: LLM page merge/creation
    cross-referencer.ts          # Step 4: Programmatic wiki-link insertion
  query/
    pipeline.ts                 # QueryPipeline: index lookup -> page read -> LLM synthesis
  lint/
    structural.ts               # Orphan, broken link, stale source, frontmatter checks
    semantic.ts                 # LLM-powered contradiction and missing link detection
    report.ts                   # Report formatter (error/warning/suggestion categories)
    fixer.ts                    # Auto-fix logic for --fix flag
  utils/
    logger.ts                   # Logger with verbose/quiet modes
    naming.ts                   # toKebabCase(), toWikiSlug(), sanitizeFilename()
    tokens.ts                   # Heuristic token estimation, PromptBudgetAnalyzer
    usage-tracker.ts            # UsageTracker: cumulative token accounting across LLM calls
  templates/
    config-template.json        # Default config.json with empty required fields
    wiki-schema.md              # Default schema document
    prompts/
      ingest.md                 # Prompt template for source ingestion
      query.md                  # Prompt template for query synthesis
      lint.md                   # Prompt template for contradiction detection
      update-page.md            # Prompt template for merging info into existing page
      create-entity.md          # Prompt template for creating entity page
      create-topic.md           # Prompt template for creating topic page
```

### File Responsibility Summary

Every file has a single, clear responsibility. The boundary rule is: **no file imports from the same directory except for types files**. Cross-module communication happens through interfaces defined in each module's types or the provider interface.

---

## 3. Module Specifications

### 3.1 Entry Point: cli.ts

**File**: `src/cli.ts`
**Responsibility**: Commander program setup, global options, command registration.

```typescript
// Exported for testing
export function createProgram(): Command;
```

**Dependencies**: `commander`, all `src/commands/*` modules

**Implementation Details**:
- Creates the `program` object with name `wiki`, version from `package.json`, description
- Registers global options: `--config <path>`, `--verbose`, `--dry-run`
- Uses `program.hook('preAction')` to load and validate configuration before any command runs
- Stores validated config on `program` via `program.setOptionValue('_config', config)`
- Registers each command by importing from `src/commands/`
- Calls `program.parse(process.argv)`

**Global Options**:
| Option | Type | Description |
|--------|------|-------------|
| `--config <path>` | string | Path to config.json (resolved from CWD) |
| `--verbose` | boolean | Enable verbose logging |
| `--dry-run` | boolean | Show planned actions without modifying files |
| `--version` | flag | Show version |
| `--help` | flag | Show help |

---

### 3.2 Configuration Module

#### 3.2.1 `src/config/types.ts`

**Responsibility**: Type definitions for all configuration structures.

```typescript
export interface LLMConfig {
  provider: 'anthropic' | 'azure' | 'vertex';
  model: string;
  apiKey: string;
  apiKeyExpiry?: string;          // ISO 8601 date; warn if within 7 days
  azureEndpoint?: string;         // Required when provider = 'azure'
  azureDeployment?: string;       // Required when provider = 'azure'
  maxTokens: number;              // Max output tokens per LLM call
}

export interface WikiPaths {
  rootDir: string;                // Absolute path to wiki root
  sourcesDir: string;             // Relative to rootDir (default: 'sources')
  wikiDir: string;                // Relative to rootDir (default: 'wiki')
  schemaDir: string;              // Relative to rootDir (default: 'schema')
}

export interface ObsidianConfig {
  enabled: boolean;
  vaultPath?: string;             // Path to Obsidian vault if different from rootDir
}

export interface WikiConfig {
  llm: LLMConfig;
  wiki: WikiPaths;
  obsidian: ObsidianConfig;
}

export class ConfigurationError extends Error {
  constructor(public readonly field: string, message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}
```

**Dependencies**: None (pure types)

#### 3.2.2 `src/config/loader.ts`

**Responsibility**: Load configuration from file, merge environment variables and CLI overrides. No fallback values -- missing required fields throw `ConfigurationError`.

```typescript
export async function loadConfig(options: {
  configPath?: string;   // From --config CLI option
  cliOverrides?: Partial<WikiConfig>;
}): Promise<WikiConfig>;
```

**Dependencies**: `fs/promises`, `path`, `./types`, `./validator`

**Implementation Details**:
- Resolves config file path: CLI `--config` argument, or `<cwd>/config.json`
- Reads and parses JSON file; throws `ConfigurationError` if file not found
- Applies environment variable overrides (see mapping table below)
- Applies CLI argument overrides (highest priority)
- Calls `validateConfig()` before returning
- **No default values anywhere** -- every required field must be explicitly provided

**Environment Variable Mapping**:

| Environment Variable | Config Field | Type |
|---------------------|-------------|------|
| `WIKI_LLM_PROVIDER` | `llm.provider` | string |
| `WIKI_LLM_MODEL` | `llm.model` | string |
| `WIKI_LLM_API_KEY` | `llm.apiKey` | string |
| `WIKI_LLM_MAX_TOKENS` | `llm.maxTokens` | number (parsed from string) |
| `WIKI_ROOT_DIR` | `wiki.rootDir` | string |
| `WIKI_AZURE_ENDPOINT` | `llm.azureEndpoint` | string |
| `WIKI_AZURE_DEPLOYMENT` | `llm.azureDeployment` | string |

**Priority Order**: CLI arguments > environment variables > config.json

#### 3.2.3 `src/config/validator.ts`

**Responsibility**: Validate all config fields. Throw `ConfigurationError` with field name on any missing required field.

```typescript
export function validateConfig(config: Partial<WikiConfig>): WikiConfig;
export function checkApiKeyExpiry(config: WikiConfig): void;
```

**Dependencies**: `./types`

**Implementation Details**:
- `validateConfig()`:
  - Checks all required fields: `llm.provider`, `llm.model`, `llm.apiKey`, `llm.maxTokens`, `wiki.rootDir`
  - Checks conditional fields: if `llm.provider === 'azure'`, requires `llm.azureEndpoint` and `llm.azureDeployment`
  - Validates `llm.provider` is one of `'anthropic' | 'azure' | 'vertex'`
  - Validates `llm.maxTokens` is a positive integer
  - Validates `wiki.rootDir` is an absolute path
  - Throws `ConfigurationError` with the field name for any violation
- `checkApiKeyExpiry()`:
  - If `llm.apiKeyExpiry` is set, parse as ISO 8601 date
  - If within 7 days of expiry, print warning to stderr
  - If already expired, print error to stderr (but do not throw -- user may want to continue)

---

### 3.3 LLM Provider Module

#### 3.3.1 `src/llm/types.ts`

**Responsibility**: Shared types for LLM interactions.

```typescript
export interface CompletionParams {
  system: string;
  messages: MessageParam[];
  maxTokens: number;
  temperature?: number;
}

export interface MessageParam {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

export interface ContentBlock {
  type: 'text' | 'image';
  text?: string;
  source?: {
    type: 'base64';
    media_type: string;
    data: string;
  };
}

export interface CompletionResult {
  text: string;
  usage: TokenUsage;
  stopReason: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ToolCompletionParams extends CompletionParams {
  tools: ToolDefinition[];
  toolChoice: { type: 'tool'; name: string } | { type: 'auto' };
}

export interface ToolCompletionResult {
  toolName: string;
  toolInput: Record<string, unknown>;
  usage: TokenUsage;
  stopReason: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

export interface TokenCountResult {
  inputTokens: number;
}
```

**Dependencies**: None (pure types)

#### 3.3.2 `src/llm/provider.ts`

**Responsibility**: Abstract interface for LLM providers.

```typescript
export interface LLMProvider {
  /**
   * Send a completion request and return text output.
   * Used for summary generation, page merging, query synthesis.
   */
  complete(params: CompletionParams): Promise<CompletionResult>;

  /**
   * Send a completion request with tool definitions, forcing structured JSON output.
   * Used for entity/topic extraction.
   */
  completeWithTools(params: ToolCompletionParams): Promise<ToolCompletionResult>;

  /**
   * Count tokens for a prompt without executing it. Free API call.
   * Used for pre-call budget verification near context limits.
   */
  countTokens(params: Omit<CompletionParams, 'maxTokens'>): Promise<TokenCountResult>;
}
```

**Dependencies**: `./types`

#### 3.3.3 `src/llm/anthropic.ts`

**Responsibility**: Anthropic SDK implementation of `LLMProvider`.

```typescript
export class AnthropicProvider implements LLMProvider {
  constructor(config: LLMConfig);
  complete(params: CompletionParams): Promise<CompletionResult>;
  completeWithTools(params: ToolCompletionParams): Promise<ToolCompletionResult>;
  countTokens(params: Omit<CompletionParams, 'maxTokens'>): Promise<TokenCountResult>;
}
```

**Dependencies**: `@anthropic-ai/sdk`, `./types`, `./provider`, `./retry`, `../config/types`

**Implementation Details**:
- Constructor creates `new Anthropic({ apiKey: config.apiKey })`
- `complete()`: Calls `client.messages.create()`, extracts text from `TextBlock` content blocks, returns `CompletionResult` with usage mapped from SDK response
- `completeWithTools()`: Calls `client.messages.create()` with `tools` and `tool_choice`, finds `ToolUseBlock` in response, returns parsed `toolInput` JSON
- `countTokens()`: Calls `client.messages.countTokens()` with same payload shape, returns `{ inputTokens }`
- All methods wrapped in `callWithRetry()` from `./retry`
- Non-streaming for all operations

#### 3.3.4 `src/llm/factory.ts`

**Responsibility**: Factory function that creates the appropriate provider based on config.

```typescript
export function createProvider(config: LLMConfig): LLMProvider;
```

**Dependencies**: `./anthropic`, `./azure`, `./vertex`, `../config/types`

**Implementation Details**:
- `provider === 'anthropic'`: Returns `new AnthropicProvider(config)`
- `provider === 'azure'`: Returns `new AzureAIProvider(config)`
- `provider === 'vertex'`: Returns `new VertexAIProvider(config)`

#### 3.3.5 `src/llm/tools.ts`

**Responsibility**: Tool definitions used for structured extraction during ingest.

```typescript
export const EXTRACT_ENTITIES_TOOL: ToolDefinition;
export const SELECT_PAGES_TOOL: ToolDefinition;
export const IDENTIFY_CONTRADICTIONS_TOOL: ToolDefinition;

// Typed interfaces for tool outputs
export interface ExtractedEntity {
  name: string;
  type: 'person' | 'organization' | 'technology' | 'concept' | 'event' | 'place';
  description: string;
  relevance: 'primary' | 'secondary' | 'mentioned';
}

export interface ExtractedTopic {
  name: string;
  description: string;
  relatedEntities: string[];
}

export interface CrossReference {
  from: string;
  to: string;
  relationship: string;
}

export interface ExtractionResult {
  entities: ExtractedEntity[];
  topics: ExtractedTopic[];
  crossReferences: CrossReference[];
}

export interface PageSelection {
  pages: Array<{
    path: string;
    relevance: string;
  }>;
}

export interface ContradictionResult {
  contradictions: Array<{
    page1: string;
    page2: string;
    claim1: string;
    claim2: string;
    explanation: string;
  }>;
  missingLinks: Array<{
    page: string;
    mentionedEntity: string;
    suggestedLink: string;
  }>;
}
```

**Dependencies**: `./types`

**Tool Schema Details**:

`EXTRACT_ENTITIES_TOOL`:
```json
{
  "name": "extract_entities",
  "description": "Extract entities, topics, and cross-references from a source document",
  "input_schema": {
    "type": "object",
    "properties": {
      "entities": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "name": { "type": "string" },
            "type": { "type": "string", "enum": ["person", "organization", "technology", "concept", "event", "place"] },
            "description": { "type": "string" },
            "relevance": { "type": "string", "enum": ["primary", "secondary", "mentioned"] }
          },
          "required": ["name", "type", "description", "relevance"]
        }
      },
      "topics": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "name": { "type": "string" },
            "description": { "type": "string" },
            "relatedEntities": { "type": "array", "items": { "type": "string" } }
          },
          "required": ["name", "description"]
        }
      },
      "crossReferences": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "from": { "type": "string" },
            "to": { "type": "string" },
            "relationship": { "type": "string" }
          },
          "required": ["from", "to", "relationship"]
        }
      }
    },
    "required": ["entities", "topics", "crossReferences"]
  }
}
```

`SELECT_PAGES_TOOL`:
```json
{
  "name": "select_relevant_pages",
  "description": "Select wiki pages relevant to answering a user question",
  "input_schema": {
    "type": "object",
    "properties": {
      "pages": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "path": { "type": "string" },
            "relevance": { "type": "string" }
          },
          "required": ["path", "relevance"]
        }
      }
    },
    "required": ["pages"]
  }
}
```

`IDENTIFY_CONTRADICTIONS_TOOL`:
```json
{
  "name": "identify_contradictions",
  "description": "Identify contradictions and missing cross-references across wiki pages",
  "input_schema": {
    "type": "object",
    "properties": {
      "contradictions": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "page1": { "type": "string" },
            "page2": { "type": "string" },
            "claim1": { "type": "string" },
            "claim2": { "type": "string" },
            "explanation": { "type": "string" }
          },
          "required": ["page1", "page2", "claim1", "claim2", "explanation"]
        }
      },
      "missingLinks": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "page": { "type": "string" },
            "mentionedEntity": { "type": "string" },
            "suggestedLink": { "type": "string" }
          },
          "required": ["page", "mentionedEntity", "suggestedLink"]
        }
      }
    },
    "required": ["contradictions", "missingLinks"]
  }
}
```

#### 3.3.6 `src/llm/retry.ts`

**Responsibility**: Retry wrapper with exponential backoff for transient LLM errors.

```typescript
export async function callWithRetry<T>(
  fn: () => Promise<T>,
  options?: RetryOptions
): Promise<T>;

export interface RetryOptions {
  maxRetries: number;       // Default: 3
  initialDelayMs: number;   // Default: 1000
  maxDelayMs: number;       // Default: 30000
  backoffFactor: number;    // Default: 2
}
```

**Dependencies**: `@anthropic-ai/sdk` (for error type checking)

**Implementation Details**:
- Retryable errors: `Anthropic.RateLimitError` (429), `Anthropic.APIError` with status >= 500
- Non-retryable (fail fast): `Anthropic.AuthenticationError` (401), `Anthropic.BadRequestError` (400)
- Backoff formula: `min(initialDelayMs * backoffFactor^attempt, maxDelayMs)`
- Logs retry attempts when verbose mode is active

---

### 3.4 Wiki Module

#### 3.4.1 `src/wiki/frontmatter.ts`

**Responsibility**: Parse and stringify YAML frontmatter using gray-matter with JSON_SCHEMA to prevent date coercion.

```typescript
export interface WikiPageFrontmatter {
  title: string;
  type: 'source-summary' | 'entity' | 'topic' | 'synthesis' | 'comparison' | 'query-result';
  created: string;             // ISO 8601 string (not Date object)
  updated: string;             // ISO 8601 string
  sources: string[];           // Source IDs or file references
  tags: string[];
  aliases?: string[];          // Alternative names for Obsidian
  status?: 'draft' | 'reviewed' | 'stable';
}

export interface ParsedPage {
  frontmatter: WikiPageFrontmatter;
  content: string;             // Markdown body after frontmatter
  raw: string;                 // Original raw text
}

export function parsePage(raw: string): ParsedPage;
export function stringifyPage(frontmatter: WikiPageFrontmatter, content: string): string;
export function updateFrontmatter(raw: string, updates: Partial<WikiPageFrontmatter>): string;
```

**Dependencies**: `gray-matter`, `js-yaml`

**Implementation Details**:
- All gray-matter calls use custom engine with `yaml.JSON_SCHEMA` to prevent YAML date auto-coercion
- `parsePage()`: Parses raw markdown, returns structured object with frontmatter as typed interface
- `stringifyPage()`: Creates markdown string with YAML frontmatter block and body
- `updateFrontmatter()`: Parses existing page, merges updates into frontmatter, preserves body content exactly
- Uses `yaml.dump()` with `{ schema: yaml.JSON_SCHEMA, lineWidth: -1, quotingType: '"', forceQuotes: false }`
- All dates stored as quoted ISO 8601 strings: `"2026-04-09T14:30:00Z"`

**gray-matter Engine Configuration** (used in all parse/stringify calls):
```typescript
const GRAY_MATTER_OPTIONS = {
  engines: {
    yaml: {
      parse: (str: string) => yaml.load(str, { schema: yaml.JSON_SCHEMA }) as object,
      stringify: (obj: object) => yaml.dump(obj, {
        schema: yaml.JSON_SCHEMA,
        lineWidth: -1,
        quotingType: '"' as const,
        forceQuotes: false,
      }),
    },
  },
};
```

#### 3.4.2 `src/wiki/wikilinks.ts`

**Responsibility**: Extract, generate, and validate Obsidian wiki-links.

```typescript
export interface WikiLink {
  target: string;              // Page name (e.g., "Machine Learning")
  displayText?: string;        // Optional display text after pipe
  raw: string;                 // Original match (e.g., "[[Machine Learning|ML]]")
}

export function extractWikiLinks(content: string): WikiLink[];
export function generateWikiLink(target: string, displayText?: string): string;
export function validateWikiLinks(
  content: string,
  existingPages: Set<string>
): { valid: WikiLink[]; broken: WikiLink[] };
export function insertWikiLinks(
  content: string,
  entityNames: string[],
  existingPages: Set<string>
): string;
```

**Dependencies**: None (pure string operations)

**Implementation Details**:
- Extraction regex: `/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g`
- `extractWikiLinks()`: Returns all `[[Target]]` and `[[Target|Display]]` matches with position info
- `generateWikiLink()`: Creates `[[target]]` or `[[target|displayText]]` string
- `validateWikiLinks()`: Checks each extracted link target against the set of existing page names (case-insensitive comparison)
- `insertWikiLinks()`: Scans content for entity name mentions that are not already wiki-linked, wraps them in `[[...]]`. Only links first occurrence per entity per section to avoid over-linking.

#### 3.4.3 `src/wiki/pages.ts`

**Responsibility**: CRUD operations for wiki pages on disk.

```typescript
export class PageManager {
  constructor(wikiDir: string);

  /** Read a wiki page, returning parsed frontmatter and content */
  readPage(relativePath: string): Promise<ParsedPage | null>;

  /** Write a wiki page with frontmatter and content */
  writePage(relativePath: string, frontmatter: WikiPageFrontmatter, content: string): Promise<void>;

  /** List all .md files in the wiki directory tree */
  listPages(): Promise<string[]>;

  /** List pages by type (subdirectory) */
  listPagesByType(type: 'sources' | 'entities' | 'topics' | 'synthesis' | 'queries'): Promise<string[]>;

  /** Check if a page exists */
  pageExists(relativePath: string): Promise<boolean>;

  /** Delete a page */
  deletePage(relativePath: string): Promise<void>;

  /** Get a set of all page names (stems) for wiki-link validation */
  getAllPageNames(): Promise<Set<string>>;
}
```

**Dependencies**: `fs/promises`, `path`, `./frontmatter`, `../utils/naming`

**Implementation Details**:
- All page paths are relative to the `wikiDir` root
- File naming enforced via `toKebabCase()` from naming utils
- `writePage()` creates parent directories if they do not exist
- `readPage()` returns `null` if file does not exist (does not throw)
- `getAllPageNames()` returns lowercase page stems for case-insensitive link matching

#### 3.4.4 `src/wiki/registry.ts`

**Responsibility**: CRUD operations for the source registry (`sources/registry.json`).

```typescript
export interface SourceEntry {
  id: string;                    // UUID v4
  filePath: string;              // Absolute path to source file
  fileName: string;              // Original filename
  format: string;                // File extension (e.g., '.md', '.pdf')
  contentHash: string;           // SHA-256 hex digest
  ingestedAt: string;            // ISO 8601 timestamp
  updatedAt: string;             // ISO 8601 timestamp
  status: 'pending' | 'ingesting' | 'ingested' | 'failed' | 'stale';
  generatedPages: string[];      // Relative paths to wiki pages created from this source
  metadata: Record<string, string>;  // User-provided metadata
  tags: string[];                // User-provided tags from --tags
}

export interface SourceRegistry {
  sources: SourceEntry[];
  lastUpdated: string;           // ISO 8601 timestamp
}

export class SourceRegistryManager {
  constructor(registryPath: string);

  /** Load registry from disk */
  load(): Promise<SourceRegistry>;

  /** Save registry to disk */
  save(registry: SourceRegistry): Promise<void>;

  /** Add a new source entry */
  addSource(entry: Omit<SourceEntry, 'id'>): Promise<SourceEntry>;

  /** Find source by file path */
  findByPath(filePath: string): Promise<SourceEntry | null>;

  /** Find source by content hash */
  findByHash(hash: string): Promise<SourceEntry | null>;

  /** Find source by ID or filename substring */
  findByIdOrName(query: string): Promise<SourceEntry | null>;

  /** Update source entry fields */
  updateSource(id: string, updates: Partial<SourceEntry>): Promise<void>;

  /** Remove source entry */
  removeSource(id: string): Promise<SourceEntry>;

  /** Get all sources */
  getAllSources(): Promise<SourceEntry[]>;

  /** Get sources by status */
  getSourcesByStatus(status: SourceEntry['status']): Promise<SourceEntry[]>;
}
```

**Dependencies**: `fs/promises`, `crypto` (for UUID generation), `path`

**Implementation Details**:
- Registry file: `<rootDir>/sources/registry.json`
- Uses `crypto.randomUUID()` for ID generation
- `addSource()` checks for duplicates by hash before adding
- `save()` writes atomically: write to temp file, then rename
- All timestamps are ISO 8601 strings
- File locking: not implemented in v1 (sequential processing assumption)

#### 3.4.5 `src/wiki/index-manager.ts`

**Responsibility**: Read, write, update, and regenerate `wiki/index.md`.

```typescript
export interface IndexEntry {
  path: string;                  // Relative path from wiki root
  title: string;
  type: string;
  summary: string;               // One-line description
  updated: string;               // ISO 8601
  tags: string[];
}

export class IndexManager {
  constructor(indexPath: string);

  /** Parse index.md into structured entries */
  readIndex(): Promise<IndexEntry[]>;

  /** Write index.md from structured entries */
  writeIndex(entries: IndexEntry[]): Promise<void>;

  /** Add or update an entry (match by path) */
  upsertEntry(entry: IndexEntry): Promise<void>;

  /** Remove an entry by path */
  removeEntry(path: string): Promise<void>;

  /** Regenerate index from a full page scan */
  regenerateFromPages(pages: ParsedPage[], paths: string[]): Promise<void>;
}
```

**Dependencies**: `fs/promises`, `path`, `./frontmatter`

**Implementation Details**:
- Index format is a markdown document with categorized sections (Source Summaries, Entities, Topics, Synthesis, Queries)
- Each section contains a markdown table: `| Link | Summary | Type | Updated | Tags |`
- Links use wiki-link format: `[[page-name]]`
- `readIndex()` parses the markdown table rows back into `IndexEntry[]`
- `upsertEntry()` finds existing entry by path and replaces, or appends to the appropriate section
- `regenerateFromPages()` builds the entire index from scratch by reading frontmatter of all wiki pages
- Entries sorted alphabetically within each section

**Index File Format**:
```markdown
# Wiki Index

Last updated: 2026-04-09T14:30:00Z

## Source Summaries

| Link | Summary | Updated | Tags |
|------|---------|---------|------|
| [[summary-article-name]] | Brief description | 2026-04-09 | tag1, tag2 |

## Entities

| Link | Summary | Updated | Tags |
|------|---------|---------|------|
| [[entity-name]] | Brief description | 2026-04-09 | tag1 |

## Topics

| Link | Summary | Updated | Tags |
|------|---------|---------|------|
| [[topic-name]] | Brief description | 2026-04-09 | tag1 |

## Synthesis

| Link | Summary | Updated | Tags |
|------|---------|---------|------|

## Queries

| Link | Summary | Updated | Tags |
|------|---------|---------|------|
```

#### 3.4.6 `src/wiki/log.ts`

**Responsibility**: Append-only log writer for `wiki/log.md`.

```typescript
export type LogAction =
  | 'INIT'
  | 'INGEST'
  | 'UPDATE'
  | 'QUERY'
  | 'LINT'
  | 'CREATE_PAGE'
  | 'UPDATE_PAGE'
  | 'DELETE_PAGE'
  | 'REMOVE_SOURCE'
  | 'REBUILD_INDEX';

export interface LogEntry {
  timestamp: string;             // ISO 8601
  action: LogAction;
  description: string;
  relatedPages?: string[];
  sourceId?: string;
}

export class LogWriter {
  constructor(logPath: string);

  /** Append a single log entry */
  append(entry: LogEntry): Promise<void>;

  /** Append multiple log entries atomically */
  appendBatch(entries: LogEntry[]): Promise<void>;

  /** Read all log entries (for status command) */
  readAll(): Promise<LogEntry[]>;

  /** Get the last entry matching an action type */
  getLastEntry(action: LogAction): Promise<LogEntry | null>;
}
```

**Dependencies**: `fs/promises`, `path`

**Implementation Details**:
- Format per line: `[2026-04-09 14:30] [INGEST] Ingested source "article.md" -- created 3 pages`
- `append()` opens file in append mode, writes one line, closes
- `appendBatch()` concatenates all entries and writes in a single append
- Never modifies existing content
- `readAll()` parses all lines back into `LogEntry[]` via regex

**Log Line Format**:
```
[YYYY-MM-DD HH:mm] [ACTION] description
```

---

### 3.5 Source Module

#### 3.5.1 `src/source/reader.ts`

**Responsibility**: Read source files in various formats, extracting text content or encoding for LLM.

```typescript
export interface ReadResult {
  text: string;                  // Extracted text content
  format: string;                // Detected format
  pageCount?: number;            // For PDFs
  isImage: boolean;              // True for image sources
  imageContent?: ContentBlock;   // Base64 encoded image for LLM vision
}

export async function readSource(filePath: string, forceFormat?: string): Promise<ReadResult>;
export function getSupportedFormats(): string[];
```

**Dependencies**: `fs/promises`, `path`, `pdf-parse`

**Implementation Details**:
- **Text files** (`.md`, `.txt`): Read as UTF-8 string
- **PDF** (`.pdf`): Use `pdf-parse` to extract text. Return `pageCount` from `result.numpages`. Text includes form-feed characters (`\f`) between pages for downstream chunking.
- **Data files** (`.json`): Read and `JSON.stringify(JSON.parse(content), null, 2)` for pretty-printed text
- **CSV** (`.csv`): Read as raw text (LLM can interpret tabular data)
- **Images** (`.png`, `.jpg`, `.jpeg`, `.webp`): Read file as Buffer, base64-encode, return as `ContentBlock` with `type: 'image'` for LLM vision. `text` field contains `"[Image: filename.png]"` placeholder.
- Throws `Error('Unsupported source format: .xyz')` for unknown formats
- Detects format from file extension; `forceFormat` overrides detection

**Supported Formats**:
```
.md, .txt, .pdf, .json, .csv, .png, .jpg, .jpeg, .webp
```

#### 3.5.2 `src/source/hasher.ts`

**Responsibility**: SHA-256 content hashing for duplicate and stale detection.

```typescript
export async function computeFileHash(filePath: string): Promise<string>;
export function computeContentHash(content: Buffer): string;
```

**Dependencies**: `crypto`, `fs/promises`

**Implementation Details**:
- Hashes raw file bytes (not decoded text) for format-agnostic determinism
- Returns lowercase hex digest string (64 characters)
- `computeFileHash()` reads file into Buffer, delegates to `computeContentHash()`
- Same file always produces same hash regardless of platform

#### 3.5.3 `src/source/chunker.ts`

**Responsibility**: Split large source content into chunks that fit within the LLM context window.

```typescript
export interface Chunk {
  index: number;                 // 0-based chunk index
  content: string;               // Chunk text
  estimatedTokens: number;       // Heuristic token estimate
  metadata: {
    startSection?: string;       // For markdown: heading that starts this chunk
    pageRange?: [number, number]; // For PDF: page range
  };
}

export interface ChunkingOptions {
  maxTokensPerChunk: number;     // Target max tokens per chunk
  overlapTokens: number;         // Overlap between chunks (200-500)
  format: string;                // Source format for format-aware splitting
}

export function chunkContent(
  content: string,
  options: ChunkingOptions
): Chunk[];

export function needsChunking(
  content: string,
  contextBudget: number
): boolean;
```

**Dependencies**: `../utils/tokens`

**Implementation Details**:
- **Markdown** (`.md`): Split on headings (`##`, `###`). Each heading starts a new potential split point. Sections that exceed the limit are split on paragraphs (double newlines).
- **PDF text**: Split on form-feed characters (`\f`) which represent page boundaries. Group consecutive pages into chunks that fit the token budget.
- **Plain text** (`.txt`): Split on double newlines (paragraphs). Group paragraphs into chunks.
- **Data files** (`.json`, `.csv`): Split on record/row boundaries.
- `overlapTokens`: The last N tokens of chunk K are repeated at the start of chunk K+1 to preserve context continuity.
- `needsChunking()`: Returns true if `estimateTokensHybrid(content)` exceeds 70% of `contextBudget`.
- `estimatedTokens` on each chunk uses the heuristic estimator from `utils/tokens`.

---

### 3.6 Ingest Module

#### 3.6.1 `src/ingest/pipeline.ts`

**Responsibility**: Orchestrate the multi-step ingest workflow.

```typescript
export interface IngestOptions {
  sourcePath: string;
  recursive: boolean;
  tags: string[];
  metadata: Record<string, string>;
  forceFormat?: string;
  dryRun: boolean;
  verbose: boolean;
}

export interface IngestResult {
  sourceId: string;
  summaryPage: string;           // Path to created summary page
  entityPages: string[];         // Paths to created/updated entity pages
  topicPages: string[];          // Paths to created/updated topic pages
  pagesCreated: number;
  pagesUpdated: number;
  tokenUsage: CumulativeUsage;
}

export class IngestPipeline {
  constructor(
    provider: LLMProvider,
    pageManager: PageManager,
    registry: SourceRegistryManager,
    indexManager: IndexManager,
    logWriter: LogWriter,
    config: WikiConfig
  );

  /** Run the full ingest pipeline for a single source file */
  ingest(options: IngestOptions): Promise<IngestResult>;

  /** Run ingest for a directory (when --recursive is set) */
  ingestDirectory(dirPath: string, options: IngestOptions): Promise<IngestResult[]>;
}
```

**Dependencies**: `../llm/provider`, `../llm/tools`, `../wiki/pages`, `../wiki/registry`, `../wiki/index-manager`, `../wiki/log`, `../source/reader`, `../source/hasher`, `../source/chunker`, `./summarizer`, `./extractor`, `./merger`, `./cross-referencer`, `../utils/usage-tracker`, `../utils/tokens`, `../utils/logger`

**Pipeline Steps** (executed sequentially for each source):

1. **Validate & Register**: Check file exists, compute hash, check registry for duplicates. If unchanged hash found, log "already ingested" and skip. If changed hash found, proceed with re-ingest. Register with status `ingesting`.

2. **Read Source**: Use `reader.readSource()` to extract text content.

3. **Check Token Budget**: Call `needsChunking()`. If true, call `chunkContent()` to split.

4. **Load Context**: Read wiki schema from `schema/wiki-schema.md`, ingest prompt template from `schema/prompts/ingest.md`, current `index.md` content.

5. **Step 1 - Summarize**: Call `summarizer.summarize()` -- LLM generates markdown summary page with frontmatter.

6. **Step 2 - Extract**: Call `extractor.extract()` -- LLM tool-use call returns structured entities, topics, cross-references.

7. **Step 3 - Merge/Create**: Call `merger.mergeOrCreatePages()` -- for each entity/topic, create new page or merge into existing.

8. **Step 4 - Cross-Reference**: Call `crossReferencer.insertLinks()` -- programmatically add `[[wiki-links]]` to all touched pages.

9. **Update Index**: Call `indexManager.upsertEntry()` for each new/modified page.

10. **Update Log**: Call `logWriter.appendBatch()` with all `INGEST`, `CREATE_PAGE`, `UPDATE_PAGE` entries.

11. **Update Registry**: Set source status to `ingested`, record `generatedPages` list.

12. **Print Summary**: Output pages created/updated, entities found, token usage.

**Multi-Chunk Handling**:
- Chunk 1: Full pipeline (summarize + extract + merge)
- Chunks 2-N: Extract only (send previous chunk's summary as context). Accumulate entities/topics.
- After all chunks: Deduplicate entities by lowercase name comparison. Run merge/create for all accumulated entities/topics.

**Dry-Run Behavior**: When `dryRun: true`, all LLM calls still execute but no files are written. Output shows what would be created/updated.

#### 3.6.2 `src/ingest/summarizer.ts`

**Responsibility**: LLM call to generate a source summary page.

```typescript
export interface SummaryResult {
  frontmatter: WikiPageFrontmatter;
  content: string;               // Markdown body
  usage: TokenUsage;
}

export class Summarizer {
  constructor(provider: LLMProvider, config: WikiConfig);

  summarize(
    sourceContent: string,
    sourceFileName: string,
    sourceId: string,
    schema: string,
    promptTemplate: string,
    tags: string[]
  ): Promise<SummaryResult>;
}
```

**Dependencies**: `../llm/provider`, `../llm/types`, `../wiki/frontmatter`, `../config/types`

**Implementation Details**:
- Constructs system prompt from schema document
- Constructs user message from prompt template with source content injected
- Calls `provider.complete()` with temperature 0.3 (factual)
- Parses returned markdown through `parsePage()` to validate frontmatter
- If frontmatter is missing or invalid, wraps content with default frontmatter
- Returns structured `SummaryResult` for downstream processing

#### 3.6.3 `src/ingest/extractor.ts`

**Responsibility**: LLM tool-use call to extract entities, topics, and cross-references.

```typescript
export class Extractor {
  constructor(provider: LLMProvider, config: WikiConfig);

  extract(
    sourceContent: string,
    schema: string,
    promptTemplate: string,
    previousSummary?: string      // For multi-chunk: context from prior chunk
  ): Promise<ExtractionResult>;
}
```

**Dependencies**: `../llm/provider`, `../llm/tools`, `../config/types`

**Implementation Details**:
- Calls `provider.completeWithTools()` with `EXTRACT_ENTITIES_TOOL` and `tool_choice: { type: 'tool', name: 'extract_entities' }`
- Forces structured JSON output via tool use mechanism
- Validates returned JSON against `ExtractionResult` interface
- For multi-chunk mode, includes `previousSummary` in the user message to provide continuity context
- Temperature: 0.2 (factual extraction)

#### 3.6.4 `src/ingest/merger.ts`

**Responsibility**: Create new wiki pages or merge new information into existing pages.

```typescript
export interface MergeResult {
  path: string;                  // Relative path to the page
  action: 'created' | 'updated';
  usage: TokenUsage;
}

export class Merger {
  constructor(
    provider: LLMProvider,
    pageManager: PageManager,
    config: WikiConfig
  );

  /** Process all extracted entities and topics, creating or merging pages */
  mergeOrCreatePages(
    extraction: ExtractionResult,
    sourceId: string,
    sourceName: string,
    schema: string,
    createEntityTemplate: string,
    createTopicTemplate: string,
    updatePageTemplate: string,
    tags: string[]
  ): Promise<MergeResult[]>;
}
```

**Dependencies**: `../llm/provider`, `../llm/types`, `../wiki/pages`, `../wiki/frontmatter`, `../utils/naming`, `../config/types`

**Implementation Details**:
- For each entity in `extraction.entities`:
  1. Generate filename: `toKebabCase(entity.name)` + optional type suffix for disambiguation (e.g., `mercury-planet.md`)
  2. Check if page exists via `pageManager.pageExists()`
  3. If exists: Call `provider.complete()` with `update-page.md` template, existing page content, and new entity info. Prompt instructs LLM to preserve existing content, add new info, and mark contradictions with `> [!warning] Contradiction` callout.
  4. If not exists: Call `provider.complete()` with `create-entity.md` template. LLM generates full page with frontmatter.
  5. Write page via `pageManager.writePage()`
- Same process for topics, using `create-topic.md` template
- Disambiguation check: Before creating, scan existing pages for name collisions. If collision detected, append entity type to filename.
- Temperature: 0.3 for page creation, 0.2 for merges (conservative)

#### 3.6.5 `src/ingest/cross-referencer.ts`

**Responsibility**: Programmatically insert wiki-links into generated/updated pages.

```typescript
export class CrossReferencer {
  constructor(pageManager: PageManager);

  /** Insert wiki-links into all pages that mention entities/topics with dedicated pages */
  insertLinks(
    touchedPages: string[],        // Paths of pages created/updated in this ingest
    extraction: ExtractionResult
  ): Promise<string[]>;            // Returns paths of pages that were modified
}
```

**Dependencies**: `../wiki/pages`, `../wiki/wikilinks`

**Implementation Details**:
- Builds a set of all entity and topic names from the extraction result
- For each touched page:
  1. Read page content
  2. Call `insertWikiLinks()` to find entity/topic name mentions not already linked
  3. If any links were inserted, write the updated page back
- Also inserts cross-references based on `extraction.crossReferences`
- Does not use LLM -- purely programmatic string manipulation
- Only links first occurrence of each entity name per section (between headings)

---

### 3.7 Query Module

#### 3.7.1 `src/query/pipeline.ts`

**Responsibility**: Orchestrate the two-step query workflow.

```typescript
export interface QueryOptions {
  question: string;
  save: boolean;
  maxPages: number;
  dryRun: boolean;
  verbose: boolean;
}

export interface QueryResult {
  answer: string;                // Markdown-formatted answer with [[wiki-links]]
  citedPages: string[];          // Paths of pages referenced in the answer
  savedPath?: string;            // If --save, path to the saved query page
  tokenUsage: CumulativeUsage;
}

export class QueryPipeline {
  constructor(
    provider: LLMProvider,
    pageManager: PageManager,
    indexManager: IndexManager,
    logWriter: LogWriter,
    config: WikiConfig
  );

  query(options: QueryOptions): Promise<QueryResult>;
}
```

**Dependencies**: `../llm/provider`, `../llm/tools`, `../wiki/pages`, `../wiki/index-manager`, `../wiki/log`, `../wiki/frontmatter`, `../utils/usage-tracker`, `../utils/naming`, `../config/types`

**Pipeline Steps**:

1. **Load Index**: Read `wiki/index.md` via `indexManager.readIndex()`

2. **Page Selection (LLM)**: Send question + index entries to LLM with `SELECT_PAGES_TOOL` and `tool_choice: { type: 'tool', name: 'select_relevant_pages' }`. LLM returns structured list of relevant page paths. If index is empty, return "No relevant information found in the wiki."

3. **Read Pages**: Read selected wiki pages (up to `maxPages` limit) via `pageManager.readPage()`

4. **Synthesis (LLM)**: Send question + page contents to LLM with query prompt template. LLM returns markdown answer with `[[wiki-link]]` citations. Temperature: 0.5 (balanced synthesis).

5. **Output**: Return answer text for stdout printing.

6. **Save** (if `--save`):
   - Generate filename from question: `toKebabCase(question).substring(0, 60) + '.md'`
   - Create page in `wiki/queries/` with frontmatter (`type: 'query-result'`)
   - Update index via `indexManager.upsertEntry()`
   - Append to log via `logWriter.append()`

---

### 3.8 Lint Module

#### 3.8.1 `src/lint/structural.ts`

**Responsibility**: File-system-based structural checks that work without an LLM.

```typescript
export interface LintFinding {
  severity: 'error' | 'warning' | 'suggestion';
  category: 'BROKEN_LINK' | 'ORPHAN' | 'STALE_SOURCE' | 'MISSING_FRONTMATTER'
           | 'CONTRADICTION' | 'MISSING_LINK';
  page: string;                  // Affected page path
  message: string;
  details?: string;
  autoFixable: boolean;          // Whether --fix can resolve this
}

export class StructuralLinter {
  constructor(
    pageManager: PageManager,
    indexManager: IndexManager,
    registry: SourceRegistryManager
  );

  /** Run all structural checks */
  check(): Promise<LintFinding[]>;

  /** Detect orphan pages (not in index and not linked from any other page) */
  checkOrphans(): Promise<LintFinding[]>;

  /** Detect broken wiki-links */
  checkBrokenLinks(): Promise<LintFinding[]>;

  /** Detect stale sources (hash mismatch) */
  checkStaleSources(): Promise<LintFinding[]>;

  /** Validate frontmatter required fields */
  checkFrontmatter(): Promise<LintFinding[]>;
}
```

**Dependencies**: `../wiki/pages`, `../wiki/wikilinks`, `../wiki/index-manager`, `../wiki/registry`, `../wiki/frontmatter`, `../source/hasher`

**Implementation Details**:
- `checkOrphans()`: Build a set of all page paths from `index.md` entries and all pages that are targets of wiki-links. Any page not in either set is an orphan.
- `checkBrokenLinks()`: For each page, extract wiki-links via `extractWikiLinks()`, check each target against `pageManager.getAllPageNames()`.
- `checkStaleSources()`: For each source in registry with status `ingested`, re-hash the source file and compare against stored `contentHash`. If mismatch, report as stale.
- `checkFrontmatter()`: For each page, parse via `parsePage()`, check required fields: `title`, `type`, `created`, `updated`, `sources`, `tags`.
- All structural checks work offline (no LLM API key required).

#### 3.8.2 `src/lint/semantic.ts`

**Responsibility**: LLM-powered semantic checks.

```typescript
export class SemanticLinter {
  constructor(provider: LLMProvider, pageManager: PageManager, config: WikiConfig);

  /** Detect contradictions across pages */
  checkContradictions(pagePaths: string[]): Promise<LintFinding[]>;

  /** Detect missing cross-references */
  checkMissingLinks(pagePaths: string[]): Promise<LintFinding[]>;

  /** Run all semantic checks */
  check(): Promise<LintFinding[]>;
}
```

**Dependencies**: `../llm/provider`, `../llm/tools`, `../wiki/pages`, `../config/types`

**Implementation Details**:
- Loads entity and topic pages in batches (configurable batch size, e.g., 10 pages per LLM call)
- Uses `IDENTIFY_CONTRADICTIONS_TOOL` with `tool_choice: { type: 'tool', name: 'identify_contradictions' }`
- Maps tool output to `LintFinding[]`
- Temperature: 0.2 (factual analysis)
- Only runs when LLM API key is available; gracefully skips if not configured

#### 3.8.3 `src/lint/report.ts`

**Responsibility**: Format lint findings into a structured report.

```typescript
export interface LintReport {
  generatedAt: string;
  errors: LintFinding[];
  warnings: LintFinding[];
  suggestions: LintFinding[];
  summary: {
    totalErrors: number;
    totalWarnings: number;
    totalSuggestions: number;
  };
}

export function generateReport(findings: LintFinding[]): LintReport;
export function formatReportAsMarkdown(report: LintReport): string;
export function formatReportForConsole(report: LintReport): string;
```

**Dependencies**: `./structural` (for `LintFinding` type)

**Report Format** (markdown output):
```markdown
# Wiki Lint Report
Generated: 2026-04-09 14:30

## Errors (N)
- [BROKEN_LINK] Page "X" links to [[Y]] but no such page exists
- [MISSING_FRONTMATTER] Page "X" missing required field: sources
- [STALE_SOURCE] Source "X" modified since last ingest (hash mismatch)

## Warnings (N)
- [ORPHAN] Page "X" not referenced by any page or the index
- [CONTRADICTION] Pages "X" and "Y" disagree on Z

## Suggestions (N)
- [MISSING_LINK] Page "X" mentions "Y" but does not link to [[Y]]
```

#### 3.8.4 `src/lint/fixer.ts`

**Responsibility**: Auto-fix logic for the `--fix` flag.

```typescript
export class LintFixer {
  constructor(
    pageManager: PageManager,
    indexManager: IndexManager
  );

  /** Attempt to fix a finding. Returns true if fixed. */
  fix(finding: LintFinding): Promise<boolean>;

  /** Fix all fixable findings in a report */
  fixAll(findings: LintFinding[]): Promise<{ fixed: number; skipped: number }>;
}
```

**Dependencies**: `../wiki/pages`, `../wiki/wikilinks`, `../wiki/index-manager`

**Fixable Issues**:
- `ORPHAN` (add to index): Add orphan page to `index.md` with frontmatter-derived entry
- `MISSING_LINK` (suggestion): Insert wiki-link where entity is mentioned but not linked
- `MISSING_FRONTMATTER` (partial): Add missing `tags: []` or `sources: []` with empty arrays. Cannot auto-generate `title` or `type`.
- `BROKEN_LINK`: If a case-insensitive match exists (e.g., `[[machine Learning]]` -> `machine-learning.md`), update the link

**Non-Fixable**:
- `STALE_SOURCE`: Requires re-ingest (user action)
- `CONTRADICTION`: Requires human or LLM judgment

---

### 3.9 Command Modules

Each command module exports a function that registers itself on a `Command` parent.

#### 3.9.1 `src/commands/init.ts`

```typescript
export function registerInitCommand(program: Command): void;
```

**Implementation**:
- Creates all directories: `sources/`, `wiki/`, `wiki/sources/`, `wiki/entities/`, `wiki/topics/`, `wiki/synthesis/`, `wiki/queries/`, `schema/`, `schema/prompts/`
- Writes template files from `src/templates/`
- Creates empty `sources/registry.json` with `{ "sources": [], "lastUpdated": "..." }`
- Creates `wiki/index.md` with header and empty table structure
- Creates `wiki/log.md` with header and `[INIT]` entry
- Creates `config.json` from template (all required fields empty)
- Creates `.gitignore` (excludes `config.json`, `node_modules/`)
- If any of the above already exist, warns "Wiki already initialized at <path>" and does not overwrite

#### 3.9.2 `src/commands/ingest.ts`

```typescript
export function registerIngestCommand(program: Command): void;
```

**Arguments**: `<source>` (file path or directory)

**Options**: `--recursive`, `--format <type>`, `--tags <tags...>`, `--metadata <key=value...>`

**Implementation**: Validates arguments, creates `IngestPipeline` from loaded config, calls `pipeline.ingest()` or `pipeline.ingestDirectory()`, prints summary.

#### 3.9.3 `src/commands/query.ts`

```typescript
export function registerQueryCommand(program: Command): void;
```

**Arguments**: `<question>` (natural-language string)

**Options**: `--save`, `--pages <n>`

**Implementation**: Creates `QueryPipeline`, calls `pipeline.query()`, prints answer to stdout. If `--save`, prints saved page path.

#### 3.9.4 `src/commands/lint.ts`

```typescript
export function registerLintCommand(program: Command): void;
```

**Options**: `--fix`, `--output <path>`, `--category <type>`

**Category Values**: `orphans`, `links`, `stale`, `frontmatter`, `contradictions`, `missing-links`

**Implementation**: Creates `StructuralLinter` and optionally `SemanticLinter`. Runs selected checks. Generates report. Optionally writes to `--output` path. If `--fix`, runs `LintFixer`.

#### 3.9.5 `src/commands/status.ts`

```typescript
export function registerStatusCommand(program: Command): void;
```

**Implementation**: Reads all wiki pages, counts by type. Reads registry, counts by status. Reads log for last ingest date. Runs quick structural lint for health indicators. Formats and prints summary.

**Output Format**:
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

#### 3.9.6 `src/commands/list-sources.ts`

```typescript
export function registerListSourcesCommand(program: Command): void;
```

**Implementation**: Reads registry, formats sources as a table with columns: ID (truncated), Filename, Format, Status, Ingested, Pages.

#### 3.9.7 `src/commands/remove-source.ts`

```typescript
export function registerRemoveSourceCommand(program: Command): void;
```

**Arguments**: `<query>` (source ID or filename substring)

**Implementation**: Finds source in registry. Prompts for confirmation (unless `--force`). Removes registry entry. Deletes summary page from `wiki/sources/`. Updates index (removes entry). Appends `REMOVE_SOURCE` and `DELETE_PAGE` to log.

Note: Entity and topic pages are NOT deleted because they may contain information from other sources. Only the source summary page is removed.

#### 3.9.8 `src/commands/rebuild-index.ts`

```typescript
export function registerRebuildIndexCommand(program: Command): void;
```

**Implementation**: Calls `pageManager.listPages()`, reads frontmatter of every page, calls `indexManager.regenerateFromPages()`. Appends `REBUILD_INDEX` to log. Prints count of entries written.

---

### 3.10 Utility Modules

#### 3.10.1 `src/utils/logger.ts`

```typescript
export interface Logger {
  info(message: string): void;
  verbose(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  success(message: string): void;
}

export function createLogger(options: { verbose: boolean }): Logger;
```

**Implementation Details**:
- `info()`: Always prints to stdout
- `verbose()`: Only prints when verbose mode is active
- `warn()`: Prints to stderr with `[WARN]` prefix
- `error()`: Prints to stderr with `[ERROR]` prefix
- `success()`: Prints to stdout with checkmark prefix

#### 3.10.2 `src/utils/naming.ts`

```typescript
export function toKebabCase(input: string): string;
export function toWikiSlug(humanTitle: string): string;
export function sanitizeFilename(input: string): string;
export function generatePageFilename(name: string, type?: string): string;
```

**Implementation Details**:
- `toKebabCase()`: Converts "Machine Learning" to "machine-learning". Strips non-alphanumeric characters except hyphens. Collapses multiple hyphens.
- `toWikiSlug()`: Collapses whitespace, removes YAML/shell-unsafe characters (`#[]|^:\/*?"<>`), trims. Used for Obsidian page display names.
- `sanitizeFilename()`: Removes all characters not in `[a-z0-9-]`. Ensures valid filename on macOS/Windows/Linux.
- `generatePageFilename()`: Combines `toKebabCase(name)` with optional type suffix for disambiguation: `"Mercury" + "planet"` -> `"mercury-planet.md"`

#### 3.10.3 `src/utils/tokens.ts`

```typescript
export function estimateTokensByChars(text: string): number;
export function estimateTokensByWords(text: string): number;
export function estimateTokensHybrid(text: string): number;
export function estimateFullPromptTokens(
  systemPrompt: string,
  messages: Array<{ role: string; content: string }>,
  safetyMarginPercent?: number
): number;

export interface PromptBudget {
  estimatedTokens: number;
  exactTokens?: number;
  contextLimit: number;
  outputReserve: number;
  effectiveLimit: number;
  fitsWithEstimate: boolean;
  fitsExactly?: boolean;
  recommendChunking: boolean;
}

export class PromptBudgetAnalyzer {
  constructor(provider: LLMProvider, model: string);

  analyze(
    systemPrompt: string,
    userContent: string,
    options?: {
      outputReserve?: number;
      useApiCount?: boolean;
      chunkingThreshold?: number;
    }
  ): Promise<PromptBudget>;
}
```

**Dependencies**: `../llm/provider`

**Implementation Details**:
- `estimateTokensByChars()`: `Math.ceil(text.length / 4)`
- `estimateTokensByWords()`: `Math.ceil(wordCount * 1.3)`
- `estimateTokensHybrid()`: Average of char-based and word-based
- `estimateFullPromptTokens()`: Sums system + messages with 10% safety margin (4 tokens overhead per message for role/metadata)
- `PromptBudgetAnalyzer.analyze()`: Uses heuristic first. If estimate is within 20% of threshold (85% of context limit), calls `provider.countTokens()` for exact count. Returns recommendation on whether chunking is needed.

**Context Window Limits** (hardcoded reference):

| Model | Context Window |
|-------|---------------|
| claude-opus-4-5 | 200,000 |
| claude-sonnet-4-5 | 200,000 |
| claude-haiku-3-5-20241022 | 200,000 |

#### 3.10.4 `src/utils/usage-tracker.ts`

```typescript
export interface CumulativeUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  callCount: number;
}

export class UsageTracker {
  record(usage: TokenUsage): void;
  get summary(): CumulativeUsage;
  printSummary(): void;
  reset(): void;
}
```

**Dependencies**: `../llm/types`

**Implementation Details**:
- Accumulates token counts across multiple LLM calls
- `printSummary()` outputs a formatted summary to stdout with locale-formatted numbers
- Used by `IngestPipeline` and `QueryPipeline` to report total token usage at operation end
- `reset()` zeros all counters (used when starting a new operation)

---

### 3.11 Template Files

#### 3.11.1 `src/templates/config-template.json`

```json
{
  "llm": {
    "provider": "",
    "model": "",
    "apiKey": "",
    "apiKeyExpiry": "",
    "maxTokens": 0
  },
  "wiki": {
    "rootDir": "",
    "sourcesDir": "sources",
    "wikiDir": "wiki",
    "schemaDir": "schema"
  },
  "obsidian": {
    "enabled": true,
    "vaultPath": ""
  }
}
```

Note: All required fields are empty strings/zero. The user must fill them in before running any command. The tool will throw `ConfigurationError` with the specific field name for any field left empty.

#### 3.11.2 `src/templates/wiki-schema.md`

A markdown document describing:
- Page types and their purposes (source-summary, entity, topic, synthesis, comparison, query-result)
- Required frontmatter fields for each page type
- Naming conventions (kebab-case filenames)
- Wiki-link usage rules
- Contradiction callout syntax: `> [!warning] Contradiction`
- Cross-reference guidelines
- Content style guidelines (objective, factual, citations)

This file is loaded into LLM system prompts as context for all operations.

#### 3.11.3 Prompt Templates (`src/templates/prompts/`)

Six prompt template files. Each uses XML-tagged sections for clarity. See Section 7 for full design.

---

## 4. Data Flow Diagrams

### 4.1 Ingest Pipeline

```
User: wiki ingest path/to/source.md
         |
         v
  [commands/ingest.ts]
  Parse CLI args, load config
         |
         v
  [source/reader.ts]        [source/hasher.ts]
  Read file content          Compute SHA-256 hash
         |                        |
         v                        v
  [wiki/registry.ts]
  Check duplicate by hash
  Register source (status: ingesting)
         |
         v
  [source/chunker.ts]
  Check token budget
  Split if needed (markdown headings / PDF pages / paragraphs)
         |
         v
  [ingest/summarizer.ts]     (LLM Call #1)
  Source content + schema + prompt template
  -> LLM generates markdown summary with frontmatter
         |
         v
  [ingest/extractor.ts]      (LLM Call #2)
  Source content + schema + tool definition
  -> LLM returns structured JSON: entities[], topics[], crossReferences[]
         |
         v
  [ingest/merger.ts]          (LLM Calls #3..N)
  For each entity/topic:
    Page exists? --YES--> LLM merge call (existing + new info)
                 --NO---> LLM create call (new page from scratch)
         |
         v
  [ingest/cross-referencer.ts]  (No LLM)
  Insert [[wiki-links]] into all touched pages programmatically
         |
         v
  [wiki/index-manager.ts]     [wiki/log.ts]           [wiki/registry.ts]
  Upsert entries for           Append INGEST,           Set status: ingested
  all new/modified pages       CREATE_PAGE,             Record generatedPages
                               UPDATE_PAGE entries
         |
         v
  Print summary: pages created/updated, entities found, token usage
```

### 4.2 Query Pipeline

```
User: wiki query "What is machine learning?"
         |
         v
  [commands/query.ts]
  Parse CLI args, load config
         |
         v
  [wiki/index-manager.ts]
  Read and parse index.md
  (If empty, return "No relevant information found")
         |
         v
  [query/pipeline.ts]         (LLM Call #1)
  Question + index entries + SELECT_PAGES_TOOL
  -> LLM returns structured JSON: relevant page paths
         |
         v
  [wiki/pages.ts]
  Read selected wiki pages (up to --pages limit)
         |
         v
  [query/pipeline.ts]         (LLM Call #2)
  Question + page contents + query prompt template
  -> LLM returns markdown answer with [[wiki-link]] citations
         |
         v
  Print answer to stdout
         |
         v  (if --save)
  [wiki/pages.ts]              [wiki/index-manager.ts]     [wiki/log.ts]
  Write to wiki/queries/       Upsert index entry          Append QUERY entry
  with type: query-result
```

### 4.3 Lint Pipeline

```
User: wiki lint [--fix] [--category <type>]
         |
         v
  [commands/lint.ts]
  Parse CLI args, load config
         |
         +------------------------------+
         |                              |
         v                              v
  [lint/structural.ts]           [lint/semantic.ts]
  (No LLM required)              (LLM required)
         |                              |
         |  checkOrphans()              |  checkContradictions()  (LLM Call)
         |  checkBrokenLinks()          |  checkMissingLinks()    (LLM Call)
         |  checkStaleSources()         |
         |  checkFrontmatter()          |
         |                              |
         +------------ + ---------------+
                       |
                       v
               [lint/report.ts]
               Categorize: errors, warnings, suggestions
               Format as markdown and/or console output
                       |
                       v
               Print to stdout
               (optionally write to --output or wiki/lint-report.md)
                       |
                       v  (if --fix)
               [lint/fixer.ts]
               Fix auto-fixable findings
               Print fix summary
```

### 4.4 Module Dependency Graph

```
                    cli.ts
                      |
          +-----------+-----------+
          |           |           |
      commands/*   config/*    utils/*
          |           |
    +-----+-----+    |
    |     |     |    |
  ingest/ query/ lint/
    |     |     |
    +-----+-----+
          |
    +-----+-----+
    |           |
  wiki/*     source/*
    |           |
  llm/*       (fs)
```

Key dependency rules:
- `commands/*` depend on pipeline modules, config, and utils
- `ingest/`, `query/`, `lint/` depend on `wiki/*`, `source/*`, and `llm/*`
- `wiki/*` depends only on `utils/*` and `source/hasher` (for stale detection)
- `llm/*` depends only on `config/types` and its own types
- `source/*` depends only on `utils/*`
- `utils/*` has no internal dependencies (except `tokens.ts` depends on `llm/provider` for `countTokens`)

---

## 5. Interface Contracts

This section defines the key interfaces that enable parallel implementation of modules.

### 5.1 LLMProvider Contract

Any module that needs LLM capabilities receives an `LLMProvider` instance via constructor injection. This is the single integration point between wiki logic and LLM infrastructure.

```typescript
interface LLMProvider {
  complete(params: CompletionParams): Promise<CompletionResult>;
  completeWithTools(params: ToolCompletionParams): Promise<ToolCompletionResult>;
  countTokens(params: Omit<CompletionParams, 'maxTokens'>): Promise<TokenCountResult>;
}
```

**Contract**:
- `complete()` always returns a non-empty `text` field or throws
- `completeWithTools()` always returns a valid `toolInput` matching the tool's schema or throws
- `countTokens()` is free (no billing) but may throw on rate limit
- All methods include `usage` in the result for tracking
- All methods are wrapped in retry logic internally

### 5.2 PageManager Contract

```typescript
interface PageManagerContract {
  readPage(relativePath: string): Promise<ParsedPage | null>;
  writePage(relativePath: string, frontmatter: WikiPageFrontmatter, content: string): Promise<void>;
  listPages(): Promise<string[]>;
  pageExists(relativePath: string): Promise<boolean>;
  deletePage(relativePath: string): Promise<void>;
  getAllPageNames(): Promise<Set<string>>;
}
```

**Contract**:
- Paths are always relative to `wikiDir`
- `readPage()` returns `null` for non-existent pages (does not throw)
- `writePage()` creates parent directories automatically
- `getAllPageNames()` returns lowercase stems for case-insensitive matching
- All operations are atomic at the file level

### 5.3 SourceRegistryManager Contract

```typescript
interface SourceRegistryContract {
  load(): Promise<SourceRegistry>;
  save(registry: SourceRegistry): Promise<void>;
  addSource(entry: Omit<SourceEntry, 'id'>): Promise<SourceEntry>;
  findByPath(filePath: string): Promise<SourceEntry | null>;
  findByHash(hash: string): Promise<SourceEntry | null>;
  updateSource(id: string, updates: Partial<SourceEntry>): Promise<void>;
  removeSource(id: string): Promise<SourceEntry>;
}
```

**Contract**:
- `addSource()` generates UUID and checks for hash duplicates before inserting
- `findByHash()` returns the first match (or null)
- `removeSource()` returns the removed entry for downstream cleanup
- `save()` writes atomically (write-to-temp + rename)

### 5.4 IndexManager Contract

```typescript
interface IndexManagerContract {
  readIndex(): Promise<IndexEntry[]>;
  writeIndex(entries: IndexEntry[]): Promise<void>;
  upsertEntry(entry: IndexEntry): Promise<void>;
  removeEntry(path: string): Promise<void>;
  regenerateFromPages(pages: ParsedPage[], paths: string[]): Promise<void>;
}
```

**Contract**:
- `upsertEntry()` matches by `path` field; inserts if not found
- `regenerateFromPages()` replaces entire index content
- Index entries are sorted alphabetically within each type section

### 5.5 LogWriter Contract

```typescript
interface LogWriterContract {
  append(entry: LogEntry): Promise<void>;
  appendBatch(entries: LogEntry[]): Promise<void>;
  readAll(): Promise<LogEntry[]>;
  getLastEntry(action: LogAction): Promise<LogEntry | null>;
}
```

**Contract**:
- Append operations never modify existing content
- `readAll()` parses all log lines; tolerates malformed lines (skips them)
- Log file is created on first append if it does not exist

### 5.6 Mock Provider for Testing

```typescript
class MockLLMProvider implements LLMProvider {
  private responses: Map<string, CompletionResult | ToolCompletionResult>;

  registerResponse(promptSubstring: string, response: CompletionResult | ToolCompletionResult): void;

  async complete(params: CompletionParams): Promise<CompletionResult> {
    // Match against registered responses by checking if any registered key
    // is a substring of the concatenated message content
  }

  async completeWithTools(params: ToolCompletionParams): Promise<ToolCompletionResult> {
    // Same matching, returns tool completion result
  }

  async countTokens(): Promise<TokenCountResult> {
    // Returns heuristic estimate
  }
}
```

This mock is used in unit tests to isolate pipeline logic from actual LLM calls.

---

## 6. Configuration Design

### 6.1 Full config.json Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["llm", "wiki", "obsidian"],
  "properties": {
    "llm": {
      "type": "object",
      "required": ["provider", "model", "apiKey", "maxTokens"],
      "properties": {
        "provider": {
          "type": "string",
          "enum": ["anthropic", "azure", "vertex"],
          "description": "LLM API provider"
        },
        "model": {
          "type": "string",
          "description": "Model identifier (e.g., claude-sonnet-4-20250514)"
        },
        "apiKey": {
          "type": "string",
          "description": "API authentication key. Recommended: use WIKI_LLM_API_KEY env var instead."
        },
        "apiKeyExpiry": {
          "type": "string",
          "format": "date",
          "description": "ISO 8601 date when API key expires. CLI warns 7 days before."
        },
        "azureEndpoint": {
          "type": "string",
          "description": "Azure OpenAI endpoint URL. Required when provider is 'azure'."
        },
        "azureDeployment": {
          "type": "string",
          "description": "Azure deployment name. Required when provider is 'azure'."
        },
        "maxTokens": {
          "type": "integer",
          "minimum": 1,
          "description": "Maximum output tokens per LLM call"
        }
      }
    },
    "wiki": {
      "type": "object",
      "required": ["rootDir", "sourcesDir", "wikiDir", "schemaDir"],
      "properties": {
        "rootDir": {
          "type": "string",
          "description": "Absolute path to the wiki root directory"
        },
        "sourcesDir": {
          "type": "string",
          "description": "Sources directory relative to rootDir"
        },
        "wikiDir": {
          "type": "string",
          "description": "Wiki directory relative to rootDir"
        },
        "schemaDir": {
          "type": "string",
          "description": "Schema directory relative to rootDir"
        }
      }
    },
    "obsidian": {
      "type": "object",
      "required": ["enabled"],
      "properties": {
        "enabled": {
          "type": "boolean",
          "description": "Whether to generate Obsidian-compatible output"
        },
        "vaultPath": {
          "type": "string",
          "description": "Path to Obsidian vault if different from rootDir"
        }
      }
    }
  }
}
```

### 6.2 Validation Rules

| Rule | Action |
|------|--------|
| `llm.provider` is empty or missing | Throw `ConfigurationError('llm.provider', 'Missing required configuration: llm.provider')` |
| `llm.provider` not in `['anthropic', 'azure', 'vertex']` | Throw `ConfigurationError('llm.provider', 'Invalid provider: xyz. Must be one of: anthropic, azure, vertex')` |
| `llm.model` is empty or missing | Throw `ConfigurationError('llm.model', ...)` |
| `llm.apiKey` is empty and `WIKI_LLM_API_KEY` not set | Throw `ConfigurationError('llm.apiKey', ...)` |
| `llm.maxTokens` is not a positive integer | Throw `ConfigurationError('llm.maxTokens', ...)` |
| `wiki.rootDir` is empty or not absolute | Throw `ConfigurationError('wiki.rootDir', ...)` |
| `llm.provider === 'azure'` and `llm.azureEndpoint` missing | Throw `ConfigurationError('llm.azureEndpoint', ...)` |
| `llm.provider === 'azure'` and `llm.azureDeployment` missing | Throw `ConfigurationError('llm.azureDeployment', ...)` |
| `llm.apiKeyExpiry` within 7 days of now | Print warning to stderr (do not throw) |
| `llm.apiKeyExpiry` already past | Print error to stderr (do not throw) |
| Config file not found at path | Throw `ConfigurationError('configFile', 'Configuration file not found: <path>')` |

### 6.3 Environment Variable Priority

```
Priority (highest to lowest):
1. CLI arguments (e.g., --config overrides path)
2. Environment variables (WIKI_LLM_API_KEY, etc.)
3. config.json file values
```

Implementation in `loader.ts`:
```typescript
// 1. Read config file
const fileConfig = await readConfigFile(configPath);

// 2. Apply env overrides
if (process.env.WIKI_LLM_PROVIDER) fileConfig.llm.provider = process.env.WIKI_LLM_PROVIDER;
if (process.env.WIKI_LLM_MODEL) fileConfig.llm.model = process.env.WIKI_LLM_MODEL;
if (process.env.WIKI_LLM_API_KEY) fileConfig.llm.apiKey = process.env.WIKI_LLM_API_KEY;
if (process.env.WIKI_LLM_MAX_TOKENS) fileConfig.llm.maxTokens = parseInt(process.env.WIKI_LLM_MAX_TOKENS, 10);
if (process.env.WIKI_ROOT_DIR) fileConfig.wiki.rootDir = process.env.WIKI_ROOT_DIR;
if (process.env.WIKI_AZURE_ENDPOINT) fileConfig.llm.azureEndpoint = process.env.WIKI_AZURE_ENDPOINT;
if (process.env.WIKI_AZURE_DEPLOYMENT) fileConfig.llm.azureDeployment = process.env.WIKI_AZURE_DEPLOYMENT;

// 3. Apply CLI overrides (if any)
// 4. Validate
return validateConfig(fileConfig);
```

---

## 7. Prompt Template Design

All prompt templates are stored in `schema/prompts/` and are loaded at runtime. They use XML-tagged sections for structure. Each template has placeholder tokens that the CLI replaces before sending to the LLM.

### 7.1 Template Placeholder Convention

Placeholders use double curly braces: `{{PLACEHOLDER_NAME}}`

Common placeholders across templates:
- `{{SCHEMA}}` -- Contents of `schema/wiki-schema.md`
- `{{SOURCE_CONTENT}}` -- Raw source document text
- `{{SOURCE_NAME}}` -- Source file name
- `{{INDEX_CONTENT}}` -- Current `wiki/index.md` content
- `{{EXISTING_PAGE}}` -- Content of existing wiki page (for merges)
- `{{ENTITY_INFO}}` -- Entity description from extraction step
- `{{TOPIC_INFO}}` -- Topic description from extraction step
- `{{QUESTION}}` -- User's query question
- `{{PAGE_CONTENTS}}` -- Content of selected wiki pages
- `{{PAGES_CONTENT}}` -- Concatenated content of multiple pages (for lint)
- `{{TAGS}}` -- Comma-separated tag list

### 7.2 `schema/prompts/ingest.md`

```markdown
# Ingest Prompt

<instructions>
You are a knowledge wiki editor. You are processing a new source document that needs to be
integrated into an existing wiki.

Your task is to generate a **source summary page** in markdown with YAML frontmatter.

The summary should:
1. Capture the key information, arguments, and conclusions from the source
2. Be written in an objective, encyclopedic tone
3. Include YAML frontmatter with: title, type (source-summary), created, updated, sources, tags
4. Reference entities and topics using [[wiki-link]] syntax where appropriate
5. Be comprehensive but concise (aim for 300-800 words)

Follow the wiki conventions described in the schema below.
</instructions>

<schema>
{{SCHEMA}}
</schema>

<current_index>
{{INDEX_CONTENT}}
</current_index>

<source_document name="{{SOURCE_NAME}}">
{{SOURCE_CONTENT}}
</source_document>

<tags>
{{TAGS}}
</tags>

Generate the source summary page now. Output valid markdown with YAML frontmatter.
```

### 7.3 `schema/prompts/query.md`

```markdown
# Query Prompt

<instructions>
You are a wiki research assistant. A user has asked a question and you have been
provided with relevant wiki pages to answer it.

Your task:
1. Synthesize an answer using ONLY the information in the provided wiki pages
2. Cite your sources using [[wiki-link]] syntax (e.g., "According to [[machine-learning]], ...")
3. If the pages do not contain enough information, say so explicitly
4. Structure your answer with clear headings if the answer is complex
5. Be precise and factual -- do not add information not present in the pages

Output format: markdown with [[wiki-link]] citations.
</instructions>

<question>
{{QUESTION}}
</question>

<wiki_pages>
{{PAGE_CONTENTS}}
</wiki_pages>

Synthesize your answer now.
```

### 7.4 `schema/prompts/lint.md`

```markdown
# Lint Prompt

<instructions>
You are a wiki quality auditor. You are reviewing a batch of wiki pages to detect:

1. **Contradictions**: Two pages asserting conflicting facts about the same entity or topic.
   Report the specific claims that conflict and which pages contain them.

2. **Missing cross-references**: Pages that mention entities or concepts that have
   dedicated wiki pages but do not use [[wiki-link]] syntax to link to them.

Use the identify_contradictions tool to report your findings as structured data.
</instructions>

<pages>
{{PAGES_CONTENT}}
</pages>

Analyze these pages now and report all contradictions and missing cross-references.
```

### 7.5 `schema/prompts/update-page.md`

```markdown
# Update Page Prompt

<instructions>
You are a wiki editor. You need to merge new information into an existing wiki page.

Rules:
1. PRESERVE all existing content -- do not remove or rewrite existing sections
2. ADD new information from the source in appropriate locations
3. If the new information CONTRADICTS existing content, add a callout:
   > [!warning] Contradiction
   > Source "{{SOURCE_NAME}}" states X, while this page previously stated Y.
4. Update the `updated` date in frontmatter to the current timestamp
5. Add the new source reference to the `sources` array in frontmatter
6. Add any new tags from the source to the `tags` array in frontmatter
7. Ensure all entity/topic mentions are wiki-linked with [[name]] syntax

Output the complete updated page (frontmatter + body).
</instructions>

<existing_page>
{{EXISTING_PAGE}}
</existing_page>

<new_information source="{{SOURCE_NAME}}">
{{ENTITY_INFO}}
</new_information>

<schema>
{{SCHEMA}}
</schema>

Output the complete updated page now.
```

### 7.6 `schema/prompts/create-entity.md`

```markdown
# Create Entity Page Prompt

<instructions>
You are a wiki editor creating a new entity page.

The entity is: {{ENTITY_NAME}} (type: {{ENTITY_TYPE}})

Create a wiki page with:
1. YAML frontmatter: title, type (entity), created, updated, sources, tags, aliases
2. A brief introduction paragraph
3. Key facts and attributes in structured sections
4. Cross-references to related entities/topics using [[wiki-link]] syntax
5. A "Sources" section at the bottom listing the source documents

Follow the conventions in the schema. Use an objective, encyclopedic tone.
</instructions>

<entity_description>
{{ENTITY_INFO}}
</entity_description>

<source_name>
{{SOURCE_NAME}}
</source_name>

<schema>
{{SCHEMA}}
</schema>

<tags>
{{TAGS}}
</tags>

Generate the entity page now.
```

### 7.7 `schema/prompts/create-topic.md`

```markdown
# Create Topic Page Prompt

<instructions>
You are a wiki editor creating a new topic page.

The topic is: {{TOPIC_NAME}}

Create a wiki page with:
1. YAML frontmatter: title, type (topic), created, updated, sources, tags, aliases
2. A clear definition/introduction
3. Key concepts and subtopics in structured sections
4. Cross-references to related entities and other topics using [[wiki-link]] syntax
5. A "Sources" section at the bottom

Follow the conventions in the schema. Aim for depth and clarity.
</instructions>

<topic_description>
{{TOPIC_INFO}}
</topic_description>

<related_entities>
{{RELATED_ENTITIES}}
</related_entities>

<source_name>
{{SOURCE_NAME}}
</source_name>

<schema>
{{SCHEMA}}
</schema>

<tags>
{{TAGS}}
</tags>

Generate the topic page now.
```

---

## 8. Error Handling Strategy

### 8.1 Error Categories

| Category | Handling | Example |
|----------|----------|---------|
| **Configuration errors** | Fail immediately with `ConfigurationError` | Missing API key, invalid provider |
| **File I/O errors** | Fail with descriptive message | Source file not found, permission denied |
| **LLM transient errors** | Retry with exponential backoff (up to 3 times) | Rate limit (429), server error (5xx) |
| **LLM permanent errors** | Fail immediately | Bad API key (401), prompt too large (400) |
| **LLM output validation** | Retry once with corrective prompt, then fail | Malformed JSON from tool use, missing frontmatter |
| **Registry corruption** | Load backup or fail with recovery instructions | Invalid JSON in registry.json |
| **Duplicate source** | Warn and skip (not an error) | Same hash already in registry |

### 8.2 Error Output Format

All errors print to stderr with this format:
```
[ERROR] <category>: <message>
  Field: <field_name>       (for config errors)
  File: <file_path>         (for file errors)
  Status: <http_status>     (for LLM errors)
```

### 8.3 Partial Failure Handling in Ingest

If the ingest pipeline fails partway through:
1. Source status is set to `failed` in the registry
2. Any pages already written remain on disk (can be cleaned up manually or by re-ingest)
3. Index and log are NOT updated for the failed operation
4. Error message includes the step that failed and what was completed
5. User can re-run `wiki ingest` on the same source to retry

### 8.4 LLM Output Validation

After every LLM call, the output is validated before writing to disk:

- **Text completions** (summaries, merges): Parse with `parsePage()`. If frontmatter is missing, wrap in default frontmatter and log a warning.
- **Tool completions** (extraction): Validate JSON structure against the expected interface. If required fields are missing, retry once with a clarifying prompt. If still invalid, throw with details.
- **Wiki-link validation**: After cross-referencing, validate all inserted links against existing pages. Broken links are logged as warnings but do not fail the operation.

---

## 9. Testing Strategy

### 9.1 Test File Inventory

```
test_scripts/
  test-config.ts                # Config loading, validation, env override, expiry warning
  test-frontmatter.ts           # gray-matter roundtrip, date preservation, aliases
  test-wikilinks.ts             # Wiki-link extraction regex, generation, validation
  test-hashing.ts               # SHA-256 hash consistency, duplicate detection
  test-registry.ts              # Registry CRUD, duplicate detection by hash
  test-chunking.ts              # Chunking by format, token budget, overlap
  test-llm-provider.ts          # Mock provider tests, retry logic, tool use parsing
  test-init.ts                  # Init creates all dirs/files, re-init warns
  test-ingest.ts                # Full ingest pipeline with mock LLM
  test-query.ts                 # Query pipeline with mock LLM
  test-lint.ts                  # Structural checks with crafted wiki
  test-utility-commands.ts      # status, list-sources, remove-source, rebuild-index
  test-e2e.ts                   # End-to-end integration (requires WIKI_TEST_LLM=true)
  fixtures/
    sample-source.md            # Markdown source for ingest testing
    sample-article.md           # Markdown article for e2e testing
    sample-notes.txt            # Text source for e2e testing
    mock-llm-responses.json     # Pre-recorded LLM responses for unit testing
```

### 9.2 Test Execution

```bash
# Unit tests (no LLM required):
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

# Integration tests (requires API key):
WIKI_TEST_LLM=true npx tsx test_scripts/test-e2e.ts
```

### 9.3 Mock LLM Strategy

The `MockLLMProvider` class enables testing pipeline logic without LLM calls:

- Pre-recorded responses stored in `test_scripts/fixtures/mock-llm-responses.json`
- Responses keyed by prompt substring matching
- Tool use responses include properly structured JSON matching tool schemas
- `countTokens()` returns heuristic estimates

---

## 10. Dependencies

### 10.1 Runtime Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `commander` | ^12.x | CLI framework |
| `@anthropic-ai/sdk` | ^0.30.x | Anthropic LLM client |
| `gray-matter` | ^4.x | YAML frontmatter parsing |
| `js-yaml` | ^4.x | YAML serialization with JSON_SCHEMA |
| `pdf-parse` | ^1.x | PDF text extraction |

### 10.2 Dev Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `typescript` | ^5.x | Compiler |
| `tsx` | ^4.x | TypeScript execution for dev/test |
| `@types/node` | ^20.x | Node.js type definitions |

### 10.3 TypeScript Configuration

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "strict": true,
    "esModuleInterop": true,
    "declaration": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "test_scripts"]
}
```

### 10.4 Package Scripts

```json
{
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/cli.ts",
    "start": "node dist/cli.js",
    "test": "tsx test_scripts/test-config.ts && tsx test_scripts/test-frontmatter.ts && tsx test_scripts/test-wikilinks.ts && tsx test_scripts/test-hashing.ts && tsx test_scripts/test-registry.ts && tsx test_scripts/test-chunking.ts"
  }
}
```

---

## Appendix A: Design Decisions Log

| # | Decision | Rationale | Alternatives Considered |
|---|----------|-----------|------------------------|
| 1 | Start with Anthropic only | Reduces initial complexity; Azure/Vertex added later behind same interface | Implement all three from day one |
| 2 | Registry tracks original file paths (no copy) | Avoids doubling disk usage; sources are immutable | Copy sources into sources/ directory |
| 3 | Section-aware chunking with token budget | Preserves semantic boundaries; heuristic + API verification near threshold | Fixed token count chunking |
| 4 | Sequential ingest processing | Sufficient for v1; parallelism adds registry/index locking complexity | Concurrent ingest with file locking |
| 5 | Entity type in filename for disambiguation | Simple, deterministic naming: mercury-planet.md vs mercury-element.md | Subdirectories by entity type |
| 6 | Textual description only for image sources | Simplifies page format; no image embedding in v1 | Embed image as relative link in summary |
| 7 | No page size limit in v1 | Deferred; monitor page growth during usage | Split large pages automatically |
| 8 | Structural lint works offline | Orphan, broken link, stale checks need no LLM; semantic checks require it | All lint requires LLM |
| 9 | gray-matter with JSON_SCHEMA | Prevents YAML date auto-coercion; dates preserved as strings | Default YAML schema with manual date handling |
| 10 | Tool use for structured extraction | Guarantees well-formed JSON; schema enforcement by the model | Prompt-based JSON in code fences |
| 11 | Non-streaming for all batch ops | Simpler code, easier error handling, immediate token usage | Streaming with progress indicators |
| 12 | Commander for CLI framework | Consistent with sibling Gitter project; cleaner subcommand model | Yargs |
| 13 | Wiki-link format [[PageName]] | Obsidian native format; case-insensitive resolution | Standard markdown links [text](url) |
| 14 | Kebab-case filenames | Obsidian-safe; no special characters; cross-platform compatible | Space-separated names (Obsidian default) |

---

## Appendix B: Glossary

| Term | Definition |
|------|-----------|
| **Source** | An original document (article, PDF, notes) added to the wiki for knowledge extraction |
| **Source Summary** | A wiki page that summarizes a single source document |
| **Entity** | A named thing: person, organization, technology, concept, event, place |
| **Topic** | A thematic concept that may span multiple sources |
| **Synthesis** | A cross-cutting analysis page that draws from multiple sources |
| **Wiki-link** | Obsidian-style `[[PageName]]` internal link |
| **Frontmatter** | YAML metadata block at the top of a markdown file between `---` delimiters |
| **Registry** | JSON file tracking all ingested sources and their metadata |
| **Index** | Master catalog page (`index.md`) listing all wiki pages with summaries |
| **Log** | Append-only file (`log.md`) recording all wiki operations chronologically |
| **Chunk** | A portion of a large source document sized to fit the LLM context window |
| **Tool use** | Anthropic mechanism for forcing structured JSON output from the LLM |

---

## Multi-Provider Architecture

**Added**: 2026-04-09
**Status**: Detailed Technical Design
**References**: `docs/reference/refined-request-multi-provider.md`, `docs/design/plan-002-multi-provider-support.md`

This section documents the technical design for extending LLM Wiki from Anthropic-only to support three LLM provider backends: Anthropic (direct), Azure AI Inference, and Google Vertex AI (Gemini).

### MP-1. Updated Technology Stack

| Concern | Technology | Version | Rationale |
|---------|-----------|---------|-----------|
| LLM client (Anthropic) | `@anthropic-ai/sdk` | existing | Primary provider, unchanged |
| LLM client (Azure AI) | `@azure-rest/ai-inference` | `^1.0.0-beta.6` | Unified REST client for all Azure-hosted models (OpenAI, Anthropic, Mistral, DeepSeek) via single `/chat/completions` endpoint |
| Azure auth | `@azure/core-auth` | `^1.9.0` | `AzureKeyCredential` for API key authentication |
| LLM client (Vertex AI) | `@google/genai` | `^1.48.0` | Google's unified Gemini SDK with Vertex AI support; replaces deprecated `@google-cloud/vertexai` (removed June 2026) |

### MP-2. Updated Source File Structure

New and modified files in the `src/llm/` module:

```
src/llm/
  types.ts                        # Unchanged
  provider.ts                     # Unchanged (LLMProvider interface)
  anthropic.ts                    # Modified: non-null assertion on config.apiKey!
  azure.ts                        # NEW: AzureAIProvider implementation
  vertex.ts                       # NEW: VertexAIProvider implementation
  factory.ts                      # Modified: wire new providers
  tools.ts                        # Unchanged
  retry.ts                        # Modified: provider-agnostic error classification
  tokens.ts                       # Modified: extended CONTEXT_LIMITS map
```

### MP-3. Updated Config Types (`src/config/types.ts`)

The `LLMConfig` interface is updated to support all three providers:

```typescript
export interface LLMConfig {
  /** LLM provider identifier */
  provider: 'anthropic' | 'azure' | 'vertex';

  /** Model name/identifier (e.g., 'claude-sonnet-4-20250514', 'gpt-4o', 'gemini-2.0-flash') */
  model: string;

  /**
   * API key for the selected provider.
   * Required for 'anthropic' and 'azure' providers.
   * NOT required for 'vertex' (uses Application Default Credentials).
   */
  apiKey?: string;

  /** ISO 8601 date string; warn if within 7 days of expiry. Irrelevant for vertex. */
  apiKeyExpiry?: string;

  /** Azure AI endpoint URL. Required when provider = 'azure'. */
  azureEndpoint?: string;

  /** Azure deployment name. Required when provider = 'azure'. */
  azureDeployment?: string;

  /** GCP project ID. Required when provider = 'vertex'. */
  vertexProjectId?: string;

  /** GCP region (e.g., 'us-central1'). Required when provider = 'vertex'. */
  vertexLocation?: string;

  /** Maximum output tokens per LLM call */
  maxTokens: number;
}
```

**Breaking change**: `apiKey` changes from required (`string`) to optional (`string | undefined`). The config validator enforces presence for `anthropic` and `azure`. The `AnthropicProvider` constructor uses `config.apiKey!` (non-null assertion) since the validator guarantees its presence.

**Validation rules** (no fallbacks, per project convention):

| Provider | Required Fields | Not Required |
|----------|----------------|-------------|
| `anthropic` | `apiKey`, `model`, `maxTokens` | `azureEndpoint`, `azureDeployment`, `vertexProjectId`, `vertexLocation` |
| `azure` | `apiKey`, `model`, `maxTokens`, `azureEndpoint`, `azureDeployment` | `vertexProjectId`, `vertexLocation` |
| `vertex` | `model`, `maxTokens`, `vertexProjectId`, `vertexLocation` | `apiKey` (uses ADC) |

**New environment variable mappings** (added to `src/config/loader.ts`):

| Variable | Maps To | Required When |
|----------|---------|---------------|
| `WIKI_VERTEX_PROJECT_ID` | `llm.vertexProjectId` | provider = vertex |
| `WIKI_VERTEX_LOCATION` | `llm.vertexLocation` | provider = vertex |

### MP-4. Provider-Agnostic Retry Module (`src/llm/retry.ts`)

The retry module is refactored to remove the `@anthropic-ai/sdk` import and work with any error type using duck-typing on HTTP status codes.

#### MP-4.1 Helper Functions

```typescript
/**
 * Extract an HTTP status code from any error object using duck-typing.
 * Supports:
 *   - Anthropic SDK errors: numeric .status
 *   - Google GenAI ApiError: numeric .status
 *   - Azure REST client: string .status (e.g., "429") on thrown wrapper errors
 */
function getHttpStatus(error: unknown): number | undefined {
  if (error && typeof error === 'object') {
    const e = error as Record<string, unknown>;

    // Numeric status (Anthropic, Google GenAI)
    if (typeof e.status === 'number') return e.status;

    // Numeric statusCode (alternative convention)
    if (typeof e.statusCode === 'number') return e.statusCode;

    // String status (Azure REST client pattern -- provider converts
    // response.status string to numeric before throwing, but handle
    // the string case defensively)
    if (typeof e.status === 'string') {
      const parsed = parseInt(e.status, 10);
      if (!isNaN(parsed)) return parsed;
    }
  }
  return undefined;
}

/**
 * Extract Retry-After delay from an error's headers (Azure provides this on 429).
 * Returns delay in milliseconds, or undefined if not available.
 *
 * Google GenAI ApiError does NOT expose Retry-After headers, so this
 * returns undefined for Vertex errors and exponential backoff is used.
 */
function getRetryAfterMs(error: unknown): number | undefined {
  if (error && typeof error === 'object') {
    const e = error as Record<string, unknown>;
    if (typeof e.headers === 'object' && e.headers) {
      const headers = e.headers as Record<string, string>;

      // Standard Retry-After header (value in seconds)
      const retryAfter = headers['retry-after'];
      if (retryAfter) {
        const seconds = parseInt(retryAfter, 10);
        if (!isNaN(seconds)) return seconds * 1000;
      }

      // Azure-specific millisecond variant
      const retryAfterMs = headers['retry-after-ms'];
      if (retryAfterMs) {
        const ms = parseInt(retryAfterMs, 10);
        if (!isNaN(ms)) return ms;
      }
    }
  }
  return undefined;
}
```

#### MP-4.2 Error Classification Logic

```typescript
// Inside the catch block of callWithRetry():

const status = getHttpStatus(error);

// No HTTP status: non-HTTP error (network failure, programming error) -- fail fast
if (status === undefined) {
  throw error;
}

// Authentication/permission errors: fail fast, never retry
if (status === 401 || status === 403) {
  throw error;
}

// Bad request: fail fast, not retryable
if (status === 400) {
  throw error;
}

// Rate limit (429): retry with backoff
// Use Retry-After header delay if available (Azure), else exponential backoff
if (status === 429) {
  if (attempt > opts.maxRetries) throw error;
  const retryAfterDelay = getRetryAfterMs(error);
  const delay = retryAfterDelay ?? Math.min(
    opts.initialDelayMs * Math.pow(opts.backoffFactor, attempt),
    opts.maxDelayMs,
  );
  await sleep(delay);
  continue;
}

// Request timeout (408): retry with backoff
if (status === 408) {
  if (attempt > opts.maxRetries) throw error;
  const delay = Math.min(
    opts.initialDelayMs * Math.pow(opts.backoffFactor, attempt),
    opts.maxDelayMs,
  );
  await sleep(delay);
  continue;
}

// Server errors (500+): retry with backoff
if (status >= 500) {
  if (attempt > opts.maxRetries) throw error;
  const delay = Math.min(
    opts.initialDelayMs * Math.pow(opts.backoffFactor, attempt),
    opts.maxDelayMs,
  );
  await sleep(delay);
  continue;
}

// Any other status code: fail fast
throw error;
```

The function signature remains unchanged: `callWithRetry<T>(fn: () => Promise<T>, maxRetries?: number): Promise<T>`.

#### MP-4.3 Compatibility Matrix

| Error Source | `.status` Type | `.headers` Available | Retry-After Supported |
|-------------|---------------|---------------------|----------------------|
| Anthropic SDK (`APIError`, `RateLimitError`, etc.) | `number` | No | No |
| Azure AI (thrown from provider after `isUnexpected()`) | `number` (converted from string) | Yes (response headers) | Yes (`retry-after` header) |
| Google GenAI (`ApiError`) | `number` | No | No |

### MP-5. Azure AI Provider (`src/llm/azure.ts`)

**Class**: `AzureAIProvider implements LLMProvider`

**Dependencies**: `@azure-rest/ai-inference` (ModelClient, isUnexpected), `@azure/core-auth` (AzureKeyCredential), `./retry`, `./tokens`, `./types`, `../config/types`

#### MP-5.1 Constructor

```typescript
import ModelClient, { isUnexpected } from '@azure-rest/ai-inference';
import { AzureKeyCredential } from '@azure/core-auth';
import type { LLMProvider } from './provider.js';
import type {
  CompletionParams, CompletionResult,
  ToolCompletionParams, ToolCompletionResult,
  TokenCountResult, TokenUsage, MessageParam,
} from './types.js';
import type { LLMConfig } from '../config/types.js';
import { callWithRetry } from './retry.js';
import { estimateTokens } from './tokens.js';

export class AzureAIProvider implements LLMProvider {
  private readonly client: ReturnType<typeof ModelClient>;
  private readonly model: string;
  private readonly maxTokens: number;

  constructor(config: LLMConfig) {
    // azureEndpoint and apiKey guaranteed by validator for azure provider
    this.client = ModelClient(
      config.azureEndpoint!,
      new AzureKeyCredential(config.apiKey!),
    );
    // azureDeployment is the Azure-specific deployment name;
    // model is used for CONTEXT_LIMITS lookup
    this.model = config.azureDeployment ?? config.model;
    this.maxTokens = config.maxTokens;
  }
```

#### MP-5.2 `complete()` Method

```typescript
  async complete(params: CompletionParams): Promise<CompletionResult> {
    return callWithRetry(async () => {
      const response = await this.client.path('/chat/completions').post({
        body: {
          model: this.model,
          messages: this.buildMessages(params.system, params.messages),
          max_tokens: params.maxTokens,
          ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
        },
      });

      if (isUnexpected(response)) {
        this.throwFromResponse(response);
      }

      const choice = response.body.choices[0];
      return {
        text: choice.message.content ?? '',
        usage: this.mapUsage(response.body.usage),
        stopReason: choice.finish_reason ?? 'unknown',
      };
    });
  }
```

**Key design decisions**:
- System prompt is sent as `{ role: "system", content: systemPrompt }` as the first message (Azure/OpenAI convention).
- The Azure REST client does NOT throw on HTTP errors; it returns response objects. `isUnexpected()` is the type guard. The provider must convert error responses into thrown errors so `callWithRetry()` can classify them.

#### MP-5.3 `completeWithTools()` Method

```typescript
  async completeWithTools(params: ToolCompletionParams): Promise<ToolCompletionResult> {
    return callWithRetry(async () => {
      const response = await this.client.path('/chat/completions').post({
        body: {
          model: this.model,
          messages: this.buildMessages(params.system, params.messages),
          max_tokens: params.maxTokens,
          tools: params.tools.map((t) => ({
            type: 'function' as const,
            function: {
              name: t.name,
              description: t.description,
              parameters: t.input_schema,
            },
          })),
          tool_choice: this.mapToolChoice(params.toolChoice),
          ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
        },
      });

      if (isUnexpected(response)) {
        this.throwFromResponse(response);
      }

      const choice = response.body.choices[0];
      const toolCall = choice.message.tool_calls?.[0];

      if (!toolCall) {
        throw new Error('Azure AI did not return a tool_call response');
      }

      // Azure returns function arguments as a JSON string -- must parse
      const toolInput = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;

      return {
        toolName: toolCall.function.name,
        toolInput,
        usage: this.mapUsage(response.body.usage),
        stopReason: choice.finish_reason ?? 'unknown',
      };
    });
  }
```

**Tool definition mapping**: `ToolDefinition` -> Azure `ChatCompletionsFunctionToolDefinition`:

| Internal (`ToolDefinition`) | Azure Format |
|-----------------------------|-------------|
| `name` | `function.name` |
| `description` | `function.description` |
| `input_schema` | `function.parameters` |
| (wrapper) | `type: "function"` |

**Tool choice mapping**:

| Internal | Azure Format |
|----------|-------------|
| `{ type: 'tool', name: 'X' }` | `{ type: 'function', function: { name: 'X' } }` |
| `{ type: 'auto' }` | `'auto'` |

#### MP-5.4 `countTokens()` Method

```typescript
  async countTokens(params: Omit<CompletionParams, 'maxTokens'>): Promise<TokenCountResult> {
    // Azure AI Inference has no native token counting endpoint.
    // Use heuristic estimation (same approach as Anthropic provider).
    const systemText = params.system;
    const messageText = params.messages
      .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
      .join('\n');
    const fullText = systemText + '\n' + messageText;

    return {
      inputTokens: estimateTokens(fullText),
    };
  }
```

#### MP-5.5 Private Helper Methods

```typescript
  /**
   * Build Azure messages array with system prompt as first message.
   */
  private buildMessages(
    system: string,
    messages: MessageParam[],
  ): Array<{ role: string; content: string }> {
    const azureMessages: Array<{ role: string; content: string }> = [
      { role: 'system', content: system },
    ];

    for (const m of messages) {
      const content = typeof m.content === 'string'
        ? m.content
        : m.content.filter((b) => b.type === 'text').map((b) => b.text!).join('');
      azureMessages.push({ role: m.role, content });
    }

    return azureMessages;
  }

  /**
   * Map tool choice from internal format to Azure format.
   */
  private mapToolChoice(
    choice: ToolCompletionParams['toolChoice'],
  ): 'auto' | { type: 'function'; function: { name: string } } {
    if (choice.type === 'auto') return 'auto';
    return { type: 'function', function: { name: choice.name } };
  }

  /**
   * Map Azure usage response to internal TokenUsage.
   * Azure does not support prompt caching, so cache fields are 0.
   */
  private mapUsage(usage: { prompt_tokens: number; completion_tokens: number }): TokenUsage {
    return {
      inputTokens: usage.prompt_tokens,
      outputTokens: usage.completion_tokens,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
    };
  }

  /**
   * Convert an Azure error response (from isUnexpected()) into a thrown error
   * with numeric .status and .headers for the retry module.
   *
   * This is the critical bridge between Azure's non-throwing REST client
   * and our retry module's duck-typed error classification.
   */
  private throwFromResponse(response: { status: string; body: any; headers: any }): never {
    const message = response.body?.error?.message ?? 'Azure AI request failed';
    const error = new Error(`Azure AI error [${response.status}]: ${message}`);
    (error as any).status = parseInt(response.status, 10);
    (error as any).headers = response.headers;
    throw error;
  }
```

#### MP-5.6 Error Handling Flow

```
Azure API call
  |
  v
response = await client.path("/chat/completions").post(...)
  |
  v
isUnexpected(response)?
  |-- No  --> Extract text/tool_call, return result
  |-- Yes --> throwFromResponse(response)
                |
                v
              Error with .status (number) and .headers (Record<string,string>)
                |
                v
              callWithRetry catches error
                |
                v
              getHttpStatus(error) reads .status
                |-- 429 --> getRetryAfterMs() checks .headers["retry-after"]
                |           retry with server-specified delay or exponential backoff
                |-- 500+ -> retry with exponential backoff
                |-- 400  -> fail fast
                |-- 401  -> fail fast
```

### MP-6. Vertex AI Provider (`src/llm/vertex.ts`)

**Class**: `VertexAIProvider implements LLMProvider`

**Dependencies**: `@google/genai` (GoogleGenAI, FunctionCallingConfigMode), `./retry`, `./types`, `../config/types`

**Critical SDK note**: Uses `@google/genai` (NOT the deprecated `@google-cloud/vertexai`). The old package is deprecated since June 2025 and will be removed June 2026.

#### MP-6.1 Constructor

```typescript
import { GoogleGenAI, FunctionCallingConfigMode } from '@google/genai';
import type { Content, FunctionDeclaration } from '@google/genai';
import type { LLMProvider } from './provider.js';
import type {
  CompletionParams, CompletionResult,
  ToolCompletionParams, ToolCompletionResult,
  TokenCountResult, TokenUsage, MessageParam,
} from './types.js';
import type { LLMConfig } from '../config/types.js';
import { callWithRetry } from './retry.js';

export class VertexAIProvider implements LLMProvider {
  private readonly ai: GoogleGenAI;
  private readonly model: string;
  private readonly maxTokens: number;

  constructor(config: LLMConfig) {
    // vertexProjectId and vertexLocation guaranteed by validator
    this.ai = new GoogleGenAI({
      vertexai: true,
      project: config.vertexProjectId!,
      location: config.vertexLocation!,
    });
    this.model = config.model;
    this.maxTokens = config.maxTokens;
  }
```

**Authentication**: Uses Application Default Credentials (ADC) automatically. No API key is passed. Users must run `gcloud auth application-default login` for local development or set `GOOGLE_APPLICATION_CREDENTIALS` for CI/CD.

#### MP-6.2 `complete()` Method

```typescript
  async complete(params: CompletionParams): Promise<CompletionResult> {
    return callWithRetry(async () => {
      const response = await this.ai.models.generateContent({
        model: this.model,
        contents: this.mapMessages(params.messages),
        config: {
          systemInstruction: params.system,
          maxOutputTokens: params.maxTokens,
          ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
        },
      });

      return {
        text: response.text ?? '',
        usage: this.mapUsage(response),
        stopReason: response.candidates?.[0]?.finishReason ?? 'unknown',
      };
    });
  }
```

**Key design decisions**:
- System prompt goes in `config.systemInstruction`, NOT as a message (Gemini convention).
- `response.text` is a convenience getter that extracts text from the first candidate's parts.

#### MP-6.3 `completeWithTools()` Method

```typescript
  async completeWithTools(params: ToolCompletionParams): Promise<ToolCompletionResult> {
    return callWithRetry(async () => {
      const response = await this.ai.models.generateContent({
        model: this.model,
        contents: this.mapMessages(params.messages),
        config: {
          systemInstruction: params.system,
          maxOutputTokens: params.maxTokens,
          tools: [{
            functionDeclarations: params.tools.map((t) => ({
              name: t.name,
              description: t.description,
              parametersJsonSchema: t.input_schema,
            } as FunctionDeclaration)),
          }],
          toolConfig: {
            functionCallingConfig: this.mapToolChoice(params.toolChoice),
          },
          ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
        },
      });

      const calls = response.functionCalls;
      if (!calls || calls.length === 0) {
        throw new Error('Vertex AI did not return a function call response');
      }

      const call = calls[0];

      return {
        toolName: call.name!,
        // call.args is already a parsed object (NOT a JSON string -- unlike Azure)
        toolInput: (call.args ?? {}) as Record<string, unknown>,
        usage: this.mapUsage(response),
        stopReason: response.candidates?.[0]?.finishReason ?? 'unknown',
      };
    });
  }
```

**Tool definition mapping**: `ToolDefinition` -> Gemini `FunctionDeclaration` using `parametersJsonSchema`:

| Internal (`ToolDefinition`) | Gemini Format |
|-----------------------------|--------------|
| `name` | `name` |
| `description` | `description` |
| `input_schema` | `parametersJsonSchema` (direct JSON Schema pass-through) |

The `parametersJsonSchema` field is the **recommended approach** in `@google/genai` v1.x. It accepts standard JSON Schema directly, avoiding the need to convert to Gemini's `Type` enum format.

**Tool choice mapping**:

| Internal | Gemini Format |
|----------|--------------|
| `{ type: 'tool', name: 'X' }` | `{ mode: FunctionCallingConfigMode.ANY, allowedFunctionNames: ['X'] }` |
| `{ type: 'auto' }` | `{ mode: FunctionCallingConfigMode.AUTO }` |

`FunctionCallingConfigMode.ANY` with a single entry in `allowedFunctionNames` forces the model to call exactly that function.

#### MP-6.4 `countTokens()` Method

```typescript
  async countTokens(params: Omit<CompletionParams, 'maxTokens'>): Promise<TokenCountResult> {
    // Gemini provides a native countTokens API -- more accurate than heuristic
    const result = await this.ai.models.countTokens({
      model: this.model,
      contents: this.mapMessages(params.messages),
    });

    return {
      inputTokens: result.totalTokens ?? 0,
    };
  }
```

This uses the native Gemini `countTokens` API, providing more accurate token counts than the heuristic estimation used by Anthropic and Azure providers.

#### MP-6.5 Private Helper Methods

```typescript
  /**
   * Map internal MessageParam[] to Gemini Content[] format.
   * - role "assistant" becomes "model" (Gemini convention)
   * - content is wrapped in parts: [{ text: ... }]
   */
  private mapMessages(messages: MessageParam[]): Content[] {
    return messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : m.role,
      parts: typeof m.content === 'string'
        ? [{ text: m.content }]
        : m.content
            .filter((block) => block.type === 'text')
            .map((block) => ({ text: block.text! })),
    }));
  }

  /**
   * Map tool choice from internal format to Gemini FunctionCallingConfig.
   */
  private mapToolChoice(
    choice: ToolCompletionParams['toolChoice'],
  ): { mode: FunctionCallingConfigMode; allowedFunctionNames?: string[] } {
    if (choice.type === 'auto') {
      return { mode: FunctionCallingConfigMode.AUTO };
    }
    return {
      mode: FunctionCallingConfigMode.ANY,
      allowedFunctionNames: [choice.name],
    };
  }

  /**
   * Map Gemini response usage metadata to internal TokenUsage.
   * Gemini does not support prompt caching in the same way, so cache fields are 0.
   *
   * Note: usageMetadata field names may be promptTokenCount/candidatesTokenCount
   * or inputTokens/outputTokens depending on API version. We check both.
   */
  private mapUsage(response: { usageMetadata?: any }): TokenUsage {
    const meta = response.usageMetadata;
    if (!meta) {
      return { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };
    }
    return {
      inputTokens: meta.promptTokenCount ?? meta.inputTokens ?? 0,
      outputTokens: meta.candidatesTokenCount ?? meta.outputTokens ?? 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
    };
  }
```

#### MP-6.6 Error Handling

The `@google/genai` SDK **throws** `ApiError` on HTTP errors (unlike Azure which returns response objects). `ApiError` has a numeric `.status` property (e.g., 429, 500). This is directly compatible with the refactored `callWithRetry()` which reads `.status` via duck-typing.

```
Vertex API call (ai.models.generateContent)
  |
  v
SDK throws ApiError on non-2xx?
  |-- No  --> Extract text/functionCalls, return result
  |-- Yes --> ApiError with .status (number)
                |
                v
              callWithRetry catches error
                |
                v
              getHttpStatus(error) reads .status
                |-- 429 --> retry with exponential backoff (no Retry-After header available)
                |-- 500+ -> retry with exponential backoff
                |-- 400  -> fail fast
                |-- 401  -> fail fast
```

**Double retry note**: The `@google/genai` SDK has built-in retry via `p-retry` for status codes 408, 429, 500, 502, 503, 504. Our `callWithRetry()` wraps around this. If the SDK exhausts its internal retries and throws, our wrapper gets additional attempts. This is acceptable: the SDK handles transient network issues, while our wrapper provides configurable, logged retry behavior consistent across all providers.

### MP-7. Updated Token Estimator (`src/llm/tokens.ts`)

The `CONTEXT_LIMITS` map is extended with Azure-hosted and Gemini models:

```typescript
const CONTEXT_LIMITS: Record<string, number> = {
  // Anthropic (existing)
  'claude-opus-4-5': 200_000,
  'claude-sonnet-4-5': 200_000,
  'claude-sonnet-4-20250514': 200_000,
  'claude-haiku-3-5-20241022': 200_000,
  'claude-3-opus-20240229': 200_000,
  'claude-3-5-sonnet-20241022': 200_000,

  // Azure-hosted OpenAI models
  'gpt-4o': 128_000,
  'gpt-4o-mini': 128_000,
  'gpt-4-turbo': 128_000,
  'gpt-4.1': 1_047_576,
  'gpt-4.1-mini': 1_047_576,
  'gpt-4.1-nano': 1_047_576,

  // Azure-hosted Mistral models
  'mistral-large-latest': 128_000,
  'mistral-large-2411': 128_000,

  // Azure-hosted DeepSeek models
  'deepseek-r1': 64_000,
  'DeepSeek-V3.1': 128_000,

  // Google Gemini models (Vertex AI)
  'gemini-2.0-flash': 1_048_576,
  'gemini-2.5-flash': 1_048_576,
  'gemini-2.5-pro': 1_048_576,
  'gemini-1.5-pro': 2_097_152,
  'gemini-1.5-flash': 1_048_576,
};
```

**Azure custom deployment names**: Azure users may deploy models with custom names (e.g., `my-gpt4o-prod`). The `model` field in config must match a known model identifier for `PromptBudgetAnalyzer` to work. The `azureDeployment` field is used for the actual Azure deployment name. This is strict behavior (throws on unknown model) per project convention.

### MP-8. Updated Factory (`src/llm/factory.ts`)

```typescript
import type { LLMProvider } from './provider.js';
import type { LLMConfig } from '../config/types.js';
import { AnthropicProvider } from './anthropic.js';
import { AzureAIProvider } from './azure-ai.js';
import { VertexAIProvider } from './vertex-ai.js';

export function createProvider(config: LLMConfig): LLMProvider {
  switch (config.provider) {
    case 'anthropic':
      return new AnthropicProvider(config);
    case 'azure':
      return new AzureAIProvider(config);
    case 'vertex':
      return new VertexAIProvider(config);
    default: {
      const exhaustive: never = config.provider;
      throw new Error(`Unknown LLM provider: ${exhaustive}`);
    }
  }
}
```

### MP-9. Message Format Translation Summary

| Aspect | Anthropic | Azure AI | Gemini (`@google/genai`) |
|--------|-----------|----------|--------------------------|
| System prompt | `system` param | `messages[0].role: "system"` | `config.systemInstruction` |
| User message | `role: "user"` | `role: "user"` | `role: "user"`, `parts: [{ text }]` |
| Assistant message | `role: "assistant"` | `role: "assistant"` | `role: "model"`, `parts: [{ text }]` |
| Max output tokens | `max_tokens` | `max_tokens` | `config.maxOutputTokens` |
| Temperature | `temperature` | `temperature` | `config.temperature` |

### MP-10. Token Usage Field Mapping

| Internal Field | Anthropic | Azure AI | Gemini |
|---------------|-----------|----------|--------|
| `inputTokens` | `usage.input_tokens` | `usage.prompt_tokens` | `usageMetadata.promptTokenCount` |
| `outputTokens` | `usage.output_tokens` | `usage.completion_tokens` | `usageMetadata.candidatesTokenCount` |
| `cacheCreationTokens` | `usage.cache_creation_input_tokens` | `0` (not supported) | `0` (not supported) |
| `cacheReadTokens` | `usage.cache_read_input_tokens` | `0` (not supported) | `0` (not supported) |

### MP-11. Implementation Units for Parallel Coding

The implementation is organized into four units with explicit dependency ordering:

```
Unit A: Foundation (retry refactor + config changes)
    |
    +----> Unit B: Azure AI provider (after A)
    |
    +----> Unit C: Vertex AI provider (after A, parallel with B)
    |
    +------+-------> Unit D: Factory wiring + tests (after B and C)
```

#### Unit A: Foundation -- Retry Refactor + Config Changes

**Files to modify**:
| File | Change |
|------|--------|
| `src/llm/retry.ts` | Remove `import Anthropic from '@anthropic-ai/sdk'`; replace `instanceof` checks with `getHttpStatus()` + `getRetryAfterMs()` duck-typing helpers |
| `src/config/types.ts` | Make `apiKey` optional (`apiKey?: string`); add `vertexProjectId?: string`; add `vertexLocation?: string` |
| `src/config/validator.ts` | Make `apiKey` check conditional (required for `anthropic`/`azure` only); add vertex-specific validation; update `checkApiKeyExpiry()` to skip for vertex |
| `src/config/loader.ts` | Add `WIKI_VERTEX_PROJECT_ID` and `WIKI_VERTEX_LOCATION` env var mappings |
| `src/llm/tokens.ts` | Extend `CONTEXT_LIMITS` with Azure-hosted and Gemini models |
| `src/llm/anthropic.ts` | Add non-null assertion on `config.apiKey!` in constructor |

**Files to create**:
| File | Purpose |
|------|---------|
| `test_scripts/test-retry-generic.ts` | Unit tests for generic retry module |
| `test_scripts/test-config-validation-providers.ts` | Config validation tests for all providers |

**Can be implemented independently**: Yes -- no dependency on Unit B or C.

#### Unit B: Azure AI Provider

**Prerequisites**: Unit A complete.

**Files to modify**:
| File | Change |
|------|--------|
| `package.json` | Add `@azure-rest/ai-inference` (`^1.0.0-beta.6`) and `@azure/core-auth` (`^1.9.0`) |

**Files to create**:
| File | Purpose |
|------|---------|
| `src/llm/azure.ts` | `AzureAIProvider` class |
| `test_scripts/test-azure-ai-provider.ts` | Azure provider tests |

**Can run in parallel with**: Unit C.

#### Unit C: Vertex AI Provider

**Prerequisites**: Unit A complete.

**Files to modify**:
| File | Change |
|------|--------|
| `package.json` | Add `@google/genai` (`^1.48.0`) |

**Files to create**:
| File | Purpose |
|------|---------|
| `src/llm/vertex.ts` | `VertexAIProvider` class |
| `test_scripts/test-vertex-ai-provider.ts` | Vertex provider tests |

**Can run in parallel with**: Unit B.

#### Unit D: Factory Wiring + Integration Tests

**Prerequisites**: Units B and C complete.

**Files to modify**:
| File | Change |
|------|--------|
| `src/llm/factory.ts` | Import `AzureAIProvider` and `VertexAIProvider`; replace `throw new Error('Provider not yet implemented...')` with actual instantiation |
| `src/templates/config-template.json` | Add example fields for vertex config |

**Verification**: End-to-end smoke tests with each provider using `wiki query` and `wiki ingest` commands.

### MP-12. Files That Need NO Changes (Consumer Modules)

These modules depend only on the `LLMProvider` interface and work with any provider without modification:

| File | Role |
|------|------|
| `src/ingest/pipeline.ts` | Receives `LLMProvider` via constructor |
| `src/ingest/summarizer.ts` | Receives `LLMProvider` as parameter |
| `src/ingest/extractor.ts` | Calls `completeWithTools()` |
| `src/ingest/merger.ts` | Calls `complete()` |
| `src/query/pipeline.ts` | Calls `completeWithTools()` then `complete()` |
| `src/lint/semantic.ts` | Calls `completeWithTools()` |
| `src/llm/tools.ts` | Pure data definitions |
| `src/llm/usage-tracker.ts` | Depends only on `TokenUsage` type |
| `src/commands/ingest.ts` | Creates provider via factory |
| `src/commands/query.ts` | Creates provider via factory |
| `src/commands/lint.ts` | Creates provider via factory |

### MP-13. NPM Dependencies to Add

| Package | Version | Provider | Purpose |
|---------|---------|----------|---------|
| `@azure-rest/ai-inference` | `^1.0.0-beta.6` | Azure AI | Unified REST client for Azure AI model deployments |
| `@azure/core-auth` | `^1.9.0` | Azure AI | `AzureKeyCredential` for API key authentication |
| `@google/genai` | `^1.48.0` | Vertex AI | Unified Gemini SDK with Vertex AI support (replaces deprecated `@google-cloud/vertexai`) |

### MP-14. Risk Register

| Risk | Impact | Mitigation |
|------|--------|------------|
| `@azure-rest/ai-inference` is still in beta | API surface may change between versions | Pin to specific beta version; monitor for stable release |
| Azure custom deployment names not in `CONTEXT_LIMITS` | `PromptBudgetAnalyzer` throws on unknown model | Document that `model` must match known identifiers; use `azureDeployment` for deployment name |
| Double retry (Google GenAI SDK built-in + our wrapper) | More total attempts than intended | Acceptable trade-off; SDK handles transient network issues, our wrapper adds logging and config |
| `apiKey` becoming optional breaks TypeScript strictness | `AnthropicProvider` constructor gets `string | undefined` | Non-null assertion (`config.apiKey!`); validator guarantees presence for `anthropic` |
| Google GenAI `usageMetadata` field names may vary | Token usage mapping could return 0s | Check both `promptTokenCount`/`candidatesTokenCount` and `inputTokens`/`outputTokens` at runtime |

### MP-15. Architecture Decisions

| # | Decision | Rationale | Alternative Rejected |
|---|----------|-----------|---------------------|
| 1 | One provider class per platform, not per model family | Azure hosts multiple model families (OpenAI, Anthropic, Mistral, DeepSeek) through the same API | Separate provider per model family |
| 2 | Duck-typed retry using `.status` property | Works across Anthropic, Azure, and Google GenAI error objects without importing any SDK | Provider-specific retry per provider class |
| 3 | Azure provider throws from `isUnexpected()` responses | Bridges Azure's non-throwing REST client with retry module's catch-based classification | Retry module checking response objects directly |
| 4 | `parametersJsonSchema` for Gemini tool definitions | Direct JSON Schema pass-through; avoids converting to Gemini's `Type` enum format | `parameters` with `Type.OBJECT` etc. |
| 5 | Native `countTokens` for Vertex, heuristic for Azure | Gemini API supports it natively; Azure AI Inference has no equivalent endpoint | Heuristic for all providers |
| 6 | ADC for Vertex AI authentication | Covers local dev, CI/CD, and GKE workloads without explicit credential management | Explicit service account key file path config field |
| 7 | `@google/genai` over `@google-cloud/vertexai` | Old package deprecated June 2025, removed June 2026; new SDK has all features | Use deprecated package |

---

## Mailbox Ingest Feature (mail-check command)

### MI-1. Overview

The `mail-check` command extends LLM Wiki with the ability to connect to one or more IMAP mailboxes, fetch unprocessed emails (subject, body, and attachments), and feed them through the existing `IngestPipeline`. The command is designed for periodic invocation (e.g., cron) rather than running as a daemon. A persistent JSON state file tracks which emails have been processed to ensure idempotency.

**Functional Requirements**: FR-59 through FR-75 (see `docs/design/project-functions.md`).

**Related Documents**:
- `docs/reference/refined-request-mailbox-ingest.md` -- Specification
- `docs/design/plan-003-mailbox-ingest.md` -- Implementation plan
- `docs/reference/investigation-mailbox-ingest.md` -- Library evaluation
- `docs/reference/research-imapflow-mime-patterns.md` -- MIME traversal patterns
- `docs/reference/research-imap-auth-providers.md` -- Authentication provider status

---

### MI-2. System Architecture

The mailbox ingest feature adds four new modules and modifies three existing files. It integrates into the existing three-layer architecture without modifying the core ingest pipeline.

```
Layer 1: Sources (immutable raw documents)
  sources/
    files/
      email-2026-04-12-103000-meeting-notes.md      <-- email body saved as markdown
      email-att-2026-04-12-103000-report.pdf         <-- attachment saved to files/
    registry.json                                     <-- existing, email sources registered here
    mailbox-state.json                                <-- NEW: tracks processed UIDs + Message-IDs

Layer 2: Wiki (LLM-generated/maintained markdown pages)
  wiki/
    sources/meeting-notes.md                          <-- generated by IngestPipeline (unchanged)
    entities/...                                      <-- generated by IngestPipeline (unchanged)
    topics/...                                        <-- generated by IngestPipeline (unchanged)
    index.md                                          <-- updated by IngestPipeline (unchanged)
    log.md                                            <-- updated by IngestPipeline (unchanged)
    sources-catalog.md                                <-- updated by IngestPipeline (unchanged)

Layer 3: Schema (configuration, prompt templates, conventions)
  config.json                                         <-- extended with optional `mailboxes` section
```

**Key architectural principle**: The mail-check command is a **producer** of source files. It saves email bodies and attachments to `sources/files/` and then delegates all wiki-related processing to `IngestPipeline.ingest()`. The core pipeline is not modified.

---

### MI-3. Component Diagram

```
                    +--------------+
                    |   src/cli.ts |
                    |  (Commander) |
                    +------+-------+
                           |
                           | registers
                           v
              +-------------------------+
              | src/commands/mail-check |
              |   MailCheckCommand      |
              |   (orchestration loop)  |
              +-----------+-------------+
                          |
           +--------------+--------------+
           |              |              |
           v              v              v
  +-----------+  +----------------+  +------------------+
  | ImapClient|  |MailboxState    |  |EmailProcessor    |
  | (imap.ts) |  |Manager         |  |(email-           |
  |           |  |(mailbox-       |  | processor.ts)    |
  | connect() |  | state.ts)     |  |                  |
  | openFolder|  |               |  | processEmail()   |
  | searchAll |  | load()/save() |  | composeBody()    |
  |   UIDs()  |  | isProcessed() |  | saveAttachment() |
  | fetchEnve |  | markProcessed |  |                  |
  |  lope()   |  | resetState()  |  +--------+---------+
  | fetchBody |  +---------------+           |
  |   ()      |                              | calls
  | discover  |                              v
  | Attachment|                    +-------------------+
  |   s()     |                    | IngestPipeline    |
  | download  |                    | (existing,        |
  | Attachment|                    |  unmodified)      |
  |   ()      |                    | .ingest(path,     |
  | disconnect|                    |   { metadata })   |
  +-----------+                    +-------------------+

  Configuration:
  +----------------+     +-------------------+     +----------------+
  | config/types.ts| --> | config/validator.ts| --> | config/loader.ts|
  | MailboxConfig  |     | validateMailbox    |     | applyEnv       |
  | WikiConfig ext |     |   Config()        |     |   Overrides()  |
  +----------------+     | checkPassword     |     | WIKI_MAILBOX_* |
                         |   Expiry()        |     +----------------+
                         +-------------------+
```

---

### MI-4. Data Models

#### MI-4.1. MailboxConfig (per-mailbox settings)

Added to `src/config/types.ts`:

```typescript
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
}
```

#### MI-4.2. WikiConfig Extension

In `src/config/types.ts`, the existing `WikiConfig` interface gains one optional field:

```typescript
export interface WikiConfig {
  llm: LLMConfig;
  wiki: WikiPaths;
  obsidian: ObsidianConfig;

  /**
   * Optional mailbox configurations for the mail-check command.
   * Keys are mailbox names (e.g., 'work', 'research') used as identifiers
   * in state tracking and source metadata.
   * Only validated when the mail-check command is invoked.
   */
  mailboxes?: Record<string, MailboxConfig>;
}
```

#### MI-4.3. Mailbox State (persistent tracking)

Defined in `src/source/mailbox-state.ts`:

```typescript
/**
 * State for a single IMAP folder within a mailbox.
 */
export interface FolderState {
  /** IMAP UIDVALIDITY value. If it changes, processedUIDs must be cleared. */
  uidValidity: number;

  /** IMAP UIDs that have been successfully processed (sorted ascending). */
  processedUIDs: number[];

  /** ISO 8601 timestamp of last successful processing in this folder. */
  lastProcessedAt: string;
}

/**
 * State for a single named mailbox (aggregates all its folders).
 */
export interface MailboxFolderState {
  folders: Record<string, FolderState>;
}

/**
 * Top-level state file structure. Persisted at sources/mailbox-state.json.
 */
export interface MailboxStateData {
  /** Per-mailbox state, keyed by mailbox name from config. */
  mailboxes: Record<string, MailboxFolderState>;

  /**
   * Global set of processed RFC 2822 Message-ID headers.
   * Used for cross-folder and cross-mailbox deduplication.
   * Stored as array on disk, loaded into a Set in memory for O(1) lookups.
   */
  processedMessageIds: string[];
}
```

File location: `<rootDir>/sources/mailbox-state.json`

#### MI-4.4. IMAP Client Interfaces

Defined in `src/source/imap.ts`:

```typescript
/**
 * Configuration passed to ImapClient constructor.
 * Derived from MailboxConfig with field name mapping (tls -> secure).
 */
export interface ImapConnectionConfig {
  host: string;
  port: number;
  secure: boolean;        // mapped from MailboxConfig.tls
  user: string;
  password: string;
  connectionTimeout: number;
}

/**
 * Envelope metadata extracted from a single email.
 */
export interface EmailEnvelope {
  uid: number;
  messageId: string;      // RFC 2822 Message-ID or synthetic SHA-256 hash
  subject: string;
  from: string;           // sender email address
  date: string;           // ISO 8601
}

/**
 * Extracted email body content.
 */
export interface EmailContent {
  body: string;           // plain text, or HTML converted to markdown
  bodyFormat: 'plain' | 'html-converted';
  usedFallback: boolean;  // true if postal-mime fallback was used
}

/**
 * Metadata for a discovered attachment (before download).
 */
export interface EmailAttachment {
  filename: string;
  mimeType: string;
  part: string;           // IMAP part number for streaming download
  size: number;
  isInline: boolean;
}

/**
 * A fully fetched email ready for processing.
 */
export interface FetchedEmail {
  envelope: EmailEnvelope;
  content: EmailContent;
  attachments: EmailAttachment[];
}
```

#### MI-4.5. Email Processor Interfaces

Defined in `src/source/email-processor.ts`:

```typescript
/**
 * Result of processing a single email through the pipeline.
 */
export interface EmailProcessingResult {
  emailMessageId: string;
  subject: string;
  bodySourcePath: string;
  attachmentSourcePaths: string[];
  ingestResults: IngestResult[];
  skippedAttachments: Array<{ filename: string; mimeType: string; reason: string }>;
}

/**
 * Options for the EmailProcessor.
 */
export interface EmailProcessorOptions {
  dryRun: boolean;
  verbose: boolean;
  sourcesDir: string;                 // absolute path to sources/files/
  supportedExtensions: Set<string>;   // from getSupportedFormats()
}
```

#### MI-4.6. Source Registry Metadata for Email Sources

Email sources are registered through the existing `SourceEntry.metadata` field (no schema change required). The following keys are populated:

| Key | Value | Example |
|-----|-------|---------|
| `source` | `"email"` | `"email"` |
| `emailMessageId` | RFC 2822 Message-ID | `"<abc123@gmail.com>"` |
| `emailFrom` | Sender address | `"alice@example.com"` |
| `emailDate` | ISO 8601 date | `"2026-04-12T10:30:00Z"` |
| `emailSubject` | Email subject line | `"Meeting Notes Q2"` |
| `mailboxName` | Config mailbox name | `"work"` |
| `parentEmailMessageId` | (attachments only) Parent email's Message-ID | `"<abc123@gmail.com>"` |

---

### MI-5. Module Design

#### MI-5.1. `src/source/imap.ts` -- ImapClient

**Purpose**: Self-contained IMAP client wrapper. Handles connection, UID search, message fetching, body extraction (with MIME tree traversal), attachment discovery, and streaming download. No knowledge of the wiki or ingest pipeline.

**Dependencies**: `imapflow`, `postal-mime`, `turndown`

**Internal helpers** (not exported):

```typescript
/**
 * Recursively find the first text/plain body part, skipping attachment-disposition nodes.
 * Returns the IMAP part number string, or null.
 * For root single-part messages (no `part` field), returns '1'.
 */
function findPlainTextPart(node: MessageStructureNode): string | null;

/**
 * Recursively find the first text/html body part, skipping attachment-disposition nodes.
 * Returns the IMAP part number string, or null.
 */
function findHtmlPart(node: MessageStructureNode): string | null;

/**
 * Recursively collect all attachment parts from the bodyStructure tree.
 * Identifies attachments by:
 *   1. Explicit: node.disposition === 'attachment'
 *   2. Implicit: type is not text/* or multipart/*, and no disposition set
 *   3. Inline CID images: node.disposition === 'inline' with node.id present
 */
function findAllAttachments(node: MessageStructureNode): EmailAttachment[];

/**
 * Extract filename from a bodyStructure node.
 * Priority: dispositionParameters.filename > parameters.name > description > 'attachment'
 * ImapFlow decodes RFC 2231 and RFC 2047 filenames via libmime automatically.
 */
function extractFilename(node: MessageStructureNode): string;

/**
 * Strip angle brackets from a Content-ID string.
 * '<abc@example.com>' -> 'abc@example.com'
 */
function stripAngleBrackets(id: string): string;

/**
 * Generate a synthetic Message-ID from SHA-256 of from+date+subject.
 * Used when the email has no Message-ID header.
 */
function generateSyntheticMessageId(from: string, date: string, subject: string): string;

/**
 * Download a single IMAP part to a Buffer.
 * Uses client.download() which auto-decodes base64/quoted-printable.
 */
async function downloadPartToBuffer(client: ImapFlow, uid: number, part: string): Promise<Buffer>;
```

**Exported class**:

```typescript
export class ImapClient {
  /**
   * @param config  Connection configuration (host, port, secure, user, password, timeout).
   * @param logger  Logger instance. Passwords are NEVER logged even in verbose mode.
   */
  constructor(config: ImapConnectionConfig, logger: Logger);

  /**
   * Connect to the IMAP server.
   * Configures imapflow with logger: false to prevent credential leakage.
   * Connection timeout is set from config.connectionTimeout.
   * @throws Error on connection failure or authentication failure.
   */
  async connect(): Promise<void>;

  /**
   * Disconnect cleanly from the IMAP server via logout().
   */
  async disconnect(): Promise<void>;

  /**
   * Open an IMAP folder and acquire the mailbox lock.
   * @returns The UIDVALIDITY value for the opened folder.
   */
  async openFolder(folderName: string): Promise<{ uidValidity: number }>;

  /**
   * Release the mailbox lock for the currently open folder.
   */
  async releaseFolder(): Promise<void>;

  /**
   * Search for all UIDs in the currently open folder.
   * Uses client.search({ all: true }, { uid: true }).
   * @returns UIDs sorted ascending (oldest first, per FR-69).
   */
  async searchAllUIDs(): Promise<number[]>;

  /**
   * Fetch envelope metadata for a single UID.
   * Uses client.fetchOne(uid, { envelope: true }, { uid: true }).
   * Handles missing Message-ID by generating a synthetic one.
   * @throws Error if the message is not found.
   */
  async fetchEnvelope(uid: number): Promise<EmailEnvelope>;

  /**
   * Fetch the email body content for a single UID.
   * Strategy:
   *   1. Fetch bodyStructure via fetchOne(uid, { bodyStructure: true })
   *   2. Walk MIME tree: prefer text/plain, fall back to text/html + turndown
   *   3. If neither found, or on download error: fallback to postal-mime full parse
   * @throws Error if body extraction fails even with fallback.
   */
  async fetchBody(uid: number): Promise<EmailContent>;

  /**
   * Discover attachments from the bodyStructure of a single UID.
   * @returns Array of attachment metadata (filename, mimeType, part number, size, isInline).
   */
  async discoverAttachments(uid: number): Promise<EmailAttachment[]>;

  /**
   * Download a single attachment part and stream it to a file on disk.
   * Uses client.download(uid, part, { uid: true }) which auto-decodes encoding.
   * Streams via pipeline(content, createWriteStream(destPath)).
   * @param uid     Message UID
   * @param part    IMAP part number (e.g., '2', '1.2.3')
   * @param destPath  Absolute path to write the decoded attachment
   */
  async downloadAttachment(uid: number, part: string, destPath: string): Promise<void>;
}
```

**imapflow configuration pattern**:

```typescript
// Inside connect()
const client = new ImapFlow({
  host: this.config.host,
  port: this.config.port,
  secure: this.config.secure,
  auth: {
    user: this.config.user,
    pass: this.config.password,
  },
  logger: false,              // NEVER log credentials
  emitLogs: false,
  socketTimeout: this.config.connectionTimeout,
  greetingTimeout: this.config.connectionTimeout,
});
```

**Turndown configuration**:

```typescript
import TurndownService from 'turndown';

const turndown = new TurndownService({
  headingStyle: 'atx',          // # style headings (Obsidian-compatible)
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
});
```

**postal-mime fallback trigger conditions**:
1. `findPlainTextPart()` and `findHtmlPart()` both return null
2. Root bodyStructure type is `message/rfc822`
3. `downloadPartToBuffer()` throws an unexpected error

---

#### MI-5.2. `src/source/mailbox-state.ts` -- MailboxStateManager

**Purpose**: Persistent state tracker for processed emails. Manages UIDs per folder, UIDVALIDITY, and global Message-ID deduplication. Follows the `SourceRegistry` atomic write pattern.

**Dependencies**: Node.js `fs/promises` only.

```typescript
export class MailboxStateManager {
  /**
   * @param statePath  Absolute path to sources/mailbox-state.json
   */
  constructor(statePath: string);

  /**
   * Load state from disk. If the file does not exist, initialize with empty state.
   * Must be called before any other method.
   */
  async load(): Promise<void>;

  /**
   * Persist current state to disk atomically (write to .tmp, then rename).
   * Follows the SourceRegistry pattern:
   *   const tmpPath = this.statePath + '.tmp';
   *   await writeFile(tmpPath, JSON.stringify(this.state, null, 2));
   *   await rename(tmpPath, this.statePath);
   */
  async save(): Promise<void>;

  /**
   * Check if a UID has been processed for a given mailbox/folder.
   * Uses the in-memory processedUIDs array (sorted, binary search for large sets).
   */
  isUIDProcessed(mailboxName: string, folder: string, uid: number): boolean;

  /**
   * Check if a Message-ID has been processed globally.
   * Uses an in-memory Set<string> for O(1) lookups (loaded from the array on disk).
   */
  isMessageIdProcessed(messageId: string): boolean;

  /**
   * Get stored UIDVALIDITY for a folder, or null if not yet recorded.
   */
  getUIDValidity(mailboxName: string, folder: string): number | null;

  /**
   * Handle UIDVALIDITY change: clear processedUIDs for the affected folder
   * and update the stored UIDVALIDITY to the new value.
   * Logs a warning via the provided logger.
   * Does NOT clear processedMessageIds (they remain valid across validity changes).
   */
  handleUIDValidityChange(
    mailboxName: string,
    folder: string,
    newValidity: number,
    logger: Logger,
  ): void;

  /**
   * Set/update UIDVALIDITY for a folder (used on first encounter).
   */
  setUIDValidity(mailboxName: string, folder: string, validity: number): void;

  /**
   * Mark an email as successfully processed.
   * Adds UID to the folder's processedUIDs and messageId to processedMessageIds.
   * Does NOT call save() -- caller is responsible for calling save() after.
   */
  markProcessed(mailboxName: string, folder: string, uid: number, messageId: string): void;

  /**
   * Reset state for a specific mailbox or all mailboxes.
   * If mailboxName is provided, clears only that mailbox's folder state.
   * If mailboxName is undefined, clears all state (all mailboxes + processedMessageIds).
   */
  resetState(mailboxName?: string): void;

  /**
   * Get a read-only copy of the current state (for debugging/display).
   */
  getState(): Readonly<MailboxStateData>;
}
```

**Internal state representation**:

```typescript
// On disk: processedMessageIds is an array
// In memory: loaded into a Set<string> for O(1) lookups
private messageIdSet: Set<string> = new Set();
private state: MailboxStateData = { mailboxes: {}, processedMessageIds: [] };

// On save(), convert Set back to sorted array for deterministic JSON output:
this.state.processedMessageIds = [...this.messageIdSet].sort();
```

---

#### MI-5.3. `src/source/email-processor.ts` -- EmailProcessor

**Purpose**: Bridge between the IMAP client and the ingest pipeline. Converts fetched emails into source files and invokes `IngestPipeline.ingest()`.

**Dependencies**: `IngestPipeline`, `ImapClient`, `Logger`

```typescript
export class EmailProcessor {
  /**
   * @param pipeline  The existing IngestPipeline instance (reused across emails).
   * @param options   Processing options (dryRun, verbose, sourcesDir, supportedExtensions).
   * @param logger    Logger instance.
   */
  constructor(
    pipeline: IngestPipeline,
    options: EmailProcessorOptions,
    logger: Logger,
  );

  /**
   * Process a single email: save body + attachments as files, ingest each.
   *
   * Steps:
   *   1. Fetch body via client.fetchBody(uid)
   *   2. Compose markdown body document (# Subject, **From**, **Date**, body content)
   *   3. Save body to sources/files/email-<YYYY-MM-DD-HHmmss>-<sanitized-subject>.md
   *   4. Call pipeline.ingest(bodyPath, { metadata: emailMetadata })
   *   5. Discover attachments via client.discoverAttachments(uid)
   *   6. For each attachment:
   *      a. Check extension against supportedExtensions
   *      b. If unsupported: log warning, add to skippedAttachments, continue
   *      c. If supported: download to sources/files/email-att-<YYYY-MM-DD-HHmmss>-<filename>
   *      d. Call pipeline.ingest(attPath, { metadata: attachmentMetadata })
   *   7. Return EmailProcessingResult
   *
   * Does NOT update mailbox state -- the caller (MailCheckCommand) does that.
   * If any step fails, the exception propagates to the caller.
   * In dry-run mode, logs what would be done without creating files or calling pipeline.
   *
   * @param client       Connected ImapClient with a folder open.
   * @param envelope     Pre-fetched envelope metadata for this email.
   * @param mailboxName  Config mailbox name (for metadata tagging).
   * @returns Processing result with paths and ingest results.
   * @throws Error if body ingest or any attachment download/ingest fails.
   */
  async processEmail(
    client: ImapClient,
    envelope: EmailEnvelope,
    mailboxName: string,
  ): Promise<EmailProcessingResult>;
}
```

**Email body composition** (FR-64):

```typescript
function composeBodyMarkdown(envelope: EmailEnvelope, content: EmailContent): string {
  const lines: string[] = [
    `# ${envelope.subject}`,
    '',
    `**From**: ${envelope.from}`,
    `**Date**: ${envelope.date}`,
    '',
    content.body,
  ];
  return lines.join('\n');
}
```

**Email metadata construction** (FR-66):

```typescript
// For the email body source:
const bodyMetadata: Record<string, string> = {
  source: 'email',
  emailMessageId: envelope.messageId,
  emailFrom: envelope.from,
  emailDate: envelope.date,
  emailSubject: envelope.subject,
  mailboxName: mailboxName,
};

// For each attachment source:
const attachmentMetadata: Record<string, string> = {
  ...bodyMetadata,
  parentEmailMessageId: envelope.messageId,
};
```

---

#### MI-5.4. `src/commands/mail-check.ts` -- MailCheckCommand

**Purpose**: CLI command registration and top-level orchestration. Follows the `registerIngestCommand()` self-registering pattern.

```typescript
/**
 * Register the `wiki mail-check` command on the given Commander program.
 * Uses the self-registering pattern (same as registerIngestCommand).
 */
export function registerMailCheckCommand(program: Command): void;
```

**Command definition**:

```typescript
program
  .command('mail-check')
  .description('Check configured mailboxes for new emails and ingest them into the wiki')
  .option('--mailbox <name>', 'Process only the named mailbox')
  .option('--limit <n>', 'Maximum emails to process per run', parseInt)
  .option('--reset-state', 'Clear processed-email state (prompts for confirmation)')
  .action(async (cmdOptions) => { /* orchestration */ });
```

**Orchestration pseudocode** (inside action handler):

```
1.  Retrieve config from program.opts()._config
2.  Create logger from program.opts()._logger or createLogger({ verbose })
3.  Validate: call validateMailboxesExist(config)
4.  Validate: call validateMailboxConfig(config) for each mailbox to process
5.  Check password expiry: call checkPasswordExpiry() for each mailbox
6.  Handle --reset-state:
    a. Prompt confirmation via readline (Node.js built-in)
    b. Load state, call stateManager.resetState(mailboxName?), save, exit
7.  Determine target mailboxes:
    - If --mailbox <name>: validate name exists in config, process only that one
    - If no --mailbox: process all configured mailboxes
8.  Load mailbox state from sources/mailbox-state.json
9.  Create LLM provider via createProvider(config.llm)
10. Create IngestPipeline instance
11. Create EmailProcessor instance
12. Initialize counters: emailsFound=0, emailsIngested=0, emailsFailed=0,
    attachmentsProcessed=0, pagesCreated=0, pagesUpdated=0
    failureDetails: Array<{ subject, mailbox, folder, uid, error }>

13. For each target mailbox (try/catch per mailbox):
    a. Map MailboxConfig to ImapConnectionConfig (tls -> secure)
    b. Create ImapClient
    c. Connect (on failure: log error, continue to next mailbox)
    d. For each configured folder:
       i.   Open folder, get uidValidity
       ii.  Compare uidValidity with stored value:
            - If stored value exists and differs: handleUIDValidityChange()
            - If first time: setUIDValidity()
       iii. Search all UIDs (sorted ascending = oldest first)
       iv.  Filter: remove UIDs where isUIDProcessed() returns true
       v.   Apply --limit cap to the filtered list (global across all mailboxes)
       vi.  For each unprocessed UID (try/catch per email):
            - Fetch envelope
            - Check isMessageIdProcessed(envelope.messageId)
            - If already processed (cross-folder dupe): log skip, continue
            - If dry-run: log what would be processed, continue
            - Call emailProcessor.processEmail(client, envelope, mailboxName)
            - On success:
              * stateManager.markProcessed(mailboxName, folder, uid, messageId)
              * await stateManager.save()  // atomic, after EACH email
              * Update counters
            - On failure:
              * Log error (do NOT mark as processed)
              * Add to failureDetails
              * Continue to next email
       vii. Release folder lock
    e. Disconnect from IMAP server

14. Print summary (FR-70):
    Mail check complete:
      Mailboxes processed: <n>
      New emails found: <emailsFound>
      Successfully ingested: <emailsIngested>
      Failed: <emailsFailed>
        - "<subject>" (<mailbox>/<folder> UID <uid>): <error>
      Attachments processed: <attachmentsProcessed>
      Wiki pages created: <pagesCreated>
      Wiki pages updated: <pagesUpdated>

15. Set process.exitCode = emailsFailed > 0 ? 1 : 0
```

**Reset state confirmation prompt**:

```typescript
import { createInterface } from 'node:readline';

async function confirmResetState(target: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(
      `Reset mailbox state for ${target}? This will cause all emails to be reprocessed. [y/N] `,
      (answer) => {
        rl.close();
        resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
      },
    );
  });
}
```

---

### MI-6. Configuration Validation Rules

#### MI-6.1. Validation Function: `validateMailboxConfig()`

Added to `src/config/validator.ts`. Called only from the `mail-check` command action, NOT from the global pre-action hook.

```typescript
/**
 * Validate all mailbox configurations in the config.
 * Throws ConfigurationError for each missing/invalid field.
 * Field paths follow the pattern 'mailboxes.<name>.<field>'.
 *
 * @param config  The loaded WikiConfig with optional mailboxes section.
 * @param mailboxName  If provided, validate only this mailbox. Otherwise validate all.
 */
export function validateMailboxConfig(
  config: WikiConfig,
  mailboxName?: string,
): void;
```

**Validation rules per mailbox field**:

| Field | Rule | ConfigurationError field path |
|-------|------|-------------------------------|
| `host` | Non-empty string | `mailboxes.<name>.host` |
| `port` | Positive integer (`Number.isInteger(v) && v > 0`) | `mailboxes.<name>.port` |
| `tls` | Boolean (`typeof v === 'boolean'`) | `mailboxes.<name>.tls` |
| `user` | Non-empty string | `mailboxes.<name>.user` |
| `password` | Non-empty string | `mailboxes.<name>.password` |
| `folders` | Non-empty array of non-empty strings (`Array.isArray(v) && v.length > 0 && v.every(f => typeof f === 'string' && f.length > 0)`) | `mailboxes.<name>.folders` |
| `connectionTimeout` | Positive integer | `mailboxes.<name>.connectionTimeout` |
| `passwordExpiry` | If present, valid ISO 8601 date (`!isNaN(new Date(v).getTime())`) | `mailboxes.<name>.passwordExpiry` |

#### MI-6.2. Guard Function: `validateMailboxesExist()`

Added to `src/config/validator.ts`:

```typescript
/**
 * Guard: ensure the config has at least one mailbox configured.
 * Called at the start of the mail-check command action.
 *
 * @throws ConfigurationError if config.mailboxes is undefined or empty.
 */
export function validateMailboxesExist(config: WikiConfig): void {
  if (!config.mailboxes || Object.keys(config.mailboxes).length === 0) {
    throw new ConfigurationError(
      'mailboxes',
      'No mailbox configurations found. Add a "mailboxes" section to config.json or set WIKI_MAILBOX_* environment variables.',
    );
  }
}
```

#### MI-6.3. Password Expiry: `checkPasswordExpiry()`

Added to `src/config/validator.ts`. Follows the exact pattern of `checkApiKeyExpiry()`:

```typescript
/**
 * Check password expiry for all configured mailboxes.
 * Emits warnings/errors to stderr. Does NOT throw.
 * Follows the checkApiKeyExpiry() pattern (lines 135-167 of validator.ts).
 */
export function checkPasswordExpiry(config: WikiConfig): void {
  if (!config.mailboxes) return;

  for (const [name, mailbox] of Object.entries(config.mailboxes)) {
    if (!mailbox.passwordExpiry) continue;

    const expiryDate = new Date(mailbox.passwordExpiry);
    if (isNaN(expiryDate.getTime())) {
      process.stderr.write(
        `[WARN] mailboxes.${name}.passwordExpiry is not a valid date: ${mailbox.passwordExpiry}\n`,
      );
      continue;
    }

    const now = new Date();
    const msPerDay = 24 * 60 * 60 * 1000;
    const daysUntilExpiry = (expiryDate.getTime() - now.getTime()) / msPerDay;

    if (daysUntilExpiry < 0) {
      process.stderr.write(
        `[ERROR] Password for mailbox "${name}" expired on ${mailbox.passwordExpiry}. Please renew.\n`,
      );
    } else if (daysUntilExpiry <= 7) {
      const daysLeft = Math.ceil(daysUntilExpiry);
      process.stderr.write(
        `[WARN] Password for mailbox "${name}" expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'} (${mailbox.passwordExpiry}). Please renew soon.\n`,
      );
    }
  }
}
```

#### MI-6.4. Env Var Loading: `applyEnvOverrides()` Extension

In `src/config/loader.ts`, the `applyEnvOverrides()` function is extended to discover and parse `WIKI_MAILBOX_*` environment variables.

**Discovery pattern**: Scan `process.env` for keys matching `WIKI_MAILBOX_*_HOST` to discover mailbox names dynamically.

```typescript
// Inside applyEnvOverrides(), after existing env var handling:

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
}
```

**Type coercion rules**:
- `port`, `connectionTimeout`: `parseInt(value, 10)`
- `tls`: `value === 'true'` (string `"true"` -> boolean `true`, anything else -> `false`)
- `folders`: `value.split(',').map(f => f.trim())` (comma-separated string -> string array)

---

### MI-7. Error Handling Strategy

The error handling follows the existing project patterns (try/catch with Logger, ConfigurationError for config issues) and the spec's NFR-06 (Graceful Failure).

#### MI-7.1. Error Hierarchy

| Error Level | Scope | Behavior | Exit Code |
|-------------|-------|----------|-----------|
| **Configuration** | Pre-execution | `ConfigurationError` thrown, caught in main action handler, logged, exit 1 | 1 |
| **Mailbox connection** | Per-mailbox | Error logged via `logger.error()`, skip to next mailbox, continue | 1 (if any) |
| **Authentication** | Per-mailbox | Error logged with host/user (NOT password), skip to next mailbox | 1 (if any) |
| **Folder open** | Per-folder | Error logged, skip to next folder, continue | 1 (if any) |
| **Email processing** | Per-email | Error logged with subject/UID, email NOT marked as processed, continue | 1 (if any) |
| **Attachment download** | Per-email | Entire email fails (not marked as processed), continue to next email | 1 (if any) |
| **State save** | Per-email | Critical error logged, command continues but state may be stale | 1 |

#### MI-7.2. Credential Safety

Passwords are never logged, even in verbose mode. This is enforced at two levels:

1. **imapflow**: Configured with `logger: false` and `emitLogs: false`
2. **Application logger**: Connection errors log `host:port` and `user` but redact `password`:
   ```typescript
   logger.error(`Failed to connect to ${config.host}:${config.port} as ${config.user}: ${error.message}`);
   // NEVER: logger.error(`... password: ${config.password} ...`);
   ```

#### MI-7.3. Connection Timeout

imapflow supports `socketTimeout` and `greetingTimeout` options (both set from `connectionTimeout`). If the server does not respond within the timeout, imapflow emits a connection error which is caught at the per-mailbox level.

#### MI-7.4. Partial Email Failure

If the email body ingests successfully but an attachment fails, the entire email is treated as failed (NOT marked as processed). On the next run, the email is retried. The already-ingested body source is detected as a duplicate by the pipeline's content-hash check (`SourceRegistry.findByHash()`) and skipped automatically.

---

### MI-8. File Naming Conventions

#### MI-8.1. Email Body Files

Pattern: `email-<YYYY-MM-DD-HHmmss>-<sanitized-subject>.md`

```typescript
function generateEmailBodyFilename(envelope: EmailEnvelope): string {
  const dateStr = formatTimestamp(envelope.date);     // '2026-04-12-103000'
  const sanitized = sanitizeForFilename(envelope.subject);  // 'meeting-notes-q2'
  return `email-${dateStr}-${sanitized}.md`;
}
```

#### MI-8.2. Attachment Files

Pattern: `email-att-<YYYY-MM-DD-HHmmss>-<original-filename>`

```typescript
function generateAttachmentFilename(envelope: EmailEnvelope, originalFilename: string): string {
  const dateStr = formatTimestamp(envelope.date);
  const sanitized = sanitizeForFilename(originalFilename);
  // Preserve original extension
  return `email-att-${dateStr}-${sanitized}`;
}
```

#### MI-8.3. Filename Sanitization

```typescript
/**
 * Sanitize a string for use as a filename.
 * Removes filesystem-unsafe characters, collapses whitespace, truncates.
 */
function sanitizeForFilename(name: string): string {
  return name
    .replace(/[/\\:*?"<>|]/g, '_')    // filesystem-unsafe chars
    .replace(/\x00/g, '')              // null bytes
    .replace(/[\x01-\x1f]/g, '')       // control characters
    .replace(/\s+/g, '-')              // whitespace to hyphens
    .toLowerCase()
    .trim()
    .slice(0, 100)                     // reasonable length cap
    || 'untitled';
}
```

#### MI-8.4. Filename Deduplication

If a file with the same name already exists in `sources/files/`, append a counter suffix:

```typescript
// email-2026-04-12-103000-meeting-notes.md
// email-2026-04-12-103000-meeting-notes-1.md
// email-2026-04-12-103000-meeting-notes-2.md
```

This follows the existing `copySourceFile()` pattern in `src/ingest/pipeline.ts` (lines 562-584).

---

### MI-9. Integration with IngestPipeline

#### MI-9.1. Data Flow

```
Email in IMAP mailbox
  |
  v
ImapClient.fetchEnvelope() --> EmailEnvelope { uid, messageId, subject, from, date }
ImapClient.fetchBody()     --> EmailContent  { body, bodyFormat, usedFallback }
  |
  v
EmailProcessor.processEmail()
  |
  +-- Compose markdown body document
  |     # <Subject>
  |     **From**: <sender>
  |     **Date**: <date>
  |     <body content>
  |
  +-- Save to sources/files/email-<timestamp>-<subject>.md
  |
  +-- pipeline.ingest(bodyPath, {
  |     metadata: {
  |       source: 'email',
  |       emailMessageId: '<abc@gmail.com>',
  |       emailFrom: 'alice@example.com',
  |       emailDate: '2026-04-12T10:30:00Z',
  |       emailSubject: 'Meeting Notes Q2',
  |       mailboxName: 'work'
  |     }
  |   })
  |     --> IngestPipeline reads file, hashes, registers, summarizes,
  |         extracts entities/topics, creates wiki pages, updates index/log
  |
  +-- For each attachment:
  |     ImapClient.downloadAttachment(uid, part, destPath)
  |     Save to sources/files/email-att-<timestamp>-<filename>
  |     pipeline.ingest(attPath, {
  |       metadata: {
  |         source: 'email',
  |         emailMessageId: '<abc@gmail.com>',
  |         ...same fields...,
  |         parentEmailMessageId: '<abc@gmail.com>'
  |       }
  |     })
  |
  v
MailCheckCommand: stateManager.markProcessed() + stateManager.save()
```

#### MI-9.2. What the Pipeline Handles Automatically

The following capabilities are fully handled by `IngestPipeline.ingest()` and require no modification:

- Source file registration in `sources/registry.json` (with metadata)
- Content hash computation and duplicate detection
- LLM summarization and wiki page generation
- Entity and topic extraction
- Cross-reference insertion
- `wiki/index.md` updates via `IndexManager`
- `wiki/log.md` append via `LogWriter`
- `sources-catalog.md` regeneration
- Source status tracking (`ingesting` -> `ingested` or `failed`)

#### MI-9.3. What mail-check Adds on Top

The `mail-check` command adds the following responsibilities that are NOT part of the pipeline:

- IMAP connection and email fetching
- Email body composition (markdown formatting)
- Attachment download and file saving
- UID-based and Message-ID-based deduplication (via `MailboxStateManager`)
- Per-email atomic state updates
- Mailbox-level error isolation
- Batch summary reporting
- Password expiry warnings

---

### MI-10. CLI Registration

In `src/cli.ts`, add the import and registration alongside the existing commands:

```typescript
// In the createProgram() function, after registerIngestCommand(program):

const { registerMailCheckCommand } = await import('./commands/mail-check.js');
registerMailCheckCommand(program);
```

This follows the same dynamic import + self-registering pattern used by `registerInitCommand` and `registerIngestCommand`.

---

### MI-11. New npm Dependencies

| Package | Type | Purpose |
|---------|------|---------|
| `imapflow` | production | Modern async/await IMAP client. Provides UID search, bodyStructure parsing, streaming part download, mailbox locking. |
| `postal-mime` | production | Zero-dependency MIME parser. Used as fallback when bodyStructure traversal fails. Same author as imapflow. |
| `turndown` | production | HTML-to-markdown converter. Used when email body has only text/html (no text/plain). Configured with `headingStyle: 'atx'` for Obsidian compatibility. |
| `@types/turndown` | devDependency | TypeScript type definitions for turndown. |

**Install command**:
```bash
npm install imapflow postal-mime turndown
npm install --save-dev @types/turndown
```

---

### MI-12. Files to Create and Modify

#### New Files

| File | Purpose | Est. Lines |
|------|---------|-----------|
| `src/source/imap.ts` | ImapClient class, MIME tree traversal helpers | 200-250 |
| `src/source/mailbox-state.ts` | MailboxStateManager class, atomic persistence | 150 |
| `src/source/email-processor.ts` | EmailProcessor class, body composition, attachment handling | 200 |
| `src/commands/mail-check.ts` | Command registration, orchestration loop, summary output | 250 |
| `test_scripts/test-mailbox-config.ts` | Config validation tests | 80 |
| `test_scripts/test-imap-client.ts` | MIME tree traversal unit tests (mock data, no real IMAP) | 120 |
| `test_scripts/test-mailbox-state.ts` | State manager CRUD and atomic write tests | 80 |
| `test_scripts/test-email-processor.ts` | Email processor tests (mock pipeline + mock IMAP client) | 100 |

#### Modified Files

| File | Change |
|------|--------|
| `src/config/types.ts` | Add `MailboxConfig` interface, extend `WikiConfig` with optional `mailboxes` field (+15 lines) |
| `src/config/validator.ts` | Add `validateMailboxConfig()`, `validateMailboxesExist()`, `checkPasswordExpiry()` (+70 lines) |
| `src/config/loader.ts` | Extend `applyEnvOverrides()` for `WIKI_MAILBOX_<NAME>_*` env vars (+50 lines) |
| `src/cli.ts` | Import and register `registerMailCheckCommand` (+3 lines) |

---

### MI-13. Testing Strategy

All test scripts follow the existing pattern: standalone TypeScript files in `test_scripts/`, run via `npx tsx test_scripts/test-*.ts`, no formal test framework.

| Test Script | What It Validates |
|-------------|-------------------|
| `test-mailbox-config.ts` | `MailboxConfig` types, `validateMailboxConfig()` throws for each missing required field, env var parsing produces correct config structure, `checkPasswordExpiry()` emits correct warnings |
| `test-imap-client.ts` | `findPlainTextPart()`, `findHtmlPart()`, `findAllAttachments()`, `extractFilename()` with real bodyStructure JSON objects from the research document. Does NOT connect to a real IMAP server. Tests the MIME tree traversal logic in isolation. |
| `test-mailbox-state.ts` | `load()` creates empty state from scratch, `isUIDProcessed()` / `isMessageIdProcessed()` return correct values, `markProcessed()` updates state, `handleUIDValidityChange()` clears UIDs but not Message-IDs, `resetState()` scoping, atomic write does not corrupt on partial failure |
| `test-email-processor.ts` | Body markdown composition matches expected format, filename generation follows naming conventions, metadata keys are correctly propagated, unsupported attachments are skipped. Uses mock `IngestPipeline` and mock `ImapClient` to avoid real IMAP and LLM calls. |

---

### MI-14. Configuration Example

```json
{
  "llm": { "..." : "existing config" },
  "wiki": { "..." : "existing config" },
  "obsidian": { "..." : "existing config" },
  "mailboxes": {
    "work": {
      "host": "imap.gmail.com",
      "port": 993,
      "tls": true,
      "user": "user@gmail.com",
      "password": "abcd-efgh-ijkl-mnop",
      "folders": ["INBOX"],
      "passwordExpiry": "2026-12-31",
      "connectionTimeout": 30000
    },
    "research": {
      "host": "imap.fastmail.com",
      "port": 993,
      "tls": true,
      "user": "researcher@fastmail.com",
      "password": "xxxx-yyyy-zzzz",
      "folders": ["INBOX", "Wiki-Feed"],
      "connectionTimeout": 30000
    }
  }
}
```

**Equivalent environment variables** (override config file):
```bash
export WIKI_MAILBOX_WORK_HOST=imap.gmail.com
export WIKI_MAILBOX_WORK_PORT=993
export WIKI_MAILBOX_WORK_TLS=true
export WIKI_MAILBOX_WORK_USER=user@gmail.com
export WIKI_MAILBOX_WORK_PASSWORD=abcd-efgh-ijkl-mnop
export WIKI_MAILBOX_WORK_FOLDERS=INBOX
export WIKI_MAILBOX_WORK_TIMEOUT=30000
```

---

### MI-15. Architecture Decisions

| # | Decision | Rationale | Alternative Rejected |
|---|----------|-----------|---------------------|
| 1 | mail-check is a source producer, not a pipeline modifier | Keeps the core IngestPipeline unchanged. Email bodies and attachments are saved as files and ingested through the standard path. | Modifying the pipeline to accept in-memory content |
| 2 | Per-email atomic state save (not batch) | If the process crashes mid-run, only the last email may need reprocessing. Matches FR-68 (atomic state updates). | Save state once at end of run |
| 3 | Hybrid MIME strategy: bodyStructure + postal-mime fallback | bodyStructure traversal is memory-efficient (no full message download). postal-mime fallback handles edge cases. | Always download full source and parse with postal-mime |
| 4 | Mailbox validation is deferred (not in global pre-action hook) | Other commands should not fail due to mailbox config issues. Only `mail-check` needs valid mailbox config. | Validate mailbox config in the global hook |
| 5 | Dual-layer deduplication (UIDs + Message-IDs) | UIDs are fast (integer comparison) but invalid after UIDVALIDITY change. Message-IDs are stable across server rebuilds and mailbox moves. | UID-only deduplication |
| 6 | imapflow with `logger: false` | Prevents credential leakage. imapflow's default logger prints connection details including auth tokens. | Custom logger that redacts credentials |
| 7 | State file uses JSON array for processedMessageIds, loaded as Set in memory | JSON arrays are human-readable and debuggable. In-memory Set provides O(1) lookups. | SQLite database for state |
| 8 | Collect UIDs via search() then process individually | Avoids imapflow deadlock (cannot call download() inside fetch() iterator). Well-documented constraint. | Use fetch() async iterator with nested download() calls |
