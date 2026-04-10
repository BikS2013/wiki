// src/commands/ingest.ts -- wiki ingest <source>: ingest pipeline orchestration

import type { Command } from 'commander';
import { resolve } from 'node:path';
import { stat, mkdir, writeFile } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import { join, extname } from 'node:path';

import type { WikiConfig } from '../config/types.js';
import { createProvider } from '../llm/factory.js';
import { createLogger } from '../utils/logger.js';
import { IngestPipeline } from '../ingest/pipeline.js';
import type { IngestOptions, IngestResult } from '../ingest/pipeline.js';
import { getSupportedFormats } from '../source/reader.js';
import { saveClipboardToFile } from '../source/clipboard.js';
import { saveWebContentToFile } from '../source/web.js';
import { saveYouTubeTranscriptToFile } from '../source/youtube.js';

/**
 * Register the `wiki ingest <source>` command on the given Commander program.
 */
export function registerIngestCommand(program: Command): void {
  program
    .command('ingest [source]')
    .description('Ingest a source document into the wiki knowledge base')
    .option('-r, --recursive', 'Recursively ingest all supported files in a directory', false)
    .option('-f, --format <type>', 'Force source format (e.g., md, txt, pdf, json)')
    .option('-t, --tags <tags...>', 'Tags to apply to generated pages')
    .option('-m, --metadata <pairs...>', 'Metadata key=value pairs (e.g., author=Smith project=Alpha)')
    .option('--clipboard', 'Ingest content from the system clipboard')
    .option('--text <content>', 'Ingest text directly from the command line')
    .option('--url <url>', 'Ingest content from a web page URL')
    .option('--youtube <url>', 'Ingest transcript from a YouTube video URL')
    .option('--update <url>', 'Re-fetch and update an existing URL source (web or YouTube)')
    .action(async (source: string | undefined, cmdOptions: Record<string, unknown>) => {
      // Retrieve global options from parent program
      const parentOpts = program.opts();
      const config = parentOpts._config as WikiConfig;
      const verbose = parentOpts.verbose as boolean ?? false;
      const dryRun = parentOpts.dryRun as boolean ?? false;
      const useClipboard = cmdOptions.clipboard as boolean ?? false;
      const inlineText = cmdOptions.text as string | undefined;
      const urlInput = cmdOptions.url as string | undefined;
      const youtubeInput = cmdOptions.youtube as string | undefined;
      const updateUrl = cmdOptions.update as string | undefined;

      const logger = createLogger({ verbose });

      // Validate mutually exclusive input options
      const inputCount = [source, useClipboard, inlineText, urlInput, youtubeInput, updateUrl].filter(Boolean).length;
      if (inputCount > 1) {
        logger.error('Only one input method allowed: <source>, --clipboard, --text, --url, --youtube, or --update. Choose one.');
        process.exitCode = 1;
        return;
      }

      if (inputCount === 0) {
        logger.error('Provide a <source>, --clipboard, --text, --url, --youtube, or --update <url>.');
        process.exitCode = 1;
        return;
      }

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

      // Handle inline text mode
      if (inlineText) {
        try {
          const sourcesFilesDir = join(config.wiki.rootDir, 'sources', 'files');
          await mkdir(sourcesFilesDir, { recursive: true });
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
          const textFilePath = join(sourcesFilesDir, `inline-${timestamp}.md`);
          await writeFile(textFilePath, inlineText, 'utf-8');
          logger.info(`Inline text saved to: ${textFilePath}`);
          const result = await pipeline.ingest(textFilePath, ingestOptions);
          printResult(logger, result);
        } catch (err) {
          logger.error(`Inline text ingest failed: ${(err as Error).message}`);
          process.exitCode = 1;
        }
        return;
      }

      // Handle --update mode (re-fetch URL source)
      if (updateUrl) {
        try {
          const sourcesFilesDir = join(config.wiki.rootDir, 'sources', 'files');
          const registryPath = join(config.wiki.rootDir, config.wiki.sourcesDir, 'registry.json');
          const { SourceRegistry } = await import('../wiki/registry.js');
          const registry = new SourceRegistry(registryPath);
          await registry.load();

          const existing = registry.findByUrl(updateUrl);
          if (!existing) {
            logger.error(`No source found with URL: ${updateUrl}. Ingest it first with --url or --youtube.`);
            process.exitCode = 1;
            return;
          }

          logger.info(`Updating source: ${existing.fileName} (${updateUrl})`);

          // Detect if YouTube or web
          const isYoutube = updateUrl.includes('youtube.com') || updateUrl.includes('youtu.be');
          let savedPath: string;
          if (isYoutube) {
            savedPath = await saveYouTubeTranscriptToFile(updateUrl, sourcesFilesDir);
          } else {
            savedPath = await saveWebContentToFile(updateUrl, sourcesFilesDir);
          }

          // Remove old source file
          const oldFilePath = join(config.wiki.rootDir, existing.filePath);
          try {
            const { unlink } = await import('node:fs/promises');
            await unlink(oldFilePath);
          } catch { /* old file may not exist */ }

          // Remove old registry entry so pipeline creates fresh
          registry.remove(existing.id);
          await registry.save();

          logger.info(`Re-fetched content saved to: ${savedPath}`);
          const result = await pipeline.ingest(savedPath, { ...ingestOptions, sourceUrl: updateUrl });
          printResult(logger, result);
        } catch (err) {
          logger.error(`Update failed: ${(err as Error).message}`);
          process.exitCode = 1;
        }
        return;
      }

      // Handle YouTube mode (supports comma-separated list of URLs)
      if (youtubeInput) {
        const urls = youtubeInput.split(',').map((u) => u.trim()).filter(Boolean);
        const sourcesFilesDir = join(config.wiki.rootDir, 'sources', 'files');
        const allResults: IngestResult[] = [];
        logger.info(`Processing ${urls.length} YouTube URL(s)...`);
        for (const url of urls) {
          try {
            logger.info(`\n--- Fetching YouTube transcript: ${url} ---`);
            const savedPath = await saveYouTubeTranscriptToFile(url, sourcesFilesDir);
            logger.info(`Transcript saved to: ${savedPath}`);
            const result = await pipeline.ingest(savedPath, { ...ingestOptions, sourceUrl: url });
            allResults.push(result);
          } catch (err) {
            logger.error(`YouTube ingest failed for ${url}: ${(err as Error).message}`);
          }
        }
        if (urls.length === 1 && allResults.length === 1) {
          printResult(logger, allResults[0]);
        } else {
          printAggregateResults(logger, allResults);
        }
        return;
      }

      // Handle URL mode (supports comma-separated list of URLs)
      if (urlInput) {
        const urls = urlInput.split(',').map((u) => u.trim()).filter(Boolean);
        const sourcesFilesDir = join(config.wiki.rootDir, 'sources', 'files');
        const allResults: IngestResult[] = [];
        logger.info(`Processing ${urls.length} web URL(s)...`);
        for (const url of urls) {
          try {
            logger.info(`\n--- Fetching web page: ${url} ---`);
            const savedPath = await saveWebContentToFile(url, sourcesFilesDir);
            logger.info(`Web content saved to: ${savedPath}`);
            const result = await pipeline.ingest(savedPath, { ...ingestOptions, sourceUrl: url });
            allResults.push(result);
          } catch (err) {
            logger.error(`URL ingest failed for ${url}: ${(err as Error).message}`);
          }
        }
        if (urls.length === 1 && allResults.length === 1) {
          printResult(logger, allResults[0]);
        } else {
          printAggregateResults(logger, allResults);
        }
        return;
      }

      // Handle clipboard mode
      if (useClipboard) {
        try {
          const sourcesFilesDir = join(config.wiki.rootDir, 'sources', 'files');
          await mkdir(sourcesFilesDir, { recursive: true });
          logger.info('Reading clipboard content...');
          const clipboardFilePath = await saveClipboardToFile(sourcesFilesDir);
          logger.info(`Clipboard content saved to: ${clipboardFilePath}`);
          const result = await pipeline.ingest(clipboardFilePath, ingestOptions);
          printResult(logger, result);
        } catch (err) {
          logger.error(`Clipboard ingest failed: ${(err as Error).message}`);
          process.exitCode = 1;
        }
        return;
      }

      const sourcePath = resolve(source!);

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
