// src/lint/semantic.ts -- LLM-powered contradiction and missing link detection

import type { LLMProvider } from '../llm/provider.js';
import type { Logger } from '../utils/logger.js';
import type { LintFinding } from './report.js';
import type { ContradictionResult } from '../llm/tools.js';
import { IDENTIFY_CONTRADICTIONS_TOOL } from '../llm/tools.js';
import { PageManager } from '../wiki/pages.js';

/** Maximum number of pages per LLM batch call */
const BATCH_SIZE = 10;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run semantic checks using an LLM to detect contradictions and
 * missing cross-references across wiki pages.
 *
 * Only processes entity and topic pages, which are the most likely
 * to contain factual claims that can contradict each other.
 */
export async function runSemanticChecks(
  provider: LLMProvider,
  wikiDir: string,
  logger: Logger,
): Promise<LintFinding[]> {
  const pageManager = new PageManager(wikiDir);
  const findings: LintFinding[] = [];

  // Collect entity and topic pages
  const entityPages = await pageManager.listPagesByType('entities');
  const topicPages = await pageManager.listPagesByType('topics');
  const allPages = [...entityPages, ...topicPages];

  if (allPages.length === 0) {
    logger.verbose('No entity or topic pages found; skipping semantic checks.');
    return findings;
  }

  logger.verbose(`Running semantic checks on ${allPages.length} page(s)...`);

  // Process pages in batches
  for (let i = 0; i < allPages.length; i += BATCH_SIZE) {
    const batch = allPages.slice(i, i + BATCH_SIZE);
    const batchFindings = await checkBatch(provider, pageManager, batch, logger);
    findings.push(...batchFindings);
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Process a batch of pages through the LLM to detect contradictions
 * and missing cross-references.
 */
async function checkBatch(
  provider: LLMProvider,
  pageManager: PageManager,
  pagePaths: string[],
  logger: Logger,
): Promise<LintFinding[]> {
  const findings: LintFinding[] = [];

  // Read all pages in the batch
  const pageContents: Array<{ path: string; title: string; content: string }> = [];
  for (const pagePath of pagePaths) {
    const parsed = await pageManager.readPage(pagePath);
    if (parsed) {
      pageContents.push({
        path: pagePath,
        title: parsed.frontmatter.title,
        content: parsed.content,
      });
    }
  }

  if (pageContents.length < 2) {
    // Need at least 2 pages to find contradictions
    return findings;
  }

  const pagesText = pageContents
    .map((p) => `--- Page: ${p.path} (${p.title}) ---\n${p.content}`)
    .join('\n\n');

  logger.verbose(
    `Checking batch of ${pageContents.length} pages for contradictions...`,
  );

  try {
    const result = await provider.completeWithTools({
      system:
        'You are a wiki quality auditor. Analyze the provided wiki pages and ' +
        'identify any factual contradictions between them, as well as entities ' +
        'mentioned in text that should be linked to existing wiki pages but are not. ' +
        'Only report clear contradictions, not differences in emphasis or detail. ' +
        'Only suggest links for entities that clearly correspond to existing pages.',
      messages: [
        {
          role: 'user',
          content: `Analyze these wiki pages for contradictions and missing links:\n\n${pagesText}`,
        },
      ],
      maxTokens: 4096,
      temperature: 0.2,
      tools: [IDENTIFY_CONTRADICTIONS_TOOL],
      toolChoice: { type: 'tool', name: 'identify_contradictions' },
    });

    const contradictionResult = result.toolInput as unknown as ContradictionResult;

    // Map contradictions to findings
    for (const c of contradictionResult.contradictions) {
      findings.push({
        severity: 'warning',
        category: 'CONTRADICTION',
        page: c.page1,
        message:
          `Pages "${c.page1}" and "${c.page2}" disagree: ` +
          `"${c.claim1}" vs "${c.claim2}"`,
        details: c.explanation,
        autoFixable: false,
      });
    }

    // Map missing links to findings
    for (const ml of contradictionResult.missingLinks) {
      findings.push({
        severity: 'suggestion',
        category: 'MISSING_LINK',
        page: ml.page,
        message:
          `Page "${ml.page}" mentions "${ml.mentionedEntity}" but does not link to [[${ml.suggestedLink}]]`,
        autoFixable: true,
      });
    }
  } catch (err) {
    logger.warn(
      `Semantic check failed for batch: ${(err as Error).message}`,
    );
  }

  return findings;
}
