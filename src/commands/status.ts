// src/commands/status.ts -- wiki status: wiki statistics display

import { join } from 'node:path';
import type { WikiConfig } from '../config/types.js';
import type { Logger } from '../utils/logger.js';
import { PageManager } from '../wiki/pages.js';
import { SourceRegistry } from '../wiki/registry.js';
import { runStructuralChecks } from '../lint/structural.js';

// ---------------------------------------------------------------------------
// Execute interface (called from cli.ts)
// ---------------------------------------------------------------------------

export interface StatusCommandOptions {
  config: WikiConfig;
  logger: Logger;
}

export async function execute(options: StatusCommandOptions): Promise<void> {
  const { config, logger } = options;

  const wikiDir = join(config.wiki.rootDir, config.wiki.wikiDir);
  const registryPath = join(
    config.wiki.rootDir,
    config.wiki.sourcesDir,
    'registry.json',
  );

  try {
    const pageManager = new PageManager(wikiDir);

    // Count pages by type
    const sourceSummaries = await pageManager.listPagesByType('sources');
    const entities = await pageManager.listPagesByType('entities');
    const topics = await pageManager.listPagesByType('topics');
    const synthesis = await pageManager.listPagesByType('synthesis');
    const queryResults = await pageManager.listPagesByType('queries');
    const totalPages =
      sourceSummaries.length +
      entities.length +
      topics.length +
      synthesis.length +
      queryResults.length;

    // Load registry for source stats
    const registry = new SourceRegistry(registryPath);
    await registry.load();
    const allSources = registry.getAll();
    const ingested = allSources.filter((s) => s.status === 'ingested');
    const pending = allSources.filter((s) => s.status === 'pending');
    const failed = allSources.filter((s) => s.status === 'failed');
    const stale = allSources.filter((s) => s.status === 'stale');

    // Find last ingest date
    let lastIngest = 'N/A';
    if (allSources.length > 0) {
      const sorted = [...allSources].sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() -
          new Date(a.updatedAt).getTime(),
      );
      lastIngest = sorted[0].updatedAt.replace('T', ' ').slice(0, 16);
    }

    // Run quick structural lint for health indicators
    let orphanCount = 0;
    let brokenLinkCount = 0;
    let staleSourceCount = 0;

    try {
      const findings = await runStructuralChecks(wikiDir, registryPath, config.wiki.rootDir);
      orphanCount = findings.filter(
        (f) => f.category === 'ORPHAN',
      ).length;
      brokenLinkCount = findings.filter(
        (f) => f.category === 'BROKEN_LINK',
      ).length;
      staleSourceCount = findings.filter(
        (f) => f.category === 'STALE_SOURCE',
      ).length;
    } catch {
      logger.verbose('Could not run health checks');
    }

    // Format and print
    const output = `Wiki Status
===========
Pages:
  Source summaries:  ${sourceSummaries.length.toString().padStart(4)}
  Entities:         ${entities.length.toString().padStart(4)}
  Topics:           ${topics.length.toString().padStart(4)}
  Synthesis:        ${synthesis.length.toString().padStart(4)}
  Query results:    ${queryResults.length.toString().padStart(4)}
  Total:            ${totalPages.toString().padStart(4)}

Sources:
  Total registered: ${allSources.length.toString().padStart(4)}
  Ingested:         ${ingested.length.toString().padStart(4)}
  Pending:          ${pending.length.toString().padStart(4)}
  Failed:           ${failed.length.toString().padStart(4)}
  Stale:            ${stale.length.toString().padStart(4)}
  Last ingest:      ${lastIngest}

Health:
  Orphan pages:     ${orphanCount.toString().padStart(4)}
  Broken links:     ${brokenLinkCount.toString().padStart(4)}
  Stale sources:    ${staleSourceCount.toString().padStart(4)}
`;

    process.stdout.write(output);
  } catch (err) {
    logger.error(`Status failed: ${(err as Error).message}`);
    process.exitCode = 1;
  }
}
