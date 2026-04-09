// src/commands/remove-source.ts -- wiki remove-source <id|name>: remove source and pages

import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { WikiConfig } from '../config/types.js';
import type { Logger } from '../utils/logger.js';
import { SourceRegistry } from '../wiki/registry.js';
import type { SourceEntry } from '../wiki/registry.js';
import { PageManager } from '../wiki/pages.js';
import { IndexManager } from '../wiki/index-manager.js';
import { LogWriter } from '../wiki/log.js';

// ---------------------------------------------------------------------------
// Execute interface (called from cli.ts)
// ---------------------------------------------------------------------------

export interface RemoveSourceCommandOptions {
  id: string;
  keepPages: boolean;
  config: WikiConfig;
  logger: Logger;
  dryRun: boolean;
}

export async function execute(options: RemoveSourceCommandOptions): Promise<void> {
  const { id, keepPages, config, logger, dryRun } = options;

  const wikiDir = join(config.wiki.rootDir, config.wiki.wikiDir);
  const indexPath = join(wikiDir, 'index.md');
  const registryPath = join(
    config.wiki.rootDir,
    config.wiki.sourcesDir,
    'registry.json',
  );

  try {
    const registry = new SourceRegistry(registryPath);
    await registry.load();

    // Find source by ID or filename substring
    const source = findSource(registry, id);
    if (!source) {
      logger.error(
        `No source found matching "${id}". Use "wiki list-sources" to see registered sources.`,
      );
      process.exitCode = 1;
      return;
    }

    logger.info(
      `Found source: ${source.fileName} (${source.id.substring(0, 8)}...)`,
    );
    logger.info(
      `Generated pages: ${source.generatedPages.length > 0 ? source.generatedPages.join(', ') : 'none'}`,
    );

    // Confirmation via readline
    const confirmed = await promptConfirmation(
      `Remove source "${source.fileName}" and its summary page? [y/N] `,
    );
    if (!confirmed) {
      logger.info('Aborted.');
      return;
    }

    if (dryRun) {
      logger.info('[DRY RUN] Would remove source and associated pages.');
      return;
    }

    const pageManager = new PageManager(wikiDir);
    const indexManager = new IndexManager();
    await indexManager.load(indexPath);
    const logWriter = new LogWriter(wikiDir);

    // Delete only source summary pages (in wiki/sources/ directory)
    // Entity and topic pages are NOT deleted as they may contain info from other sources
    const deletedPages: string[] = [];
    if (!keepPages) {
      for (const pagePath of source.generatedPages) {
        if (pagePath.startsWith('sources/')) {
          try {
            await pageManager.deletePage(pagePath);
            indexManager.removeEntry(pagePath);
            deletedPages.push(pagePath);
            logger.verbose(`Deleted page: ${pagePath}`);
          } catch {
            logger.warn(`Could not delete page: ${pagePath}`);
          }
        }
      }
    }

    // Save updated index
    await indexManager.save();

    // Delete the copied source file from sources/files/
    if (source.filePath && !source.filePath.startsWith('/')) {
      const copiedFilePath = join(config.wiki.rootDir, source.filePath);
      if (existsSync(copiedFilePath)) {
        try {
          await unlink(copiedFilePath);
          logger.verbose(`Deleted copied source file: ${source.filePath}`);
        } catch {
          logger.warn(`Could not delete copied source file: ${source.filePath}`);
        }
      }
    }

    // Remove from registry
    registry.remove(source.id);
    await registry.save();

    // Append to log
    await logWriter.append(
      'REMOVE_SOURCE',
      `Removed source: ${source.fileName} (${source.id})`,
    );
    for (const page of deletedPages) {
      await logWriter.append('DELETE_PAGE', `Deleted page: ${page}`);
    }

    logger.success(
      `Removed source "${source.fileName}" and ${deletedPages.length} page(s)`,
    );
  } catch (err) {
    logger.error(`Remove source failed: ${(err as Error).message}`);
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Find a source by exact ID match or filename substring match.
 */
function findSource(
  registry: SourceRegistry,
  query: string,
): SourceEntry | undefined {
  // Try exact ID match first
  const byId = registry.findById(query);
  if (byId) return byId;

  // Try substring match on filename
  const all = registry.getAll();
  const matches = all.filter(
    (s) =>
      s.fileName.toLowerCase().includes(query.toLowerCase()) ||
      s.id.startsWith(query),
  );

  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw new Error(
      `Ambiguous query "${query}" matches ${matches.length} sources: ` +
        matches.map((s) => s.fileName).join(', ') +
        '. Please be more specific or use the full ID.',
    );
  }

  return undefined;
}

/**
 * Prompt the user for confirmation via readline.
 */
function promptConfirmation(prompt: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(prompt, (answer) => {
      rl.close();
      resolve(
        answer.trim().toLowerCase() === 'y' ||
          answer.trim().toLowerCase() === 'yes',
      );
    });
  });
}
