#!/usr/bin/env node
// src/cli.ts -- Commander program setup, global options, command registration

import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config/loader.js';
import { createLogger } from './utils/logger.js';

// ---------------------------------------------------------------------------
// Version resolution
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function readVersion(): string {
  // Walk up to find package.json (handles both src/ and dist/ execution)
  const candidates = [
    resolve(__dirname, '..', 'package.json'),
    resolve(__dirname, '..', '..', 'package.json'),
  ];

  for (const candidate of candidates) {
    try {
      const pkg = JSON.parse(readFileSync(candidate, 'utf-8'));
      return pkg.version ?? '0.0.0';
    } catch {
      // Try next candidate
    }
  }

  return '0.0.0';
}

// ---------------------------------------------------------------------------
// Program factory
// ---------------------------------------------------------------------------

/**
 * Create and configure the Commander program with all commands registered.
 * Exported for testing.
 */
export async function createProgram(): Promise<Command> {
  const program = new Command();

  program
    .name('wiki')
    .version(readVersion())
    .description('LLM Wiki -- Build a persistent, interlinked markdown knowledge base using LLMs')
    .option('--config <path>', 'Path to config.json')
    .option('--verbose', 'Enable verbose logging', false)
    .option('--dry-run', 'Show planned actions without modifying files', false);

  // -----------------------------------------------------------------------
  // Pre-action hook: load config for all commands except 'init'
  // -----------------------------------------------------------------------

  program.hook('preAction', async (thisCommand, actionCommand) => {
    const commandName = actionCommand.name();

    // 'init' does not require an existing config file
    if (commandName === 'init') {
      return;
    }

    const opts = program.opts();
    const logger = createLogger({ verbose: opts.verbose ?? false });

    try {
      const config = await loadConfig({
        configPath: opts.config,
      });

      // Store validated config for commands to retrieve
      program.setOptionValue('_config', config);
      program.setOptionValue('_logger', logger);
    } catch (err: unknown) {
      logger.error((err as Error).message);
      process.exit(1);
    }
  });

  // -----------------------------------------------------------------------
  // Command registration
  // -----------------------------------------------------------------------

  // Commands that self-register (export registerXCommand(program))
  const { registerInitCommand } = await import('./commands/init.js');
  registerInitCommand(program);

  const { registerIngestCommand } = await import('./commands/ingest.js');
  registerIngestCommand(program);

  const { registerMailCheckCommand } = await import('./commands/mail-check.js');
  registerMailCheckCommand(program);

  // Commands that export execute() -- registered inline
  registerQueryCommand(program);
  registerLintCommand(program);
  registerStatusCommand(program);
  registerListSourcesCommand(program);
  registerRemoveSourceCommand(program);
  registerRebuildIndexCommand(program);

  return program;
}

// ---------------------------------------------------------------------------
// Inline command registrations (for commands exporting execute())
// ---------------------------------------------------------------------------

function registerQueryCommand(program: Command): void {
  program
    .command('query <question>')
    .description('Query the wiki with a natural language question')
    .option('--pages <n>', 'Maximum number of pages to include as context', '5')
    .option('--save', 'Save the query result as a wiki page', false)
    .action(async (question: string, cmdOpts: Record<string, unknown>) => {
      const { execute } = await import('./commands/query.js');
      const opts = program.opts();
      await execute({
        question,
        maxPages: parseInt(cmdOpts.pages as string, 10),
        save: cmdOpts.save as boolean,
        config: opts._config,
        logger: opts._logger,
        dryRun: opts.dryRun ?? false,
      });
    });
}

function registerLintCommand(program: Command): void {
  program
    .command('lint')
    .description('Check wiki for structural and semantic issues')
    .option('--fix', 'Auto-fix fixable issues', false)
    .option('--category <type>', 'Limit checks to a specific category')
    .option('--output <path>', 'Write report to a file instead of stdout')
    .action(async (cmdOpts: Record<string, unknown>) => {
      const { execute } = await import('./commands/lint.js');
      const opts = program.opts();
      await execute({
        fix: cmdOpts.fix as boolean,
        category: cmdOpts.category as string | undefined,
        output: cmdOpts.output as string | undefined,
        config: opts._config,
        logger: opts._logger,
        dryRun: opts.dryRun ?? false,
      });
    });
}

function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Display wiki statistics and health summary')
    .action(async () => {
      const { execute } = await import('./commands/status.js');
      const opts = program.opts();
      await execute({
        config: opts._config,
        logger: opts._logger,
      });
    });
}

function registerListSourcesCommand(program: Command): void {
  program
    .command('list-sources')
    .description('List all registered source documents')
    .option('--status <status>', 'Filter by source status')
    .action(async (cmdOpts: Record<string, unknown>) => {
      const { execute } = await import('./commands/list-sources.js');
      const opts = program.opts();
      await execute({
        status: cmdOpts.status as string | undefined,
        config: opts._config,
        logger: opts._logger,
      });
    });
}

function registerRemoveSourceCommand(program: Command): void {
  program
    .command('remove-source <id>')
    .description('Remove a source and its generated wiki pages')
    .option('--keep-pages', 'Keep generated wiki pages on disk', false)
    .action(async (id: string, cmdOpts: Record<string, unknown>) => {
      const { execute } = await import('./commands/remove-source.js');
      const opts = program.opts();
      await execute({
        id,
        keepPages: cmdOpts.keepPages as boolean,
        config: opts._config,
        logger: opts._logger,
        dryRun: opts.dryRun ?? false,
      });
    });
}

function registerRebuildIndexCommand(program: Command): void {
  program
    .command('rebuild-index')
    .description('Regenerate wiki/index.md from all wiki pages')
    .action(async () => {
      const { execute } = await import('./commands/rebuild-index.js');
      const opts = program.opts();
      await execute({
        config: opts._config,
        logger: opts._logger,
        dryRun: opts.dryRun ?? false,
      });
    });
}

// ---------------------------------------------------------------------------
// Main execution
// ---------------------------------------------------------------------------

createProgram()
  .then((program) => program.parseAsync(process.argv))
  .catch((err: Error) => {
    process.stderr.write(`[ERROR] ${err.message}\n`);
    process.exit(1);
  });
