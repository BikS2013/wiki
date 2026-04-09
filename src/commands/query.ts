// src/commands/query.ts -- wiki query <question>: query pipeline orchestration

import { join } from 'node:path';
import type { WikiConfig } from '../config/types.js';
import type { Logger } from '../utils/logger.js';
import { createProvider } from '../llm/factory.js';
import { QueryPipeline } from '../query/pipeline.js';
import { PageManager } from '../wiki/pages.js';
import { IndexManager } from '../wiki/index-manager.js';
import { LogWriter } from '../wiki/log.js';

// ---------------------------------------------------------------------------
// Execute interface (called from cli.ts)
// ---------------------------------------------------------------------------

export interface QueryCommandOptions {
  question: string;
  maxPages: number;
  save: boolean;
  config: WikiConfig;
  logger: Logger;
  dryRun: boolean;
}

export async function execute(options: QueryCommandOptions): Promise<void> {
  const { question, maxPages, save, config, logger, dryRun } = options;

  const provider = createProvider(config.llm);
  const wikiDir = join(config.wiki.rootDir, config.wiki.wikiDir);
  const pageManager = new PageManager(wikiDir);
  const indexManager = new IndexManager();
  await indexManager.load(join(wikiDir, 'index.md'));
  const logWriter = new LogWriter(wikiDir);

  const pipeline = new QueryPipeline(
    provider,
    pageManager,
    indexManager,
    logWriter,
    config,
    logger,
  );

  try {
    const result = await pipeline.query({
      question,
      save,
      maxPages,
      dryRun,
      verbose: false,
    });

    // Print the answer to stdout
    process.stdout.write(`\n${result.answer}\n`);

    if (result.savedPath) {
      logger.info(`\nSaved to: ${result.savedPath}`);
    }

    if (result.citedPages.length > 0) {
      logger.verbose(`Cited pages: ${result.citedPages.join(', ')}`);
    }
  } catch (err) {
    logger.error(`Query failed: ${(err as Error).message}`);
    process.exitCode = 1;
  }
}
