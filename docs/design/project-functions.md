# LLM Wiki - Functional Requirements & Feature Descriptions

**Date**: 2026-04-09
**Status**: Draft -- derived from refined-request-llm-wiki.md

---

## Source Management

### FR-01: Source File Registration
The CLI must accept a source file path (or directory of files) and register it in the sources layer.
- Input: absolute or relative file path, or directory path
- The system creates an entry in `sources/registry.json`
- When a directory is provided with `--recursive`, all supported files within are registered individually

### FR-02: Source Registry
The system must maintain a source registry (`sources/registry.json`) tracking all ingested sources with metadata:
- `id`: UUID
- `filePath`: absolute or relative path to source file
- `fileName`: original filename
- `format`: file extension
- `contentHash`: SHA-256 hash
- `ingestedAt`: ISO 8601 timestamp
- `updatedAt`: ISO 8601 timestamp
- `status`: one of `pending`, `ingesting`, `ingested`, `failed`, `stale`
- `generatedPages`: array of relative paths to wiki pages created from this source
- `metadata`: optional user-provided key-value pairs

### FR-03: Source Immutability
Sources must be treated as immutable. The tool must never modify files in the sources directory. The registry tracks original file paths; files are not copied.

### FR-04: Supported Source Formats
The system must support the following source formats:
- Text: `.md`, `.txt`
- Data: `.json`, `.csv`
- PDF: `.pdf` (text extracted via pdf-parse)
- Images: `.png`, `.jpg`, `.jpeg`, `.webp` (processed via LLM vision using base64 encoding)

### FR-05: Duplicate Source Detection
The system must detect duplicate sources by SHA-256 content hash and warn the user when attempting to ingest a file whose content hash already exists in the registry.

### FR-06: Source Re-Ingestion
The system must support re-ingesting an updated source (same path, different content hash), triggering wiki page updates. The source status transitions from `ingested` to `ingesting` and back to `ingested` upon completion.

---

## Ingest Operation

### FR-07: Source Summary Generation
The `ingest` command must read the source document, generate a summary page in markdown with YAML frontmatter, and place it under `wiki/sources/` with the naming pattern `summary-<source-name>.md`.

### FR-08: Entity Extraction and Page Creation
During ingest, the system must identify entities (people, organizations, concepts, technologies, events) mentioned in the source and create or update dedicated entity pages under `wiki/entities/`. Entity extraction uses LLM tool-use with the `extract_entities` tool definition for structured JSON output.

### FR-09: Topic Extraction and Page Creation
During ingest, the system must identify topics and concepts, and create or update topic pages under `wiki/topics/`.

### FR-10: Index Update on Ingest
During ingest, the system must update `wiki/index.md` with entries for all new or modified pages. Each index entry includes: link, one-line summary, type, last-updated date, and tags.

### FR-11: Log Entry on Ingest
During ingest, the system must append a structured log entry to `wiki/log.md` in the format: `[YYYY-MM-DD HH:mm] [ACTION] description`.

### FR-12: Cross-Reference Insertion
During ingest, the system must insert cross-references using Obsidian wiki-link syntax `[[PageName]]` between related pages. Cross-references are determined by the LLM extraction step and inserted programmatically.

### FR-13: Page Merging with Contradiction Detection
When updating an existing wiki page, the system must preserve existing content and merge new information. Contradictions between existing and new information must be noted explicitly with an Obsidian callout: `> [!warning] Contradiction`.

### FR-14: Wiki Page Frontmatter
Each wiki page must include YAML frontmatter with the following fields:
- `title`: string -- page title
- `type`: one of `source-summary`, `entity`, `topic`, `synthesis`, `comparison`, `query-result`
- `created`: string -- ISO 8601 date
- `updated`: string -- ISO 8601 date
- `sources`: array of strings -- source IDs or file references
- `tags`: array of strings
- `aliases`: (optional) array of strings -- alternative names for Obsidian
- `status`: (optional) one of `draft`, `reviewed`, `stable`

Dates are stored as quoted ISO 8601 strings to prevent YAML auto-coercion. Frontmatter is parsed with gray-matter using `JSON_SCHEMA` engine.

---

## Query Operation

### FR-15: Natural Language Query
The `query` command must accept a natural-language question and search the wiki for relevant pages.

### FR-16: Index-Based Lookup
Query must use `index.md` as the primary lookup mechanism. The index content is sent to the LLM along with the question to identify candidate pages.

### FR-17: LLM-Powered Synthesis
Query must read relevant wiki pages and synthesize an answer using the LLM. The answer must include citations in `[[PageName]]` wiki-link format.

### FR-18: Stdout Output
Query must output the answer to stdout in markdown format.

### FR-19: Save Query Result
Query must support a `--save` flag that files the answer as a new wiki page under `wiki/queries/` with frontmatter type `query-result`, updates the index, and appends to the log.

---

## Lint Operation

### FR-20: Orphan Page Detection
The `lint` command must scan the wiki for orphan pages -- pages not referenced in `index.md` or by any other page via wiki-links.

### FR-21: Broken Link Detection
Lint must detect broken wiki-links -- `[[PageName]]` references where no corresponding `.md` file exists in the wiki.

### FR-22: Stale Source Detection
Lint must detect stale claims -- source-summary pages whose source file has been modified since last ingest, determined by comparing the current SHA-256 hash against the hash stored in the registry.

### FR-23: Missing Cross-Reference Detection
Lint must detect missing cross-references -- pages that mention entities or concepts that have dedicated pages but lack `[[wiki-links]]` to those pages. This check is LLM-powered.

### FR-24: Lint Report
Lint must produce a structured report to stdout categorized by severity (error, warning, suggestion). Optionally writes the report to `wiki/lint-report.md` via `--output` flag.

### FR-25: Contradiction Detection
Lint must detect contradictions across pages -- pages that assert conflicting facts about the same entity or topic. This check is LLM-powered and operates by loading entity/topic pages in batches.

---

## Index and Log

### FR-26: Index Structure
`index.md` must contain a categorized catalog of all wiki pages. Each entry includes: link (wiki-link to the page), one-line summary, type, last-updated date, and tags. The index is structured as a markdown table, grouped by page type.

### FR-27: Log Format
`log.md` must be append-only with entries in the format:
```
[YYYY-MM-DD HH:mm] [ACTION] description
```
Where ACTION is one of: `INGEST`, `UPDATE`, `QUERY`, `LINT`, `CREATE_PAGE`, `UPDATE_PAGE`, `DELETE_PAGE`, `INIT`.

### FR-28: Status Command
The CLI must provide a `status` command that shows wiki statistics:
- Total pages by type (source-summary, entity, topic, synthesis, query-result)
- Total sources by status (pending, ingesting, ingested, failed, stale)
- Last ingest date
- Quick health summary (orphan count, broken link count, stale source count)

---

## Wiki Maintenance

### FR-29: Rebuild Index
The CLI must provide a `rebuild-index` command that regenerates `index.md` from scratch by scanning all `.md` files in the `wiki/` directory, parsing their frontmatter, and producing a fresh index.

### FR-30: Remove Source
The CLI must provide a `remove-source` command that:
1. Prompts the user for confirmation
2. Removes the source entry from `sources/registry.json`
3. Removes the associated summary page from `wiki/sources/`
4. Updates `wiki/index.md` to remove the summary page entry
5. Appends a `DELETE_PAGE` log entry to `wiki/log.md`

### FR-31: List Sources
The CLI must provide a `list-sources` command that displays all registered sources in a formatted table with columns: ID, filename, format, status, ingested date, generated pages count.

---

## CLI Interface

### FR-32: Global Options
All commands support the following global options:
- `--config <path>`: path to config.json (default: `./config.json` relative to current directory)
- `--verbose`: enable verbose output including LLM call details and token usage
- `--dry-run`: show what would be done without making any file changes
- `--help`: show help text
- `--version`: show version

### FR-33: Ingest Options
The `ingest` command supports:
- `<source>`: required argument -- path to source file or directory
- `--recursive`: scan directory recursively for supported source files
- `--format <type>`: force source format (auto-detected by default from extension)
- `--tags <tags...>`: tags to apply to all generated wiki pages
- `--metadata <key=value...>`: additional metadata key-value pairs for the source registry entry

### FR-34: Query Options
The `query` command supports:
- `<question>`: required argument -- natural-language question string
- `--save`: save the answer as a new wiki page under `wiki/queries/`
- `--pages <n>`: maximum number of wiki pages to consult for the answer

### FR-35: Lint Options
The `lint` command supports:
- `--fix`: attempt to auto-fix issues (update broken links where unambiguous, add missing index entries)
- `--output <path>`: write report to file (default: stdout only)
- `--category <type>`: only run checks of a specific category: `orphans`, `links`, `stale`, `contradictions`

---

## Configuration

### FR-36: No Fallback Values
Missing required configuration fields must raise a `ConfigurationError` exception with the field name. No default or fallback values are permitted.

### FR-37: Configuration Priority
Configuration values are resolved in this priority order (highest wins):
1. CLI arguments
2. Environment variables
3. Config file (`config.json`)

### FR-38: Environment Variable Override
The following environment variables override config file values:
- `WIKI_LLM_PROVIDER` overrides `llm.provider`
- `WIKI_LLM_API_KEY` overrides `llm.apiKey`
- `WIKI_LLM_MODEL` overrides `llm.model`
- `WIKI_LLM_MAX_TOKENS` overrides `llm.maxTokens`
- `WIKI_ROOT_DIR` overrides `wiki.rootDir`
- `WIKI_AZURE_ENDPOINT` overrides `llm.azureEndpoint`
- `WIKI_AZURE_DEPLOYMENT` overrides `llm.azureDeployment`

### FR-39: API Key Expiry Warning
If `llm.apiKeyExpiry` is set in the config and the expiry date is within 7 days of the current date, the CLI must print a warning to stderr on every command invocation.

---

## Technical Requirements

### TR-01: TypeScript Strict Mode
All code must be written in TypeScript with strict mode enabled and ES2022+ target.

### TR-02: Node.js LTS
Runtime requires Node.js LTS (>=20).

### TR-03: Package Manager
npm is the package manager.

### TR-04: CLI Framework
`commander` is the CLI framework (consistent with sibling Gitter project).

### TR-05: LLM SDK
`@anthropic-ai/sdk` is the primary LLM client. Initial implementation supports Anthropic only. Azure and Vertex are deferred behind the `LLMProvider` interface.

### TR-06: Frontmatter Library
`gray-matter` with `JSON_SCHEMA` engine (via `js-yaml`) to prevent YAML date auto-coercion.

### TR-07: PDF Library
`pdf-parse` (v1) or `@cedrugs/pdf-parse` for PDF text extraction. Per-page splitting via form-feed character (`\f`).

### TR-08: Content Hashing
SHA-256 via Node.js built-in `crypto` module. Hash raw file bytes for deterministic, format-agnostic results.

### TR-09: File I/O
Node.js `fs/promises` for all file operations. No database required.

### TR-10: Obsidian Compatibility
- Wiki-link syntax: `[[PageName]]` and `[[PageName|Display Text]]`
- YAML frontmatter with `aliases` field
- Tags in frontmatter
- Kebab-case filenames (Obsidian-safe, no special characters)
- Case-insensitive link resolution awareness

### TR-11: Token Management
- Heuristic estimation (hybrid chars/4 + words*1.3) for initial chunking pass
- API-based `countTokens()` for verification when near context limit
- Cumulative `UsageTracker` across all LLM calls per operation
- Token usage reported in `--verbose` mode

### TR-12: Testing
All test scripts placed in `test_scripts/` directory. Unit tests use mock LLM provider. Integration tests gated behind `WIKI_TEST_LLM=true` environment variable.

### TR-13: Documentation
All tools documented in `CLAUDE.md` per project conventions.

---

## Multi-Provider LLM Support

### FR-40: Azure AI Provider
The system must support Azure AI Inference as an LLM provider. When `provider` is set to `"azure"`, the system must use the Azure AI Inference SDK (`@azure-rest/ai-inference`) to communicate with the configured Azure endpoint and deployment. The provider must implement the `LLMProvider` interface (`complete`, `completeWithTools`, `countTokens`) so all upstream modules work without modification.

### FR-41: Azure AI Tool Use
The Azure AI provider must support structured tool-use output (`completeWithTools`) using the Azure AI Inference chat completions API with function calling. The provider must translate the internal `ToolDefinition` format to Azure's `ChatCompletionsFunctionToolDefinition` format (with `type: "function"` wrapper and `function.parameters` from `input_schema`) and extract the function call result from `response.body.choices[0].message.tool_calls[0]`. Function call arguments are returned as a JSON string by Azure and must be parsed with `JSON.parse()`.

### FR-42: Azure AI Token Counting
The Azure AI provider must implement `countTokens` using heuristic estimation (character-based `estimateTokens()` function) since the Azure AI Inference API does not provide a native token counting endpoint.

### FR-43: Vertex AI Provider
The system must support Google Vertex AI as an LLM provider. When `provider` is set to `"vertex"`, the system must use the `@google/genai` SDK (NOT the deprecated `@google-cloud/vertexai`) to communicate with the Gemini API via Vertex AI backend. Authentication uses Application Default Credentials (ADC); no API key is required.

### FR-44: Vertex AI Tool Use
The Vertex AI provider must support structured tool-use output using Gemini's function calling capability. The provider must translate the internal `ToolDefinition` format to Gemini's `FunctionDeclaration` format using `parametersJsonSchema` (direct JSON Schema pass-through). Forced tool use is achieved via `FunctionCallingConfigMode.ANY` with `allowedFunctionNames`. Function call arguments (`call.args`) are already parsed objects (no `JSON.parse()` needed, unlike Azure).

### FR-45: Vertex AI Token Counting
The Vertex AI provider must implement `countTokens` using the native Gemini `ai.models.countTokens()` API, providing more accurate token counts than the heuristic estimation used by Anthropic and Azure providers.

### FR-46: Provider-Agnostic Retry
The retry module (`callWithRetry`) must work with all three providers without importing any provider-specific SDK. Error classification must use duck-typing on HTTP status codes:
- Read `.status` as number (Anthropic, Google GenAI) or parse from string (Azure converted wrapper)
- Read `.headers["retry-after"]` when available (Azure 429 responses)
- Classification: 429 and 500+ are retryable; 400, 401, 403 fail fast; no-status errors fail fast
- Exponential backoff with configurable options (unchanged `RetryOptions` interface)

### FR-47: Extended Context Limits
The `PromptBudgetAnalyzer` must include context window limits for commonly used models across all three providers:
- Azure-hosted OpenAI: `gpt-4o` (128K), `gpt-4o-mini` (128K), `gpt-4-turbo` (128K), `gpt-4.1` (1M), `gpt-4.1-mini` (1M), `gpt-4.1-nano` (1M)
- Azure-hosted Mistral: `mistral-large-latest` (128K), `mistral-large-2411` (128K)
- Azure-hosted DeepSeek: `deepseek-r1` (64K), `DeepSeek-V3.1` (128K)
- Google Gemini: `gemini-2.0-flash` (1M), `gemini-2.5-flash` (1M), `gemini-2.5-pro` (1M), `gemini-1.5-pro` (2M), `gemini-1.5-flash` (1M)

### FR-48: Provider-Specific Configuration Validation
The validator must enforce provider-specific required fields with no fallback values:
- `anthropic`: requires `apiKey`
- `azure`: requires `apiKey`, `azureEndpoint`, `azureDeployment`
- `vertex`: requires `vertexProjectId`, `vertexLocation`; does NOT require `apiKey`
The `apiKey` field becomes optional in the TypeScript interface. The `checkApiKeyExpiry()` function skips when provider is `vertex` (Vertex uses ADC, no expiring API key).

### FR-49: Factory Routing
The `createProvider` factory must instantiate the correct provider class based on `config.provider`: `AnthropicProvider` for `"anthropic"`, `AzureAIProvider` for `"azure"`, `VertexAIProvider` for `"vertex"`. The exhaustive switch ensures compile-time safety against unhandled providers.

### FR-50: Vertex Configuration Environment Variables
The following new environment variables must be supported:
- `WIKI_VERTEX_PROJECT_ID` maps to `llm.vertexProjectId`
- `WIKI_VERTEX_LOCATION` maps to `llm.vertexLocation`
These follow the same priority order as existing env vars: CLI arguments > environment variables > config.json.
