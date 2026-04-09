// src/ingest/extractor.ts -- Step 2: LLM entity/topic extraction via tool use

import type { LLMProvider } from '../llm/provider.js';
import { EXTRACT_ENTITIES_TOOL } from '../llm/tools.js';
import type { ExtractionResult, ExtractedEntity, ExtractedTopic, CrossReference } from '../llm/tools.js';

/**
 * Extract entities, topics, and cross-references from a source document
 * using LLM tool-use for structured JSON output.
 *
 * @param provider      LLM provider instance
 * @param sourceContent Full text content of the source document
 * @param summary       The summary already generated for this source (provides context)
 * @param schemaPrompt  Combined wiki schema + extraction instructions
 * @returns             Structured extraction result with entities, topics, and cross-references
 */
export async function extractEntitiesAndTopics(
  provider: LLMProvider,
  sourceContent: string,
  summary: string,
  schemaPrompt: string,
): Promise<ExtractionResult> {
  const systemPrompt = [
    schemaPrompt,
    '',
    'You are a knowledge-base curator. Your task is to extract structured information',
    'from a source document. You MUST use the extract_entities tool to return your results.',
    'Extract all meaningful entities (people, organizations, technologies, concepts, events, places),',
    'all notable topics discussed, and cross-references between them.',
    'For each entity, assess its relevance: primary (central to the document),',
    'secondary (significant supporting role), or mentioned (briefly referenced).',
  ].join('\n');

  const userMessage = [
    '--- SOURCE CONTENT ---',
    sourceContent,
    '--- END SOURCE CONTENT ---',
    '',
    '--- SUMMARY (for context) ---',
    summary,
    '--- END SUMMARY ---',
    '',
    'Extract all entities, topics, and cross-references from this source document.',
    'Use the extract_entities tool to return structured results.',
  ].join('\n');

  const result = await provider.completeWithTools({
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
    maxTokens: 4096,
    temperature: 0.2,
    tools: [EXTRACT_ENTITIES_TOOL],
    toolChoice: { type: 'tool', name: 'extract_entities' },
  });

  const input = result.toolInput;

  // Parse and validate the structured output
  const entities: ExtractedEntity[] = Array.isArray(input.entities)
    ? (input.entities as ExtractedEntity[])
    : [];

  const topics: ExtractedTopic[] = Array.isArray(input.topics)
    ? (input.topics as ExtractedTopic[]).map((t) => ({
        name: t.name,
        description: t.description,
        relatedEntities: Array.isArray(t.relatedEntities) ? t.relatedEntities : [],
      }))
    : [];

  const crossReferences: CrossReference[] = Array.isArray(input.crossReferences)
    ? (input.crossReferences as CrossReference[])
    : [];

  return { entities, topics, crossReferences };
}
