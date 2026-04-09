// src/lint/fixer.ts -- Auto-fix logic for --fix flag

import { join } from 'node:path';
import type { LintFinding } from './report.js';
import { PageManager } from '../wiki/pages.js';
import { IndexManager } from '../wiki/index-manager.js';
import { updateFrontmatter, parsePage } from '../wiki/frontmatter.js';
import type { WikiPageFrontmatter } from '../wiki/frontmatter.js';
import { insertWikiLinks } from '../wiki/wikilinks.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Attempt to auto-fix all fixable findings.
 *
 * Returns:
 * - `fixed`: number of findings that were successfully resolved
 * - `remaining`: findings that could not be auto-fixed
 */
export async function autoFix(
  findings: LintFinding[],
  wikiDir: string,
): Promise<{ fixed: number; remaining: LintFinding[] }> {
  const pageManager = new PageManager(wikiDir);
  const indexManager = new IndexManager();
  const indexPath = join(wikiDir, 'index.md');
  await indexManager.load(indexPath);

  let fixed = 0;
  const remaining: LintFinding[] = [];
  let indexModified = false;

  for (const finding of findings) {
    if (!finding.autoFixable) {
      remaining.push(finding);
      continue;
    }

    const wasFixed = await fixSingle(finding, pageManager, indexManager, () => {
      indexModified = true;
    });
    if (wasFixed) {
      fixed++;
    } else {
      remaining.push(finding);
    }
  }

  // Save index if any orphan fixes modified it
  if (indexModified) {
    await indexManager.save();
  }

  return { fixed, remaining };
}

// ---------------------------------------------------------------------------
// Internal fix handlers
// ---------------------------------------------------------------------------

/**
 * Attempt to fix a single finding. Returns true if successful.
 */
async function fixSingle(
  finding: LintFinding,
  pageManager: PageManager,
  indexManager: IndexManager,
  onIndexModified: () => void,
): Promise<boolean> {
  switch (finding.category) {
    case 'ORPHAN':
      return fixOrphan(finding, pageManager, indexManager, onIndexModified);

    case 'BROKEN_LINK':
      return fixBrokenLink(finding, pageManager);

    case 'MISSING_FRONTMATTER':
      return fixMissingFrontmatter(finding, pageManager);

    case 'MISSING_LINK':
      return fixMissingLink(finding, pageManager);

    default:
      // STALE_SOURCE and CONTRADICTION are not auto-fixable
      return false;
  }
}

/**
 * Fix orphan page by adding it to the index.
 */
async function fixOrphan(
  finding: LintFinding,
  pageManager: PageManager,
  indexManager: IndexManager,
  onIndexModified: () => void,
): Promise<boolean> {
  const pagePath = finding.page;
  const parsed = await pageManager.readPage(pagePath);
  if (!parsed) return false;

  indexManager.addEntry({
    path: pagePath,
    title: parsed.frontmatter.title,
    type: parsed.frontmatter.type,
    summary: '',
    updated: parsed.frontmatter.updated,
    tags: parsed.frontmatter.tags ?? [],
  });
  onIndexModified();

  return true;
}

/**
 * Fix broken wiki-link by searching for a case-insensitive match.
 */
async function fixBrokenLink(
  finding: LintFinding,
  pageManager: PageManager,
): Promise<boolean> {
  // Extract the broken link target from the message
  const linkMatch = finding.message.match(/\[\[([^\]]+)\]\]/);
  if (!linkMatch) return false;

  const brokenTarget = linkMatch[1];
  const allPageNames = await pageManager.getAllPageNames();

  // Search for a case-insensitive match
  const brokenLower = brokenTarget.toLowerCase().replace(/[^a-z0-9]/g, '');
  let bestMatch: string | null = null;

  for (const pageName of allPageNames) {
    const normalized = pageName.replace(/[^a-z0-9]/g, '');
    if (normalized === brokenLower) {
      bestMatch = pageName;
      break;
    }
  }

  if (!bestMatch) return false;

  // Read the page, replace the broken link, and write back
  const parsed = await pageManager.readPage(finding.page);
  if (!parsed) return false;

  const fixedContent = parsed.content.replace(
    `[[${brokenTarget}]]`,
    `[[${bestMatch}]]`,
  );

  if (fixedContent === parsed.content) return false;

  await pageManager.writePage(
    finding.page,
    parsed.frontmatter,
    fixedContent,
  );

  return true;
}

/**
 * Fix missing frontmatter fields where we can safely add defaults.
 * Only `tags` and `sources` can be safely defaulted to empty arrays.
 */
async function fixMissingFrontmatter(
  finding: LintFinding,
  pageManager: PageManager,
): Promise<boolean> {
  // Parse which field is missing from the message
  const fieldMatch = finding.message.match(/missing required field: (\w+)/);
  if (!fieldMatch) return false;

  const field = fieldMatch[1];

  // Only auto-fix tags and sources with empty arrays
  if (field !== 'tags' && field !== 'sources') return false;

  const parsed = await pageManager.readPage(finding.page);
  if (!parsed) return false;

  const updates: Partial<WikiPageFrontmatter> = {};
  if (field === 'tags') {
    updates.tags = [];
  } else if (field === 'sources') {
    updates.sources = [];
  }

  const updatedRaw = updateFrontmatter(parsed.raw, updates);
  const reParsed = parsePage(updatedRaw);

  await pageManager.writePage(
    finding.page,
    reParsed.frontmatter,
    reParsed.content,
  );

  return true;
}

/**
 * Fix missing link by inserting a wiki-link where an entity is mentioned.
 */
async function fixMissingLink(
  finding: LintFinding,
  pageManager: PageManager,
): Promise<boolean> {
  // Extract entity name and suggested link from the message
  const entityMatch = finding.message.match(/mentions "([^"]+)"/);
  const linkMatch = finding.message.match(/\[\[([^\]]+)\]\]/);

  if (!entityMatch || !linkMatch) return false;

  const entityName = entityMatch[1];
  const suggestedLink = linkMatch[1];

  const parsed = await pageManager.readPage(finding.page);
  if (!parsed) return false;

  // Use the wiki-link insertion utility with a single-entry map
  const linkMap = new Map<string, string>();
  linkMap.set(entityName, suggestedLink);

  const updatedContent = insertWikiLinks(parsed.content, linkMap);

  if (updatedContent === parsed.content) return false;

  await pageManager.writePage(
    finding.page,
    parsed.frontmatter,
    updatedContent,
  );

  return true;
}
