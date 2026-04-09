// src/wiki/registry.ts -- SourceRegistry class: load/save/CRUD sources/registry.json

import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

/**
 * A single source entry in the registry.
 */
export interface SourceEntry {
  /** UUID v4 identifier */
  id: string;
  /** Absolute path to the source file */
  filePath: string;
  /** Original filename (basename) */
  fileName: string;
  /** File extension including the dot (e.g. '.md', '.pdf') */
  format: string;
  /** SHA-256 hex digest of file content */
  contentHash: string;
  /** ISO 8601 timestamp when the source was first ingested */
  ingestedAt: string;
  /** ISO 8601 timestamp when the source was last updated */
  updatedAt: string;
  /** Processing status */
  status: 'pending' | 'ingesting' | 'ingested' | 'failed' | 'stale';
  /** Relative paths to wiki pages generated from this source */
  generatedPages: string[];
  /** User-provided metadata key-value pairs */
  metadata: Record<string, string>;
}

/**
 * Top-level registry structure persisted to disk.
 */
interface RegistryData {
  sources: SourceEntry[];
  lastUpdated: string;
}

/**
 * Manages the source registry stored as JSON at `sources/registry.json`.
 *
 * Provides CRUD operations for source entries, with persistence to disk.
 */
export class SourceRegistry {
  private registryPath: string;
  private data: RegistryData = { sources: [], lastUpdated: new Date().toISOString() };
  private loaded = false;

  constructor(registryPath: string) {
    this.registryPath = registryPath;
  }

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  /**
   * Load the registry from disk. If the file does not exist, initialise with
   * an empty registry.
   */
  async load(registryPath?: string): Promise<void> {
    if (registryPath) {
      this.registryPath = registryPath;
    }

    try {
      const raw = await readFile(this.registryPath, 'utf-8');
      this.data = JSON.parse(raw) as RegistryData;
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        // File doesn't exist yet -- start fresh
        this.data = { sources: [], lastUpdated: new Date().toISOString() };
      } else {
        throw err;
      }
    }
    this.loaded = true;
  }

  /**
   * Persist the current registry state to disk.
   *
   * Writes to a temporary file first and then renames for atomic update.
   */
  async save(): Promise<void> {
    this.data.lastUpdated = new Date().toISOString();

    const dir = path.dirname(this.registryPath);
    await mkdir(dir, { recursive: true });

    const tmpPath = this.registryPath + '.tmp';
    await writeFile(tmpPath, JSON.stringify(this.data, null, 2), 'utf-8');
    await rename(tmpPath, this.registryPath);
  }

  // ---------------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------------

  /**
   * Add a new source entry. Generates a UUID and sets timestamps automatically.
   *
   * @returns The newly created entry (with generated id).
   */
  add(entry: Omit<SourceEntry, 'id'>): SourceEntry {
    this.ensureLoaded();

    const newEntry: SourceEntry = {
      ...entry,
      id: randomUUID(),
    };

    this.data.sources.push(newEntry);
    return newEntry;
  }

  /**
   * Update an existing source entry by id.
   *
   * @throws Error if no entry with the given id exists.
   */
  update(id: string, updates: Partial<Omit<SourceEntry, 'id'>>): SourceEntry {
    this.ensureLoaded();

    const index = this.data.sources.findIndex((s) => s.id === id);
    if (index === -1) {
      throw new Error(`Source entry not found: ${id}`);
    }

    this.data.sources[index] = { ...this.data.sources[index], ...updates };
    return this.data.sources[index];
  }

  /**
   * Remove a source entry by id.
   *
   * @returns The removed entry.
   * @throws Error if no entry with the given id exists.
   */
  remove(id: string): SourceEntry {
    this.ensureLoaded();

    const index = this.data.sources.findIndex((s) => s.id === id);
    if (index === -1) {
      throw new Error(`Source entry not found: ${id}`);
    }

    const [removed] = this.data.sources.splice(index, 1);
    return removed;
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  /**
   * Find a source entry by its content hash.
   */
  findByHash(hash: string): SourceEntry | undefined {
    this.ensureLoaded();
    return this.data.sources.find((s) => s.contentHash === hash);
  }

  /**
   * Find a source entry by its absolute file path.
   */
  findByPath(filePath: string): SourceEntry | undefined {
    this.ensureLoaded();
    return this.data.sources.find((s) => s.filePath === filePath);
  }

  /**
   * Find a source entry by its UUID.
   */
  findById(id: string): SourceEntry | undefined {
    this.ensureLoaded();
    return this.data.sources.find((s) => s.id === id);
  }

  /**
   * Return all source entries.
   */
  getAll(): SourceEntry[] {
    this.ensureLoaded();
    return [...this.data.sources];
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private ensureLoaded(): void {
    if (!this.loaded) {
      throw new Error(
        'Registry has not been loaded. Call load() before performing operations.',
      );
    }
  }
}
