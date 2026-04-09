// src/commands/ingest.ts -- wiki ingest <source>: ingest pipeline orchestration

import type { Command } from 'commander';
import { resolve } from 'node:path';
import { stat } from 'node:fs/promises';
import { readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

import type { WikiConfig } from '../config/types.js';
import { createProvider } from '../llm/factory.js';
import { createLogger } from '../utils/logger.js';
import { IngestPipeline } from '../ingest/pipeline.js';
import type { IngestOptions, IngestResult } from '../ingest/pipeline.js';
import { getSupportedFormats } from '../source/reader.js';

/**
 * Register the `wiki ingest <source>` command on the given Commander program.
 */
export function registerIngestCommand(program: Command): void {
  program
    .command('ingest <source>')
    .description('Ingest a source document into the wiki knowledge base')
    .option('-r, --recursive', 'Recursively ingest all supported files in a directory', false)
    .option('-f, --format <type>', 'Force source format (e.g., md, txt, pdf, json)')
    .option('-t, --tags <tags...>', 'Tags to apply to generated pages')
    .option('-m, --metadata <pairs...>', 'Metadata key=value pairs (e.g., author=Smith project=Alpha)')
    .action(async (source: string, cmdOptions: Record<string, unknown>) => {
      // Retrieve global options from parent program
      const parentOpts = program.opts();
      const config = parentOpts._config as WikiConfig;
      const verbose = parentOpts.verbose as boolean ?? false;
      const dryRun = parentOpts.dryRun as boolean ?? false;

      const logger = createLogger({ verbose });
      const provider = createProvider(config.llm);
      const pipeline = new IngestPipeline(config, provider, logger);

      // Parse metadata pairs into a record
      const metadata: Record<string, string> = {};
      if (Array.isArray(cmdOptions.metadata)) {
        for (const pair of cmdOptions.metadata as string[]) {
          const eqIndex = pair.indexOf('=');
          if (eqIndex > 0) {
            metadata[pair.slice(0, eqIndex)] = pair.slice(eqIndex + 1);
          }
        }
      }

      const ingestOptions: IngestOptions = {
        tags: (cmdOptions.tags as string[]) ?? [],
        metadata,
        dryRun,
        recursive: cmdOptions.recursive as boolean ?? false,
      };

      const sourcePath = resolve(source);

      try {
        const sourceStat = await stat(sourcePath);

        if (sourceStat.isDirectory()) {
          if (!ingestOptions.recursive) {
            logger.error(
              `"${sourcePath}" is a directory. Use --recursive to ingest all files.`,
            );
            process.exitCode = 1;
            return;
          }

          // Recursively collect all supported files
          const supportedFormats = new Set(getSupportedFormats());
          const files = collectFiles(sourcePath, supportedFormats);

          if (files.length === 0) {
            logger.warn('No supported files found in directory.');
            return;
          }

          logger.info(`Found ${files.length} supported file(s) to ingest.`);

          const allResults: IngestResult[] = [];
          for (const file of files) {
            try {
              logger.info(`\n--- Ingesting: ${file} ---`);
              const result = await pipeline.ingest(file, ingestOptions);
              allResults.push(result);
            } catch (err) {
              logger.error(`Failed to ingest ${file}: ${(err as Error).message}`);
            }
          }

          // Print aggregate summary
          printAggregateResults(logger, allResults);
        } else {
          // Single file ingest
          const result = await pipeline.ingest(sourcePath, ingestOptions);
          printResult(logger, result);
        }
      } catch (err) {
        logger.error(`Ingest failed: ${(err as Error).message}`);
        process.exitCode = 1;
      }
    });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Recursively collect all files with supported extensions from a directory.
 */
function collectFiles(dirPath: string, supportedFormats: Set<string>): string[] {
  const results: string[] = [];
  const entries = readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFiles(fullPath, supportedFormats));
    } else if (entry.isFile()) {
      const ext = extname(entry.name).toLowerCase();
      if (supportedFormats.has(ext)) {
        results.push(fullPath);
      }
    }
  }

  return results;
}

/**
 * Print results for a single file ingest.
 */
function printResult(logger: ReturnType<typeof createLogger>, result: IngestResult): void {
  logger.info('');
  logger.info('=== Ingest Complete ===');
  logger.info(`Summary page: ${result.sourceSummaryPath}`);
  logger.info(`Pages created: ${result.pagesCreated.length}`);
  logger.info(`Pages updated: ${result.pagesUpdated.length}`);

  if (result.entities.length > 0) {
    logger.info(`Entities (${result.entities.length}): ${result.entities.join(', ')}`);
  }
  if (result.topics.length > 0) {
    logger.info(`Topics (${result.topics.length}): ${result.topics.join(', ')}`);
  }
}

/**
 * Print aggregate results for a directory ingest.
 */
function printAggregateResults(
  logger: ReturnType<typeof createLogger>,
  results: IngestResult[],
): void {
  const totalCreated = results.reduce((sum, r) => sum + r.pagesCreated.length, 0);
  const totalUpdated = results.reduce((sum, r) => sum + r.pagesUpdated.length, 0);
  const allEntities = [...new Set(results.flatMap((r) => r.entities))];
  const allTopics = [...new Set(results.flatMap((r) => r.topics))];

  logger.info('');
  logger.info('=== Batch Ingest Complete ===');
  logger.info(`Sources processed: ${results.length}`);
  logger.info(`Total pages created: ${totalCreated}`);
  logger.info(`Total pages updated: ${totalUpdated}`);

  if (allEntities.length > 0) {
    logger.info(`Unique entities (${allEntities.length}): ${allEntities.join(', ')}`);
  }
  if (allTopics.length > 0) {
    logger.info(`Unique topics (${allTopics.length}): ${allTopics.join(', ')}`);
  }
}
