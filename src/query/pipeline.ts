// src/query/pipeline.ts -- QueryPipeline: index lookup -> page read -> LLM synthesis

import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import type { LLMProvider } from '../llm/provider.js';
import type { WikiConfig } from '../config/types.js';
import type { Logger } from '../utils/logger.js';
import type { PageSelection } from '../llm/tools.js';
import { SELECT_PAGES_TOOL } from '../llm/tools.js';
import { UsageTracker } from '../llm/usage-tracker.js';
import { PageManager } from '../wiki/pages.js';
import { IndexManager } from '../wiki/index-manager.js';
import { LogWriter } from '../wiki/log.js';
import type { WikiPageFrontmatter } from '../wiki/frontmatter.js';
import { extractWikiLinks } from '../wiki/wikilinks.js';
import { toKebabCase } from '../utils/naming.js';
import type { TokenUsage } from '../llm/types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QueryOptions {
  question: string;
  save: boolean;
  maxPages: number;
  dryRun: boolean;
  verbose: boolean;
}

export interface QueryResult {
  answer: string;
  citedPages: string[];
  savedPath?: string;
  tokenUsage: TokenUsage;
}

// ---------------------------------------------------------------------------
// QueryPipeline
// ---------------------------------------------------------------------------

export class QueryPipeline {
  private readonly provider: LLMProvider;
  private readonly pageManager: PageManager;
  private readonly indexManager: IndexManager;
  private readonly logWriter: LogWriter;
  private readonly config: WikiConfig;
  private readonly logger: Logger;

  constructor(
    provider: LLMProvider,
    pageManager: PageManager,
    indexManager: IndexManager,
    logWriter: LogWriter,
    config: WikiConfig,
    logger: Logger,
  ) {
    this.provider = provider;
    this.pageManager = pageManager;
    this.indexManager = indexManager;
    this.logWriter = logWriter;
    this.config = config;
    this.logger = logger;
  }

  async query(options: QueryOptions): Promise<QueryResult> {
    const tracker = new UsageTracker();
    const wikiDir = join(this.config.wiki.rootDir, this.config.wiki.wikiDir);
    const indexPath = join(wikiDir, 'index.md');

    // Step 1: Load the wiki index
    this.logger.verbose('Loading wiki index...');
    let indexContent: string;
    try {
      indexContent = await readFile(indexPath, 'utf-8');
    } catch {
      return {
        answer: 'No relevant information found in the wiki.',
        citedPages: [],
        tokenUsage: tracker.getTotal(),
      };
    }

    if (!indexContent || indexContent.trim().length === 0) {
      return {
        answer: 'No relevant information found in the wiki.',
        citedPages: [],
        tokenUsage: tracker.getTotal(),
      };
    }

    // Step 2: Page selection via LLM with SELECT_PAGES_TOOL
    this.logger.verbose('Selecting relevant pages via LLM...');
    const selectionResult = await this.provider.completeWithTools({
      system:
        'You are a wiki assistant. Given a user question and a wiki index, ' +
        'select the most relevant pages that could help answer the question. ' +
        'Return only pages listed in the index.',
      messages: [
        {
          role: 'user',
          content:
            `Question: ${options.question}\n\n` +
            `Wiki Index:\n${indexContent}`,
        },
      ],
      maxTokens: this.config.llm.maxTokens,
      temperature: 0.2,
      tools: [SELECT_PAGES_TOOL],
      toolChoice: { type: 'tool', name: 'select_relevant_pages' },
    });

    tracker.track(selectionResult.usage);
    const selection = selectionResult.toolInput as unknown as PageSelection;

    if (!selection.pages || selection.pages.length === 0) {
      return {
        answer: 'No relevant information found in the wiki.',
        citedPages: [],
        tokenUsage: tracker.getTotal(),
      };
    }

    // Step 3: Read selected pages (up to maxPages)
    const pagesToRead = selection.pages.slice(0, options.maxPages);
    this.logger.verbose(
      `Reading ${pagesToRead.length} page(s): ${pagesToRead.map((p) => p.path).join(', ')}`,
    );

    const pageContents: Array<{ path: string; content: string }> = [];
    for (const page of pagesToRead) {
      const parsed = await this.pageManager.readPage(page.path);
      if (parsed) {
        pageContents.push({
          path: page.path,
          content: `# ${parsed.frontmatter.title}\n\n${parsed.content}`,
        });
      }
    }

    if (pageContents.length === 0) {
      return {
        answer: 'Selected pages could not be read. The wiki may need rebuilding.',
        citedPages: [],
        tokenUsage: tracker.getTotal(),
      };
    }

    // Step 4: Synthesis via LLM
    this.logger.verbose('Synthesizing answer...');
    const pagesText = pageContents
      .map((p) => `--- Page: ${p.path} ---\n${p.content}`)
      .join('\n\n');

    const synthesisResult = await this.provider.complete({
      system:
        'You are a knowledgeable wiki assistant. Answer the user question based ' +
        'solely on the provided wiki pages. Use [[wiki-link]] syntax to cite ' +
        'specific pages. If the pages do not contain enough information to fully ' +
        'answer the question, say so explicitly. Format your answer in markdown.',
      messages: [
        {
          role: 'user',
          content:
            `Question: ${options.question}\n\n` +
            `Wiki Pages:\n${pagesText}`,
        },
      ],
      maxTokens: this.config.llm.maxTokens,
      temperature: 0.5,
    });

    tracker.track(synthesisResult.usage);

    const answer = synthesisResult.text;
    const citedPages = extractWikiLinks(answer);

    // Step 5: Save if requested
    let savedPath: string | undefined;
    if (options.save && !options.dryRun) {
      savedPath = await this.saveQueryResult(options.question, answer, citedPages);
    }

    this.logger.verbose(tracker.getSummary());

    return {
      answer,
      citedPages,
      savedPath,
      tokenUsage: tracker.getTotal(),
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async saveQueryResult(
    question: string,
    answer: string,
    citedPages: string[],
  ): Promise<string> {
    const slug = toKebabCase(question).substring(0, 60);
    const relativePath = `queries/${slug}.md`;
    const now = new Date().toISOString();

    const frontmatter: WikiPageFrontmatter = {
      title: question,
      type: 'query-result',
      created: now,
      updated: now,
      sources: citedPages,
      tags: ['query'],
    };

    await this.pageManager.writePage(
      relativePath,
      frontmatter,
      `\n## Question\n\n${question}\n\n## Answer\n\n${answer}\n`,
    );

    // Update index via load/addEntry/save pattern
    const wikiDir = join(this.config.wiki.rootDir, this.config.wiki.wikiDir);
    const indexPath = join(wikiDir, 'index.md');
    await this.indexManager.load(indexPath);
    this.indexManager.addEntry({
      path: relativePath,
      title: question,
      type: 'query-result',
      summary: question,
      updated: now,
      tags: ['query'],
    });
    await this.indexManager.save();

    // Append to log
    await this.logWriter.append(
      'QUERY',
      `Saved query result: "${question}" -> ${relativePath}`,
    );

    this.logger.success(`Query saved to ${relativePath}`);
    return relativePath;
  }
}
