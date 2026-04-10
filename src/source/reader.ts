// src/source/reader.ts -- Read source files by format (text, PDF, image, data)

import { readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Result of reading a source file.
 */
export interface ReadResult {
  /** Extracted text content (or base64-encoded string for images) */
  content: string;
  /** Detected file format (extension including the dot, e.g. '.md') */
  format: string;
}

/** All file extensions the reader can handle. */
const TEXT_FORMATS = new Set(['.md', '.txt', '.csv']);
const DATA_FORMATS = new Set(['.json']);
const PDF_FORMATS = new Set(['.pdf']);
const IMAGE_FORMATS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const DOCX_FORMATS = new Set(['.docx']);
const XLSX_FORMATS = new Set(['.xlsx', '.xls']);

const ALL_SUPPORTED = new Set([
  ...TEXT_FORMATS,
  ...DATA_FORMATS,
  ...PDF_FORMATS,
  ...IMAGE_FORMATS,
  ...DOCX_FORMATS,
  ...XLSX_FORMATS,
]);

/**
 * Returns the list of file extensions this reader supports.
 */
export function getSupportedFormats(): string[] {
  return [...ALL_SUPPORTED].sort();
}

/**
 * Read a source file and return its content in a format suitable for downstream processing.
 *
 * - Text files (.md, .txt, .csv): read as UTF-8 string.
 * - JSON (.json): read, parse, and re-stringify with pretty printing.
 * - PDF (.pdf): extract text via pdf-parse. Text includes form-feed characters between pages.
 * - Images (.png, .jpg, .jpeg, .webp): return base64-encoded content.
 *
 * @throws Error if the file format is unsupported.
 */
export async function readSource(filePath: string): Promise<ReadResult> {
  const ext = path.extname(filePath).toLowerCase();

  if (!ALL_SUPPORTED.has(ext)) {
    throw new Error(`Unsupported source format: ${ext}`);
  }

  const format = ext;

  // --- Text formats ---
  if (TEXT_FORMATS.has(ext)) {
    const content = await readFile(filePath, 'utf-8');
    return { content, format };
  }

  // --- JSON ---
  if (DATA_FORMATS.has(ext)) {
    const raw = await readFile(filePath, 'utf-8');
    // Parse and re-stringify for consistent pretty-printed output
    const parsed: unknown = JSON.parse(raw);
    const content = JSON.stringify(parsed, null, 2);
    return { content, format };
  }

  // --- PDF ---
  if (PDF_FORMATS.has(ext)) {
    const buffer = await readFile(filePath);
    // Dynamic import so the dependency is only loaded when needed
    const pdfParse = (await import('pdf-parse')).default;
    const result = await pdfParse(buffer);
    return { content: result.text, format };
  }

  // --- Images ---
  if (IMAGE_FORMATS.has(ext)) {
    const buffer = await readFile(filePath);
    const content = buffer.toString('base64');
    return { content, format };
  }

  // --- DOCX ---
  if (DOCX_FORMATS.has(ext)) {
    const buffer = await readFile(filePath);
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    return { content: result.value, format };
  }

  // --- XLSX / XLS ---
  if (XLSX_FORMATS.has(ext)) {
    const buffer = await readFile(filePath);
    const XLSX = await import('xlsx');
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheets: string[] = [];
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const csv = XLSX.utils.sheet_to_csv(sheet);
      sheets.push(`## Sheet: ${sheetName}\n\n${csv}`);
    }
    return { content: sheets.join('\n\n---\n\n'), format };
  }

  // Should never reach here due to the guard at the top, but TypeScript needs it
  throw new Error(`Unsupported source format: ${ext}`);
}
