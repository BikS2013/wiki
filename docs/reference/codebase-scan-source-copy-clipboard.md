# Codebase Scan: Source File Copying & Clipboard Ingest

**Date**: 2026-04-09

---

## 1. Current Ingest Pipeline Flow

**File**: `src/ingest/pipeline.ts`

The `IngestPipeline.ingest(sourcePath, options)` method performs 15 sequential steps:

| Step | Lines | Description |
|------|-------|-------------|
| 1 | 83-88 | Read source file from `absoluteSourcePath` using `readSource()` |
| 2 | 93 | Hash file content using `hashFile(absoluteSourcePath)` |
| 3 | 99-111 | Check registry for duplicate hash (skip if already ingested) |
| 4 | 116-139 | Register source with status `'ingesting'` -- stores `absoluteSourcePath` as `filePath` |
| 5 | 144-153 | Load wiki schema and ingest prompt template |
| 6 | 158-161 | Load `index.md` for context |
| 7 | 169-176 | LLM summarization |
| 8 | 181-192 | Write summary page to `wiki/sources/` |
| 9 | 197-209 | LLM entity/topic extraction |
| 10 | 214-286 | Create/merge entity pages |
| 11 | 291-349 | Create/merge topic pages |
| 12 | 354-371 | Insert cross-references |
| 13 | 376-402 | Update `index.md` |
| 14 | 407-419 | Append to `log.md` |
| 15 | 424-436 | Update registry status to `'ingested'`, record generated page paths |

**Key observation**: The source file is read and hashed directly from `absoluteSourcePath`. No copying occurs. The absolute path is stored verbatim in the registry.

### Registry Registration (Step 4, lines 116-139)

```typescript
// Line 117: Look up by absolute path
const existingByPath = registry.findByPath(absoluteSourcePath);
if (existingByPath) {
  sourceEntry = registry.update(existingByPath.id, {
    contentHash,
    status: 'ingesting',
    updatedAt: now,
  });
} else {
  sourceEntry = registry.add({
    filePath: absoluteSourcePath,    // <-- stores absolute path
    fileName: sourceFileName,
    format: sourceFormat,
    contentHash,
    ...
  });
}
```

---

## 2. How `SourceEntry.filePath` Is Used Across the Codebase

### Definition: `src/wiki/registry.ts`, line 14

```typescript
export interface SourceEntry {
  id: string;
  /** Absolute path to the source file */
  filePath: string;
  fileName: string;
  format: string;
  contentHash: string;
  ...
}
```

### All Usage Sites

| File | Lines | Usage | Impact of Change |
|------|-------|-------|------------------|
| `src/wiki/registry.ts` | 14 | Field definition with JSDoc "Absolute path to the source file" | Update JSDoc to "Relative path to copied source file" |
| `src/wiki/registry.ts` | 170-172 | `findByPath(filePath)` -- matches `s.filePath === filePath` | Must now accept relative paths; callers must pass relative paths |
| `src/ingest/pipeline.ts` | 117 | `registry.findByPath(absoluteSourcePath)` -- finds existing entry by original path | Must change to use relative copied path for lookup |
| `src/ingest/pipeline.ts` | 126 | `filePath: absoluteSourcePath` -- stores absolute path in new entry | Must store relative copied path instead |
| `src/lint/structural.ts` | 140 | `await hashFile(source.filePath)` -- hashes the file at the stored path | Must resolve relative path against rootDir before hashing |
| `src/lint/structural.ts` | 145, 155 | `page: source.filePath` -- used in lint finding messages | Minor: message will show relative path instead of absolute |
| `src/commands/list-sources.ts` | (none) | Does NOT use `filePath` -- only uses `fileName`, `format`, `status`, `ingestedAt`, `generatedPages` | No change needed |
| `src/commands/remove-source.ts` | (none) | Does NOT use `filePath` directly -- but should be updated to delete the copied file | Must add file deletion logic for `sources/files/<file>` |

### Summary of `filePath` Dependencies

- **Writers**: Only `src/ingest/pipeline.ts` (line 126) writes `filePath` to the registry
- **Readers**: `src/ingest/pipeline.ts` (line 117 via `findByPath`), `src/lint/structural.ts` (lines 140, 145, 155)
- **Not used**: `list-sources.ts`, `remove-source.ts`, `status.ts`

---

## 3. Where `sources/` Directory Structure Is Created

### `src/commands/init.ts`, lines 429-437

```typescript
const directories = [
  join(rootDir, 'sources'),           // <-- only 'sources/' top-level
  join(rootDir, 'wiki', 'sources'),
  join(rootDir, 'wiki', 'entities'),
  join(rootDir, 'wiki', 'topics'),
  join(rootDir, 'wiki', 'synthesis'),
  join(rootDir, 'wiki', 'queries'),
  join(rootDir, 'schema', 'prompts'),
];
```

**Change needed**: Add `join(rootDir, 'sources', 'files')` to this array.

### `src/commands/init.ts`, lines 504-511

```typescript
// 8. Create sources/registry.json
await writeTemplate(
  join(rootDir, 'sources', 'registry.json'),
  buildRegistryContent(),
  logger,
);
```

No change needed here -- `registry.json` stays at `sources/registry.json`.

### Next steps message (line 531)

```typescript
logger.info('  2. Place source documents in the sources/ directory');
```

This message should be updated since users no longer manually place files there.

---

## 4. Configuration Related to Sources Directory

### `src/config/types.ts`, line 45

```typescript
sourcesDir: string;  // defaults to 'sources'
```

The `sourcesDir` config controls the base `sources/` path. The new `sources/files/` subdirectory is a fixed convention under `sourcesDir`, not a separate config value.

### `src/templates/config-template.json`, line 24

```json
"sourcesDir": "sources"
```

No change needed.

---

## 5. Project Design Document References

### `docs/design/project-design.md`, lines 48-51

The runtime directory structure section shows:

```
sources/
  registry.json
```

This must be updated to:

```
sources/
  registry.json
  files/                  # Copied source files (wiki is self-contained)
```

### `docs/design/project-design.md`, line 40

```
Layer 1: Sources (immutable raw documents)
```

This description needs updating -- sources are now copies managed by the wiki, not external references.

---

## 6. CLI Command Registration

### `src/commands/ingest.ts`, line 22

```typescript
program
  .command('ingest <source>')
```

The `<source>` argument is required (angle brackets). For `--clipboard` support, this must become optional: `ingest [source]`. Commander supports optional arguments with square brackets.

### Current options (lines 23-26)

```typescript
.option('-r, --recursive', ...)
.option('-f, --format <type>', ...)
.option('-t, --tags <tags...>', ...)
.option('-m, --metadata <pairs...>', ...)
```

A new option must be added:
```typescript
.option('--clipboard', 'Ingest content from the system clipboard')
```

### Validation needed in the action handler

- If `--clipboard` is set and `source` is also provided, error out
- If neither `--clipboard` nor `source` is provided, error out

---

## 7. Files That Do NOT Need Modification

| File | Reason |
|------|--------|
| `src/source/reader.ts` | Reads from any file path; already supports `.txt` and `.png` |
| `src/source/hasher.ts` | Hashes any file path; path-agnostic |
| `src/ingest/summarizer.ts` | Receives content string, not file path |
| `src/ingest/extractor.ts` | Receives content string, not file path |
| `src/ingest/merger.ts` | Receives content strings |
| `src/ingest/cross-referencer.ts` | Operates on page content |
| `src/wiki/index-manager.ts` | No dependency on source file paths |
| `src/wiki/log.ts` | Receives strings |
| `src/wiki/pages.ts` | Operates on wiki pages, not source files |
| `src/wiki/frontmatter.ts` | Parsing utility |
| `src/wiki/wikilinks.ts` | Link processing |
| `src/commands/query.ts` | No source file interaction |
| `src/commands/status.ts` | Uses registry but only for counts |
| `src/commands/rebuild-index.ts` | Regenerates index from wiki pages |
| `src/config/*` | No source file path logic |
| `src/llm/*` | Provider layer, no file system interaction |
| `src/query/*` | Query pipeline, no source files |
