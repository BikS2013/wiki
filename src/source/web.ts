// src/source/web.ts -- Fetch and extract content from web page URLs

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { extract } from '@extractus/article-extractor';

export interface WebContent {
  title: string;
  content: string;
  url: string;
  author?: string;
  published?: string;
}

/**
 * Fetch a web page and extract its main article content as markdown-like text.
 * Uses @extractus/article-extractor which handles readability extraction.
 *
 * @throws Error if the URL is invalid, unreachable, or has no extractable content.
 */
export async function fetchWebContent(url: string): Promise<WebContent> {
  // Validate URL
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }

  if (!parsed.protocol.startsWith('http')) {
    throw new Error(`URL must use http or https protocol: ${url}`);
  }

  const article = await extract(url);

  if (!article || !article.content) {
    throw new Error(`No extractable content found at: ${url}`);
  }

  // Strip HTML tags from content to get plain text
  const plainContent = stripHtml(article.content);

  return {
    title: article.title ?? parsed.hostname,
    content: plainContent,
    url,
    author: article.author ?? undefined,
    published: article.published ?? undefined,
  };
}

/**
 * Fetch a web page and save its content as a markdown file in the destination directory.
 * Returns the path to the saved file.
 */
export async function saveWebContentToFile(
  url: string,
  destDir: string,
): Promise<string> {
  await mkdir(destDir, { recursive: true });
  const web = await fetchWebContent(url);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const slugTitle = web.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  const filename = `web-${slugTitle}-${timestamp}.md`;
  const filePath = join(destDir, filename);

  // Build markdown content with metadata header
  const lines: string[] = [
    `# ${web.title}`,
    '',
    `> Source: ${web.url}`,
  ];
  if (web.author) lines.push(`> Author: ${web.author}`);
  if (web.published) lines.push(`> Published: ${web.published}`);
  lines.push('', '---', '', web.content);

  await writeFile(filePath, lines.join('\n'), 'utf-8');
  return filePath;
}

/**
 * Strip HTML tags from a string, preserving text content.
 * Converts common block elements to newlines for readability.
 */
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
