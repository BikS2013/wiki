// src/query/pipeline.ts -- QueryPipeline: index lookup -> page read -> LLM synthesis

import { join } from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
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
    // The LLM may return bare page names (e.g., "556-557-xlsx") without
    // subdirectory prefix or .md extension. We need to resolve them to actual
    // file paths by searching all wiki subdirectories.
    const pagesToRead = selection.pages.slice(0, options.maxPages);
    this.logger.verbose(
      `Reading ${pagesToRead.length} page(s): ${pagesToRead.map((p) => p.path).join(', ')}`,
    );

    const pageContents: Array<{ path: string; content: string }> = [];
    for (const page of pagesToRead) {
      const resolvedPath = await this.resolvePagePath(page.path, wikiDir);
      if (!resolvedPath) {
        this.logger.verbose(`Page not found: ${page.path}`);
        continue;
      }
      const parsed = await this.pageManager.readPage(resolvedPath);
      if (parsed) {
        pageContents.push({
          path: resolvedPath,
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

    // Step 4b: Collect original source documents from cited pages
    const sourcesList = await this.collectOriginalSources(pageContents, wikiDir);
    const fullAnswer = sourcesList.length > 0
      ? answer + '\n\n---\n\n### Sources\n\n' + sourcesList.map((s) => `- ${s}`).join('\n')
      : answer;

    // Step 5: Save if requested
    let savedPath: string | undefined;
    if (options.save && !options.dryRun) {
      savedPath = await this.saveQueryResult(options.question, fullAnswer, citedPages);
    }

    this.logger.verbose(tracker.getSummary());

    return {
      answer: fullAnswer,
      citedPages,
      savedPath,
      tokenUsage: tracker.getTotal(),
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Collect original source documents from the pages used to answer the query.
   * Reads each page's frontmatter to find its `sources` field, then looks up
   * the source registry to get original file names and URLs.
   */
  private async collectOriginalSources(
    pageContents: Array<{ path: string; content: string }>,
    wikiDir: string,
  ): Promise<string[]> {
    const sourceNames = new Set<string>();
    const sourceLines: string[] = [];
    const seen = new Set<string>();

    // Collect source references from all consulted pages' frontmatter
    for (const page of pageContents) {
      const resolvedPath = join(wikiDir, page.path);
      try {
        const raw = await readFile(resolvedPath, 'utf-8');
        const { parseFrontmatter } = await import('../wiki/frontmatter.js');
        const { data } = parseFrontmatter(raw);
        if (data.sources && Array.isArray(data.sources)) {
          for (const s of data.sources) {
            sourceNames.add(String(s));
          }
        }
      } catch {
        // Skip pages that can't be parsed
      }
    }

    // Look up source entries in the registry to get URLs and filenames
    try {
      const registryPath = join(
        this.config.wiki.rootDir,
        this.config.wiki.sourcesDir,
        'registry.json',
      );
      const { SourceRegistry } = await import('../wiki/registry.js');
      const registry = new SourceRegistry(registryPath);
      await registry.load();

      if (sourceNames.size > 0) {
        for (const entry of registry.getAll()) {
          if (entry.status !== 'ingested') continue;
          // Match by filename, path, or ID from frontmatter sources
          const matches = sourceNames.has(entry.fileName) ||
            sourceNames.has(entry.filePath) ||
            sourceNames.has(entry.id);
          if (!matches) continue;

          const key = entry.sourceUrl ?? entry.filePath;
          if (seen.has(key)) continue;
          seen.add(key);

          if (entry.sourceUrl) {
            sourceLines.push(`${entry.fileName} — ${entry.sourceUrl}`);
          } else {
            sourceLines.push(`${entry.fileName} (${entry.filePath})`);
          }
        }
      }
    } catch {
      // Registry not available — fall back to listing source names from frontmatter
      for (const name of sourceNames) {
        if (!seen.has(name)) {
          seen.add(name);
          sourceLines.push(name);
        }
      }
    }

    // If no specific sources found but we have frontmatter references, list those
    if (sourceLines.length === 0 && sourceNames.size > 0) {
      for (const name of sourceNames) {
        sourceLines.push(name);
      }
    }

    return sourceLines;
  }

  /**
   * Resolve a page name/path from the LLM to an actual relative file path.
   * The LLM may return bare names like "staffing-and-personnel" without
   * the subdirectory (entities/, topics/, sources/) or .md extension.
   * This method searches all wiki subdirectories to find the actual file.
   */
  private async resolvePagePath(pagePath: string, wikiDir: string): Promise<string | null> {
    // Normalize: strip .md if present, strip leading subdir if present
    const cleanName = pagePath
      .replace(/\.md$/, '')
      .replace(/^(entities|topics|sources|synthesis|queries)\//, '');

    // Try the path as-is first (with .md extension)
    const candidates = [
      pagePath,
      `${pagePath}.md`,
      `entities/${cleanName}.md`,
      `topics/${cleanName}.md`,
      `sources/${cleanName}.md`,
      `synthesis/${cleanName}.md`,
      `queries/${cleanName}.md`,
    ];

    for (const candidate of candidates) {
      const fullPath = join(wikiDir, candidate);
      if (existsSync(fullPath)) {
        return candidate;
      }
    }

    // Last resort: case-insensitive search across all subdirs
    const subdirs = ['entities', 'topics', 'sources', 'synthesis', 'queries'];
    const lowerName = cleanName.toLowerCase();
    for (const subdir of subdirs) {
      const dirPath = join(wikiDir, subdir);
      try {
        const files = await readdir(dirPath);
        const match = files.find(
          (f) => f.toLowerCase().replace(/\.md$/, '') === lowerName,
        );
        if (match) {
          return `${subdir}/${match}`;
        }
      } catch {
        // Directory may not exist
      }
    }

    return null;
  }

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
