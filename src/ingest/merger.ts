// src/ingest/merger.ts -- Step 3: LLM page merge/creation

import type { LLMProvider } from '../llm/provider.js';

/**
 * Merge new information into an existing wiki page using the LLM.
 *
 * The LLM is instructed to:
 * - Preserve all existing content and structure
 * - Integrate new information in appropriate sections
 * - Note contradictions with `> [!warning] Contradiction` callouts
 * - Update the `updated` field in frontmatter
 * - Add the new source to the `sources` array in frontmatter
 *
 * @param provider            LLM provider instance
 * @param existingPageContent Full markdown content of the existing page (with frontmatter)
 * @param newInfo             New information to merge (entity/topic description from extraction)
 * @param sourceName          Name of the source providing the new information
 * @param schemaPrompt        Combined wiki schema + update-page prompt template
 * @returns                   Updated markdown string with frontmatter
 */
export async function mergeIntoExistingPage(
  provider: LLMProvider,
  existingPageContent: string,
  newInfo: string,
  sourceName: string,
  schemaPrompt: string,
): Promise<string> {
  const systemPrompt = [
    schemaPrompt,
    '',
    'You are a knowledge-base curator. Your task is to merge new information into',
    'an existing wiki page. Follow these rules strictly:',
    '',
    '1. PRESERVE all existing content -- do not remove or rewrite existing information.',
    '2. ADD new information in the most appropriate section, or create a new section if needed.',
    '3. If the new information CONTRADICTS existing content, keep both versions and add',
    '   a callout block: > [!warning] Contradiction',
    '   followed by an explanation of the discrepancy.',
    '4. UPDATE the `updated` field in the YAML frontmatter to the current ISO 8601 date.',
    '5. ADD the source reference to the `sources` array in frontmatter if not already present.',
    '6. Maintain consistent formatting, heading levels, and wiki-link syntax [[Page Name]].',
    '7. Return the COMPLETE page including frontmatter -- not just the changes.',
  ].join('\n');

  const userMessage = [
    `New information comes from source: ${sourceName}`,
    '',
    '--- EXISTING PAGE ---',
    existingPageContent,
    '--- END EXISTING PAGE ---',
    '',
    '--- NEW INFORMATION ---',
    newInfo,
    '--- END NEW INFORMATION ---',
    '',
    'Merge the new information into the existing page. Return the complete updated page.',
  ].join('\n');

  const result = await provider.complete({
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
    maxTokens: 4096,
    temperature: 0.2,
  });

  return result.text;
}
