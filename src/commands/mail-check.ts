// src/commands/mail-check.ts -- wiki mail-check: check mailboxes and ingest emails

import type { Command } from 'commander';
import { createInterface } from 'node:readline';
import { join } from 'node:path';

import type { WikiConfig, MailboxConfig } from '../config/types.js';
import { ConfigurationError } from '../config/types.js';
import {
  validateMailboxConfig,
  validateMailboxesExist,
  checkMailboxPasswordExpiry,
} from '../config/validator.js';
import { createProvider } from '../llm/factory.js';
import { createLogger } from '../utils/logger.js';
import type { Logger } from '../utils/logger.js';
import { IngestPipeline } from '../ingest/pipeline.js';
import { ImapClient } from '../source/imap.js';
import type { ImapConnectionConfig } from '../source/imap.js';
import { MailboxStateManager } from '../source/mailbox-state.js';
import { EmailProcessor } from '../source/email-processor.js';
import type { EmailProcessorOptions } from '../source/email-processor.js';
import { getSupportedFormats } from '../source/reader.js';
import { EmailClassifier } from '../source/email-classifier.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Prompt the user for reset-state confirmation via readline.
 * Returns true if the user confirms with 'y' or 'yes'.
 */
async function confirmResetState(target: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(
      `Reset mailbox state for ${target}? This will cause all emails to be reprocessed. [y/N] `,
      (answer) => {
        rl.close();
        resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
      },
    );
  });
}

/**
 * Map a MailboxConfig to an ImapConnectionConfig (tls -> secure).
 */
function toImapConnectionConfig(mailbox: MailboxConfig): ImapConnectionConfig {
  return {
    host: mailbox.host,
    port: mailbox.port,
    secure: mailbox.tls,
    user: mailbox.user,
    password: mailbox.password,
    connectionTimeout: mailbox.connectionTimeout,
  };
}

// ---------------------------------------------------------------------------
// Failure detail tracking
// ---------------------------------------------------------------------------

interface FailureDetail {
  subject: string;
  mailbox: string;
  folder: string;
  uid: number;
  error: string;
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

/**
 * Register the `wiki mail-check` command on the given Commander program.
 * Uses the self-registering pattern (same as registerIngestCommand).
 */
export function registerMailCheckCommand(program: Command): void {
  program
    .command('mail-check')
    .description(
      'Check IMAP mailboxes for new emails and ingest them into the wiki\n' +
      '  - Classifies emails via LLM: content → wiki, noise → ignored folder\n' +
      '  - Processes body + attachments (md, docx, pdf)\n' +
      '  - Tracks state to avoid reprocessing (cron-friendly)',
    )
    .addHelpText('after', '\n' +
      'Connects to configured IMAP mailboxes, fetches unprocessed emails (subject,\n' +
      'body, attachments), and feeds them through the ingest pipeline as wiki sources.\n\n' +
      'Email classification (optional):\n' +
      '  When processedFolder AND ignoredFolder are set for a mailbox, the LLM\n' +
      '  classifies each email as "content" or "noise" before processing.\n' +
      '  - Content → ingested into wiki, moved to processedFolder\n' +
      '  - Noise  → moved to ignoredFolder, skipped\n\n' +
      'Configuration:\n' +
      '  Via config.json "mailboxes" section or WIKI_MAILBOX_<NAME>_* env vars.\n' +
      '  Required per mailbox: HOST, PORT, TLS, USER, PASSWORD, FOLDERS, TIMEOUT\n' +
      '  Optional: PROCESSED_FOLDER, IGNORED_FOLDER, PASSWORD_EXPIRY\n\n' +
      'Designed for periodic invocation (e.g., cron). Tracks processed emails\n' +
      'by UID + Message-ID to avoid duplicate processing across runs.',
    )
    .option('--mailbox <name>', 'Process only the named mailbox (default: all configured mailboxes)')
    .option('--limit <n>', 'Maximum number of emails to process per run (across all mailboxes)', parseInt)
    .option('--reset-state', 'Clear processed-email state and exit (prompts for confirmation)', false)
    .action(async (cmdOptions: Record<string, unknown>) => {
      // Retrieve global options from parent program
      const parentOpts = program.opts();
      const config = parentOpts._config as WikiConfig;
      const verbose = parentOpts.verbose as boolean ?? false;
      const dryRun = parentOpts.dryRun as boolean ?? false;
      const logger = parentOpts._logger as Logger ?? createLogger({ verbose });

      const mailboxFilter = cmdOptions.mailbox as string | undefined;
      const limit = cmdOptions.limit as number | undefined;
      const resetState = cmdOptions.resetState as boolean ?? false;

      try {
        // --- Validate mailbox configuration ---
        validateMailboxesExist(config);

        // Determine target mailboxes
        const targetMailboxNames: string[] = [];
        if (mailboxFilter) {
          if (!config.mailboxes![mailboxFilter]) {
            throw new ConfigurationError(
              `mailboxes.${mailboxFilter}`,
              `Mailbox "${mailboxFilter}" not found in configuration. Available: ${Object.keys(config.mailboxes!).join(', ')}`,
            );
          }
          targetMailboxNames.push(mailboxFilter);
        } else {
          targetMailboxNames.push(...Object.keys(config.mailboxes!));
        }

        // Validate each target mailbox config
        for (const name of targetMailboxNames) {
          validateMailboxConfig(name, config.mailboxes![name]);
        }

        // Check password expiry (warnings only, does not throw)
        checkMailboxPasswordExpiry(config);

        // --- State management ---
        const statePath = join(config.wiki.rootDir, 'sources', 'mailbox-state.json');
        const stateManager = new MailboxStateManager(statePath);
        await stateManager.load();

        // Handle --reset-state
        if (resetState) {
          const target = mailboxFilter ? `mailbox "${mailboxFilter}"` : 'all mailboxes';
          const confirmed = await confirmResetState(target);
          if (!confirmed) {
            logger.info('Reset cancelled.');
            return;
          }
          stateManager.resetState(mailboxFilter);
          await stateManager.save();
          logger.info(`State reset for ${target}.`);
          return;
        }

        // --- Create pipeline components ---
        const provider = createProvider(config.llm);
        const pipeline = new IngestPipeline(config, provider, logger);
        const sourcesDir = join(config.wiki.rootDir, 'sources', 'files');
        const supportedExtensions = new Set(getSupportedFormats());

        const processorOptions: EmailProcessorOptions = {
          dryRun,
          verbose,
          sourcesDir,
          supportedExtensions,
        };
        const emailProcessor = new EmailProcessor(pipeline, processorOptions, logger);

        // --- Counters ---
        let emailsFound = 0;
        let emailsIngested = 0;
        let emailsIgnored = 0;
        let emailsFailed = 0;
        let attachmentsProcessed = 0;
        let pagesCreated = 0;
        let pagesUpdated = 0;
        let mailboxesProcessed = 0;
        let globalLimitRemaining = limit ?? Infinity;
        const failureDetails: FailureDetail[] = [];

        // --- Process each target mailbox ---
        for (const mailboxName of targetMailboxNames) {
          const mailboxConfig = config.mailboxes![mailboxName];
          const imapConfig = toImapConnectionConfig(mailboxConfig);
          const imapClient = new ImapClient(imapConfig, logger);

          // Determine if classification is enabled (both folders must be set)
          const classificationEnabled = !!(mailboxConfig.processedFolder && mailboxConfig.ignoredFolder);
          let classifier: EmailClassifier | null = null;
          if (classificationEnabled) {
            classifier = new EmailClassifier(provider, logger);
            logger.verbose(
              `Classification enabled for "${mailboxName}": content → "${mailboxConfig.processedFolder}", noise → "${mailboxConfig.ignoredFolder}"`,
            );
          }

          try {
            // Connect to IMAP server
            logger.info(`Connecting to mailbox "${mailboxName}" (${mailboxConfig.host}:${mailboxConfig.port})...`);
            await imapClient.connect();
            mailboxesProcessed++;

            // Create destination folders if classification is enabled
            if (classificationEnabled) {
              await imapClient.createFolderIfNeeded(mailboxConfig.processedFolder!);
              await imapClient.createFolderIfNeeded(mailboxConfig.ignoredFolder!);
            }

            // Process each configured folder
            for (const folder of mailboxConfig.folders) {
              try {
                // Open folder and get uidValidity
                const { uidValidity } = await imapClient.openFolder(folder);

                // Handle uidValidity
                const storedValidity = stateManager.getUIDValidity(mailboxName, folder);
                if (storedValidity !== null && storedValidity !== uidValidity) {
                  stateManager.handleUIDValidityChange(mailboxName, folder, uidValidity, logger);
                } else if (storedValidity === null) {
                  stateManager.setUIDValidity(mailboxName, folder, uidValidity);
                }

                // Search all UIDs (sorted ascending, oldest first)
                const allUIDs = await imapClient.searchAllUIDs();

                // Filter out already-processed UIDs
                const unprocessedUIDs = allUIDs.filter(
                  (uid) => !stateManager.isUIDProcessed(mailboxName, folder, uid),
                );

                // Apply --limit cap (global across all mailboxes/folders)
                const uidsToProcess = unprocessedUIDs.slice(0, globalLimitRemaining);
                emailsFound += uidsToProcess.length;

                logger.verbose(
                  `${mailboxName}/${folder}: ${allUIDs.length} total UIDs, ${unprocessedUIDs.length} unprocessed, processing ${uidsToProcess.length}`,
                );

                // Process each unprocessed UID
                for (const uid of uidsToProcess) {
                  try {
                    // Fetch envelope for Message-ID dedup check
                    const envelope = await imapClient.fetchEnvelope(uid);

                    // Check Message-ID dedup (cross-folder/cross-mailbox)
                    if (stateManager.isMessageIdProcessed(envelope.messageId)) {
                      logger.verbose(
                        `Skipping ${mailboxName}/${folder} UID ${uid}: Message-ID already processed (${envelope.messageId})`,
                      );
                      // Mark UID as processed since the message was already ingested
                      stateManager.markProcessed(mailboxName, folder, uid, envelope.messageId);
                      await stateManager.save();
                      continue;
                    }

                    // Dry-run: log what would be processed (with classification if enabled)
                    if (dryRun) {
                      if (classifier) {
                        // Fetch body preview for classification even in dry-run
                        const content = await imapClient.fetchBody(uid);
                        const bodyPreview = content.body.slice(0, 500);
                        const classResult = await classifier.classify(envelope, bodyPreview);
                        logger.info(
                          `[DRY-RUN] "${envelope.subject}" from ${envelope.from} → ${classResult.classification.toUpperCase()} (${classResult.reason})`,
                        );
                      } else {
                        logger.info(
                          `[DRY-RUN] Would process: "${envelope.subject}" from ${envelope.from} (${mailboxName}/${folder} UID ${uid})`,
                        );
                      }
                      globalLimitRemaining--;
                      if (globalLimitRemaining <= 0) break;
                      continue;
                    }

                    // --- Classification step (if enabled) ---
                    if (classifier) {
                      // Fetch body for classification
                      const content = await imapClient.fetchBody(uid);
                      const bodyPreview = content.body.slice(0, 500);
                      const classResult = await classifier.classify(envelope, bodyPreview);

                      if (classResult.classification === 'ignore') {
                        logger.info(
                          `Ignored: "${envelope.subject}" from ${envelope.from} — ${classResult.reason}`,
                        );

                        // Move to ignored folder
                        try {
                          await imapClient.moveMessage(uid, mailboxConfig.ignoredFolder!);
                        } catch (moveErr) {
                          logger.warn(`Failed to move UID ${uid} to "${mailboxConfig.ignoredFolder}": ${(moveErr as Error).message}`);
                        }

                        // Mark as processed so we don't re-classify
                        stateManager.markProcessed(mailboxName, folder, uid, envelope.messageId);
                        await stateManager.save();
                        emailsIgnored++;
                        globalLimitRemaining--;
                        if (globalLimitRemaining <= 0) break;
                        continue;
                      }

                      // Content — proceed with processing
                      logger.info(`Content: "${envelope.subject}" — ${classResult.reason}`);
                    }

                    // --- Process the email ---
                    logger.info(`Processing: "${envelope.subject}" (${mailboxName}/${folder} UID ${uid})`);
                    const result = await emailProcessor.processEmail(imapClient, envelope, mailboxName);

                    // Move to processed folder (if classification is enabled)
                    if (classificationEnabled) {
                      try {
                        await imapClient.moveMessage(uid, mailboxConfig.processedFolder!);
                      } catch (moveErr) {
                        logger.warn(`Failed to move UID ${uid} to "${mailboxConfig.processedFolder}": ${(moveErr as Error).message}`);
                      }
                    }

                    // Mark as processed and save state atomically after each email
                    stateManager.markProcessed(mailboxName, folder, uid, envelope.messageId);
                    await stateManager.save();

                    // Update counters
                    emailsIngested++;
                    attachmentsProcessed += result.attachmentSourcePaths.length;
                    for (const ingestResult of result.ingestResults) {
                      pagesCreated += ingestResult.pagesCreated.length;
                      pagesUpdated += ingestResult.pagesUpdated.length;
                    }

                    globalLimitRemaining--;
                    if (globalLimitRemaining <= 0) break;
                  } catch (emailErr) {
                    // Per-email error: log, do NOT mark as processed, continue
                    const errMsg = (emailErr as Error).message;
                    logger.error(`Failed to process UID ${uid} in ${mailboxName}/${folder}: ${errMsg}`);
                    emailsFailed++;
                    failureDetails.push({
                      subject: '(unknown)',
                      mailbox: mailboxName,
                      folder,
                      uid,
                      error: errMsg,
                    });
                  }
                }

                // Release folder lock
                await imapClient.releaseFolder();
              } catch (folderErr) {
                // Per-folder error: log and continue to next folder
                logger.error(
                  `Failed to process folder "${folder}" in mailbox "${mailboxName}": ${(folderErr as Error).message}`,
                );
              }

              if (globalLimitRemaining <= 0) break;
            }
          } catch (mailboxErr) {
            // Per-mailbox error: log and continue to next mailbox
            logger.error(
              `Failed to process mailbox "${mailboxName}" (${mailboxConfig.host}:${mailboxConfig.port} as ${mailboxConfig.user}): ${(mailboxErr as Error).message}`,
            );
          } finally {
            // Always disconnect and save state
            try {
              await imapClient.disconnect();
            } catch {
              // Ignore disconnect errors
            }
            try {
              await stateManager.save();
            } catch (saveErr) {
              logger.error(`Failed to save state: ${(saveErr as Error).message}`);
            }
          }

          if (globalLimitRemaining <= 0) break;
        }

        // --- Print summary ---
        logger.info('');
        logger.info('=== Mail Check Complete ===');
        logger.info(`Mailboxes processed: ${mailboxesProcessed}`);
        logger.info(`New emails found: ${emailsFound}`);
        logger.info(`Successfully ingested: ${emailsIngested}`);
        logger.info(`Ignored (noise): ${emailsIgnored}`);
        logger.info(`Failed: ${emailsFailed}`);

        for (const detail of failureDetails) {
          logger.info(`  - "${detail.subject}" (${detail.mailbox}/${detail.folder} UID ${detail.uid}): ${detail.error}`);
        }

        logger.info(`Attachments processed: ${attachmentsProcessed}`);
        logger.info(`Wiki pages created: ${pagesCreated}`);
        logger.info(`Wiki pages updated: ${pagesUpdated}`);

        // Set exit code if any failures occurred
        if (emailsFailed > 0) {
          process.exitCode = 1;
        }
      } catch (err) {
        if (err instanceof ConfigurationError) {
          logger.error(err.message);
        } else {
          logger.error(`Mail check failed: ${(err as Error).message}`);
        }
        process.exitCode = 1;
      }
    });
}
