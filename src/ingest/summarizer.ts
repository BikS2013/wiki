// src/ingest/summarizer.ts -- Step 1: LLM source summarization

import type { LLMProvider } from '../llm/provider.js';

/**
 * Send source content to LLM with schema prompt for summarization.
 * The LLM returns a full markdown page (with frontmatter) summarizing the source.
 *
 * @param provider      LLM provider instance
 * @param sourceContent Full text content of the source document
 * @param sourceName    Original filename of the source (for context)
 * @param schemaPrompt  Combined wiki schema + ingest prompt template
 * @returns             Raw markdown string with YAML frontmatter and body
 */
export async function summarizeSource(
  provider: LLMProvider,
  sourceContent: string,
  sourceName: string,
  schemaPrompt: string,
): Promise<string> {
  const systemPrompt = [
    schemaPrompt,
    '',
    'You are a knowledge-base curator. Your task is to produce a summary wiki page',
    'from a source document. The page MUST include valid YAML frontmatter with fields:',
    'title, type (must be "source-summary"), created, updated, sources, tags.',
    'After the frontmatter, write a clear, well-structured markdown summary.',
    'Preserve all factual information. Use wiki-link syntax [[Page Name]] when',
    'referencing entities or topics that could have their own wiki pages.',
  ].join('\n');

  const userMessage = [
    `Source filename: ${sourceName}`,
    '',
    '--- SOURCE CONTENT ---',
    sourceContent,
    '--- END SOURCE CONTENT ---',
    '',
    'Please create a comprehensive source summary wiki page from this document.',
    'Include YAML frontmatter and well-organized markdown body.',
  ].join('\n');

  const result = await provider.complete({
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
    maxTokens: 4096,
    temperature: 0.3,
  });

  return result.text;
}
