// src/source/chunker.ts -- Section-aware content chunking with token budget

/**
 * Options that control how content is split into chunks.
 */
export interface ChunkOptions {
  /** Maximum number of estimated tokens per chunk. */
  maxTokens: number;
  /** Number of estimated tokens to overlap between consecutive chunks (default 100). */
  overlap?: number;
}

/**
 * Heuristic token estimation: approximately 1 token per 4 characters.
 * Accuracy is ~85-95% for English prose. For precise counts use the Anthropic
 * countTokens API instead.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Extract approximately `tokenCount` tokens worth of text from the end of a string,
 * measured by the chars/4 heuristic.
 */
function tailByTokens(text: string, tokenCount: number): string {
  const charCount = tokenCount * 4;
  if (text.length <= charCount) {
    return text;
  }
  return text.slice(text.length - charCount);
}

/**
 * Split text into sentences using a simple heuristic: break on period, exclamation
 * mark, or question mark followed by whitespace or end-of-string.
 */
function splitSentences(text: string): string[] {
  // Match sentence-ending punctuation followed by space or end-of-string.
  const parts = text.split(/(?<=[.!?])\s+/);
  return parts.filter((s) => s.length > 0);
}

/**
 * Split text into paragraphs (separated by double newlines).
 */
function splitParagraphs(text: string): string[] {
  return text.split(/\n\n+/).filter((p) => p.trim().length > 0);
}

/**
 * Split markdown content on headings (lines starting with ## or ###).
 * Each section includes its heading line.
 */
function splitMarkdownSections(text: string): string[] {
  const lines = text.split('\n');
  const sections: string[] = [];
  let current: string[] = [];

  for (const line of lines) {
    // A heading of level 2 or 3 starts a new section
    if (/^#{2,3}\s/.test(line) && current.length > 0) {
      sections.push(current.join('\n'));
      current = [];
    }
    current.push(line);
  }

  if (current.length > 0) {
    sections.push(current.join('\n'));
  }

  return sections;
}

/**
 * Given an array of text segments, greedily group them into chunks that each
 * fit within `maxTokens`. When a single segment exceeds `maxTokens` it is
 * returned as its own (over-sized) chunk to avoid infinite loops; the caller
 * should sub-split if needed.
 */
function groupSegments(segments: string[], maxTokens: number): string[] {
  const chunks: string[] = [];
  let buffer = '';

  for (const seg of segments) {
    const combined = buffer.length > 0 ? buffer + '\n\n' + seg : seg;
    if (estimateTokens(combined) <= maxTokens) {
      buffer = combined;
    } else {
      if (buffer.length > 0) {
        chunks.push(buffer);
      }
      buffer = seg;
    }
  }

  if (buffer.length > 0) {
    chunks.push(buffer);
  }

  return chunks;
}

/**
 * Split a single text block that exceeds `maxTokens` by sentences. If any
 * single sentence still exceeds the limit it is kept as-is.
 */
function splitBySentences(text: string, maxTokens: number): string[] {
  const sentences = splitSentences(text);
  return groupSegments(sentences, maxTokens);
}

/**
 * Split a single text block that exceeds `maxTokens` first by paragraphs,
 * then by sentences if a paragraph is still too large.
 */
function splitByParagraphsThenSentences(text: string, maxTokens: number): string[] {
  const paragraphs = splitParagraphs(text);
  const intermediate = groupSegments(paragraphs, maxTokens);

  // Sub-split any chunks that are still too large
  const result: string[] = [];
  for (const chunk of intermediate) {
    if (estimateTokens(chunk) > maxTokens) {
      result.push(...splitBySentences(chunk, maxTokens));
    } else {
      result.push(chunk);
    }
  }

  return result;
}

/**
 * Section-aware content chunking.
 *
 * Strategy:
 * 1. Split on markdown headings (## or ###) first.
 * 2. If a section exceeds `maxTokens`, split on paragraphs.
 * 3. If a paragraph exceeds `maxTokens`, split on sentences.
 * 4. Apply token overlap between consecutive chunks.
 *
 * Token estimation uses the chars/4 heuristic.
 *
 * @returns Array of chunk strings.
 */
export function chunkContent(content: string, options: ChunkOptions): string[] {
  const { maxTokens, overlap = 100 } = options;

  // If the whole content fits, return it as a single chunk
  if (estimateTokens(content) <= maxTokens) {
    return [content];
  }

  // Step 1: split on markdown headings
  const sections = splitMarkdownSections(content);

  // Step 2: group sections, sub-splitting oversized ones by paragraphs then sentences
  const rawChunks: string[] = [];

  for (const section of sections) {
    if (estimateTokens(section) <= maxTokens) {
      // Try to merge with the previous chunk
      if (rawChunks.length > 0) {
        const merged = rawChunks[rawChunks.length - 1] + '\n\n' + section;
        if (estimateTokens(merged) <= maxTokens) {
          rawChunks[rawChunks.length - 1] = merged;
          continue;
        }
      }
      rawChunks.push(section);
    } else {
      // Section is too large -- split by paragraphs, then sentences
      const subChunks = splitByParagraphsThenSentences(section, maxTokens);
      rawChunks.push(...subChunks);
    }
  }

  // Step 3: apply overlap between consecutive chunks
  if (overlap <= 0 || rawChunks.length <= 1) {
    return rawChunks;
  }

  const overlapped: string[] = [rawChunks[0]];
  for (let i = 1; i < rawChunks.length; i++) {
    const overlapText = tailByTokens(rawChunks[i - 1], overlap);
    overlapped.push(overlapText + '\n\n' + rawChunks[i]);
  }

  return overlapped;
}
