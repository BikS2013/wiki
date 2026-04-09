// src/utils/naming.ts -- toKebabCase(), toWikiSlug(), sanitizeFilename(), generatePageFilename()

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Convert any text to kebab-case.
 *
 * "Machine Learning"       -> "machine-learning"
 * "  Hello   World  "      -> "hello-world"
 * "camelCaseExample"        -> "camel-case-example"
 * "PascalCaseExample"       -> "pascal-case-example"
 * "Resume -- Pro Tips!"     -> "resume-pro-tips"
 * "foo--bar___baz"          -> "foo-bar-baz"
 */
export function toKebabCase(text: string): string {
  return (
    text
      // Transliterate common accented characters to ASCII equivalents
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      // Insert a hyphen before uppercase letters that follow lowercase letters
      // (handles camelCase / PascalCase)
      .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
      // Replace any non-alphanumeric character (or sequence) with a single hyphen
      .replace(/[^a-zA-Z0-9]+/g, '-')
      // Lowercase everything
      .toLowerCase()
      // Collapse multiple consecutive hyphens
      .replace(/-{2,}/g, '-')
      // Strip leading and trailing hyphens
      .replace(/^-+|-+$/g, '')
  );
}

/**
 * Convert a human-readable title to an Obsidian-safe filename slug.
 *
 * Unlike kebab-case, wiki slugs preserve spaces (Obsidian's native format)
 * but strip characters that are invalid in filenames or problematic in YAML /
 * shell contexts.
 *
 * "My Note: A Deep Dive"   -> "My Note A Deep Dive"
 * "  spaces   everywhere " -> "spaces everywhere"
 * "Title #1 [draft]"       -> "Title 1 draft"
 */
export function toWikiSlug(text: string): string {
  return (
    text
      .trim()
      // Collapse whitespace to single space
      .replace(/\s+/g, ' ')
      // Remove characters invalid in filenames across macOS/Windows/Linux
      // and characters unsafe in YAML / shell contexts
      .replace(/[#\[\]|^:\\/*?"<>]/g, '')
      .trim()
  );
}

/**
 * Remove all unsafe characters from a filename, leaving only lowercase
 * alphanumeric characters and hyphens.  Guarantees a valid filename on
 * macOS, Windows, and Linux.
 *
 * "Hello World!.md"        -> "hello-world-md"
 * "Resume (2024)"          -> "resume-2024"
 * "___weird___name___"     -> "weird-name"
 */
export function sanitizeFilename(text: string): string {
  return (
    text
      // Transliterate accented characters
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      // Replace anything not alphanumeric with a hyphen
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .toLowerCase()
      // Collapse multiple hyphens
      .replace(/-{2,}/g, '-')
      // Strip leading/trailing hyphens
      .replace(/^-+|-+$/g, '')
  );
}

/**
 * Generate a wiki page filename from a human-readable name and an optional
 * type for disambiguation.
 *
 * "Mercury"            -> "mercury.md"
 * "Mercury", "planet"  -> "mercury-planet.md"
 */
export function generatePageFilename(name: string, type?: string): string {
  const slug = toKebabCase(name);
  if (type) {
    const typeSuffix = toKebabCase(type);
    return `${slug}-${typeSuffix}.md`;
  }
  return `${slug}.md`;
}
