// src/ingest/cross-referencer.ts -- Step 4: Programmatic wiki-link insertion

import { existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import type { CrossReference } from '../llm/tools.js';
import { insertWikiLinks, resolveWikiLinkToPath } from '../wiki/wikilinks.js';
import { toKebabCase } from '../utils/naming.js';

/**
 * Insert cross-reference wiki-links into page content.
 *
 * For each cross-reference, checks whether the target page exists in the wiki
 * directory. If the target exists, inserts a [[wiki-link]] for its first
 * unlinked mention in the content. This is purely programmatic -- no LLM calls.
 *
 * @param content    Markdown content (body, may include frontmatter)
 * @param crossRefs  Cross-references extracted during the extraction step
 * @param wikiDir    Absolute path to the wiki directory
 * @returns          Content with wiki-links inserted for valid cross-references
 */
export function insertCrossReferences(
  content: string,
  crossRefs: CrossReference[],
  wikiDir: string,
): string {
  if (crossRefs.length === 0) return content;

  // Build a link map: display text -> page name (for entities/topics that have pages)
  const linkMap = new Map<string, string>();

  for (const ref of crossRefs) {
    // Check if the target page exists in the wiki directory
    const targetPageName = ref.to;
    const resolvedPath = resolveWikiLinkToPath(targetPageName, wikiDir);

    if (resolvedPath) {
      // Target page exists -- map the target name to itself for wiki-linking
      linkMap.set(targetPageName, targetPageName);
    } else {
      // Also try kebab-case filename lookup in known subdirectories
      const kebabName = toKebabCase(targetPageName);
      const possiblePaths = [
        join(wikiDir, 'entities', `${kebabName}.md`),
        join(wikiDir, 'topics', `${kebabName}.md`),
        join(wikiDir, 'sources', `${kebabName}.md`),
      ];

      for (const possiblePath of possiblePaths) {
        if (existsSync(possiblePath)) {
          // Derive the page name from the existing file
          const pageName = basename(possiblePath, '.md');
          linkMap.set(targetPageName, pageName);
          break;
        }
      }
    }
  }

  // Use the wikilinks module to insert links for first occurrences
  return insertWikiLinks(content, linkMap);
}
