# Refined Request: Source File Copying & Clipboard Ingest

**Date**: 2026-04-09  
**Status**: Ready for Implementation

---

## Overview

Two changes to the ingest pipeline:

1. **Source file copying**: When ingesting, copy the source file into `<rootDir>/sources/files/` so the wiki becomes self-contained. The registry stores the copied path (relative to rootDir), not the original absolute path.
2. **Clipboard support**: New `wiki ingest --clipboard` option to ingest text or image content directly from the macOS system clipboard.

---

## Part A: Source File Copying

### Functional Requirements

**FR-A1**: When `wiki ingest <source>` is called, the pipeline MUST copy the source file into `<rootDir>/sources/files/` before any other processing.

**FR-A2**: The registry `filePath` field MUST store a path relative to rootDir (e.g., `sources/files/article.md`), not an absolute path.

**FR-A3**: If a file with the same name already exists in `sources/files/`, the pipeline MUST append a numeric suffix to avoid collision (e.g., `article.md` -> `article-1.md` -> `article-2.md`).

**FR-A4**: After copying, all downstream processing (reading, hashing, summarization) MUST operate on the copied file, not the original.

**FR-A5**: The `lint --stale` check MUST hash the copied file in `sources/files/`, not look for the original external path.

**FR-A6**: The `wiki init` command MUST create the `sources/files/` subdirectory as part of the initial directory structure.

**FR-A7**: The `remove-source` command, when removing a source, MUST also delete the copied file from `sources/files/`.

**FR-A8**: The `list-sources` command display remains unchanged (it already shows `fileName`, not `filePath`).

**FR-A9**: The `SourceEntry.filePath` field semantics change from "absolute path to original" to "relative path to copied file within the wiki root". This is a breaking change to the registry format.

**FR-A10**: For directory/recursive ingest (`--recursive`), each file in the directory MUST be individually copied into `sources/files/` (flat structure, no subdirectory mirroring).

### Files to Modify

| File | Change |
|------|--------|
| `src/ingest/pipeline.ts` | Add file-copy step before Step 1. Store relative copied path in registry. Hash the copied file. |
| `src/wiki/registry.ts` | Update `SourceEntry.filePath` JSDoc from "Absolute path" to "Relative path to copied source file within rootDir". Update `findByPath()` to match relative paths. |
| `src/commands/init.ts` | Add `sources/files/` to the directory creation list. |
| `src/commands/remove-source.ts` | After removing registry entry, also delete the copied file from `sources/files/`. |
| `src/lint/structural.ts` | In `checkStaleSources()`, resolve `source.filePath` relative to rootDir before hashing. |
| `src/commands/ingest.ts` | No change needed (it passes the original path; the pipeline handles copying). |
| `src/commands/list-sources.ts` | No functional change needed. |

### New Utility Function

Add to `src/ingest/pipeline.ts` (or a new `src/source/copier.ts`):

```typescript
/**
 * Copy a source file into <rootDir>/sources/files/, deduplicating the filename
 * if a file with the same name already exists. Returns the relative path
 * (from rootDir) of the copied file.
 */
async function copySourceFile(
  absoluteSourcePath: string,
  rootDir: string,
): Promise<string>;
```

### Deduplication Logic

```
Given: article.md
If sources/files/article.md exists:
  Try sources/files/article-1.md
  Try sources/files/article-2.md
  ...until a free name is found
```

---

## Part B: Clipboard Ingest

### Functional Requirements

**FR-B1**: A new option `--clipboard` on the `wiki ingest` command allows ingesting content from the macOS system clipboard.

**FR-B2**: When `--clipboard` is used, the `<source>` positional argument MUST NOT be required. The two modes are mutually exclusive.

**FR-B3**: The pipeline MUST detect the clipboard content type:
- If the clipboard contains image data (PNG/TIFF bitmap), save as `.png`
- If the clipboard contains text, save as `.txt`

**FR-B4**: Clipboard content MUST be saved to `sources/files/` with a generated filename: `clipboard-YYYY-MM-DD-HHmmss.{txt|png}`

**FR-B5**: After saving the clipboard content as a file, the normal ingest pipeline runs on that saved file (same as any other source).

**FR-B6**: If the clipboard is empty or contains unsupported data (e.g., file references without content), the command MUST fail with a clear error message.

### macOS Clipboard Access - Technical Notes

**Text content**:
```bash
pbpaste
```
Returns the clipboard text to stdout. Exit code 0 even if clipboard is empty (returns empty string).

**Image content detection and extraction**:
```bash
# Check if clipboard has image data
osascript -e 'clipboard info' 
# Returns e.g.: {class PNGf...}, {class TIFF...}, {class utf8...}

# Save clipboard image as PNG
osascript -e 'set pngData to the clipboard as "class PNGf"' \
          -e 'set filePath to POSIX path of "/tmp/clipboard.png"' \
          -e 'set fRef to open for access filePath with write permission' \
          -e 'write pngData to fRef' \
          -e 'close access fRef'
```

**Detection strategy**:
1. Run `osascript -e 'clipboard info'` to get available clipboard formats
2. If output contains `PNGf` or `TIFF` -> treat as image, extract PNG
3. Else if output contains `utf8` or `ut16` -> treat as text, use `pbpaste`
4. Else -> error: unsupported clipboard content

### Files to Modify / Create

| File | Change |
|------|--------|
| `src/commands/ingest.ts` | Add `--clipboard` option. Make `<source>` optional when `--clipboard` is set. Add clipboard extraction logic before calling pipeline. |
| `src/source/clipboard.ts` | **NEW** -- Clipboard content detection and extraction for macOS. Functions: `detectClipboardType()`, `extractClipboardText()`, `extractClipboardImage()`, `saveClipboardContent()`. |
| `src/source/reader.ts` | No change needed (`.txt` and `.png` are already supported formats). |

### CLI Syntax

```bash
# Ingest from clipboard (text or image auto-detected)
wiki ingest --clipboard

# Ingest from clipboard with tags
wiki ingest --clipboard --tags research notes

# Original file ingest (unchanged)
wiki ingest path/to/file.md
```

---

## Acceptance Criteria

### Source File Copying

- [ ] `wiki init` creates `sources/files/` directory
- [ ] `wiki ingest file.md` copies `file.md` into `sources/files/file.md`
- [ ] Registry entry `filePath` is `sources/files/file.md` (relative), not absolute
- [ ] Ingesting the same filename twice produces `file.md` and `file-1.md` in `sources/files/`
- [ ] `wiki lint --stale` checks the hash of the copied file, not the original
- [ ] `wiki remove-source <id>` deletes the copied file from `sources/files/`
- [ ] Directory ingest (`--recursive`) copies all files flat into `sources/files/`
- [ ] All downstream processing (summarization, entity extraction) uses copied file content

### Clipboard Ingest

- [ ] `wiki ingest --clipboard` with text on clipboard saves `.txt` and ingests it
- [ ] `wiki ingest --clipboard` with image on clipboard saves `.png` and ingests it
- [ ] `wiki ingest --clipboard` with empty clipboard prints error and exits with code 1
- [ ] `wiki ingest --clipboard` and `wiki ingest <file>` are mutually exclusive (error if both provided)
- [ ] Generated filename follows pattern `clipboard-YYYY-MM-DD-HHmmss.{txt|png}`
- [ ] Saved clipboard file appears in `sources/files/` and is registered normally

---

## Implementation Order

1. Add `sources/files/` to `init.ts` directory creation
2. Create `src/source/copier.ts` with `copySourceFile()` function
3. Modify `pipeline.ts` to copy source file and use copied path
4. Update `registry.ts` JSDoc and `findByPath()` semantics
5. Update `lint/structural.ts` to resolve relative paths
6. Update `remove-source.ts` to delete copied files
7. Create `src/source/clipboard.ts` with macOS clipboard utilities
8. Update `commands/ingest.ts` for `--clipboard` option
9. Update all documentation (project-design.md, project-functions.md, configuration-guide.md)
