// src/commands/init.ts -- wiki init: create directory structure and templates

import { Command } from 'commander';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createLogger, type Logger } from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Embedded Templates
// ---------------------------------------------------------------------------

const CONFIG_TEMPLATE = JSON.stringify(
  {
    _comment: 'LLM Wiki Configuration. Values can be overridden by environment variables (higher priority). See docs/design/configuration-guide.md for details.',
    llm: {
      _comment_provider: 'Options: anthropic, azure, vertex | Env: WIKI_LLM_PROVIDER',
      provider: '',
      _comment_model: 'Model identifier (e.g. claude-sonnet-4-20250514, gpt-4o, gemini-2.5-pro) | Env: WIKI_LLM_MODEL',
      model: '',
      _comment_apiKey: 'Required for anthropic and azure, not needed for vertex | Env: WIKI_LLM_API_KEY',
      apiKey: '',
      _comment_apiKeyExpiry: 'Optional ISO 8601 date. Warns 7 days before expiry.',
      apiKeyExpiry: '',
      _comment_maxTokens: 'Max output tokens per LLM call | Env: WIKI_LLM_MAX_TOKENS',
      maxTokens: 4096,
      _comment_azure: 'Required when provider = azure | Env: WIKI_AZURE_ENDPOINT, WIKI_AZURE_DEPLOYMENT',
      azureEndpoint: '',
      azureDeployment: '',
      _comment_vertex: 'Required when provider = vertex | Env: WIKI_VERTEX_PROJECT_ID, WIKI_VERTEX_LOCATION',
      vertexProjectId: '',
      vertexLocation: '',
    },
    wiki: {
      _comment_rootDir: 'Absolute path to wiki root | Env: WIKI_ROOT_DIR',
      rootDir: '',
      sourcesDir: 'sources',
      wikiDir: 'wiki',
      schemaDir: 'schema',
    },
    obsidian: {
      enabled: true,
      vaultPath: '',
    },
  },
  null,
  2,
);

const WIKI_SCHEMA_TEMPLATE = `# Wiki Schema

This document describes the structure and conventions for all wiki pages.
The LLM must follow these rules when creating or updating pages.

## Page Types

| Type | Directory | Purpose |
|------|-----------|---------|
| source-summary | wiki/sources/ | Summary of an ingested source document |
| entity | wiki/entities/ | Person, organisation, technology, or other named entity |
| topic | wiki/topics/ | Concept, field, or subject area |
| synthesis | wiki/synthesis/ | Cross-cutting analysis combining multiple sources |
| comparison | wiki/synthesis/ | Side-by-side comparison of entities or approaches |
| query-result | wiki/queries/ | Saved answer to a user query |

## Frontmatter (YAML)

Every page MUST begin with YAML frontmatter:

\`\`\`yaml
---
title: "Page Title"
type: source-summary | entity | topic | synthesis | comparison | query-result
created: "YYYY-MM-DDTHH:mm:ssZ"
updated: "YYYY-MM-DDTHH:mm:ssZ"
sources:
  - "source-filename.md"
tags:
  - tag1
  - tag2
aliases:
  - "Alternative Name"
---
\`\`\`

## Naming Conventions

- Filenames use **kebab-case**: \`machine-learning.md\`, \`john-doe.md\`
- Avoid special characters in filenames
- Use the \`generatePageFilename()\` convention: name + optional type suffix

## Wiki Links

- Use Obsidian-style wiki links: \`[[page-name]]\` or \`[[page-name|Display Text]]\`
- Link to entities and topics whenever they are mentioned
- Do not create links to pages that do not exist

## Contradiction Callouts

When new information contradicts existing content, add:

\`\`\`markdown
> [!warning] Contradiction
> Source "X" states A, while this page previously stated B.
\`\`\`

## Content Style

- Objective, encyclopedic tone
- Factual and evidence-based
- Cite sources using wiki-links
- Be comprehensive but concise
`;

const PROMPT_INGEST = `# Ingest Prompt

<instructions>
You are a knowledge wiki editor. You are processing a new source document that needs to be
integrated into an existing wiki.

Your task is to generate a **source summary page** in markdown with YAML frontmatter.

The summary should:
1. Capture the key information, arguments, and conclusions from the source
2. Be written in an objective, encyclopedic tone
3. Include YAML frontmatter with: title, type (source-summary), created, updated, sources, tags
4. Reference entities and topics using [[wiki-link]] syntax where appropriate
5. Be comprehensive but concise (aim for 300-800 words)

Follow the wiki conventions described in the schema below.
</instructions>

<schema>
{{SCHEMA}}
</schema>

<current_index>
{{INDEX_CONTENT}}
</current_index>

<source_document name="{{SOURCE_NAME}}">
{{SOURCE_CONTENT}}
</source_document>

<tags>
{{TAGS}}
</tags>

Generate the source summary page now. Output valid markdown with YAML frontmatter.
`;

const PROMPT_QUERY = `# Query Prompt

<instructions>
You are a wiki research assistant. A user has asked a question and you have been
provided with relevant wiki pages to answer it.

Your task:
1. Synthesize an answer using ONLY the information in the provided wiki pages
2. Cite your sources using [[wiki-link]] syntax (e.g., "According to [[machine-learning]], ...")
3. If the pages do not contain enough information, say so explicitly
4. Structure your answer with clear headings if the answer is complex
5. Be precise and factual -- do not add information not present in the pages

Output format: markdown with [[wiki-link]] citations.
</instructions>

<question>
{{QUESTION}}
</question>

<wiki_pages>
{{PAGE_CONTENTS}}
</wiki_pages>

Synthesize your answer now.
`;

const PROMPT_LINT = `# Lint Prompt

<instructions>
You are a wiki quality auditor. You are reviewing a batch of wiki pages to detect:

1. **Contradictions**: Two pages asserting conflicting facts about the same entity or topic.
   Report the specific claims that conflict and which pages contain them.

2. **Missing cross-references**: Pages that mention entities or concepts that have
   dedicated wiki pages but do not use [[wiki-link]] syntax to link to them.

Use the identify_contradictions tool to report your findings as structured data.
</instructions>

<pages>
{{PAGES_CONTENT}}
</pages>

Analyze these pages now and report all contradictions and missing cross-references.
`;

const PROMPT_UPDATE_PAGE = `# Update Page Prompt

<instructions>
You are a wiki editor. You need to merge new information into an existing wiki page.

Rules:
1. PRESERVE all existing content -- do not remove or rewrite existing sections
2. ADD new information from the source in appropriate locations
3. If the new information CONTRADICTS existing content, add a callout:
   > [!warning] Contradiction
   > Source "{{SOURCE_NAME}}" states X, while this page previously stated Y.
4. Update the \`updated\` date in frontmatter to the current timestamp
5. Add the new source reference to the \`sources\` array in frontmatter
6. Add any new tags from the source to the \`tags\` array in frontmatter
7. Ensure all entity/topic mentions are wiki-linked with [[name]] syntax

Output the complete updated page (frontmatter + body).
</instructions>

<existing_page>
{{EXISTING_PAGE}}
</existing_page>

<new_information source="{{SOURCE_NAME}}">
{{ENTITY_INFO}}
</new_information>

<schema>
{{SCHEMA}}
</schema>

Output the complete updated page now.
`;

const PROMPT_CREATE_ENTITY = `# Create Entity Page Prompt

<instructions>
You are a wiki editor creating a new entity page.

The entity is: {{ENTITY_NAME}} (type: {{ENTITY_TYPE}})

Create a wiki page with:
1. YAML frontmatter: title, type (entity), created, updated, sources, tags, aliases
2. A brief introduction paragraph
3. Key facts and attributes in structured sections
4. Cross-references to related entities/topics using [[wiki-link]] syntax
5. A "Sources" section at the bottom listing the source documents

Follow the conventions in the schema. Use an objective, encyclopedic tone.
</instructions>

<entity_description>
{{ENTITY_INFO}}
</entity_description>

<source_name>
{{SOURCE_NAME}}
</source_name>

<schema>
{{SCHEMA}}
</schema>

<tags>
{{TAGS}}
</tags>

Generate the entity page now.
`;

const PROMPT_CREATE_TOPIC = `# Create Topic Page Prompt

<instructions>
You are a wiki editor creating a new topic page.

The topic is: {{TOPIC_NAME}}

Create a wiki page with:
1. YAML frontmatter: title, type (topic), created, updated, sources, tags, aliases
2. A clear definition/introduction
3. Key concepts and subtopics in structured sections
4. Cross-references to related entities and other topics using [[wiki-link]] syntax
5. A "Sources" section at the bottom

Follow the conventions in the schema. Aim for depth and clarity.
</instructions>

<topic_description>
{{TOPIC_INFO}}
</topic_description>

<related_entities>
{{RELATED_ENTITIES}}
</related_entities>

<source_name>
{{SOURCE_NAME}}
</source_name>

<schema>
{{SCHEMA}}
</schema>

<tags>
{{TAGS}}
</tags>

Generate the topic page now.
`;

function buildIndexContent(): string {
  return `# Wiki Index

> Auto-generated catalog of all wiki pages. Do not edit manually.

## Sources

<!-- source-summary pages listed here -->

## Entities

<!-- entity pages listed here -->

## Topics

<!-- topic pages listed here -->

## Synthesis

<!-- synthesis and comparison pages listed here -->

## Queries

<!-- query-result pages listed here -->
`;
}

function buildLogContent(): string {
  const now = new Date().toISOString();
  return `# Wiki Log

> Append-only record of wiki operations.

| Timestamp | Action | Details |
|-----------|--------|---------|
| ${now} | INIT | Wiki initialized |
`;
}

function buildRegistryContent(): string {
  return JSON.stringify(
    {
      sources: [],
      lastUpdated: new Date().toISOString(),
    },
    null,
    2,
  );
}

const GITIGNORE_CONTENT = `config.json
node_modules/
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(dir: string, logger: Logger): Promise<void> {
  await mkdir(dir, { recursive: true });
  logger.verbose(`Created directory: ${dir}`);
}

async function writeTemplate(
  filePath: string,
  content: string,
  logger: Logger,
): Promise<void> {
  await writeFile(filePath, content, 'utf-8');
  logger.verbose(`Created file: ${filePath}`);
}

// ---------------------------------------------------------------------------
// Command Registration
// ---------------------------------------------------------------------------

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Initialize a new LLM Wiki in the current directory')
    .option('--path <dir>', 'Target directory (default: current working directory)')
    .option('--verbose', 'Enable verbose output', false)
    .action(async (options: { path?: string; verbose: boolean }) => {
      const logger = createLogger({ verbose: options.verbose });
      const rootDir = resolve(options.path ?? process.cwd());

      logger.verbose(`Initializing wiki at: ${rootDir}`);

      // ------------------------------------------------------------------
      // 1. Check if wiki already exists
      // ------------------------------------------------------------------
      const configPath = join(rootDir, 'config.json');
      const schemaDir = join(rootDir, 'schema');

      if (await pathExists(configPath)) {
        logger.warn(`Wiki already initialized at ${rootDir} (config.json exists).`);
        logger.warn('Aborting to avoid overwriting existing data.');
        process.exitCode = 1;
        return;
      }

      if (await pathExists(schemaDir)) {
        logger.warn(`Wiki already initialized at ${rootDir} (schema/ directory exists).`);
        logger.warn('Aborting to avoid overwriting existing data.');
        process.exitCode = 1;
        return;
      }

      // ------------------------------------------------------------------
      // 2. Create directory structure
      // ------------------------------------------------------------------
      const directories = [
        join(rootDir, 'sources'),
        join(rootDir, 'sources', 'files'),
        join(rootDir, 'wiki', 'sources'),
        join(rootDir, 'wiki', 'entities'),
        join(rootDir, 'wiki', 'topics'),
        join(rootDir, 'wiki', 'synthesis'),
        join(rootDir, 'wiki', 'queries'),
        join(rootDir, 'schema', 'prompts'),
      ];

      for (const dir of directories) {
        await ensureDir(dir, logger);
      }

      logger.success('Directory structure created');

      // ------------------------------------------------------------------
      // 3. Create config.json from template
      // ------------------------------------------------------------------
      await writeTemplate(configPath, CONFIG_TEMPLATE, logger);
      logger.success('Created config.json');

      // ------------------------------------------------------------------
      // 4. Create schema/wiki-schema.md
      // ------------------------------------------------------------------
      await writeTemplate(
        join(rootDir, 'schema', 'wiki-schema.md'),
        WIKI_SCHEMA_TEMPLATE,
        logger,
      );
      logger.success('Created schema/wiki-schema.md');

      // ------------------------------------------------------------------
      // 5. Create schema/prompts/*.md
      // ------------------------------------------------------------------
      const prompts: Array<[string, string]> = [
        ['ingest.md', PROMPT_INGEST],
        ['query.md', PROMPT_QUERY],
        ['lint.md', PROMPT_LINT],
        ['update-page.md', PROMPT_UPDATE_PAGE],
        ['create-entity.md', PROMPT_CREATE_ENTITY],
        ['create-topic.md', PROMPT_CREATE_TOPIC],
      ];

      for (const [filename, content] of prompts) {
        await writeTemplate(
          join(rootDir, 'schema', 'prompts', filename),
          content,
          logger,
        );
      }

      logger.success('Created prompt templates in schema/prompts/');

      // ------------------------------------------------------------------
      // 6. Create wiki/index.md
      // ------------------------------------------------------------------
      await writeTemplate(
        join(rootDir, 'wiki', 'index.md'),
        buildIndexContent(),
        logger,
      );
      logger.success('Created wiki/index.md');

      // ------------------------------------------------------------------
      // 7. Create wiki/log.md
      // ------------------------------------------------------------------
      await writeTemplate(
        join(rootDir, 'wiki', 'log.md'),
        buildLogContent(),
        logger,
      );
      logger.success('Created wiki/log.md');

      // ------------------------------------------------------------------
      // 8. Create sources/registry.json
      // ------------------------------------------------------------------
      await writeTemplate(
        join(rootDir, 'sources', 'registry.json'),
        buildRegistryContent(),
        logger,
      );
      logger.success('Created sources/registry.json');

      // ------------------------------------------------------------------
      // 9. Create .gitignore
      // ------------------------------------------------------------------
      await writeTemplate(
        join(rootDir, '.gitignore'),
        GITIGNORE_CONTENT,
        logger,
      );
      logger.success('Created .gitignore');

      // ------------------------------------------------------------------
      // 10. Print success message with next steps
      // ------------------------------------------------------------------
      logger.info('');
      logger.info('Wiki initialized successfully!');
      logger.info('');
      logger.info('Next steps:');
      logger.info('  1. Edit config.json to add your LLM provider credentials');
      logger.info('  2. Place source documents in the sources/ directory');
      logger.info('  3. Run: wiki ingest <source-file> to process your first document');
      logger.info('');
    });
}
