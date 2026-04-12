# Plan 003: IMAP Mailbox Ingest

**Date**: 2026-04-12
**Status**: Draft
**Feature**: Email/Mailbox ingestion into the wiki knowledge base
**Related Documents**:
- `docs/reference/refined-request-mailbox-ingest.md` (specification)
- `docs/reference/investigation-mailbox-ingest.md` (library evaluation)
- `docs/reference/research-imapflow-mime-patterns.md` (MIME traversal patterns)
- `docs/reference/research-imap-auth-providers.md` (auth provider landscape)
- `docs/reference/codebase-scan-mailbox-ingest.md` (integration points)

---

## Table of Contents

1. [Overview](#1-overview)
2. [Key Technical Decisions](#2-key-technical-decisions)
3. [Phase Breakdown](#3-phase-breakdown)
4. [Dependency Graph](#4-dependency-graph)
5. [Parallelization](#5-parallelization)
6. [Files to Create or Modify](#6-files-to-create-or-modify)
7. [Risks and Mitigations](#7-risks-and-mitigations)

---

## 1. Overview

This plan adds a `wiki mail-check` command that connects to one or more IMAP mailboxes, fetches unprocessed emails (subject, body, and attachments), and feeds them through the existing ingest pipeline. The command is designed for periodic invocation (e.g., cron) rather than running as a daemon. A persistent state file tracks processed emails to ensure idempotency.

**Estimated total new code**: 700-1000 lines of production code + 300+ lines of tests.

**New npm dependencies**:
| Package | Purpose |
|---------|---------|
| `imapflow` | Modern async/await IMAP client with UID support, bodyStructure parsing, streaming download |
| `postal-mime` | Zero-dependency MIME parser (fallback for complex email structures) |
| `turndown` | HTML-to-markdown conversion for HTML-only email bodies |
| `@types/turndown` | TypeScript type definitions for turndown (dev dependency) |

---

## 2. Key Technical Decisions

These decisions are derived from the research documents and are fixed for this implementation:

| Decision | Choice | Rationale |
|----------|--------|-----------|
| IMAP library | `imapflow` | Modern async/await, built-in TypeScript types, active maintenance, same author as postal-mime |
| MIME strategy | Hybrid: imapflow bodyStructure + postal-mime fallback | Primary path uses selective part download (memory efficient); fallback parses full source for edge cases |
| HTML-to-markdown | `turndown` | Standard Node.js library, configurable, TypeScript types available |
| State persistence | JSON file with atomic writes | Matches existing `SourceRegistry` pattern (tmp + rename) |
| Authentication | Basic auth + app passwords only | OAuth2 deferred; M365/Outlook limitation documented clearly |
| Deduplication | Dual-layer: UIDs per folder + Message-IDs globally | UIDs for efficiency, Message-IDs as cross-folder/cross-mailbox safety net |
| Fetch strategy | Collect UIDs via search, then fetchOne + download per UID | Avoids imapflow deadlock (cannot call download inside fetch iterator) |

---

## 3. Phase Breakdown

### Phase 1: Configuration (Types, Validation, Env Vars)

**Objective**: Extend the configuration system to support mailbox settings. No IMAP connection logic yet.

**Files to modify**:
- `src/config/types.ts` -- Add `MailboxConfig` interface and optional `mailboxes` field to `WikiConfig`
- `src/config/validator.ts` -- Add `validateMailboxConfig()` and `checkPasswordExpiry()` functions
- `src/config/loader.ts` -- Extend `applyEnvOverrides()` for `WIKI_MAILBOX_<NAME>_*` env vars

**Detailed tasks**:

1.1. **Add `MailboxConfig` interface** to `src/config/types.ts`:
```typescript
export interface MailboxConfig {
    host: string;
    port: number;
    tls: boolean;
    user: string;
    password: string;
    folders: string[];
    passwordExpiry?: string;
    connectionTimeout: number;
}
```

1.2. **Extend `WikiConfig`** with optional `mailboxes` field:
```typescript
export interface WikiConfig {
    llm: LLMConfig;
    wiki: WikiPaths;
    obsidian: ObsidianConfig;
    mailboxes?: Record<string, MailboxConfig>;
}
```

1.3. **Add `validateMailboxConfig()`** to `src/config/validator.ts`:
- Validate each mailbox entry: `host` (non-empty string), `port` (positive integer), `tls` (boolean), `user` (non-empty string), `password` (non-empty string), `folders` (non-empty array of non-empty strings), `connectionTimeout` (positive integer)
- If `passwordExpiry` is present, validate it is a valid ISO 8601 date string
- Throw `ConfigurationError` for each missing/invalid field with descriptive message and field path (e.g., `mailboxes.work.host`)
- This function is NOT called in the global pre-action hook; it is called only when `mail-check` runs

1.4. **Add `checkPasswordExpiry()`** to `src/config/validator.ts`:
- Follow the exact pattern of `checkApiKeyExpiry()` (lines ~135+)
- For each mailbox with a `passwordExpiry` value, warn to stderr if within 7 days of expiry
- Message format: `Warning: Password for mailbox "<name>" expires on <date> (<N> days remaining)`

1.5. **Extend `applyEnvOverrides()`** in `src/config/loader.ts`:
- Handle dynamic mailbox env vars: `WIKI_MAILBOX_<NAME>_HOST`, `WIKI_MAILBOX_<NAME>_PORT`, `WIKI_MAILBOX_<NAME>_TLS`, `WIKI_MAILBOX_<NAME>_USER`, `WIKI_MAILBOX_<NAME>_PASSWORD`, `WIKI_MAILBOX_<NAME>_FOLDERS` (comma-separated), `WIKI_MAILBOX_<NAME>_TIMEOUT`
- Discovery: scan `process.env` for keys matching `WIKI_MAILBOX_*_HOST` to discover mailbox names dynamically
- Create or merge into `config.mailboxes[name.toLowerCase()]` following existing priority rules (env vars override config file)
- Type coercion: `port` and `connectionTimeout` parsed as integers, `tls` parsed as boolean (`"true"/"false"`), `folders` split on comma

1.6. **Add `validateMailboxesExist()`** guard:
- When `mail-check` is invoked but `config.mailboxes` is undefined or empty, throw `ConfigurationError('mailboxes', 'No mailbox configurations found. Add a "mailboxes" section to config.json or set WIKI_MAILBOX_* environment variables.')`

**Acceptance criteria**:
- [ ] `MailboxConfig` interface is defined in types.ts
- [ ] `WikiConfig` has optional `mailboxes` field
- [ ] `validateMailboxConfig()` throws `ConfigurationError` for each missing required field
- [ ] `validateMailboxConfig()` validates field types (port is number, tls is boolean, folders is array)
- [ ] `checkPasswordExpiry()` warns to stderr within 7 days of expiry
- [ ] Env var `WIKI_MAILBOX_WORK_HOST=imap.example.com` populates `config.mailboxes.work.host`
- [ ] Env var `WIKI_MAILBOX_WORK_FOLDERS=INBOX,Archive` produces `["INBOX", "Archive"]`
- [ ] Test script `test_scripts/test-mailbox-config.ts` validates all above

---

### Phase 2: IMAP Client Module

**Objective**: Create a self-contained IMAP client wrapper that handles connection, UID search, message fetching, body extraction, and attachment download. No knowledge of the wiki or ingest pipeline.

**Files to create**:
- `src/source/imap.ts` -- IMAP client wrapper (~200-250 lines)

**New npm dependencies** (install in this phase):
- `imapflow`
- `postal-mime`
- `turndown`
- `@types/turndown` (dev)

**Detailed tasks**:

2.1. **Install dependencies**:
```bash
npm install imapflow postal-mime turndown
npm install --save-dev @types/turndown
```

2.2. **Define exported interfaces** in `src/source/imap.ts`:

```typescript
export interface ImapConnectionConfig {
    host: string;
    port: number;
    secure: boolean;    // maps from MailboxConfig.tls
    user: string;
    password: string;
    connectionTimeout: number;
}

export interface EmailEnvelope {
    uid: number;
    messageId: string;
    subject: string;
    from: string;
    date: string;          // ISO 8601
}

export interface EmailContent {
    body: string;          // Plain text or HTML-converted-to-markdown
    bodyFormat: 'plain' | 'html-converted';
    usedFallback: boolean; // true if postal-mime fallback was used
}

export interface EmailAttachment {
    filename: string;
    mimeType: string;
    part: string;          // IMAP part number for streaming
    size: number;
    isInline: boolean;
}

export interface FetchedEmail {
    envelope: EmailEnvelope;
    content: EmailContent;
    attachments: EmailAttachment[];
}
```

2.3. **Implement `ImapClient` class**:

```typescript
export class ImapClient {
    constructor(config: ImapConnectionConfig, logger: Logger);

    /** Connect to the IMAP server */
    async connect(): Promise<void>;

    /** Disconnect cleanly */
    async disconnect(): Promise<void>;

    /** Open a folder and return UIDVALIDITY */
    async openFolder(folderName: string): Promise<{ uidValidity: number }>;

    /** Search for all UIDs in the currently open folder */
    async searchAllUIDs(): Promise<number[]>;

    /** Fetch envelope (metadata) for a single UID */
    async fetchEnvelope(uid: number): Promise<EmailEnvelope>;

    /** Fetch email body content (text/plain preferred, HTML fallback with turndown) */
    async fetchBody(uid: number): Promise<EmailContent>;

    /** Discover attachments from bodyStructure */
    async discoverAttachments(uid: number): Promise<EmailAttachment[]>;

    /** Download a single attachment to disk, streaming to file */
    async downloadAttachment(uid: number, part: string, destPath: string): Promise<void>;

    /** Release the current folder lock */
    async releaseFolder(): Promise<void>;
}
```

2.4. **Implement MIME tree traversal** (internal helpers):
- `findPlainTextPart(node)` -- recursive, skips `disposition === 'attachment'`, returns part number or null
- `findHtmlPart(node)` -- recursive, same skip logic
- `findAllAttachments(node)` -- recursive, collects explicit attachments (`disposition === 'attachment'`), implicit attachments (non-text, non-multipart without disposition), and inline CID images (`disposition === 'inline'` with `id`)
- `extractFilename(node)` -- checks `dispositionParameters.filename`, `parameters.name`, `description`, falls back to generated name

2.5. **Implement HTML-to-markdown conversion**:
- Create a `TurndownService` instance with `headingStyle: 'atx'` (Obsidian-compatible)
- Used when `text/plain` part is not found but `text/html` is

2.6. **Implement postal-mime fallback**:
- Triggered when bodyStructure traversal finds no text/plain and no text/html parts
- Also triggered when root type is `message/rfc822`
- Also triggered when `download()` throws an error
- Fetches full message source via `fetchOne(uid, { source: true }, { uid: true })`
- Parses with `PostalMime.parse(source)`

2.7. **Implement synthetic Message-ID generation**:
- When an email has no Message-ID header, generate one from SHA-256 of `from + date + subject`
- Log a warning when this occurs

2.8. **Credential safety**:
- The `ImapClient` constructor must configure imapflow with `logger: false` (or a custom logger that redacts credentials)
- In verbose mode, log connection host/port but NEVER log the password

**Acceptance criteria**:
- [ ] `ImapClient` connects to an IMAP server with TLS
- [ ] `searchAllUIDs()` returns UIDs sorted ascending (oldest first)
- [ ] `fetchEnvelope()` returns parsed subject, from, date, messageId
- [ ] `fetchBody()` returns plain text when available
- [ ] `fetchBody()` converts HTML to markdown via turndown when only HTML is available
- [ ] `fetchBody()` falls back to postal-mime when bodyStructure traversal fails
- [ ] `discoverAttachments()` returns supported and unsupported attachments
- [ ] `downloadAttachment()` streams decoded content to disk
- [ ] Passwords are never logged even in verbose mode
- [ ] Test script `test_scripts/test-imap-client.ts` tests MIME traversal helpers with mock bodyStructure data

---

### Phase 3: Mailbox State Manager

**Objective**: Create a persistent state tracker for processed emails. Manages UIDs per folder, UIDVALIDITY, and global Message-ID deduplication.

**Files to create**:
- `src/source/mailbox-state.ts` -- State manager (~150 lines)

**Detailed tasks**:

3.1. **Define state interfaces**:

```typescript
export interface FolderState {
    uidValidity: number;
    processedUIDs: number[];
    lastProcessedAt: string;  // ISO 8601
}

export interface MailboxFolderState {
    folders: Record<string, FolderState>;
}

export interface MailboxState {
    mailboxes: Record<string, MailboxFolderState>;
    processedMessageIds: string[];
}
```

3.2. **Implement `MailboxStateManager` class**:

```typescript
export class MailboxStateManager {
    constructor(statePath: string);

    /** Load state from disk (or initialize empty state if file does not exist) */
    async load(): Promise<void>;

    /** Save state to disk atomically (tmp + rename) */
    async save(): Promise<void>;

    /** Check if a UID has been processed for a given mailbox/folder */
    isUIDProcessed(mailboxName: string, folder: string, uid: number): boolean;

    /** Check if a Message-ID has been processed globally */
    isMessageIdProcessed(messageId: string): boolean;

    /** Get stored UIDVALIDITY for a folder */
    getUIDValidity(mailboxName: string, folder: string): number | null;

    /** Handle UIDVALIDITY change: clear processedUIDs for the folder, log warning */
    handleUIDValidityChange(mailboxName: string, folder: string, newValidity: number, logger: Logger): void;

    /** Update UIDVALIDITY for a folder */
    setUIDValidity(mailboxName: string, folder: string, validity: number): void;

    /** Mark an email as processed (add UID and Message-ID) */
    markProcessed(mailboxName: string, folder: string, uid: number, messageId: string): void;

    /** Reset state for a specific mailbox or all mailboxes */
    resetState(mailboxName?: string): void;

    /** Get the full state for reading */
    getState(): MailboxState;
}
```

3.3. **Atomic write pattern** (following `SourceRegistry`):
```typescript
async save(): Promise<void> {
    const tmpPath = this.statePath + '.tmp';
    await fs.writeFile(tmpPath, JSON.stringify(this.state, null, 2));
    await fs.rename(tmpPath, this.statePath);
}
```

3.4. **UIDVALIDITY handling logic**:
- On each folder open, compare server's UIDVALIDITY with stored value
- If unchanged: use `processedUIDs` for fast deduplication
- If changed: clear `processedUIDs` for that folder, log a warning, rely on `processedMessageIds` for dedup
- Store the new UIDVALIDITY value

3.5. **Message-ID deduplication**:
- `processedMessageIds` is stored as an array but used as a `Set<string>` in memory for O(1) lookups
- Cross-mailbox deduplication: the same Message-ID across different mailboxes is detected

**Acceptance criteria**:
- [ ] State file is created on first run with empty structure
- [ ] `isUIDProcessed()` returns correct results after `markProcessed()`
- [ ] `isMessageIdProcessed()` returns correct results after `markProcessed()`
- [ ] UIDVALIDITY change clears processedUIDs but NOT processedMessageIds
- [ ] `resetState('work')` clears only the "work" mailbox state
- [ ] `resetState()` (no args) clears all state
- [ ] Atomic write: interrupted writes do not corrupt the state file
- [ ] Test script `test_scripts/test-mailbox-state.ts` validates all above

---

### Phase 4: Email Processor

**Objective**: Bridge between the IMAP client and the ingest pipeline. Converts fetched emails into source files and invokes the pipeline.

**Files to create**:
- `src/source/email-processor.ts` -- Email processing logic (~200 lines)

**Detailed tasks**:

4.1. **Define interfaces**:

```typescript
export interface EmailProcessingResult {
    emailMessageId: string;
    subject: string;
    bodySourcePath: string;
    attachmentSourcePaths: string[];
    ingestResults: IngestResult[];  // from pipeline
    skippedAttachments: Array<{ filename: string; mimeType: string; reason: string }>;
}

export interface EmailProcessorOptions {
    dryRun: boolean;
    verbose: boolean;
    sourcesDir: string;      // path to sources/files/
    supportedExtensions: Set<string>;
}
```

4.2. **Implement `EmailProcessor` class**:

```typescript
export class EmailProcessor {
    constructor(
        pipeline: IngestPipeline,
        options: EmailProcessorOptions,
        logger: Logger
    );

    /**
     * Process a single email: save body + attachments as files, ingest each.
     * Returns the processing result. Does NOT update mailbox state (caller does that).
     */
    async processEmail(
        client: ImapClient,
        envelope: EmailEnvelope,
        mailboxName: string
    ): Promise<EmailProcessingResult>;
}
```

4.3. **Email body composition** (FR-64):
- Compose the email body into a markdown file:
  ```markdown
  # <Subject>

  **From**: <sender>
  **Date**: <date>

  <body content>
  ```
- Save to `sources/files/email-<YYYY-MM-DD-HHmmss>-<sanitized-subject>.md`
- Handle filename deduplication (append `-1`, `-2`, etc. if file exists)

4.4. **Attachment saving** (FR-65):
- For each attachment from `client.discoverAttachments()`:
  - Check if the file extension is in `supportedExtensions`
  - If unsupported: add to `skippedAttachments`, log warning, continue
  - If supported: call `client.downloadAttachment(uid, part, destPath)`
  - Save to `sources/files/email-att-<YYYY-MM-DD-HHmmss>-<original-filename>`
  - Handle filename deduplication

4.5. **Pipeline invocation** (FR-73):
- Call `pipeline.ingest(bodyPath, { metadata: emailMetadata })` for the body
- Call `pipeline.ingest(attPath, { metadata: attachmentMetadata })` for each attachment
- Email metadata keys: `source`, `emailMessageId`, `emailFrom`, `emailDate`, `emailSubject`, `mailboxName`
- Attachment metadata adds: `parentEmailMessageId`

4.6. **Dry-run support**:
- In dry-run mode, log what would be saved/ingested but do not create files or call the pipeline

4.7. **Error handling**:
- If body ingest fails, throw (caller will skip state update for this email)
- If attachment download/ingest fails, throw (entire email is not marked processed)
- Caller catches and continues to next email

**Acceptance criteria**:
- [ ] Email body is saved as a markdown file with correct format
- [ ] Filename pattern matches `email-<YYYY-MM-DD-HHmmss>-<sanitized-subject>.md`
- [ ] Attachments are saved with pattern `email-att-<YYYY-MM-DD-HHmmss>-<original-filename>`
- [ ] Unsupported attachment types are logged and skipped
- [ ] Pipeline is called with correct metadata keys
- [ ] Dry-run mode does not create files
- [ ] Failure in any step throws to caller

---

### Phase 5: CLI Command

**Objective**: Register the `mail-check` command with Commander and implement the orchestration loop.

**Files to create**:
- `src/commands/mail-check.ts` -- Command module (~250 lines)

**Files to modify**:
- `src/cli.ts` -- Import and register `registerMailCheckCommand`

**Detailed tasks**:

5.1. **Register command** using self-registering pattern (like `ingest.ts`):

```typescript
export function registerMailCheckCommand(program: Command): void {
    program
        .command('mail-check')
        .description('Check configured mailboxes for new emails and ingest them into the wiki')
        .option('--mailbox <name>', 'Process only the named mailbox')
        .option('--limit <n>', 'Maximum emails to process per run', parseInt)
        .option('--reset-state', 'Clear processed-email state (prompts for confirmation)')
        .action(async (options) => { ... });
}
```

5.2. **Import in `src/cli.ts`**:
- Add `import { registerMailCheckCommand } from './commands/mail-check.js';`
- Call `registerMailCheckCommand(program);` alongside existing command registrations

5.3. **Implement orchestration loop** (main action handler):

```
1. Load config, validate mailbox section (validateMailboxConfig + validateMailboxesExist)
2. Check password expiry for all configured mailboxes
3. Handle --reset-state (prompt confirmation, clear state, exit)
4. Determine which mailboxes to process (--mailbox filters to one)
5. Load mailbox state from sources/mailbox-state.json
6. Create IngestPipeline and LLM provider
7. For each mailbox:
   a. Create ImapClient with mailbox config
   b. Connect to IMAP server (try/catch per mailbox)
   c. For each configured folder:
      i.   Open folder, get UIDVALIDITY
      ii.  Handle UIDVALIDITY change if needed
      iii. Search all UIDs, sort ascending (oldest first)
      iv.  Filter out processed UIDs
      v.   Apply --limit cap
      vi.  For each unprocessed UID:
           - Fetch envelope
           - Check Message-ID against processedMessageIds
           - If already processed (cross-folder/cross-mailbox dupe): skip, log
           - Call EmailProcessor.processEmail()
           - On success: markProcessed() + save state (atomic)
           - On failure: log error, continue to next email
      vii. Release folder lock
   d. Disconnect from IMAP server
8. Print summary (FR-70): new found, ingested, failed, attachments, pages created/updated
9. Exit with code 0 if all succeeded, 1 if any failures
```

5.4. **Confirmation prompt for --reset-state**:
- Use `readline` (Node.js built-in) to prompt: `Reset mailbox state for <name|all>? This will cause all emails to be reprocessed. [y/N]`
- Require explicit "y" or "yes" to proceed

5.5. **Batch summary output** (FR-70):
```
Mail check complete:
  Mailboxes processed: 2
  New emails found: 15
  Successfully ingested: 13
  Failed: 2
    - "Meeting notes" (work/INBOX UID 1045): LLM rate limit
    - "Project update" (work/INBOX UID 1046): Attachment download timeout
  Attachments processed: 8
  Wiki pages created: 21
  Wiki pages updated: 4
```

**Acceptance criteria**:
- [ ] `wiki mail-check` processes all configured mailboxes
- [ ] `wiki mail-check --mailbox work` processes only "work"
- [ ] `wiki mail-check --limit 5` processes at most 5 emails total
- [ ] `wiki mail-check --dry-run` shows what would be processed without changes
- [ ] `wiki mail-check --reset-state` prompts for confirmation before clearing state
- [ ] Failed email does not block subsequent emails
- [ ] Failed mailbox does not block other mailboxes
- [ ] Summary output shows correct counts
- [ ] Non-zero exit code when any email or mailbox fails
- [ ] Password expiry warnings appear on stderr

---

### Phase 6: Integration Testing and Documentation

**Objective**: End-to-end validation and documentation updates.

**Files to create**:
- `test_scripts/test-mailbox-config.ts` -- Config validation tests
- `test_scripts/test-imap-client.ts` -- MIME traversal unit tests (mock bodyStructure data)
- `test_scripts/test-mailbox-state.ts` -- State manager tests
- `test_scripts/test-email-processor.ts` -- Email processor tests (mock pipeline + mock IMAP client)

**Files to modify**:
- `CLAUDE.md` -- Update Wiki tool documentation with `mail-check` command
- `docs/design/project-functions.md` -- Add FR-59 through FR-75
- `docs/design/project-design.md` -- Add Section 3.12 (Source Module: IMAP/Email) and update source file structure
- `docs/design/configuration-guide.md` -- Add mailbox configuration section
- `Issues - Pending Items.md` -- Check for items to add/remove

**Detailed tasks**:

6.1. **Test scripts**:

| Test Script | What It Tests |
|-------------|---------------|
| `test-mailbox-config.ts` | Config types, validation errors for missing fields, env var parsing, password expiry |
| `test-imap-client.ts` | `findPlainTextPart()`, `findHtmlPart()`, `findAllAttachments()`, `extractFilename()` with real bodyStructure JSON objects. Does NOT connect to a real IMAP server. |
| `test-mailbox-state.ts` | Load/save, UID tracking, Message-ID dedup, UIDVALIDITY change handling, reset |
| `test-email-processor.ts` | Body composition, filename generation, metadata propagation. Uses mocked pipeline and IMAP client. |

6.2. **CLAUDE.md Wiki tool update**:
- Add `mail-check` to the command list
- Add all options: `--mailbox`, `--limit`, `--reset-state`
- Add examples
- Add cron scheduling example
- Update supported source formats to mention email

6.3. **Configuration guide update**:
- Add full `mailboxes` section documentation
- Document env var pattern `WIKI_MAILBOX_<NAME>_*`
- Document password security recommendations (prefer env vars)
- Document M365/Outlook limitation clearly
- Document app password setup for Gmail, iCloud, Yahoo
- Document `passwordExpiry` field and its behavior

6.4. **Project design update**:
- Add `src/source/imap.ts`, `src/source/mailbox-state.ts`, `src/source/email-processor.ts` to source file structure
- Add `src/commands/mail-check.ts` to command modules
- Describe the mail-check data flow
- Add `imapflow`, `postal-mime`, `turndown` to dependencies table

**Acceptance criteria**:
- [ ] All 4 test scripts pass
- [ ] CLAUDE.md reflects the new `mail-check` command with full documentation
- [ ] Configuration guide documents all mailbox settings
- [ ] Configuration guide includes M365 limitation notice
- [ ] Project design is updated with new modules
- [ ] project-functions.md includes FR-59 through FR-75

---

## 4. Dependency Graph

```
Phase 1: Configuration
    |
    |--- Phase 2: IMAP Client Module
    |       |
    |       |--- Phase 4: Email Processor
    |       |       |
    |       |       |--- Phase 5: CLI Command
    |       |               |
    |--- Phase 3: Mailbox State Manager  |
            |                            |
            |--- Phase 5: CLI Command ---+
                    |
                    Phase 6: Integration Testing & Documentation
```

**Critical path**: Phase 1 -> Phase 2 -> Phase 4 -> Phase 5 -> Phase 6

**Dependencies**:
| Phase | Depends On | Reason |
|-------|-----------|--------|
| Phase 2 | Phase 1 | Uses `MailboxConfig` types and `ImapConnectionConfig` maps from it |
| Phase 3 | Phase 1 | State file path derived from `WikiConfig.wiki.rootDir` |
| Phase 4 | Phase 2 | Calls `ImapClient` methods for fetching and downloading |
| Phase 4 | (IngestPipeline) | Uses existing pipeline; no modification needed |
| Phase 5 | Phase 2, 3, 4 | Orchestrates all three modules |
| Phase 6 | Phase 5 | Tests and docs for the complete feature |

---

## 5. Parallelization

| Can Run In Parallel | Why |
|---------------------|-----|
| Phase 2 and Phase 3 | Both depend only on Phase 1 types; no shared code between them |
| Test writing for Phases 2/3 | Test scripts for IMAP client and state manager are independent |

| Must Be Sequential | Why |
|---------------------|-----|
| Phase 1 before Phase 2/3 | Types and validation must exist before client/state modules use them |
| Phase 2 before Phase 4 | Email processor calls IMAP client methods |
| Phase 4 before Phase 5 | CLI command orchestrates the email processor |
| Phase 5 before Phase 6 | Integration tests require the full command to exist |

**Recommended execution order**:
1. Phase 1 (configuration)
2. Phase 2 + Phase 3 in parallel
3. Phase 4 (email processor)
4. Phase 5 (CLI command)
5. Phase 6 (testing + docs)

---

## 6. Files to Create or Modify

### New Files

| File | Phase | Purpose | Estimated Lines |
|------|-------|---------|-----------------|
| `src/source/imap.ts` | 2 | IMAP client wrapper (connect, fetch, download, MIME traversal) | 200-250 |
| `src/source/mailbox-state.ts` | 3 | Mailbox state persistence (UIDs, Message-IDs, UIDVALIDITY) | 150 |
| `src/source/email-processor.ts` | 4 | Email-to-source-file conversion and pipeline invocation | 200 |
| `src/commands/mail-check.ts` | 5 | CLI command orchestration | 250 |
| `test_scripts/test-mailbox-config.ts` | 6 | Config validation tests | 80 |
| `test_scripts/test-imap-client.ts` | 6 | MIME traversal unit tests | 120 |
| `test_scripts/test-mailbox-state.ts` | 6 | State manager tests | 80 |
| `test_scripts/test-email-processor.ts` | 6 | Email processor tests | 100 |

### Modified Files

| File | Phase | Change | Estimated Lines Added |
|------|-------|--------|----------------------|
| `src/config/types.ts` | 1 | Add `MailboxConfig` interface, extend `WikiConfig` | 20 |
| `src/config/validator.ts` | 1 | Add `validateMailboxConfig()`, `checkPasswordExpiry()`, `validateMailboxesExist()` | 70 |
| `src/config/loader.ts` | 1 | Extend `applyEnvOverrides()` for `WIKI_MAILBOX_*` env vars | 50 |
| `src/cli.ts` | 5 | Import + register `registerMailCheckCommand` | 3 |
| `CLAUDE.md` | 6 | Add `mail-check` command documentation | 30 |
| `docs/design/project-functions.md` | 6 | Add FR-59 through FR-75 | 100 |
| `docs/design/project-design.md` | 6 | Add email/IMAP modules to architecture | 60 |
| `docs/design/configuration-guide.md` | 6 | Add mailbox configuration section | 80 |

### Dependencies (package.json)

| Package | Type | Phase |
|---------|------|-------|
| `imapflow` | production | 2 |
| `postal-mime` | production | 2 |
| `turndown` | production | 2 |
| `@types/turndown` | devDependency | 2 |

---

## 7. Risks and Mitigations

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|------------|--------|------------|
| R1 | Microsoft 365 / Outlook basic auth is permanently blocked | Certain | Users with M365/Outlook cannot use the feature | Document limitation clearly in config guide. OAuth2 is a planned future enhancement (plan-004). The imapflow library already supports `auth.accessToken` for XOAUTH2. |
| R2 | Google Workspace accounts require OAuth2 (since May 2025) | Certain | Users with business Gmail cannot use the feature | Document limitation. Only personal `@gmail.com` accounts with app passwords are supported initially. |
| R3 | IMAP server quirks (non-standard bodyStructure) | Medium | Body extraction fails for specific providers | postal-mime fallback path catches these cases. Log a warning and switch to full-source parsing. |
| R4 | Large mailbox initial ingestion (thousands of unprocessed emails) | Medium | Timeout, rate limits on LLM API, long-running command | `--limit` option caps emails per run. Streaming downloads prevent memory issues. Users can ramp up gradually. |
| R5 | UIDVALIDITY change causes unnecessary reprocessing | Low | Extra LLM calls for already-ingested emails | Message-ID dedup prevents duplicate wiki pages. Content hash in the ingest pipeline catches remaining duplicates. |
| R6 | imapflow deadlock from calling download() inside fetch() iterator | Medium | Hangs during email processing | Mitigated by design: collect UIDs via `search()` first, then process with `fetchOne()` + `download()` individually. |
| R7 | Concurrent mail-check runs processing same emails | Low | Duplicate source files (not duplicate wiki pages due to content hash) | Documented as known behavior. State file atomic writes minimize the window. Content-hash dedup in pipeline prevents duplicate wiki pages. |
| R8 | Email with extremely large attachment (>25MB) | Low | Long download, memory pressure | imapflow `download()` streams to disk. Consider adding `maxBytes` option to `download()` as a safety cap. |
| R9 | Turndown produces poor markdown from messy HTML emails | Medium | Low-quality wiki pages from HTML-only emails | Acceptable for initial implementation. Custom turndown rules can be added later. Plain text is always preferred when available. |
| R10 | `postal-mime` loads entire message into memory for fallback path | Low | Memory pressure for very large emails | Fallback is only used for edge cases (no text parts found). Most emails are well under 25MB. |

---

## Appendix A: Supported Email Providers (Initial Release)

| Provider | Supported | Auth Method | Notes |
|----------|-----------|-------------|-------|
| Gmail (personal @gmail.com) | Yes | App password | Requires 2-Step Verification enabled |
| iCloud Mail | Yes | App-specific password | Requires Apple 2FA |
| Yahoo Mail | Yes | App password | Plain passwords blocked since May 2024 |
| FastMail | Yes | App password | Requires paid plan (not Basic) |
| Zoho Mail | Yes | App password | Standard or app passwords |
| Self-hosted (Dovecot, etc.) | Yes | Basic auth | Server config determines options |
| Microsoft 365 (work/school) | No | OAuth2 required | Planned for future release |
| Outlook.com / Hotmail | No | OAuth2 required | Planned for future release |
| Google Workspace (business) | No | OAuth2 required | Planned for future release |
| ProtonMail | No | Requires Bridge app | Niche; not planned |

## Appendix B: Out of Scope

Per the specification, the following are explicitly excluded:
1. Sending emails
2. SMTP/POP3 support
3. OAuth2/XOAUTH2 authentication (future plan-004)
4. Email deletion or flagging on the server
5. IMAP IDLE (real-time push)
6. Email threading/conversation reconstruction
7. Calendar invites / VCALENDAR parsing
8. S/MIME or PGP decryption
9. Mailbox folder creation or management
10. GUI or web interface for configuration
11. Rate limiting or throttling against the IMAP server
