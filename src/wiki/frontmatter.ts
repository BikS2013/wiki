// src/wiki/frontmatter.ts -- gray-matter wrapper with JSON_SCHEMA, parse/stringify

import matter from 'gray-matter';
import yaml from 'js-yaml';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WikiPageFrontmatter {
  title: string;
  type:
    | 'source-summary'
    | 'entity'
    | 'topic'
    | 'synthesis'
    | 'comparison'
    | 'query-result';
  created: string; // ISO 8601 string (never a Date object)
  updated: string; // ISO 8601 string
  sources: string[]; // Source IDs or file references
  tags: string[];
  aliases?: string[]; // Alternative names for Obsidian
  status?: 'draft' | 'reviewed' | 'stable';
}

export interface ParsedPage {
  frontmatter: WikiPageFrontmatter;
  content: string; // Markdown body after frontmatter
  raw: string; // Original raw text
}

// ---------------------------------------------------------------------------
// Gray-matter engine configuration -- prevents YAML date auto-coercion
// ---------------------------------------------------------------------------

const GRAY_MATTER_OPTIONS = {
  engines: {
    yaml: {
      parse: (str: string) =>
        yaml.load(str, { schema: yaml.JSON_SCHEMA }) as Record<string, unknown>,
      stringify: (obj: Record<string, unknown>) =>
        yaml.dump(obj, {
          schema: yaml.JSON_SCHEMA,
          lineWidth: -1,
          quotingType: '"' as const,
          forceQuotes: false,
        }),
    },
  },
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a raw markdown string with YAML frontmatter.
 * Uses JSON_SCHEMA to keep dates as strings.
 */
export function parseFrontmatter(content: string): {
  data: WikiPageFrontmatter;
  content: string;
} {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parsed = matter(content, GRAY_MATTER_OPTIONS as any);
  return {
    data: parsed.data as WikiPageFrontmatter,
    content: parsed.content,
  };
}

/**
 * Parse a raw markdown string into a fully structured ParsedPage.
 */
export function parsePage(raw: string): ParsedPage {
  const { data, content } = parseFrontmatter(raw);
  return {
    frontmatter: data,
    content,
    raw,
  };
}

/**
 * Stringify frontmatter data and body content into a complete markdown
 * string with YAML frontmatter block.
 */
export function stringifyFrontmatter(
  data: WikiPageFrontmatter,
  content: string,
): string {
  const yamlStr = yaml.dump(data as unknown as Record<string, unknown>, {
    schema: yaml.JSON_SCHEMA,
    lineWidth: -1,
    quotingType: '"' as const,
    forceQuotes: false,
  });

  // Ensure body starts on its own line after the closing ---
  const normalizedContent = content.startsWith('\n') ? content : `\n${content}`;
  return `---\n${yamlStr}---${normalizedContent}`;
}

/**
 * Alias for stringifyFrontmatter that matches the project design naming.
 */
export function stringifyPage(
  frontmatter: WikiPageFrontmatter,
  content: string,
): string {
  return stringifyFrontmatter(frontmatter, content);
}

/**
 * Parse an existing page, merge partial updates into its frontmatter, and
 * return the complete re-serialized string.  The markdown body is preserved
 * exactly as-is.
 */
export function updateFrontmatter(
  raw: string,
  updates: Partial<WikiPageFrontmatter>,
): string {
  const { frontmatter, content } = parsePage(raw);
  const merged: WikiPageFrontmatter = { ...frontmatter, ...updates };
  return stringifyFrontmatter(merged, content);
}
