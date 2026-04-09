# Investigation: LLM Wiki - Technology Stack & Architecture

## Executive Summary

The recommended stack for LLM Wiki is: **commander** for CLI framework (cleaner subcommand model, better TypeScript support), **@anthropic-ai/sdk** as the primary LLM client with a thin provider-agnostic abstraction layer, **gray-matter** for YAML frontmatter parsing, **pdf-parse** for PDF text extraction, and Node.js built-in **crypto** for SHA-256 content hashing. The prompt architecture should use a multi-step chained pipeline (summarize, extract entities, merge pages) with structured JSON output via Anthropic's tool-use mechanism. Large sources should be chunked using a section-aware strategy that respects markdown headings and PDF page boundaries. Testing should use mock LLM responses for unit tests and real LLM calls for integration tests gated behind an environment variable.

---

## Detailed Analysis

### 1. CLI Framework: commander vs yargs

**Recommendation: `commander`**

| Criterion | commander | yargs |
|-----------|-----------|-------|
| TypeScript support | Excellent -- ships with types, fluent API maps cleanly to TS | Good, but type inference on chained `.option()` is weaker |
| Subcommand model | First-class `.command()` with per-command options | Supported but more verbose; `.commandDir()` pattern can be messy |
| Bundle size | ~55 KB (lightweight) | ~200 KB (heavier, more features) |
| Maintenance | Active, stable API, backward-compatible releases | Active, but API surface is larger and has had breaking changes |
| Learning curve | Minimal -- declarative and straightforward | Moderate -- more configuration knobs |
| Ecosystem alignment | Used by Gitter (sibling project in this repo) | N/A |

**Justification**: The LLM Wiki CLI has a clean set of subcommands (init, ingest, query, lint, status, list-sources, remove-source, rebuild-index) with per-command options. Commander's subcommand model maps directly to this structure. Additionally, the sibling Gitter project already uses commander, so there is team familiarity and consistency within the macbook-desktop repo.

**Key patterns for this project**:
- Use `program.command('ingest').argument('<source>').option('--recursive')` for each subcommand
- Use `.hook('preAction')` for config loading and validation
- Global options (`--config`, `--verbose`, `--dry-run`) registered on the parent program

### 2. LLM SDK: Provider-Agnostic Client

**Recommendation: `@anthropic-ai/sdk` as primary, with a thin abstraction layer**

**Architecture**:

```typescript
// Provider interface
interface LLMProvider {
  complete(params: CompletionParams): Promise<CompletionResult>;
  completeWithTools(params: ToolCompletionParams): Promise<ToolCompletionResult>;
}

// Concrete implementations
class AnthropicProvider implements LLMProvider { ... }
class AzureOpenAIProvider implements LLMProvider { ... }
class VertexProvider implements LLMProvider { ... }

// Factory
function createProvider(config: LLMConfig): LLMProvider { ... }
```

**Key considerations**:

- **Start with Anthropic only**. Azure and Vertex can be added later behind the same interface. The abstraction layer should exist from day one, but only the Anthropic implementation needs to be built initially.
- **@anthropic-ai/sdk** (npm) provides: message creation, streaming, tool use, vision (for image sources), structured output via tool definitions.
- **Azure OpenAI**: When needed, use `@azure/openai` SDK. The abstraction normalizes the different response formats.
- **Vertex AI**: When needed, use `@anthropic-ai/sdk` with Vertex configuration (the Anthropic SDK supports Vertex as a backend via `AnthropicVertex` class).
- **Token counting**: The Anthropic SDK returns `usage.input_tokens` and `usage.output_tokens` in every response. Use these for budget tracking. For pre-call estimation, use a conservative 4 characters per token heuristic, or the `@anthropic-ai/tokenizer` package if precision is needed.

**Packages**:
- `@anthropic-ai/sdk` -- primary (required)
- `@azure/openai` -- deferred until Azure support is needed
- No additional package needed for Vertex (Anthropic SDK handles it)

### 3. Markdown/Frontmatter: gray-matter and Wiki-Link Handling

**Recommendation: `gray-matter` for frontmatter, custom regex for wiki-links**

**gray-matter** (npm):
- De facto standard for YAML frontmatter parsing in Node.js
- Parses `---\nyaml\n---\ncontent` format
- Returns `{ data, content, excerpt }` -- `data` is the parsed YAML object, `content` is the markdown body
- Supports stringifying (writing frontmatter back to markdown)
- TypeScript types available via `@types/gray-matter`
- Handles edge cases: empty frontmatter, multiline strings, arrays, nested objects

**Wiki-link extraction**:
- Use a regex: `/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g` to extract all `[[PageName]]` and `[[PageName|Display Text]]` links
- No npm package needed for this; a simple utility function suffices
- For Obsidian compatibility: file names should be kebab-case, links should use the page title (not the filename), and the `aliases` frontmatter field should list alternative names

**Obsidian compatibility checklist**:
- YAML frontmatter with `title`, `aliases`, `tags` fields
- Wiki-link syntax `[[PageName]]` (not standard markdown links)
- Callout syntax for contradictions: `> [!warning] Contradiction`
- Dataview-compatible field types (strings, arrays, dates in ISO 8601)
- No special characters in filenames beyond hyphens

**Packages**:
- `gray-matter` -- required
- `@types/gray-matter` -- dev dependency

### 4. PDF Processing

**Recommendation: `pdf-parse`**

**pdf-parse** (npm):
- Simple API: `pdfParse(buffer)` returns `{ text, numpages, info, metadata }`
- Text extraction preserves basic structure (paragraphs, line breaks)
- Lightweight -- wraps Mozilla's pdf.js
- Well-established (1M+ weekly downloads)
- Returns page count, which is useful for chunking by page

**Limitations and mitigations**:
- Does not preserve formatting (tables, columns) -- acceptable for LLM ingestion since the LLM can handle imperfect text
- Does not extract images from PDFs -- if images in PDFs need processing, that is a separate concern (out of scope for v1)
- Scanned PDFs (image-only) will return empty text -- the system should detect this and warn the user, potentially suggesting image-based ingest via LLM vision

**Alternative considered**: `pdf2json` -- more complex API, better table handling, but overkill for this use case.

**Chunking strategy for PDFs**:
- pdf-parse provides the full text. For page-based chunking, use the `pagerender` option or split on form-feed characters
- A better approach for this project: chunk by token count with overlap, since page boundaries in PDFs are often arbitrary

**Packages**:
- `pdf-parse` -- required

### 5. Content Hashing

**Recommendation: Node.js built-in `crypto` module**

No external package needed. The implementation is straightforward:

```typescript
import { createHash } from 'crypto';
import { readFile } from 'fs/promises';

async function computeFileHash(filePath: string): Promise<string> {
  const content = await readFile(filePath);
  return createHash('sha256').update(content).digest('hex');
}
```

**Use cases in LLM Wiki**:
- **Duplicate detection**: Hash new source file, compare against `sources/registry.json` entries
- **Stale detection**: Re-hash source file at lint time, compare against stored hash to detect modifications
- **Re-ingest triggering**: When source path matches but hash differs, trigger update workflow

**Design note**: Hash the raw file bytes (not decoded text) so the hash is format-agnostic and deterministic regardless of text encoding.

### 6. Prompt Architecture

**Recommendation: Multi-step chained pipeline with structured JSON output via tool use**

The ingest operation is the most complex workflow and requires careful prompt design:

**Step 1 -- Summarize Source**:
- Input: source content (full text or chunks), wiki schema
- Output: markdown summary with frontmatter (source-summary page)
- Pattern: Single prompt, markdown output

**Step 2 -- Extract Entities and Topics**:
- Input: source content, wiki schema
- Output: structured JSON list of entities and topics
- Pattern: Tool use -- define tools `extract_entities` and `extract_topics` with JSON schemas
- This leverages Anthropic's tool-use feature to get reliably structured output

```typescript
// Example tool definition for entity extraction
const extractEntitiesTool = {
  name: 'extract_entities',
  description: 'Extract entities from the source document',
  input_schema: {
    type: 'object',
    properties: {
      entities: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            type: { type: 'string', enum: ['person', 'organization', 'technology', 'concept', 'event'] },
            description: { type: 'string' },
            relatedEntities: { type: 'array', items: { type: 'string' } }
          },
          required: ['name', 'type', 'description']
        }
      }
    },
    required: ['entities']
  }
};
```

**Step 3 -- Merge/Create Pages**:
- For each entity/topic: if page exists, send existing page + new info to LLM for merge; if not, create new page
- Input: existing page content (if any), new information from source, wiki schema
- Output: updated markdown page with frontmatter
- Pattern: Single prompt per page, markdown output
- Contradiction handling: prompt instructs LLM to use `> [!warning] Contradiction` callout when new info conflicts with existing

**Step 4 -- Cross-Reference and Index Update**:
- Input: list of all created/updated pages, current index.md
- Output: updated index.md entries
- Pattern: Can be done programmatically (no LLM needed) since page frontmatter contains all necessary metadata

**Key prompt engineering principles**:
- Every prompt includes the wiki schema as system context
- Prompts use XML-tagged sections for clarity: `<source>`, `<existing_page>`, `<schema>`, `<instructions>`
- Output format is specified explicitly in each prompt
- Temperature should be low (0.2-0.3) for factual extraction, slightly higher (0.5) for synthesis

### 7. Token Management

**Recommendation: Section-aware chunking with overlap**

**Strategy**:

1. **Pre-flight token estimation**: Before sending to LLM, estimate token count. Use `content.length / 4` as a rough heuristic (conservative for English text). The Anthropic SDK reports actual usage in responses for budget tracking.

2. **Chunking triggers**: If estimated tokens exceed 70% of the model's context window (leaving room for system prompt, schema, and output), chunk the source.

3. **Chunking approaches by format**:
   - **Markdown**: Split on headings (`##`, `###`). Keep each section as a chunk. If a section exceeds the limit, split on paragraphs.
   - **PDF**: Split on page boundaries (pdf-parse provides page count). Group pages into chunks that fit the token budget.
   - **Plain text**: Split on double newlines (paragraphs). Group paragraphs into chunks.
   - **CSV/JSON**: Split on rows/records. Group into chunks.

4. **Overlap**: Include 200-500 tokens of overlap between chunks to preserve context continuity.

5. **Multi-chunk ingest workflow**:
   - Chunk 1: Full extraction (summary, entities, topics)
   - Chunks 2-N: Incremental extraction -- send previous chunk's summary as context, extract additional entities/topics
   - Final merge: Combine all chunk results, deduplicate entities by name similarity

6. **Token budget per operation**:
   - Configure `llm.maxTokens` in config (no default -- must be explicitly set)
   - Track cumulative tokens across all LLM calls in an ingest operation
   - Log token usage per operation in verbose mode

### 8. Testing Strategy

**Recommendation: Layered testing with mock LLM for unit tests, real LLM for integration tests**

**Unit Tests** (fast, no LLM):
- **Mock LLM responses**: Create fixture files with realistic LLM output for each prompt type
- **Test targets**: frontmatter parsing, wiki-link extraction, content hashing, registry CRUD, index generation, log formatting, chunking logic, config validation
- **Pattern**: Inject a mock `LLMProvider` that returns canned responses

```typescript
class MockLLMProvider implements LLMProvider {
  private responses: Map<string, CompletionResult>;
  
  async complete(params: CompletionParams): Promise<CompletionResult> {
    // Return pre-recorded response based on prompt pattern matching
  }
}
```

**Integration Tests** (slow, requires LLM API):
- Gate behind `WIKI_TEST_LLM=true` environment variable
- Test full ingest pipeline with a small source document
- Test query pipeline with a pre-built wiki
- Test lint pipeline detecting known issues
- Use a small, cheap model for integration tests if possible

**Test file organization** (per project conventions, in `test_scripts/`):
- `test_scripts/test-config.ts` -- config loading and validation
- `test_scripts/test-registry.ts` -- source registry operations
- `test_scripts/test-frontmatter.ts` -- gray-matter parsing and generation
- `test_scripts/test-wikilinks.ts` -- wiki-link extraction regex
- `test_scripts/test-hashing.ts` -- content hashing and dedup
- `test_scripts/test-chunking.ts` -- token estimation and chunking
- `test_scripts/test-ingest.ts` -- full ingest pipeline (integration)
- `test_scripts/test-query.ts` -- query pipeline (integration)
- `test_scripts/test-lint.ts` -- lint pipeline (unit + integration)

**Mock fixtures** (in `test_scripts/fixtures/`):
- Sample source documents (markdown, text, small PDF)
- Expected LLM responses for each prompt step
- Sample wiki pages for testing merge and lint

---

## Recommended Architecture

```
wiki/
  src/
    cli.ts                    # Entry point, commander setup
    commands/
      init.ts                 # wiki init
      ingest.ts               # wiki ingest
      query.ts                # wiki query
      lint.ts                 # wiki lint
      status.ts               # wiki status
      list-sources.ts         # wiki list-sources
      remove-source.ts        # wiki remove-source
      rebuild-index.ts        # wiki rebuild-index
    llm/
      provider.ts             # LLMProvider interface
      anthropic.ts            # Anthropic implementation
      azure.ts                # Azure implementation (stub/deferred)
      factory.ts              # createProvider factory
      tools.ts                # Tool definitions for structured extraction
    wiki/
      registry.ts             # Source registry CRUD
      index.ts                # index.md generation and updating
      log.ts                  # log.md append operations
      frontmatter.ts          # gray-matter wrapper, wiki page I/O
      wikilinks.ts            # Wiki-link extraction and validation
      pages.ts                # Page creation, reading, updating
    source/
      reader.ts               # Source file reading (text, PDF, image)
      hasher.ts               # SHA-256 hashing
      chunker.ts              # Token-aware chunking
    ingest/
      pipeline.ts             # Multi-step ingest orchestration
      summarizer.ts           # Step 1: source summarization
      extractor.ts            # Step 2: entity/topic extraction
      merger.ts               # Step 3: page merge logic
    config/
      loader.ts               # Config loading (CLI > env > file)
      validator.ts            # Config validation (no fallbacks)
      types.ts                # WikiConfig interface
    utils/
      tokens.ts               # Token estimation utilities
      naming.ts               # kebab-case file naming
      logger.ts               # Verbose/quiet output
  package.json
  tsconfig.json
```

**Data flow for ingest**:
1. `commands/ingest.ts` validates args and loads config
2. `source/reader.ts` reads the file, `source/hasher.ts` computes hash
3. `wiki/registry.ts` checks for duplicates, registers source
4. `source/chunker.ts` splits if needed
5. `ingest/pipeline.ts` orchestrates the multi-step LLM workflow
6. `ingest/summarizer.ts` generates source summary via LLM
7. `ingest/extractor.ts` extracts entities/topics via LLM tool use
8. `ingest/merger.ts` creates or updates entity/topic pages via LLM
9. `wiki/index.ts` updates index.md
10. `wiki/log.ts` appends log entries
11. `wiki/registry.ts` updates source status to `ingested`

**Dependency injection**: The `LLMProvider` interface is passed to pipeline components, enabling mock injection for testing.

---

## Risk Assessment

### High Risk

1. **LLM Output Reliability**: The LLM may produce inconsistent JSON structures, malformed frontmatter, or broken wiki-links. **Mitigation**: Use tool-use for structured output, validate all LLM output with schemas before writing to disk, implement retry logic for malformed responses.

2. **Token Budget Overruns**: A single ingest touching many entity/topic pages could require 10-20+ LLM calls, consuming significant tokens and time. **Mitigation**: Track cumulative token usage, provide `--dry-run` to preview what would happen, consider batching entity/topic updates.

3. **Page Merge Conflicts**: When merging new information into existing pages, the LLM might lose or corrupt existing content. **Mitigation**: Always read the full existing page before merge, include explicit "preserve all existing content" instructions in prompts, consider keeping a backup of the pre-merge page.

### Medium Risk

4. **PDF Text Quality**: pdf-parse may return garbled text for complex PDFs (multi-column, tables, scanned). **Mitigation**: Log a warning when extracted text appears abnormally short or contains high Unicode noise. Suggest image-based ingest as a fallback.

5. **Naming Collisions**: Two entities with the same name (e.g., "Mercury" the planet vs the element) will conflict. **Mitigation**: Include entity type in filename (e.g., `mercury-planet.md`), use `aliases` frontmatter for disambiguation.

6. **Large Wiki Scaling**: As the wiki grows to hundreds of pages, loading `index.md` into the LLM context for every query becomes expensive. **Mitigation**: Use a condensed index format, implement section-based index loading, or introduce a lightweight search mechanism.

### Low Risk

7. **Configuration Complexity**: Supporting three LLM providers adds configuration surface area. **Mitigation**: Start with Anthropic only; the provider interface exists but Azure/Vertex implementations are deferred.

8. **Obsidian Compatibility Edge Cases**: Obsidian's wiki-link resolution has nuances (case sensitivity, folder resolution). **Mitigation**: Follow Obsidian's "shortest path" link resolution, test with an actual Obsidian vault.

---

## Technical Research Guidance

Research needed: Yes

### Topic: Anthropic SDK Structured Output & Tool Use
- **Why**: The ingest workflow requires the LLM to return structured JSON (entities, topics, cross-references) alongside markdown. Need to confirm the best pattern for this with the current Anthropic SDK.
- **Focus**: Tool use for structured extraction, JSON mode, prompt patterns for multi-step workflows
- **Depth**: targeted

### Topic: Anthropic SDK Token Counting
- **Why**: The chunking strategy needs accurate pre-call token estimation. Need to determine whether to use a heuristic, the `@anthropic-ai/tokenizer` package, or the API's token counting endpoint.
- **Focus**: Available token counting methods, accuracy vs performance tradeoffs, how to estimate prompt + context size before making the API call
- **Depth**: targeted

### Topic: pdf-parse Page-Level Extraction
- **Why**: The chunking strategy for PDFs benefits from page-level extraction. Need to confirm whether pdf-parse supports per-page text extraction or if custom page splitting is needed.
- **Focus**: `pagerender` option behavior, form-feed character splitting, alternative approaches for page-level extraction
- **Depth**: shallow

### Topic: gray-matter Roundtrip Fidelity
- **Why**: The merge workflow reads a page (parsing frontmatter), modifies it, and writes it back. Need to confirm that gray-matter preserves YAML formatting and does not corrupt special characters, arrays, or dates during roundtrip.
- **Focus**: Stringify behavior, date handling (ISO 8601), array formatting, Obsidian-specific fields (`aliases`)
- **Depth**: shallow

### Topic: Obsidian Wiki-Link Resolution Rules
- **Why**: Generated wiki-links must resolve correctly in Obsidian. Need to understand Obsidian's exact link resolution algorithm (case sensitivity, shortest path, folder handling).
- **Focus**: How Obsidian resolves `[[PageName]]` to files, case sensitivity rules, behavior with duplicate page names, alias resolution
- **Depth**: shallow
