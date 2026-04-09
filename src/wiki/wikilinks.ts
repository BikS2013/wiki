// src/wiki/wikilinks.ts -- Wiki-link extraction, generation, resolution, insertion

import { readdirSync, existsSync } from 'fs';
import { join, basename } from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WikiLink {
  target: string; // Page name (e.g., "Machine Learning")
  displayText?: string; // Optional display text after pipe
  raw: string; // Original match (e.g., "[[Machine Learning|ML]]")
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Regex for Obsidian-style wiki-links.
 * Matches [[Target]] and [[Target|Display Text]].
 * Does NOT match transclusion (![[...]]) or heading/block links.
 */
const WIKILINK_REGEX = /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extract all wiki-links from a markdown string.
 * Returns an array of target page names (just the target, no display text).
 * Duplicates are included if the same link appears multiple times.
 */
export function extractWikiLinks(content: string): string[] {
  const targets: string[] = [];

  const regex = new RegExp(WIKILINK_REGEX.source, WIKILINK_REGEX.flags);
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    targets.push(match[1].trim());
  }

  return targets;
}

/**
 * Extract all wiki-links from a markdown string as structured objects.
 * Returns WikiLink objects with target, optional displayText, and raw match.
 */
export function extractWikiLinkObjects(content: string): WikiLink[] {
  const links: WikiLink[] = [];

  const regex = new RegExp(WIKILINK_REGEX.source, WIKILINK_REGEX.flags);
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    links.push({
      target: match[1].trim(),
      displayText: match[2]?.trim(),
      raw: match[0],
    });
  }

  return links;
}

/**
 * Generate a wiki-link string.
 *
 * @param pageName    The target page name (becomes the link target)
 * @param displayText Optional display text (pipe syntax)
 * @returns           `[[pageName]]` or `[[pageName|displayText]]`
 */
export function generateWikiLink(
  pageName: string,
  displayText?: string,
): string {
  if (displayText && displayText !== pageName) {
    return `[[${pageName}|${displayText}]]`;
  }
  return `[[${pageName}]]`;
}

/**
 * Resolve a wiki-link target to an actual file path inside the wiki
 * directory.  Resolution is case-insensitive, matching Obsidian behaviour
 * on macOS / Windows.
 *
 * @param link     The link target string (e.g., "Machine Learning")
 * @param wikiDir  Absolute path to the wiki directory
 * @returns        Absolute path to the resolved .md file, or null
 */
export function resolveWikiLinkToPath(
  link: string,
  wikiDir: string,
): string | null {
  const normalizedLink = link.trim().toLowerCase();

  // Recursively collect all .md files in wikiDir
  const mdFiles = collectMarkdownFiles(wikiDir);

  for (const filePath of mdFiles) {
    const stem = basename(filePath, '.md').toLowerCase();
    if (stem === normalizedLink) {
      return filePath;
    }
  }

  return null;
}

/**
 * Validate wiki-links in content against a set of existing page names.
 * Page-name comparison is case-insensitive.
 */
export function validateWikiLinks(
  content: string,
  existingPages: Set<string>,
): { valid: WikiLink[]; broken: WikiLink[] } {
  const links = extractWikiLinkObjects(content);
  const lowerPages = new Set<string>(
    [...existingPages].map((p) => p.toLowerCase()),
  );

  const valid: WikiLink[] = [];
  const broken: WikiLink[] = [];

  for (const link of links) {
    if (lowerPages.has(link.target.toLowerCase())) {
      valid.push(link);
    } else {
      broken.push(link);
    }
  }

  return { valid, broken };
}

/**
 * Scan content for entity / topic mentions and wrap them in wiki-links.
 *
 * @param content   Markdown body text
 * @param linkMap   Map of display text -> page name (case-insensitive matching)
 * @returns         Content with mentions replaced by wiki-links.
 *
 * Only the **first** occurrence of each mention per content block is linked
 * to avoid over-linking.  Text that is already inside a wiki-link is not
 * touched.
 */
export function insertWikiLinks(
  content: string,
  linkMap: Map<string, string>,
): string {
  if (linkMap.size === 0) return content;

  let result = content;

  // Build a sorted list of entries (longest first to avoid partial matches)
  const entries = [...linkMap.entries()].sort(
    (a, b) => b[0].length - a[0].length,
  );

  // Track which mentions have already been linked (first occurrence only)
  const linked = new Set<string>();

  for (const [mention, pageName] of entries) {
    const mentionLower = mention.toLowerCase();
    if (linked.has(mentionLower)) continue;

    // Build a case-insensitive regex for the mention, ensuring it matches
    // whole words and is NOT already inside [[...]]
    const escaped = mention.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(
      // Negative lookbehind: not preceded by [[
      `(?<!\\[\\[)` +
        // Word boundary (or start)
        `\\b(${escaped})\\b` +
        // Negative lookahead: not followed by ]] or |
        `(?!\\]\\]|\\|)`,
      'i',
    );

    const match = pattern.exec(result);
    if (match) {
      const link = generateWikiLink(pageName, match[1]);
      result =
        result.slice(0, match.index) +
        link +
        result.slice(match.index + match[0].length);
      linked.add(mentionLower);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Recursively collect all .md file paths under a directory.
 */
function collectMarkdownFiles(dir: string): string[] {
  const results: string[] = [];

  if (!existsSync(dir)) return results;

  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectMarkdownFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      results.push(fullPath);
    }
  }

  return results;
}
