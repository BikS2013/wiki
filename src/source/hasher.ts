// src/source/hasher.ts -- SHA-256 content hashing

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

/**
 * Compute a SHA-256 hash of a string and return the lowercase hex digest.
 *
 * Useful for hashing already-loaded content (e.g. after reading a file into memory).
 */
export function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

/**
 * Compute a SHA-256 hash of a file's raw bytes and return the lowercase hex digest.
 *
 * Reads the file as a binary Buffer so the hash is format-agnostic and deterministic
 * across platforms (no encoding normalization).
 */
export async function hashFile(filePath: string): Promise<string> {
  const buffer = await readFile(filePath);
  return createHash('sha256').update(buffer).digest('hex');
}
