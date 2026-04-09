// src/commands/list-sources.ts -- wiki list-sources: display registered sources

import { join } from 'node:path';
import type { WikiConfig } from '../config/types.js';
import type { Logger } from '../utils/logger.js';
import { SourceRegistry } from '../wiki/registry.js';

// ---------------------------------------------------------------------------
// Execute interface (called from cli.ts)
// ---------------------------------------------------------------------------

export interface ListSourcesCommandOptions {
  status?: string;
  config: WikiConfig;
  logger: Logger;
}

export async function execute(options: ListSourcesCommandOptions): Promise<void> {
  const { status, config, logger } = options;

  const registryPath = join(
    config.wiki.rootDir,
    config.wiki.sourcesDir,
    'registry.json',
  );

  try {
    const registry = new SourceRegistry(registryPath);
    await registry.load();
    let sources = registry.getAll();

    // Filter by status if provided
    if (status) {
      sources = sources.filter((s) => s.status === status);
    }

    if (sources.length === 0) {
      logger.info(status ? `No sources with status "${status}".` : 'No sources registered.');
      return;
    }

    // Table header
    const header = [
      'ID'.padEnd(10),
      'Filename'.padEnd(30),
      'Format'.padEnd(8),
      'Status'.padEnd(12),
      'Ingested'.padEnd(20),
      'Pages'.padEnd(6),
    ].join(' | ');

    const separator = '-'.repeat(header.length);

    process.stdout.write(`${header}\n`);
    process.stdout.write(`${separator}\n`);

    for (const source of sources) {
      const row = [
        source.id.substring(0, 8).padEnd(10),
        source.fileName.substring(0, 28).padEnd(30),
        source.format.padEnd(8),
        source.status.padEnd(12),
        source.ingestedAt.replace('T', ' ').slice(0, 16).padEnd(20),
        source.generatedPages.length.toString().padEnd(6),
      ].join(' | ');

      process.stdout.write(`${row}\n`);
    }

    logger.info(`\nTotal: ${sources.length} source(s)`);
  } catch (err) {
    logger.error(`List sources failed: ${(err as Error).message}`);
    process.exitCode = 1;
  }
}
