// src/source/clipboard.ts -- macOS clipboard content detection and extraction

import { execSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Detected clipboard content type.
 */
export type ClipboardContentType = 'text' | 'image' | 'none';

/**
 * Detect what type of content is on the macOS clipboard.
 *
 * Strategy:
 * 1. Run `osascript -e 'clipboard info'` to get available clipboard formats
 * 2. If output contains `PNGf` or `TIFF` -> image
 * 3. Else if output contains `utf8` or `ut16` -> text
 * 4. Else -> none
 */
export function detectClipboardType(): ClipboardContentType {
  try {
    const info = execSync('osascript -e \'clipboard info\'', {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();

    if (info.includes('PNGf') || info.includes('TIFF')) {
      return 'image';
    }
    if (info.includes('utf8') || info.includes('ut16') || info.includes('«class utf8»') || info.includes('«class ut16»')) {
      return 'text';
    }

    return 'none';
  } catch {
    return 'none';
  }
}

/**
 * Extract text content from the clipboard using `pbpaste`.
 *
 * @throws Error if clipboard text is empty.
 */
export function extractClipboardText(): string {
  const text = execSync('pbpaste', { encoding: 'utf-8' });
  if (!text || text.trim().length === 0) {
    throw new Error('Clipboard text is empty');
  }
  return text;
}

/**
 * Extract image content from the clipboard and save as PNG to a temporary file.
 * Uses osascript with AppKit to write clipboard PNG data to disk.
 *
 * @returns The path to the saved temporary PNG file.
 * @throws Error if the clipboard does not contain image data.
 */
export function extractClipboardImage(destPath: string): void {
  const script = [
    'use framework "AppKit"',
    'set pb to current application\'s NSPasteboard\'s generalPasteboard()',
    'set imgData to pb\'s dataForType:"public.png"',
    'if imgData is missing value then',
    '  -- Try TIFF and convert to PNG',
    '  set tiffData to pb\'s dataForType:"public.tiff"',
    '  if tiffData is missing value then',
    '    error "No image data on clipboard"',
    '  end if',
    '  set bitmapRep to current application\'s NSBitmapImageRep\'s imageRepWithData:tiffData',
    '  set imgData to bitmapRep\'s representationUsingType:(current application\'s NSBitmapImageFileTypePNG) properties:(missing value)',
    'end if',
    `imgData's writeToFile:"${destPath}" atomically:true`,
  ].join('\n');

  try {
    execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, {
      timeout: 10000,
    });
  } catch (err) {
    // Try alternate simpler approach using raw AppleScript class
    try {
      const altScript = [
        'set pngData to the clipboard as «class PNGf»',
        `set filePath to POSIX path of "${destPath}"`,
        'set fRef to open for access filePath with write permission',
        'write pngData to fRef',
        'close access fRef',
      ].join('\n');
      execSync(`osascript -e '${altScript.replace(/'/g, "'\\''")}'`, {
        timeout: 10000,
      });
    } catch {
      throw new Error(
        `Failed to extract image from clipboard: ${(err as Error).message}`,
      );
    }
  }
}

/**
 * Generate a timestamp-based filename for clipboard content.
 */
function generateClipboardFilename(extension: string): string {
  const now = new Date();
  const ts = now.toISOString()
    .replace(/T/, '-')
    .replace(/:/g, '')
    .replace(/\.\d{3}Z$/, '');
  // Format: clipboard-YYYY-MM-DD-HHmmss
  return `clipboard-${ts}.${extension}`;
}

/**
 * Save clipboard content (text or image) to a file in the specified directory.
 *
 * 1. Detect clipboard content type
 * 2. If text: save as `.txt`
 * 3. If image: save as `.png`
 * 4. If empty/unsupported: throw error
 *
 * @param destDir - Directory where the file will be saved
 * @returns The absolute path to the saved file
 * @throws Error if clipboard is empty or contains unsupported data
 */
export async function saveClipboardToFile(destDir: string): Promise<string> {
  const contentType = detectClipboardType();

  if (contentType === 'none') {
    throw new Error('Clipboard is empty or contains unsupported data');
  }

  if (contentType === 'text') {
    const text = extractClipboardText();
    const filename = generateClipboardFilename('txt');
    const filePath = join(destDir, filename);
    await writeFile(filePath, text, 'utf-8');
    return filePath;
  }

  // contentType === 'image'
  const filename = generateClipboardFilename('png');
  const filePath = join(destDir, filename);
  extractClipboardImage(filePath);
  return filePath;
}
