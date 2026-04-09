// src/commands/lint.ts -- wiki lint: structural and semantic checks

import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import type { WikiConfig } from '../config/types.js';
import type { Logger } from '../utils/logger.js';
import { createProvider } from '../llm/factory.js';
import { runStructuralChecks } from '../lint/structural.js';
import { runSemanticChecks } from '../lint/semantic.js';
import {
  generateReport,
  formatReportAsMarkdown,
  formatReportForConsole,
} from '../lint/report.js';
import type { LintFinding } from '../lint/report.js';
import { autoFix } from '../lint/fixer.js';

// ---------------------------------------------------------------------------
// Execute interface (called from cli.ts)
// ---------------------------------------------------------------------------

export interface LintCommandOptions {
  fix: boolean;
  category?: string;
  output?: string;
  config: WikiConfig;
  logger: Logger;
  dryRun: boolean;
}

export async function execute(options: LintCommandOptions): Promise<void> {
  const { fix, category, output, config, logger, dryRun } = options;

  const wikiDir = join(config.wiki.rootDir, config.wiki.wikiDir);
  const registryPath = join(
    config.wiki.rootDir,
    config.wiki.sourcesDir,
    'registry.json',
  );

  let findings: LintFinding[] = [];

  try {
    // Structural checks (no LLM required)
    const structuralCategories = new Set([
      'orphans',
      'links',
      'stale',
      'frontmatter',
    ]);
    const semanticCategories = new Set([
      'contradictions',
      'missing-links',
    ]);

    const runStructural =
      !category || structuralCategories.has(category);
    const runSemantic =
      !category || semanticCategories.has(category);

    if (runStructural) {
      logger.verbose('Running structural checks...');
      let structuralFindings = await runStructuralChecks(
        wikiDir,
        registryPath,
      );

      // Filter by specific category if requested
      if (category) {
        const categoryMap: Record<string, string> = {
          orphans: 'ORPHAN',
          links: 'BROKEN_LINK',
          stale: 'STALE_SOURCE',
          frontmatter: 'MISSING_FRONTMATTER',
        };
        const filterCategory = categoryMap[category];
        if (filterCategory) {
          structuralFindings = structuralFindings.filter(
            (f) => f.category === filterCategory,
          );
        }
      }

      findings.push(...structuralFindings);
    }

    if (runSemantic) {
      logger.verbose('Running semantic checks...');
      try {
        const provider = createProvider(config.llm);
        let semanticFindings = await runSemanticChecks(
          provider,
          wikiDir,
          logger,
        );

        // Filter by specific category if requested
        if (category) {
          const categoryMap: Record<string, string> = {
            contradictions: 'CONTRADICTION',
            'missing-links': 'MISSING_LINK',
          };
          const filterCategory = categoryMap[category];
          if (filterCategory) {
            semanticFindings = semanticFindings.filter(
              (f) => f.category === filterCategory,
            );
          }
        }

        findings.push(...semanticFindings);
      } catch (err) {
        logger.warn(
          `Semantic checks skipped: ${(err as Error).message}`,
        );
      }
    }

    // Auto-fix if requested (and not dry-run)
    if (fix && !dryRun && findings.some((f) => f.autoFixable)) {
      logger.verbose('Attempting auto-fixes...');
      const { fixed, remaining } = await autoFix(findings, wikiDir);
      logger.success(`Auto-fixed ${fixed} issue(s)`);
      findings = remaining;
    }

    // Generate and output report
    const report = generateReport(findings);
    const consoleOutput = formatReportForConsole(report);
    process.stdout.write(consoleOutput);

    // Write to file if requested
    if (output) {
      const markdownReport = formatReportAsMarkdown(report);
      await writeFile(output, markdownReport, 'utf-8');
      logger.success(`Report written to ${output}`);
    }

    // Also write to default lint-report.md location
    if (!dryRun) {
      const defaultReportPath = join(wikiDir, 'lint-report.md');
      const markdownReport = formatReportAsMarkdown(report);
      await writeFile(defaultReportPath, markdownReport, 'utf-8');
      logger.verbose(`Report also saved to ${defaultReportPath}`);
    }

    // Exit code reflects findings
    if (report.summary.totalErrors > 0) {
      process.exitCode = 1;
    }
  } catch (err) {
    logger.error(`Lint failed: ${(err as Error).message}`);
    process.exitCode = 1;
  }
}
