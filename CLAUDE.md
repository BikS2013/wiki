<structure-and-conventions>
## Structure & Conventions

- Every time you want to create a test script, you must create it in the test_scripts folder. If the folder doesn't exist, you must make it.

- All the plans must be kept under the docs/design folder inside the project's folder in separate files: Each plan file must be named according to the following pattern: plan-xxx-<indicative description>.md

- The complete project design must be maintained inside a file named docs/design/project-design.md under the project's folder. The file must be updated with each new design or design change.

- All the reference material used for the project must be collected and kept under the docs/reference folder.
- All the functional requirements and all the feature descriptions must be registered in the /docs/design/project-functions.MD document under the project's folder.

<configuration-guide>
- If the user ask you to create a configuration guide, you must create it under the docs/design folder, name it configuration-guide.md and be sure to explain the following:
  - if multiple configuration options exist (like config file, env variables, cli params, etc) you must explain the options and what is the priority of each one.
  - Which is the purpose and the use of each configuration variable
  - How the user can obtain such a configuration variable
  - What is the recomented approach of storing or managing this configuration variable
  - Which options exist for the variable and what each option means for the project
  - If there are any default value for the parameter you must present it.
  - For configuration parameters that expire (e.g., PAT keys, tokens), I want you to propose to the user adding a parameter to capture the parameter's expiration date, so the app or service can proactively warn users to renew.
</configuration-guide>

- Every time you create a prompt working in a project, the prompt must be placed inside a dedicated folder named prompts. If the folder doesn't exists you must create it. The prompt file name must have an sequential number prefix and must be representative to the prompt use and purpose.

- You must maintain a document at the root level of the project, named "Issues - Pending Items.md," where you must register any issue, pending item, inconsistency, or discrepancy you detect. Every time you fix a defect or an issue, you must check this file to see if there is an item to remove.
- The "Issues - Pending Items.md" content must be organized with the pending items on top and the completed items after. From the pending items the most critical and important must be first followed by the rest.

- When I ask you to create tools in the context of a project everything must be in Typescript.
- Every tool you develop must be documented in the project's Claude.md file
- The documentation must be in the following format:
<toolName>
    <objective>
        what the tool does
    </objective>
    <command>
        the exact command to run
    </command>
    <info>
        detailed description of the tool
        command line parameters and their description
        examples of usage
    </info>
</toolName>

- Every time I ask you to do something that requires the creation of a code script, I want you to examine the tools already implemented in the scope of the project to detect if the code you plan to write, fits to the scope of the tool.
- If so, I want you to implement the code as an extension of the tool, otherwise I want you to build a generic and abstract version of the code as a tool, which will be part of the toolset of the project.
- Our goal is, while the project progressing, to develop the tools needed to test, evaluate, generate data, collect information, etc and reuse them in a consistent manner.
- All these tools must be documented inside the CLAUDE.md to allow their consistent reuse.

- When I ask you to locate code, I need to give me the folder, the file name, the class, and the line number together with the code extract.
- Don't perform any version control operation unless I explicitly request it.

- When you design databases you must align with the following table naming conventions:
  - Table names must be singular e.g. the table that keeps customers' data must be called "Customer"
  - Tables that are used to express references from one entity to another can by plural if the first entity is linked to many other entities.
  - So we have "Customer" and "Transaction" tables, we have CustomerTransactions.

- You must never create fallback solutions for configuration settings. In every case a configuration setting is not provided you must raise the appropriate exception. You must never substitute the missing config value with a default or a fallback value.
- If I ask you to make an exception to the configuration setting rule, you must write this exception in the projects memory file, before you implement it.
</structure-and-conventions>

# LLM Wiki - Personal Knowledge Base Builder

## Project Overview
A TypeScript CLI tool that builds and maintains a persistent, structured personal knowledge base (wiki) using LLMs. Instead of RAG-style retrieval, the system incrementally compiles knowledge from raw source documents into interlinked Obsidian-compatible markdown files.

## Tools

<Wiki>
    <objective>
        CLI tool that builds and maintains a persistent personal knowledge base using LLMs.
        Ingests source documents, extracts entities/topics, generates interlinked wiki pages,
        and supports querying, linting, and maintenance operations.
    </objective>
    <command>
        npx tsx src/cli.ts [command]
        # Or after build: node dist/cli.js [command]
    </command>
    <info>
        LLM Wiki is a TypeScript CLI tool that manages a three-layer knowledge base:
        - Layer 1: Raw sources (immutable documents)
        - Layer 2: Wiki (LLM-generated interlinked markdown pages)
        - Layer 3: Schema (configuration, prompt templates, conventions)

        Commands:
            wiki init                      Initialize a new wiki in the current directory
            wiki ingest <source>           Ingest a source file or directory
            wiki ingest --clipboard        Ingest from system clipboard (text or image)
            wiki query <question>          Query the wiki with natural language
            wiki lint                      Run health checks on the wiki
            wiki status                    Show wiki statistics
            wiki list-sources              List all registered sources
            wiki remove-source <id|name>   Remove a source and its wiki pages
            wiki rebuild-index             Regenerate index.md from wiki pages

        Global Options:
            --config <path>                Path to config.json (default: ./config.json)
            --verbose                      Enable verbose output
            --dry-run                      Show what would be done without changes
            --help                         Show help
            --version                      Show version

        Ingest Options:
            --clipboard                    Ingest from system clipboard (text or image, macOS)
            --recursive                    Scan directory recursively
            --format <type>                Force source format
            --tags <tags...>               Tags for generated pages
            --metadata <key=value...>      Additional source metadata

        Source Handling:
            Source files are COPIED into sources/files/ inside the wiki root.
            The wiki is self-contained — original source files can be moved/deleted
            after ingestion without affecting the wiki.
            Clipboard content is saved as clipboard-<timestamp>.txt or .png.

        Query Options:
            --save                         Save answer as a wiki page
            --pages <n>                    Max wiki pages to consult

        Lint Options:
            --fix                          Auto-fix issues where possible
            --output <path>                Write report to file
            --category <type>              Filter: orphans|links|stale|contradictions

        Providers:
            anthropic  -- Anthropic Claude models (direct API). Requires: apiKey.
            azure      -- Azure AI Inference (OpenAI-compatible endpoint). Requires: apiKey, azureEndpoint, azureDeployment.
            vertex     -- Google Vertex AI (Gemini models via Application Default Credentials). Requires: vertexProjectId, vertexLocation. Does NOT require apiKey.

        Configuration:
            Config file: config.json at wiki root
            Priority: CLI args > env vars > config file
            Required (all providers): WIKI_LLM_PROVIDER, WIKI_LLM_MODEL, WIKI_LLM_MAX_TOKENS, WIKI_ROOT_DIR
            Required (anthropic): WIKI_LLM_API_KEY
            Required (azure): WIKI_LLM_API_KEY, WIKI_AZURE_ENDPOINT, WIKI_AZURE_DEPLOYMENT
            Required (vertex): WIKI_VERTEX_PROJECT_ID, WIKI_VERTEX_LOCATION
            Optional: WIKI_LLM_API_KEY_EXPIRY (ISO 8601 date; warns within 7 days of expiry)
            See docs/design/configuration-guide.md for full details.

        Build:
            npm run build

        Development:
            npx tsx src/cli.ts [command]

        Type Check:
            npx tsc --noEmit

        Tests:
            npx tsx test_scripts/test-config.ts
            npx tsx test_scripts/test-frontmatter.ts
            npx tsx test_scripts/test-wikilinks.ts
            npx tsx test_scripts/test-naming.ts
            npx tsx test_scripts/test-hasher.ts
            npx tsx test_scripts/test-chunker.ts
            npx tsx test_scripts/test-tokens.ts
            npx tsx test_scripts/test-retry.ts
            npx tsx test_scripts/test-registry.ts
            npx tsx test_scripts/test-index-manager.ts
            npx tsx test_scripts/test-log.ts

        Supported source formats: .md, .txt, .pdf, .json, .csv, .png, .jpg, .jpeg, .webp
        Output: Obsidian-compatible markdown with YAML frontmatter and [[wiki-links]]

        Examples:
            npx tsx src/cli.ts init                           # Create wiki structure
            npx tsx src/cli.ts ingest article.md              # Ingest a source (copies to sources/files/)
            npx tsx src/cli.ts ingest docs/ --recursive       # Ingest a directory
            npx tsx src/cli.ts ingest --clipboard             # Ingest from clipboard (text or image)
            npx tsx src/cli.ts query "What is X?"             # Query the wiki
            npx tsx src/cli.ts query --save "Compare A and B" # Query and save result
            npx tsx src/cli.ts lint                           # Health check
            npx tsx src/cli.ts lint --fix                     # Auto-fix issues
            npx tsx src/cli.ts status                         # Wiki statistics
        Documentation:
            docs/design/project-design.md        # Full technical design
            docs/design/configuration-guide.md   # All config options explained
            docs/design/deployment-guide.md      # Installation, setup, and usage
            docs/design/project-functions.md     # Functional requirements
            docs/design/plan-001-llm-wiki-implementation.md   # Original implementation plan
            docs/design/plan-002-multi-provider-support.md    # Multi-provider plan
    </info>
</Wiki>
