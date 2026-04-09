// src/ingest/pipeline.ts -- IngestPipeline: multi-step orchestration

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, basename, extname, resolve } from 'node:path';

import type { LLMProvider } from '../llm/provider.js';
import type { WikiConfig } from '../config/types.js';
import type { Logger } from '../utils/logger.js';
import type { SourceEntry } from '../wiki/registry.js';
import { SourceRegistry } from '../wiki/registry.js';
import { IndexManager } from '../wiki/index-manager.js';
import { LogWriter } from '../wiki/log.js';
import { readSource } from '../source/reader.js';
import { hashFile } from '../source/hasher.js';
import { summarizeSource } from './summarizer.js';
import { extractEntitiesAndTopics } from './extractor.js';
import { mergeIntoExistingPage } from './merger.js';
import { insertCrossReferences } from './cross-referencer.js';
import { toKebabCase } from '../utils/naming.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IngestOptions {
  tags?: string[];
  metadata?: Record<string, string>;
  dryRun?: boolean;
  recursive?: boolean;
}

export interface IngestResult {
  pagesCreated: string[];
  pagesUpdated: string[];
  entities: string[];
  topics: string[];
  sourceSummaryPath: string;
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

export class IngestPipeline {
  private config: WikiConfig;
  private provider: LLMProvider;
  private logger: Logger;

  constructor(config: WikiConfig, provider: LLMProvider, logger: Logger) {
    this.config = config;
    this.provider = provider;
    this.logger = logger;
  }

  /**
   * Run the full ingest pipeline for a single source file.
   */
  async ingest(sourcePath: string, options: IngestOptions): Promise<IngestResult> {
    const absoluteSourcePath = resolve(sourcePath);
    const rootDir = this.config.wiki.rootDir;
    const sourcesDir = join(rootDir, this.config.wiki.sourcesDir);
    const wikiDir = join(rootDir, this.config.wiki.wikiDir);
    const schemaDir = join(rootDir, this.config.wiki.schemaDir);
    const dryRun = options.dryRun ?? false;

    const pagesCreated: string[] = [];
    const pagesUpdated: string[] = [];
    const entityNames: string[] = [];
    const topicNames: string[] = [];
    let sourceSummaryPath = '';

    // Registry setup
    const registryPath = join(sourcesDir, 'registry.json');
    const registry = new SourceRegistry(registryPath);
    await registry.load();

    let sourceEntry: SourceEntry | undefined;

    try {
      // ------------------------------------------------------------------
      // Step 1: Read source file
      // ------------------------------------------------------------------
      this.logger.info(`Reading source: ${absoluteSourcePath}`);
      const readResult = await readSource(absoluteSourcePath);
      const sourceContent = readResult.content;
      const sourceFormat = readResult.format;
      const sourceFileName = basename(absoluteSourcePath);

      // ------------------------------------------------------------------
      // Step 2: Hash content
      // ------------------------------------------------------------------
      const contentHash = await hashFile(absoluteSourcePath);
      this.logger.verbose(`Content hash: ${contentHash}`);

      // ------------------------------------------------------------------
      // Step 3: Check registry for duplicates
      // ------------------------------------------------------------------
      const existingEntry = registry.findByHash(contentHash);
      if (existingEntry && existingEntry.status === 'ingested') {
        this.logger.info(
          `Source already ingested (unchanged hash): ${sourceFileName}. Skipping.`,
        );
        return {
          pagesCreated: [],
          pagesUpdated: [],
          entities: [],
          topics: [],
          sourceSummaryPath: existingEntry.generatedPages[0] ?? '',
        };
      }

      // ------------------------------------------------------------------
      // Step 4: Register source with status 'ingesting'
      // ------------------------------------------------------------------
      const now = new Date().toISOString();
      const existingByPath = registry.findByPath(absoluteSourcePath);
      if (existingByPath) {
        sourceEntry = registry.update(existingByPath.id, {
          contentHash,
          status: 'ingesting',
          updatedAt: now,
        });
      } else {
        sourceEntry = registry.add({
          filePath: absoluteSourcePath,
          fileName: sourceFileName,
          format: sourceFormat,
          contentHash,
          ingestedAt: now,
          updatedAt: now,
          status: 'ingesting',
          generatedPages: [],
          metadata: options.metadata ?? {},
        });
      }
      if (!dryRun) {
        await registry.save();
      }

      // ------------------------------------------------------------------
      // Step 5: Load wiki schema and ingest prompt template
      // ------------------------------------------------------------------
      const schemaPath = join(schemaDir, 'wiki-schema.md');
      const ingestPromptPath = join(schemaDir, 'prompts', 'ingest.md');

      const schemaContent = existsSync(schemaPath)
        ? await readFile(schemaPath, 'utf-8')
        : '';
      const ingestPrompt = existsSync(ingestPromptPath)
        ? await readFile(ingestPromptPath, 'utf-8')
        : '';
      const schemaPrompt = [schemaContent, ingestPrompt].filter(Boolean).join('\n\n');

      // ------------------------------------------------------------------
      // Step 6: Load index.md for context
      // ------------------------------------------------------------------
      const indexPath = join(wikiDir, 'index.md');
      const indexContent = existsSync(indexPath)
        ? await readFile(indexPath, 'utf-8')
        : '';

      this.logger.verbose(`Wiki schema loaded (${schemaContent.length} chars)`);
      this.logger.verbose(`Index loaded (${indexContent.length} chars)`);

      // ------------------------------------------------------------------
      // Step 7: Send to LLM for summarization
      // ------------------------------------------------------------------
      this.logger.info('Generating source summary...');
      const summaryMarkdown = await summarizeSource(
        this.provider,
        sourceContent,
        sourceFileName,
        schemaPrompt,
      );
      this.logger.verbose(`Summary generated (${summaryMarkdown.length} chars)`);

      // ------------------------------------------------------------------
      // Step 8: Write summary page to wiki/sources/
      // ------------------------------------------------------------------
      const summaryFilename = `${toKebabCase(basename(sourceFileName, extname(sourceFileName)))}.md`;
      const summaryDir = join(wikiDir, 'sources');
      sourceSummaryPath = join(summaryDir, summaryFilename);

      if (dryRun) {
        this.logger.info(`[DRY RUN] Would write summary: ${sourceSummaryPath}`);
      } else {
        await mkdir(summaryDir, { recursive: true });
        await writeFile(sourceSummaryPath, summaryMarkdown, 'utf-8');
        this.logger.success(`Summary page created: ${sourceSummaryPath}`);
      }
      pagesCreated.push(sourceSummaryPath);

      // ------------------------------------------------------------------
      // Step 9: Send to LLM for entity/topic extraction
      // ------------------------------------------------------------------
      this.logger.info('Extracting entities and topics...');
      const extraction = await extractEntitiesAndTopics(
        this.provider,
        sourceContent,
        summaryMarkdown,
        schemaPrompt,
      );

      this.logger.info(
        `Extracted ${extraction.entities.length} entities, ` +
          `${extraction.topics.length} topics, ` +
          `${extraction.crossReferences.length} cross-references`,
      );

      // ------------------------------------------------------------------
      // Step 10: For each entity -- check if page exists, merge or create
      // ------------------------------------------------------------------
      const entityDir = join(wikiDir, 'entities');
      if (!dryRun) {
        await mkdir(entityDir, { recursive: true });
      }

      // Load prompt templates for entity/topic creation and page updates
      const createEntityPromptPath = join(schemaDir, 'prompts', 'create-entity.md');
      const createTopicPromptPath = join(schemaDir, 'prompts', 'create-topic.md');
      const updatePagePromptPath = join(schemaDir, 'prompts', 'update-page.md');

      const createEntityPrompt = existsSync(createEntityPromptPath)
        ? await readFile(createEntityPromptPath, 'utf-8')
        : '';
      const createTopicPrompt = existsSync(createTopicPromptPath)
        ? await readFile(createTopicPromptPath, 'utf-8')
        : '';
      const updatePagePrompt = existsSync(updatePagePromptPath)
        ? await readFile(updatePagePromptPath, 'utf-8')
        : '';

      for (const entity of extraction.entities) {
        entityNames.push(entity.name);
        const entityFilename = `${toKebabCase(entity.name)}.md`;
        const entityPagePath = join(entityDir, entityFilename);

        if (existsSync(entityPagePath)) {
          // Merge into existing page
          this.logger.verbose(`Merging into existing entity page: ${entity.name}`);
          const existingContent = await readFile(entityPagePath, 'utf-8');
          const newInfo = [
            `Entity: ${entity.name} (${entity.type})`,
            `Relevance: ${entity.relevance}`,
            '',
            entity.description,
          ].join('\n');
          const mergePrompt = [schemaContent, updatePagePrompt].filter(Boolean).join('\n\n');

          const mergedContent = await mergeIntoExistingPage(
            this.provider,
            existingContent,
            newInfo,
            sourceFileName,
            mergePrompt,
          );

          if (dryRun) {
            this.logger.info(`[DRY RUN] Would update entity page: ${entityPagePath}`);
          } else {
            await writeFile(entityPagePath, mergedContent, 'utf-8');
            this.logger.success(`Entity page updated: ${entity.name}`);
          }
          pagesUpdated.push(entityPagePath);
        } else {
          // Create new entity page
          this.logger.verbose(`Creating new entity page: ${entity.name}`);
          const createPrompt = [schemaContent, createEntityPrompt].filter(Boolean).join('\n\n');
          const entityContent = await createEntityPage(
            this.provider,
            entity,
            sourceFileName,
            createPrompt,
            options.tags ?? [],
          );

          if (dryRun) {
            this.logger.info(`[DRY RUN] Would create entity page: ${entityPagePath}`);
          } else {
            await writeFile(entityPagePath, entityContent, 'utf-8');
            this.logger.success(`Entity page created: ${entity.name}`);
          }
          pagesCreated.push(entityPagePath);
        }
      }

      // ------------------------------------------------------------------
      // Step 11: For each topic -- check if page exists, merge or create
      // ------------------------------------------------------------------
      const topicDir = join(wikiDir, 'topics');
      if (!dryRun) {
        await mkdir(topicDir, { recursive: true });
      }

      for (const topic of extraction.topics) {
        topicNames.push(topic.name);
        const topicFilename = `${toKebabCase(topic.name)}.md`;
        const topicPagePath = join(topicDir, topicFilename);

        if (existsSync(topicPagePath)) {
          // Merge into existing page
          this.logger.verbose(`Merging into existing topic page: ${topic.name}`);
          const existingContent = await readFile(topicPagePath, 'utf-8');
          const newInfo = [
            `Topic: ${topic.name}`,
            '',
            topic.description,
            '',
            `Related entities: ${topic.relatedEntities.join(', ')}`,
          ].join('\n');
          const mergePrompt = [schemaContent, updatePagePrompt].filter(Boolean).join('\n\n');

          const mergedContent = await mergeIntoExistingPage(
            this.provider,
            existingContent,
            newInfo,
            sourceFileName,
            mergePrompt,
          );

          if (dryRun) {
            this.logger.info(`[DRY RUN] Would update topic page: ${topicPagePath}`);
          } else {
            await writeFile(topicPagePath, mergedContent, 'utf-8');
            this.logger.success(`Topic page updated: ${topic.name}`);
          }
          pagesUpdated.push(topicPagePath);
        } else {
          // Create new topic page
          this.logger.verbose(`Creating new topic page: ${topic.name}`);
          const createPrompt = [schemaContent, createTopicPrompt].filter(Boolean).join('\n\n');
          const topicContent = await createTopicPage(
            this.provider,
            topic,
            sourceFileName,
            createPrompt,
            options.tags ?? [],
          );

          if (dryRun) {
            this.logger.info(`[DRY RUN] Would create topic page: ${topicPagePath}`);
          } else {
            await writeFile(topicPagePath, topicContent, 'utf-8');
            this.logger.success(`Topic page created: ${topic.name}`);
          }
          pagesCreated.push(topicPagePath);
        }
      }

      // ------------------------------------------------------------------
      // Step 12: Insert cross-references in new/updated pages
      // ------------------------------------------------------------------
      this.logger.info('Inserting cross-references...');
      const allTouchedPages = [...pagesCreated, ...pagesUpdated];
      for (const pagePath of allTouchedPages) {
        if (dryRun) continue;
        if (!existsSync(pagePath)) continue;

        const pageContent = await readFile(pagePath, 'utf-8');
        const updatedContent = insertCrossReferences(
          pageContent,
          extraction.crossReferences,
          wikiDir,
        );

        if (updatedContent !== pageContent) {
          await writeFile(pagePath, updatedContent, 'utf-8');
          this.logger.verbose(`Cross-references inserted: ${basename(pagePath)}`);
        }
      }

      // ------------------------------------------------------------------
      // Step 13: Update index.md
      // ------------------------------------------------------------------
      if (!dryRun) {
        const indexMgr = new IndexManager();
        await indexMgr.load(indexPath);

        for (const pagePath of [...pagesCreated, ...pagesUpdated]) {
          const relPath = pagePath.startsWith(wikiDir)
            ? pagePath.slice(wikiDir.length + 1)
            : pagePath;
          const pageName = basename(pagePath, '.md');
          indexMgr.addEntry({
            path: relPath,
            title: pageName.replace(/-/g, ' '),
            type: relPath.startsWith('sources/') ? 'source-summary'
              : relPath.startsWith('entities/') ? 'entity'
              : relPath.startsWith('topics/') ? 'topic'
              : 'unknown',
            summary: '',
            updated: new Date().toISOString(),
            tags: options.tags ?? [],
          });
        }

        await indexMgr.save();
        this.logger.verbose('Index updated');
      } else {
        this.logger.info('[DRY RUN] Would update index.md');
      }

      // ------------------------------------------------------------------
      // Step 14: Append to log.md
      // ------------------------------------------------------------------
      if (!dryRun) {
        const logWriter = new LogWriter(wikiDir);
        await logWriter.append('INGEST', `Source: ${sourceFileName}`);
        for (const page of pagesCreated) {
          await logWriter.append('CREATE_PAGE', basename(page));
        }
        for (const page of pagesUpdated) {
          await logWriter.append('UPDATE_PAGE', basename(page));
        }
        this.logger.verbose('Log updated');
      } else {
        this.logger.info('[DRY RUN] Would append to log.md');
      }

      // ------------------------------------------------------------------
      // Step 15: Update registry status to 'ingested'
      // ------------------------------------------------------------------
      if (sourceEntry) {
        const generatedPages = allTouchedPages.map((p) =>
          p.startsWith(rootDir) ? p.slice(rootDir.length + 1) : p,
        );
        registry.update(sourceEntry.id, {
          status: 'ingested',
          updatedAt: new Date().toISOString(),
          generatedPages,
        });
        if (!dryRun) {
          await registry.save();
        }
      }

      return {
        pagesCreated,
        pagesUpdated,
        entities: entityNames,
        topics: topicNames,
        sourceSummaryPath,
      };
    } catch (error) {
      // If any step fails after registration, update source status to 'failed'
      if (sourceEntry) {
        try {
          registry.update(sourceEntry.id, {
            status: 'failed',
            updatedAt: new Date().toISOString(),
          });
          if (!options.dryRun) {
            await registry.save();
          }
        } catch {
          // Swallow save errors during failure handling
        }
      }
      throw error;
    }
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Create a new entity page via LLM.
 */
async function createEntityPage(
  provider: LLMProvider,
  entity: { name: string; type: string; description: string; relevance: string },
  sourceName: string,
  schemaPrompt: string,
  tags: string[],
): Promise<string> {
  const systemPrompt = [
    schemaPrompt,
    '',
    'You are a knowledge-base curator. Create a wiki page for an entity.',
    'The page MUST include valid YAML frontmatter with fields:',
    'title, type (must be "entity"), created, updated, sources, tags.',
    'Write a comprehensive, well-structured markdown page about the entity.',
    'Use wiki-link syntax [[Page Name]] when referencing other entities or topics.',
  ].join('\n');

  const userMessage = [
    `Entity name: ${entity.name}`,
    `Entity type: ${entity.type}`,
    `Relevance: ${entity.relevance}`,
    `Source: ${sourceName}`,
    `Tags: ${tags.join(', ') || 'none'}`,
    '',
    '--- ENTITY DESCRIPTION ---',
    entity.description,
    '--- END DESCRIPTION ---',
    '',
    'Create a wiki page for this entity.',
  ].join('\n');

  const result = await provider.complete({
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
    maxTokens: 4096,
    temperature: 0.3,
  });

  return result.text;
}

/**
 * Create a new topic page via LLM.
 */
async function createTopicPage(
  provider: LLMProvider,
  topic: { name: string; description: string; relatedEntities: string[] },
  sourceName: string,
  schemaPrompt: string,
  tags: string[],
): Promise<string> {
  const systemPrompt = [
    schemaPrompt,
    '',
    'You are a knowledge-base curator. Create a wiki page for a topic/concept.',
    'The page MUST include valid YAML frontmatter with fields:',
    'title, type (must be "topic"), created, updated, sources, tags.',
    'Write a comprehensive, well-structured markdown page about the topic.',
    'Use wiki-link syntax [[Page Name]] when referencing related entities or topics.',
  ].join('\n');

  const userMessage = [
    `Topic name: ${topic.name}`,
    `Source: ${sourceName}`,
    `Related entities: ${topic.relatedEntities.join(', ') || 'none'}`,
    `Tags: ${tags.join(', ') || 'none'}`,
    '',
    '--- TOPIC DESCRIPTION ---',
    topic.description,
    '--- END DESCRIPTION ---',
    '',
    'Create a wiki page for this topic.',
  ].join('\n');

  const result = await provider.complete({
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
    maxTokens: 4096,
    temperature: 0.3,
  });

  return result.text;
}

