# Style and Conventions

## Code Style
- TypeScript for all code
- No fallback/default values for configuration settings - always raise exceptions
- FastAPI for Python REST APIs (not applicable here - TypeScript project)

## Naming
- Database tables: singular names (e.g., "Customer" not "Customers")
- Plan files: plan-NNN-<description>.md
- Test scripts: in test_scripts/ folder
- Prompts: sequential numbering in prompts/ folder

## Documentation
- Tools documented in CLAUDE.md with XML format (<toolName>, <objective>, <command>, <info>)
- Project design in docs/design/project-design.md
- Functional requirements in docs/design/project-functions.md
- Issues tracked in "Issues - Pending Items.md" at project root

## Configuration
- Never use fallback values - raise exceptions for missing config
- Configuration guide goes in docs/design/configuration-guide.md
