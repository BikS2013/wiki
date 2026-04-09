# Research: PDF Extraction, Gray-Matter Roundtrip, and Obsidian Link Resolution

**Date**: 2026-04-09  
**Project**: LLM Wiki TypeScript CLI  
**Purpose**: Shallow reference research for three topics that directly affect implementation decisions in the wiki CLI.

---

## Table of Contents

1. [Topic 1: pdf-parse Page-Level Extraction](#topic-1-pdf-parse-page-level-extraction)
2. [Topic 2: gray-matter Roundtrip Fidelity](#topic-2-gray-matter-roundtrip-fidelity)
3. [Topic 3: Obsidian Wiki-Link Resolution Rules](#topic-3-obsidian-wiki-link-resolution-rules)
4. [Assumptions & Scope](#assumptions--scope)
5. [References](#references)

---

## Topic 1: pdf-parse Page-Level Extraction

### Overview

The npm ecosystem has two distinct generations of `pdf-parse`. The original (v1, by `rl-wallaby`) is still the most widely installed and is what most tutorials reference. A modern rewrite (v2 class-based, under `mehmet-kozan`) was released later with a different API. A maintained fork (`@cedrugs/pdf-parse`) tracks the original API with bundled TypeScript types.

This research covers **per-page text extraction** across these variants.

---

### Does pdf-parse Support Per-Page Extraction?

**v1 (original npm `pdf-parse`)** — indirect support only.

The v1 API returns a single `result.text` string. Pages are concatenated with **form feed characters** (`\f`, Unicode `\u000C`). Splitting on `\f` is the standard workaround for per-page extraction.

The `pagerender` option allows a custom callback that is invoked once per page before concatenation. This is the only hook for intercepting page-level content in v1.

**v2 (`mehmet-kozan/pdf-parse`)** — direct support via `partial`, `first`, `last` options and a `pages` array in the result.

---

### How the `pagerender` Option Works (v1)

`pagerender` is a callback that receives a `pageData` object (a PDF.js page proxy) and must return a Promise resolving to the page's text string. The library calls this for each page and concatenates the results with `\f`.

```typescript
import fs from 'fs';
import pdf from 'pdf-parse';

// Capture per-page text while pdf-parse does its work
const pageTexts: string[] = [];

function pagerender(pageData: any): Promise<string> {
  const renderOptions = {
    normalizeWhitespace: false,
    disableCombineTextItems: false,
  };
  return pageData.getTextContent(renderOptions).then((textContent: any) => {
    let lastY: number | undefined;
    let text = '';
    for (const item of textContent.items) {
      if (lastY === item.transform[5] || lastY === undefined) {
        text += item.str;
      } else {
        text += '\n' + item.str;
      }
      lastY = item.transform[5];
    }
    pageTexts.push(text);
    return text;
  });
}

async function extractPages(filePath: string): Promise<string[]> {
  const buffer = fs.readFileSync(filePath);
  await pdf(buffer, { pagerender });
  return pageTexts;
}
```

**Important caveat**: v1.0.9 and above changed internal rendering behavior. If you are on an older pinned version, verify the callback still fires as expected.

---

### Splitting by Form Feed Character (v1 workaround)

When you only need text content and not coordinate data, the `\f` split is simpler and faster than a custom `pagerender`:

```typescript
import fs from 'fs';
import pdf from 'pdf-parse';

async function getPagesViaFormFeed(filePath: string): Promise<string[]> {
  const buffer = fs.readFileSync(filePath);
  const result = await pdf(buffer);
  // result.text joins pages with \f (form feed, \u000C)
  const pages = result.text.split('\f');
  // Trim trailing empty entry that may appear after the last \f
  if (pages.length > 0 && pages[pages.length - 1].trim() === '') {
    pages.pop();
  }
  return pages;
}
```

**Reliability note**: The form feed is only present when the default `pagerender` is used. If you supply a custom `pagerender` that does not insert `\f`, splitting will not work. Stick to one approach.

---

### v2 API: Direct Per-Page Extraction

The `mehmet-kozan/pdf-parse` v2 package has a class-based API with native per-page support:

```typescript
import { PDFParse } from 'pdf-parse';

async function extractSpecificPages(pdfUrl: string, pages: number[]): Promise<void> {
  const parser = new PDFParse({ url: pdfUrl });

  // Extract only pages 1, 3, and 5
  const result = await parser.getText({ partial: [1, 3, 5] });
  console.log(result.pages[0].text); // Page 1 text
  console.log(result.pages[1].text); // Page 3 text

  // Extract first 5 pages
  const first5 = await parser.getText({ first: 5 });

  // Extract pages 2 through 5 (range)
  const range = await parser.getText({ first: 2, last: 5 });

  await parser.destroy(); // Always release resources
}
```

**Node.js compatibility**: v2 requires Node.js >= 20.16.0, >= 22.3.0, or >= 23.0.0. It does **not** support Node.js 18 or 19.

---

### Better Alternatives for Page-Level Extraction

| Library | Per-Page Support | Coordinates | Node Compatibility | Notes |
|---|---|---|---|---|
| `pdf-parse` v1 | Via `pagerender` + `\f` split | No | Node 12+ | Simplest; widest usage |
| `pdf-parse` v2 (`mehmet-kozan`) | `partial`, `first`, `last` | No | Node 20+ only | Modern API; breaking Node requirement |
| `@cedrugs/pdf-parse` | Same as v1 + native TypeScript types | No | Node 18+ | Best drop-in for TS projects |
| `pdfjs-dist` | Full per-page objects | Yes (x,y) | Node 12+ | Most powerful; more verbose |
| `pdf2json` | Per-page JSON objects | Yes | Node 12+ | Good for forms and tables |
| `pdfreader` | Event-based per-item | Yes (row,column) | Node 12+ | Best for table extraction |

**Recommendation for the wiki CLI**: Use `@cedrugs/pdf-parse` for simple text extraction with TypeScript support and Node 18+ compatibility. If coordinate-level precision is needed (e.g., detecting headers by position), switch to `pdfjs-dist`.

---

### Page Count and Metadata

In v1, `result.numpages` gives the total page count. In v2, `parser.getInfo({ parsePageInfo: true })` returns per-page metadata.

```typescript
// v1 - basic metadata
const result = await pdf(buffer);
console.log(result.numpages);  // total pages
console.log(result.info);      // author, creation date, etc.
console.log(result.metadata);  // XMP metadata if present
```

---

## Topic 2: gray-matter Roundtrip Fidelity

### Overview

`gray-matter` is the de-facto standard for parsing YAML frontmatter in the Node.js ecosystem (used by Gatsby, Astro, VitePress, TinaCMS, and many others). The question for the wiki CLI is: if you parse a file, modify the data object, and stringify it back, is the output byte-for-byte identical to the original?

**Short answer**: No, roundtrip is not guaranteed to be identical. Understanding the specific differences is essential to avoid data corruption.

---

### What Happens During Stringify

`matter.stringify(content, data)` delegates serialization to `js-yaml`'s `dump()` function. The result is re-serialized YAML, not the original frontmatter text. This means:

- Key ordering may change (YAML does not guarantee key order, and `js-yaml` may reorder)
- Whitespace and indentation may change
- Quoted strings may gain or lose quotes
- Comments in the original frontmatter are **lost**
- Date strings may be converted to JavaScript `Date` objects and re-serialized differently

```typescript
import matter from 'gray-matter';
import { readFileSync, writeFileSync } from 'fs';

// UNSAFE: may silently alter frontmatter formatting
function unsafeReadModifyWrite(filePath: string, newTitle: string): void {
  const raw = readFileSync(filePath, 'utf-8');
  const parsed = matter(raw);
  parsed.data.title = newTitle;
  const output = matter.stringify(parsed.content, parsed.data);
  writeFileSync(filePath, output, 'utf-8');
}
```

---

### Date Handling: The Biggest Gotcha

YAML 1.1 (which `js-yaml` uses by default) automatically parses date-like strings into JavaScript `Date` objects. This means:

```yaml
# Original frontmatter
date: 2024-01-15
created: 2023-06-30T14:22:00Z
```

After `matter(raw)`, `parsed.data.date` is a JavaScript `Date` object, not a string. When stringified back, `js-yaml` will re-serialize it in a different format.

**Example of lossy roundtrip:**

```typescript
import matter from 'gray-matter';

const input = `---
date: 2024-01-15
---
Content`;

const parsed = matter(input);
console.log(typeof parsed.data.date);  // 'object' (Date), not 'string'
console.log(parsed.data.date);         // 2024-01-15T00:00:00.000Z

const output = matter.stringify(parsed.content, parsed.data);
// Output frontmatter:
// ---
// date: 2024-01-15T00:00:00.000Z   <-- CHANGED from original
// ---
```

**Fix: disable date parsing** by using `js-yaml` with `FAILSAFE_SCHEMA` or a custom engine:

```typescript
import matter from 'gray-matter';
import yaml from 'js-yaml';

// Option A: Pass js-yaml options through gray-matter engines config
const parsed = matter(raw, {
  engines: {
    yaml: {
      parse: (str: string) => yaml.load(str, { schema: yaml.JSON_SCHEMA }),
      stringify: (obj: object) => yaml.dump(obj, { schema: yaml.JSON_SCHEMA }),
    },
  },
});

// Option B: Quote the date in the source file so YAML treats it as a string
// date: "2024-01-15"    <-- preserves as string
```

`JSON_SCHEMA` treats all bare values that look like dates as strings, preventing auto-coercion.

---

### Array Handling

Arrays roundtrip reliably in terms of values, but formatting changes:

```yaml
# Original (flow style, single line)
tags: [typescript, cli, obsidian]

# After stringify (block style, multi-line)
tags:
  - typescript
  - cli
  - obsidian
```

This is a formatting difference only — the semantic values are preserved. However, a diff-based tool or a user inspecting the file will see it as a change.

**Obsidian `aliases` field** is an array and will be subject to the same reformatting:

```yaml
# Original Obsidian frontmatter
aliases: [My Note, MyNote]

# After gray-matter stringify
aliases:
  - My Note
  - MyNote
```

Obsidian parses both formats correctly, so this is safe semantically but noisy in version control.

---

### Special Character Handling

Strings containing YAML special characters (`:`, `#`, `{`, `}`, `[`, `]`) will be quoted in the output:

```yaml
# Original
title: Foo: Bar

# After stringify
title: 'Foo: Bar'
```

This is semantically correct but not byte-for-byte identical.

---

### Best Practices for Read-Modify-Write

**1. String-preserving approach** — only replace the frontmatter block surgically using regex:

```typescript
import matter from 'gray-matter';
import yaml from 'js-yaml';

function safeUpdateFrontmatter(
  raw: string,
  updates: Record<string, unknown>
): string {
  const parsed = matter(raw, {
    engines: {
      yaml: {
        parse: (str: string) => yaml.load(str, { schema: yaml.JSON_SCHEMA }) as object,
        stringify: (obj: object) =>
          yaml.dump(obj, {
            schema: yaml.JSON_SCHEMA,
            lineWidth: -1,         // Prevent line wrapping
            quotingType: '"',      // Consistent quote style
            forceQuotes: false,
          }),
      },
    },
  });

  // Merge updates into existing data
  const newData = { ...parsed.data, ...updates };

  // Rebuild only the frontmatter block; preserve the body exactly
  const newFrontmatter = yaml.dump(newData, {
    schema: yaml.JSON_SCHEMA,
    lineWidth: -1,
  });

  return `---\n${newFrontmatter}---\n${parsed.content}`;
}
```

**2. Preserve unknown fields** — always spread existing data before applying updates so you do not lose fields you did not explicitly handle.

**3. Treat dates as strings** — store dates as quoted strings in frontmatter (`"2024-01-15"`) if you do not need `Date` object semantics in code. This prevents the auto-coercion issue entirely.

**4. Avoid re-stringifying if unchanged** — compare `parsed.data` to your intended output before writing; skip the write if nothing changed.

**5. Never rely on key order** — if downstream tools depend on frontmatter key order, document this assumption explicitly. `js-yaml` does not guarantee insertion order.

---

### Obsidian-Specific Fields: `aliases`

Obsidian recognizes `aliases` as a special field. Key behaviors:

- Obsidian accepts both `aliases: [a, b]` (flow) and block list style
- If you stringify with gray-matter and the value becomes block-style, Obsidian still resolves it correctly
- The field name must be exactly `aliases` (lowercase); Obsidian does not recognize `alias` (singular) for link resolution purposes
- `tags` follows the same pattern

```typescript
// Reading aliases safely (as strings, not Date objects)
import matter from 'gray-matter';
import yaml from 'js-yaml';

interface ObsidianFrontmatter {
  title?: string;
  aliases?: string[];
  tags?: string[];
  date?: string;  // Keep as string
  [key: string]: unknown;
}

function parseObsidianFrontmatter(raw: string): ObsidianFrontmatter {
  const parsed = matter(raw, {
    engines: {
      yaml: {
        parse: (str: string) =>
          yaml.load(str, { schema: yaml.JSON_SCHEMA }) as object,
        stringify: (obj: object) =>
          yaml.dump(obj, { schema: yaml.JSON_SCHEMA }),
      },
    },
  });
  return parsed.data as ObsidianFrontmatter;
}
```

---

## Topic 3: Obsidian Wiki-Link Resolution Rules

### Overview

Understanding how Obsidian resolves `[[PageName]]` to actual files is critical for generating wikilinks programmatically in the CLI. This section covers the resolution algorithm, case sensitivity, duplicate handling, alias resolution, and naming conventions.

---

### Resolution Algorithm

Obsidian maintains an in-memory index of all filenames in the vault at startup and updates it as files change. When resolving `[[PageName]]`:

1. **Exact stem match** (case-insensitive): find a file whose name without extension matches `PageName`. Extension `.md` is assumed unless specified otherwise.
2. **Shortest path** (default setting): if the filename is globally unique in the vault, Obsidian stores and resolves just the bare name. No path prefix is needed.
3. **Disambiguation by path**: if two files share the same name in different folders, the link must include enough path to be unambiguous — e.g., `[[Folder/PageName]]`.
4. **Alias match**: if a note has `aliases` in frontmatter, Obsidian also indexes those aliases. A link matching an alias resolves to that note.

**Resolution stops at the first match**. If a bare `[[PageName]]` matches both a note named `PageName.md` at the root and an alias on another note, the filename match wins.

---

### Case Sensitivity

Obsidian link resolution is **case-insensitive**. `[[my note]]`, `[[My Note]]`, and `[[MY NOTE]]` all resolve to the same file on both macOS (APFS case-insensitive) and Windows (NTFS case-insensitive).

**Important caveats**:

- On Linux (case-sensitive file system), two files `Note.md` and `note.md` can coexist in the same folder. Obsidian's behavior becomes inconsistent in this scenario.
- External tools that process vault files (e.g., the wiki CLI, static site generators) should normalize link text to match actual file names to maintain cross-platform portability.
- There is a known Obsidian bug: renaming a file only by changing case (e.g., `macOs.md` to `macOS.md`) fails because Obsidian's rename check compares case-insensitively and reports a collision with itself.

```typescript
// Normalize a wikilink target for cross-platform safety
function normalizeLinkTarget(target: string): string {
  return target
    .trim()
    // Collapse multiple spaces
    .replace(/\s+/g, ' ');
  // Do NOT lowercase — preserve the file's actual casing for display
  // Obsidian resolves case-insensitively, but casing is visible to users
}
```

---

### Handling Duplicate Page Names Across Folders

When two notes share the same stem name in different folders:

```
vault/
  notes/ProjectAlpha.md
  archive/ProjectAlpha.md
```

A bare `[[ProjectAlpha]]` resolves to whichever file Obsidian indexed first (typically alphabetical by path, but this is not guaranteed and should not be relied on).

**Disambiguating links**: Use the minimum path needed to be unique:

```
[[notes/ProjectAlpha]]      → resolves to notes/ProjectAlpha.md
[[archive/ProjectAlpha]]    → resolves to archive/ProjectAlpha.md
```

Obsidian automatically uses this shortest-disambiguating-path format when you create links via its UI. When generating links programmatically:

```typescript
interface VaultIndex {
  // stem (lowercase) -> array of relative paths in vault
  [stem: string]: string[];
}

function generateWikiLink(
  targetStem: string,
  index: VaultIndex,
  displayText?: string
): string {
  const stemKey = targetStem.toLowerCase();
  const matches = index[stemKey] ?? [];

  let linkTarget: string;
  if (matches.length === 0) {
    // Unresolved link — Obsidian will create the file on click
    linkTarget = targetStem;
  } else if (matches.length === 1) {
    // Unique: use bare stem
    linkTarget = targetStem;
  } else {
    // Ambiguous: use shortest unique prefix path
    linkTarget = findShortestUniquePath(targetStem, matches);
  }

  if (displayText && displayText !== linkTarget) {
    return `[[${linkTarget}|${displayText}]]`;
  }
  return `[[${linkTarget}]]`;
}

function findShortestUniquePath(stem: string, paths: string[]): string {
  // Find the shortest path suffix that uniquely identifies one file
  // e.g. ["notes/ProjectAlpha.md", "archive/ProjectAlpha.md"]
  // -> "notes/ProjectAlpha" for the first, "archive/ProjectAlpha" for the second
  // For generation purposes, always pass the specific target path:
  return paths[0].replace(/\.md$/, '');
}
```

---

### How Aliases Affect Link Resolution

Frontmatter aliases allow a note to be linked by alternative names:

```yaml
# In "Artificial Intelligence.md"
---
aliases:
  - AI
  - Machine Learning Basics
---
```

This enables `[[AI]]` and `[[Machine Learning Basics]]` to both resolve to `Artificial Intelligence.md`.

**Key behaviors**:

- Alias matching is also case-insensitive
- When you type `[[AI` in Obsidian's editor, autocomplete suggests both the filename match and alias matches
- Obsidian generates the link as `[[Artificial Intelligence|AI]]` — the target is always the real filename, and the display text is the alias that was typed
- Aliases in frontmatter are **global** across the vault; display text in a pipe (`[[File|Display]]`) is local to that specific link instance

**For programmatic generation**, to link to a note by its alias you need to know the alias-to-file mapping:

```typescript
interface AliasIndex {
  // alias (lowercase) -> actual file stem
  [alias: string]: string;
}

function resolveAlias(
  linkText: string,
  aliasIndex: AliasIndex,
  vaultIndex: VaultIndex
): string {
  const key = linkText.toLowerCase();

  // Check if it matches an alias
  const resolvedStem = aliasIndex[key];
  if (resolvedStem) {
    // Generate [[ActualFile|alias]] format
    return `[[${resolvedStem}|${linkText}]]`;
  }

  // Fall back to direct filename resolution
  return generateWikiLink(linkText, vaultIndex);
}
```

**Obsidian does NOT resolve wikilinks placed inside YAML frontmatter values**. Aliases must be plain strings — not wikilinks. Wikilinks in frontmatter values are treated as literal strings.

---

### File Naming Conventions for Programmatic Wiki-Link Generation

**Do:**

- Use human-readable names that reflect the note's topic: `Machine Learning.md`
- Keep names unique across the entire vault to enable bare `[[Name]]` links
- Use spaces (not dashes or underscores) — Obsidian's UI generates space-based names; spaces and `-`/`_` are treated as equivalent during resolution but spaces render more naturally
- Keep extension as `.md` — Obsidian treats `.md` as the default and omits it in links

**Avoid:**

- Duplicate stems across folders unless you are intentional about always including the path in links
- Special characters that break YAML or shell contexts: `#`, `[`, `]`, `|`, `^`, `:`, `/` in file names
- Names that look like ISO 8601 dates without quoting if used as frontmatter values (YAML coercion risk)
- Trailing or leading spaces in filenames

**Recommended pattern for the wiki CLI** — enforce a slug-based naming convention internally, with `aliases` for human-readable display names:

```typescript
function toWikiSlug(humanTitle: string): string {
  return humanTitle
    .trim()
    // Collapse whitespace to single space (Obsidian's native format)
    .replace(/\s+/g, ' ')
    // Remove characters invalid in filenames across macOS/Windows/Linux
    .replace(/[#\[\]|^:\\/*?"<>]/g, '')
    .trim();
}

// Example: "My Note: A Deep Dive" -> "My Note A Deep Dive"
```

---

### Link Syntax Reference

| Syntax | Meaning |
|---|---|
| `[[PageName]]` | Link to PageName.md, display text = PageName |
| `[[PageName\|Display Text]]` | Link to PageName.md, display text = Display Text |
| `[[Folder/PageName]]` | Link with path disambiguation |
| `[[PageName#Heading]]` | Link to a specific heading within PageName |
| `[[PageName^blockid]]` | Link to a specific block within PageName |
| `![[PageName]]` | Embed the note inline (transclusion) |

---

## Assumptions & Scope

| Assumption | Confidence | Impact if Wrong |
|---|---|---|
| `pdf-parse` v1 is the primary package in use (not v2) | HIGH | v2 has a completely different API; all v1 code examples would not apply |
| Node.js version is 18+ (allowing `@cedrugs/pdf-parse`) | MEDIUM | If Node 16, must use original `pdf-parse` v1 only |
| Obsidian vault uses default "Shortest path when possible" link setting | HIGH | If "Absolute path" is configured, all generated links need full paths |
| Gray-matter uses `js-yaml` under the hood (not another YAML engine) | HIGH | js-yaml is the default; switching to `yaml` package changes behavior |
| YAML frontmatter only (not TOML or JSON frontmatter in the vault) | HIGH | TOML/JSON frontmatter needs a different gray-matter engine configuration |
| Obsidian vault runs on macOS (case-insensitive FS) | MEDIUM | Linux vaults are case-sensitive; resolution rules differ |

### Uncertainties & Gaps

- **pdf-parse v2 (`mehmet-kozan`) vs original**: It is unclear which package the wiki CLI intends to install. The package name on npm may differ. Verify with `npm info pdf-parse` to see which package is actually installed.
- **gray-matter key ordering**: `js-yaml` dump preserves JavaScript object key order in modern V8, but this is an implementation detail, not a guarantee. If the Obsidian vault has files authored with specific key ordering (e.g., `title`, `date`, `tags` always in that sequence), stringify may reorder them.
- **Obsidian alias resolution priority vs filename resolution**: the exact behavior when an alias on Note A matches the filename of Note B is not formally documented. The filename match likely wins, but this should be tested empirically.
- **Form feed character reliability in pdf-parse**: Not all PDFs insert form feeds between pages. Some scanned or image-heavy PDFs may produce blank page slots. The `\f`-split approach should be validated against the actual PDFs in scope.

### Clarifying Questions for Follow-up

1. Which specific `pdf-parse` package version and variant is the CLI installing? (`pdf-parse` v1, `@cedrugs/pdf-parse`, or the `mehmet-kozan` v2 rewrite?)
2. Does the wiki CLI need to extract coordinates or just text from PDFs? (determines whether `pdfjs-dist` is needed)
3. Are dates in frontmatter stored as bare YAML dates (`2024-01-15`) or quoted strings (`"2024-01-15"`) in the target Obsidian vault?
4. Does the Obsidian vault use the default "Shortest path" link setting or "Absolute path"?
5. Is the vault on a case-sensitive file system (Linux server)?
6. Are there wikilinks inside frontmatter YAML values that the CLI needs to parse? (Obsidian does not render these, but some plugins do)

---

## References

| # | Source | URL | Information Gathered |
|---|---|---|---|
| 1 | pdf-parse npm (original v1) | https://www.npmjs.com/package/pdf-parse | pagerender option, form feed separator, result structure |
| 2 | mehmet-kozan/pdf-parse (v2) | https://github.com/mehmet-kozan/pdf-parse | v2 class-based API, partial/first/last options, pages array |
| 3 | Context7: mehmet-kozan/pdf-parse | https://context7.com/mehmet-kozan/pdf-parse/llms.txt | getText() configuration options, per-page result structure |
| 4 | Strapi: 7 PDF Parsing Libraries | https://strapi.io/blog/7-best-javascript-pdf-parsing-libraries-nodejs-2025 | Comparison of pdf-parse, pdfjs-dist, pdf2json, pdfreader |
| 5 | FreeCodeCamp: Custom PDF Extractor | https://www.freecodecamp.org/news/build-a-custom-pdf-text-extractor-with-nodejs-and-typescript/ | TypeScript examples for pdf-parse |
| 6 | gray-matter GitHub README | https://github.com/jonschlinkert/gray-matter | stringify API, language option, YAML/JSON output |
| 7 | Context7: gray-matter docs | https://context7.com/jonschlinkert/gray-matter/llms.txt | stringify roundtrip examples, TypeScript types |
| 8 | gray-matter Issue #62 (date parsing) | https://github.com/jonschlinkert/gray-matter/issues/62 | Date auto-coercion problem and disable-date-parsing workaround |
| 9 | js-yaml Issue #161 (date strings) | https://github.com/nodeca/js-yaml/issues/161 | JSON_SCHEMA as workaround for date coercion in js-yaml |
| 10 | Obsidian Forum: Case Sensitivity | https://forum.obsidian.md/t/case-sensitivity/52331 | Case-insensitive resolution, known rename bug |
| 11 | Obsidian Forum: Duplicate Filenames | https://forum.obsidian.md/t/disambiguiting-mutiple-files-with-the-same-name/32110 | Disambiguation behavior for duplicate stems |
| 12 | Obsidian Help: Aliases | https://help.obsidian.md/aliases | Aliases frontmatter field, global vs local display text |
| 13 | obsidian-export Discussion #58 | https://github.com/zoni/obsidian-export/discussions/58 | Shortest-path algorithm, vault indexing mechanism |
| 14 | Obsidian Forum: Link Resolution Mode | https://forum.obsidian.md/t/add-settings-to-control-link-resolution-mode/69360 | Shortest path vs absolute path setting |
| 15 | Obsibrain: Obsidian Linking Guide | https://www.obsibrain.com/blog/obsidian-linking-the-complete-guide-to-connecting-your-notes | Alias autocomplete behavior, pipe syntax |

### Recommended for Deep Reading

- **gray-matter Issue #62** (https://github.com/jonschlinkert/gray-matter/issues/62): Essential reading before implementing any frontmatter write-back logic. Documents the date coercion problem and available workarounds in detail.
- **mehmet-kozan/pdf-parse docs/options.md** (https://github.com/mehmet-kozan/pdf-parse/blob/main/docs/options.md): Full option reference for v2, including all `getText()` parameters.
- **Obsidian Forum: Case Sensitivity thread** (https://forum.obsidian.md/t/case-sensitivity/52331): Covers edge cases around case on different operating systems that affect cross-platform vault portability.
