// src/wiki/index-manager.ts -- IndexManager: read/write/update/regenerate wiki/index.md

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, basename, relative } from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single entry in the wiki index.
 */
export interface IndexEntry {
  /** Relative path from wiki root */
  path: string;
  /** Human-readable title */
  title: string;
  /** Page type (source-summary, entity, topic, synthesis, query-result, etc.) */
  type: string;
  /** One-line description */
  summary: string;
  /** ISO 8601 date string */
  updated: string;
  /** Associated tags */
  tags: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Category headers mapped to the page types they contain. */
const CATEGORY_MAP: Record<string, string[]> = {
  'Source Summaries': ['source-summary'],
  'Entities': ['entity'],
  'Topics': ['topic'],
  'Synthesis': ['synthesis', 'comparison'],
  'Queries': ['query-result'],
};

/** Ordered category names for consistent output. */
const CATEGORY_ORDER = [
  'Source Summaries',
  'Entities',
  'Topics',
  'Synthesis',
  'Queries',
];

const TABLE_HEADER = '| Link | Summary | Updated | Tags |';
const TABLE_SEPARATOR = '|------|---------|---------|------|';

// ---------------------------------------------------------------------------
// IndexManager class
// ---------------------------------------------------------------------------

/**
 * Manages the `wiki/index.md` file, which serves as a categorised catalogue
 * of all wiki pages.
 */
export class IndexManager {
  private indexPath: string = '';
  private entries: IndexEntry[] = [];

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  /**
   * Load and parse an existing index.md into structured entries.
   * If the file does not exist, starts with an empty entry list.
   */
  async load(indexPath: string): Promise<void> {
    this.indexPath = indexPath;

    let raw: string;
    try {
      raw = await readFile(indexPath, 'utf-8');
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.entries = [];
        return;
      }
      throw err;
    }

    this.entries = parseIndexMarkdown(raw);
  }

  /**
   * Write the current entries back to index.md as a categorised markdown
   * document.
   */
  async save(): Promise<void> {
    if (!this.indexPath) {
      throw new Error('IndexManager: no index path set. Call load() first.');
    }

    const dir = dirname(this.indexPath);
    await mkdir(dir, { recursive: true });

    const content = renderIndex(this.entries);
    await writeFile(this.indexPath, content, 'utf-8');
  }

  // -------------------------------------------------------------------------
  // CRUD
  // -------------------------------------------------------------------------

  /**
   * Add a new entry. If an entry with the same path already exists it is
   * replaced (upsert semantics).
   */
  addEntry(entry: IndexEntry): void {
    const idx = this.entries.findIndex((e) => e.path === entry.path);
    if (idx !== -1) {
      this.entries[idx] = entry;
    } else {
      this.entries.push(entry);
    }
  }

  /**
   * Update an existing entry identified by path. Merges partial updates.
   */
  updateEntry(path: string, updates: Partial<IndexEntry>): void {
    const idx = this.entries.findIndex((e) => e.path === path);
    if (idx === -1) {
      throw new Error(`IndexManager: entry not found for path "${path}"`);
    }
    this.entries[idx] = { ...this.entries[idx], ...updates };
  }

  /**
   * Remove an entry by path.
   */
  removeEntry(path: string): void {
    const idx = this.entries.findIndex((e) => e.path === path);
    if (idx !== -1) {
      this.entries.splice(idx, 1);
    }
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  /**
   * Return all entries in the index.
   */
  getEntries(): IndexEntry[] {
    return [...this.entries];
  }

  /**
   * Find all entries matching a given page type.
   */
  findByType(type: string): IndexEntry[] {
    return this.entries.filter((e) => e.type === type);
  }

  /**
   * Find entries whose title contains the query string (case-insensitive).
   */
  findByTitle(query: string): IndexEntry[] {
    const lower = query.toLowerCase();
    return this.entries.filter((e) => e.title.toLowerCase().includes(lower));
  }

  // -------------------------------------------------------------------------
  // Regeneration
  // -------------------------------------------------------------------------

  /**
   * Scan all wiki pages under wikiDir and rebuild the index from their
   * frontmatter. Replaces any existing entries.
   */
  async regenerate(wikiDir: string): Promise<void> {
    const { listPages, readPage } = await import('./pages.js');

    const pagePaths = await listPages(wikiDir);
    const newEntries: IndexEntry[] = [];

    for (const pagePath of pagePaths) {
      // Skip index.md, log.md, and lint-report.md
      const name = basename(pagePath);
      if (name === 'index.md' || name === 'log.md' || name === 'lint-report.md') {
        continue;
      }

      try {
        const parsed = await readPage(pagePath);
        const relPath = relative(wikiDir, pagePath);

        newEntries.push({
          path: relPath,
          title: parsed.frontmatter.title ?? basename(pagePath, '.md'),
          type: parsed.frontmatter.type ?? 'unknown',
          summary: extractSummary(parsed.content),
          updated: parsed.frontmatter.updated ?? '',
          tags: parsed.frontmatter.tags ?? [],
        });
      } catch {
        // Skip files that cannot be parsed
        continue;
      }
    }

    this.entries = newEntries;
  }
}

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

/**
 * Render the full index.md content from a list of entries.
 */
function renderIndex(entries: IndexEntry[]): string {
  const lines: string[] = [];

  lines.push('# Wiki Index');
  lines.push('');
  lines.push(`Last updated: ${new Date().toISOString()}`);
  lines.push('');

  for (const category of CATEGORY_ORDER) {
    const types = CATEGORY_MAP[category] ?? [];
    const categoryEntries = entries
      .filter((e) => types.includes(e.type))
      .sort((a, b) => a.title.localeCompare(b.title));

    lines.push(`## ${category}`);
    lines.push('');
    lines.push(TABLE_HEADER);
    lines.push(TABLE_SEPARATOR);

    for (const entry of categoryEntries) {
      const link = `[[${basename(entry.path, '.md')}]]`;
      const tags = entry.tags.join(', ');
      const updated = entry.updated ? entry.updated.slice(0, 10) : '';
      lines.push(`| ${link} | ${escapePipe(entry.summary)} | ${updated} | ${tags} |`);
    }

    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Escape pipe characters inside a markdown table cell.
 */
function escapePipe(text: string): string {
  return text.replace(/\|/g, '\\|');
}

/**
 * Extract the first meaningful sentence from page content for use as a
 * summary in the index.
 */
function extractSummary(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) return '';

  // Find first non-empty, non-heading line
  const lines = trimmed.split('\n');
  for (const line of lines) {
    const stripped = line.trim();
    if (stripped && !stripped.startsWith('#')) {
      // Truncate to a reasonable length
      if (stripped.length > 120) {
        return stripped.slice(0, 117) + '...';
      }
      return stripped;
    }
  }

  return '';
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

/**
 * Parse index.md markdown content back into IndexEntry[].
 */
function parseIndexMarkdown(raw: string): IndexEntry[] {
  const entries: IndexEntry[] = [];
  const lines = raw.split('\n');

  let currentType = '';

  for (const line of lines) {
    // Detect category headers
    if (line.startsWith('## ')) {
      const header = line.slice(3).trim();
      const types = CATEGORY_MAP[header];
      currentType = types?.[0] ?? '';
      continue;
    }

    // Skip non-table-row lines
    if (!line.startsWith('|') || line.startsWith('|--') || line.includes('Link')) {
      continue;
    }

    const cells = line
      .split('|')
      .map((c) => c.trim())
      .filter((c) => c.length > 0);

    if (cells.length < 4) continue;

    // Parse wiki-link from first cell: [[page-name]]
    const linkMatch = cells[0].match(/\[\[([^\]]+)\]\]/);
    const pageName = linkMatch ? linkMatch[1] : cells[0];

    entries.push({
      path: pageName.includes('/') ? pageName : pageName + '.md',
      title: pageName.replace(/-/g, ' '),
      type: currentType,
      summary: cells[1].replace(/\\\|/g, '|'),
      updated: cells[2],
      tags: cells[3]
        ? cells[3]
            .split(',')
            .map((t) => t.trim())
            .filter((t) => t.length > 0)
        : [],
    });
  }

  return entries;
}
