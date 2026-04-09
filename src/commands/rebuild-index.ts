// src/commands/rebuild-index.ts -- wiki rebuild-index: regenerate index.md

import { join } from 'node:path';
import type { WikiConfig } from '../config/types.js';
import type { Logger } from '../utils/logger.js';
import { IndexManager } from '../wiki/index-manager.js';
import { LogWriter } from '../wiki/log.js';

// ---------------------------------------------------------------------------
// Execute interface (called from cli.ts)
// ---------------------------------------------------------------------------

export interface RebuildIndexCommandOptions {
  config: WikiConfig;
  logger: Logger;
  dryRun: boolean;
}

export async function execute(options: RebuildIndexCommandOptions): Promise<void> {
  const { config, logger, dryRun } = options;

  const wikiDir = join(config.wiki.rootDir, config.wiki.wikiDir);
  const indexPath = join(wikiDir, 'index.md');

  try {
    const indexManager = new IndexManager();
    const logWriter = new LogWriter(wikiDir);

    // Load existing index (or start fresh)
    await indexManager.load(indexPath);

    // Regenerate from all wiki pages
    logger.verbose('Scanning wiki pages...');
    await indexManager.regenerate(wikiDir);

    if (dryRun) {
      logger.info('[DRY RUN] Would regenerate index.md');
      return;
    }

    // Save the regenerated index
    await indexManager.save();

    // Append to log
    await logWriter.append(
      'REBUILD_INDEX',
      'Regenerated index.md from all wiki pages',
    );

    logger.success('Index rebuilt successfully');
  } catch (err) {
    logger.error(`Rebuild index failed: ${(err as Error).message}`);
    process.exitCode = 1;
  }
}
