// src/lint/structural.ts -- Orphan, broken link, stale source, frontmatter checks

import { basename, join } from 'node:path';
import type { LintFinding } from './report.js';
import { PageManager } from '../wiki/pages.js';
import { IndexManager } from '../wiki/index-manager.js';
import { SourceRegistry } from '../wiki/registry.js';
import { extractWikiLinks } from '../wiki/wikilinks.js';
import { hashFile } from '../source/hasher.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run all structural checks against the wiki.
 * Structural checks work offline (no LLM API key required).
 */
export async function runStructuralChecks(
  wikiDir: string,
  registryPath: string,
): Promise<LintFinding[]> {
  const pageManager = new PageManager(wikiDir);
  const indexManager = new IndexManager();
  await indexManager.load(join(wikiDir, 'index.md'));
  const registry = new SourceRegistry(registryPath);
  await registry.load();

  const findings: LintFinding[] = [];

  findings.push(...(await checkOrphans(pageManager, indexManager)));
  findings.push(...(await checkBrokenLinks(pageManager)));
  findings.push(...(await checkStaleSources(registry)));
  findings.push(...(await checkFrontmatter(pageManager)));

  return findings;
}

// ---------------------------------------------------------------------------
// Individual checks
// ---------------------------------------------------------------------------

/**
 * Detect orphan pages: pages not in the index and not linked from any other page.
 */
async function checkOrphans(
  pageManager: PageManager,
  indexManager: IndexManager,
): Promise<LintFinding[]> {
  const findings: LintFinding[] = [];
  const allPages = await pageManager.listPages();

  // Collect all wiki-link targets across all pages
  const linkedTargets = new Set<string>();
  for (const pagePath of allPages) {
    const parsed = await pageManager.readPage(pagePath);
    if (parsed) {
      const links = extractWikiLinks(parsed.content);
      for (const link of links) {
        linkedTargets.add(link.toLowerCase());
      }
    }
  }

  // Build a set of page names referenced in the index
  const indexReferences = new Set<string>();
  const allIndexEntries = indexManager.getEntries();
  for (const entry of allIndexEntries) {
    indexReferences.add(basename(entry.path, '.md').toLowerCase());
  }

  // Special pages that are never orphans
  const specialPages = new Set(['index.md', 'log.md', 'lint-report.md']);

  for (const pagePath of allPages) {
    if (specialPages.has(pagePath)) continue;

    const stem = basename(pagePath, '.md').toLowerCase();
    const inIndex = indexReferences.has(stem);
    const isLinked = linkedTargets.has(stem);

    if (!inIndex && !isLinked) {
      findings.push({
        severity: 'warning',
        category: 'ORPHAN',
        page: pagePath,
        message: `Page "${pagePath}" is not referenced by any page or the index`,
        autoFixable: true,
      });
    }
  }

  return findings;
}

/**
 * Detect broken wiki-links: links that point to pages that do not exist.
 */
async function checkBrokenLinks(
  pageManager: PageManager,
): Promise<LintFinding[]> {
  const findings: LintFinding[] = [];
  const allPages = await pageManager.listPages();
  const allPageNames = await pageManager.getAllPageNames();

  for (const pagePath of allPages) {
    const parsed = await pageManager.readPage(pagePath);
    if (!parsed) continue;

    const links = extractWikiLinks(parsed.content);
    for (const linkTarget of links) {
      if (!allPageNames.has(linkTarget.toLowerCase())) {
        findings.push({
          severity: 'error',
          category: 'BROKEN_LINK',
          page: pagePath,
          message: `Page "${pagePath}" links to [[${linkTarget}]] but no such page exists`,
          autoFixable: true,
        });
      }
    }
  }

  return findings;
}

/**
 * Detect stale sources: sources whose content hash no longer matches the registry.
 */
async function checkStaleSources(
  registry: SourceRegistry,
): Promise<LintFinding[]> {
  const findings: LintFinding[] = [];
  const sources = registry.getAll();

  for (const source of sources) {
    if (source.status !== 'ingested') continue;

    try {
      const currentHash = await hashFile(source.filePath);
      if (currentHash !== source.contentHash) {
        findings.push({
          severity: 'error',
          category: 'STALE_SOURCE',
          page: source.filePath,
          message: `Source "${source.fileName}" modified since last ingest (hash mismatch)`,
          autoFixable: false,
        });
      }
    } catch {
      // Source file may have been deleted or moved
      findings.push({
        severity: 'error',
        category: 'STALE_SOURCE',
        page: source.filePath,
        message: `Source "${source.fileName}" cannot be read (file may have been deleted or moved)`,
        autoFixable: false,
      });
    }
  }

  return findings;
}

/**
 * Validate frontmatter required fields on all wiki pages.
 */
async function checkFrontmatter(
  pageManager: PageManager,
): Promise<LintFinding[]> {
  const findings: LintFinding[] = [];
  const allPages = await pageManager.listPages();
  const requiredFields = ['title', 'type', 'created', 'updated', 'sources', 'tags'] as const;

  // Skip special non-frontmatter pages
  const specialPages = new Set(['index.md', 'log.md', 'lint-report.md']);

  for (const pagePath of allPages) {
    if (specialPages.has(pagePath)) continue;

    const parsed = await pageManager.readPage(pagePath);
    if (!parsed) continue;

    const fm = parsed.frontmatter as unknown as Record<string, unknown>;
    for (const field of requiredFields) {
      const value = fm[field];
      if (value === undefined || value === null || value === '') {
        findings.push({
          severity: 'error',
          category: 'MISSING_FRONTMATTER',
          page: pagePath,
          message: `Page "${pagePath}" missing required field: ${field}`,
          autoFixable: field === 'tags' || field === 'sources',
        });
      }
    }
  }

  return findings;
}
