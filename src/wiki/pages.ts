// src/wiki/pages.ts -- Page CRUD: create, read, update, list wiki pages

import { readFile, writeFile, readdir, mkdir, unlink, access } from 'node:fs/promises';
import { join, basename, relative, dirname } from 'node:path';
import { parsePage, stringifyPage } from './frontmatter.js';
import type { WikiPageFrontmatter, ParsedPage } from './frontmatter.js';

// ---------------------------------------------------------------------------
// Standalone functions (used by pipelines and other modules)
// ---------------------------------------------------------------------------

/**
 * Create a new wiki page with frontmatter and content.
 * Creates subdirectories if they do not exist.
 *
 * @param wikiDir     Absolute path to the wiki directory
 * @param subdir      Subdirectory within wikiDir (e.g. 'entities', 'topics')
 * @param filename    Filename for the page (e.g. 'machine-learning.md')
 * @param frontmatter Complete frontmatter data for the page
 * @param content     Markdown body content (without frontmatter)
 * @returns           Absolute path to the created file
 */
export async function createPage(
  wikiDir: string,
  subdir: string,
  filename: string,
  frontmatter: WikiPageFrontmatter,
  content: string,
): Promise<string> {
  const dirPath = join(wikiDir, subdir);
  await mkdir(dirPath, { recursive: true });

  const filePath = join(dirPath, filename);
  const raw = stringifyPage(frontmatter, content);
  await writeFile(filePath, raw, 'utf-8');

  return filePath;
}

/**
 * Read and parse a wiki page from disk.
 *
 * @param pagePath  Absolute path to the .md file
 * @returns         Parsed page with frontmatter, content, and raw text
 */
export async function readPage(pagePath: string): Promise<ParsedPage> {
  const raw = await readFile(pagePath, 'utf-8');
  return parsePage(raw);
}

/**
 * Update an existing wiki page by merging partial frontmatter updates
 * and replacing the body content.
 *
 * @param pagePath           Absolute path to the .md file
 * @param updatedFrontmatter Partial frontmatter fields to merge
 * @param updatedContent     New markdown body content
 */
export async function updatePage(
  pagePath: string,
  updatedFrontmatter: Partial<WikiPageFrontmatter>,
  updatedContent: string,
): Promise<void> {
  const raw = await readFile(pagePath, 'utf-8');
  const existing = parsePage(raw);

  const merged: WikiPageFrontmatter = {
    ...existing.frontmatter,
    ...updatedFrontmatter,
  };

  const newRaw = stringifyPage(merged, updatedContent);
  await writeFile(pagePath, newRaw, 'utf-8');
}

/**
 * List all .md files recursively under the wiki directory.
 *
 * @param wikiDir  Absolute path to the wiki directory
 * @returns        Array of absolute paths to .md files
 */
export async function listPages(wikiDir: string): Promise<string[]> {
  return collectMarkdownFiles(wikiDir);
}

/**
 * Check whether a page with the given name exists anywhere under
 * the wiki directory. Comparison is case-insensitive against the
 * file stem (filename without .md extension).
 *
 * @param wikiDir   Absolute path to the wiki directory
 * @param pageName  Page name to search for (e.g. "machine-learning")
 * @returns         True if a matching page exists
 */
export async function pageExists(
  wikiDir: string,
  pageName: string,
): Promise<boolean> {
  const normalised = pageName.trim().toLowerCase();
  const files = await collectMarkdownFiles(wikiDir);

  for (const filePath of files) {
    const stem = basename(filePath, '.md').toLowerCase();
    if (stem === normalised) {
      return true;
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// PageManager class (for commands that need stateful, relative-path access)
// ---------------------------------------------------------------------------

/**
 * CRUD operations for wiki pages stored on disk.
 *
 * All paths passed to methods are **relative** to the `wikiDir` root.
 */
export class PageManager {
  private readonly wikiDir: string;

  constructor(wikiDir: string) {
    this.wikiDir = wikiDir;
  }

  /**
   * Read a wiki page, returning parsed frontmatter and content.
   * Returns `null` if the file does not exist (does not throw).
   */
  async readPage(relativePath: string): Promise<ParsedPage | null> {
    const fullPath = join(this.wikiDir, relativePath);
    try {
      const raw = await readFile(fullPath, 'utf-8');
      return parsePage(raw);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw err;
    }
  }

  /**
   * Write a wiki page with frontmatter and content.
   * Creates parent directories if they do not exist.
   */
  async writePage(
    relativePath: string,
    frontmatter: WikiPageFrontmatter,
    content: string,
  ): Promise<void> {
    const fullPath = join(this.wikiDir, relativePath);
    await mkdir(dirname(fullPath), { recursive: true });
    const raw = stringifyPage(frontmatter, content);
    await writeFile(fullPath, raw, 'utf-8');
  }

  /**
   * List all .md files in the wiki directory tree.
   * Returns paths relative to wikiDir.
   */
  async listPages(): Promise<string[]> {
    return this.collectMarkdownFilesRelative(this.wikiDir, this.wikiDir);
  }

  /**
   * List pages by type (subdirectory).
   */
  async listPagesByType(
    type: 'sources' | 'entities' | 'topics' | 'synthesis' | 'queries',
  ): Promise<string[]> {
    const subDir = join(this.wikiDir, type);
    try {
      return await this.collectMarkdownFilesRelative(subDir, this.wikiDir);
    } catch {
      return [];
    }
  }

  /**
   * Check if a page exists.
   */
  async pageExists(relativePath: string): Promise<boolean> {
    const fullPath = join(this.wikiDir, relativePath);
    try {
      await access(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Delete a page.
   */
  async deletePage(relativePath: string): Promise<void> {
    const fullPath = join(this.wikiDir, relativePath);
    await unlink(fullPath);
  }

  /**
   * Get a set of all page names (lowercase stems) for wiki-link validation.
   */
  async getAllPageNames(): Promise<Set<string>> {
    const pages = await this.listPages();
    const names = new Set<string>();
    for (const p of pages) {
      names.add(basename(p, '.md').toLowerCase());
    }
    return names;
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private async collectMarkdownFilesRelative(
    dir: string,
    rootDir: string,
  ): Promise<string[]> {
    const results: string[] = [];

    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return results;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...(await this.collectMarkdownFilesRelative(fullPath, rootDir)));
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        results.push(relative(rootDir, fullPath));
      }
    }

    return results;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers (for standalone functions)
// ---------------------------------------------------------------------------

/**
 * Recursively collect all .md file paths under a directory.
 * Returns absolute paths.
 */
async function collectMarkdownFiles(dir: string): Promise<string[]> {
  const results: string[] = [];

  try {
    await access(dir);
  } catch {
    return results;
  }

  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await collectMarkdownFiles(fullPath);
      results.push(...nested);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      results.push(fullPath);
    }
  }

  return results;
}
