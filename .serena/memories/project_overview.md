# Wiki Project Overview

## Purpose
LLM Wiki - A TypeScript-based tool for building personal knowledge bases using LLMs. The LLM incrementally builds and maintains a persistent wiki of interlinked markdown files from raw source documents. Three layers: raw sources (immutable), wiki (LLM-generated markdown), and schema (configuration).

## Status
Greenfield project - no source code yet. Implementation starting April 2026.

## Tech Stack
- Language: TypeScript (per project conventions)
- Runtime: Node.js
- Package Manager: npm
- Platform: macOS (Darwin)

## Project Structure
```
wiki/
├── CLAUDE.md              # Project instructions
├── docs/
│   ├── design/            # Plans, project design, configuration guide
│   └── reference/         # Reference material, codebase scans
├── test_scripts/          # All test scripts
├── src/                   # Source code (to be created)
└── Issues - Pending Items.md  # Issue tracking
```

## Key Conventions (from CLAUDE.md)
- All code in TypeScript
- No fallback values for configuration - raise exceptions
- Database tables use singular names
- Plans: docs/design/plan-NNN-<description>.md
- Tools documented in CLAUDE.md with XML format
- Tests in test_scripts/ folder
- Prompts in prompts/ folder with sequential numbering
