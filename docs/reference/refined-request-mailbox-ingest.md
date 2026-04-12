# Refined Request: Mailbox Ingest for LLM Wiki

**Date**: 2026-04-12
**Status**: Draft
**Feature**: Email/Mailbox ingestion into the wiki knowledge base

---

## 1. Objective

Add to the LLM Wiki CLI tool the ability to connect to one or more IMAP mailboxes, fetch unprocessed emails (subject, body, and attachments), and feed them through the existing ingest pipeline to become part of the wiki knowledge base. The command is designed to be invoked periodically (e.g., via cron) rather than running as a long-lived daemon. A persistent state file tracks which emails have been processed to avoid duplicate ingestion.

---

## 2. Functional Requirements

### Email Fetching

**FR-59: IMAP Mailbox Connection**
The CLI must connect to an IMAP server using the configured host, port, credentials, and TLS settings. The protocol is IMAP (not POP3) because IMAP leaves messages on the server and supports UID-based tracking, which is essential for idempotent processing.

**FR-60: Folder Selection**
The command must read from one or more IMAP folders as specified in configuration. The configuration must specify a list of folder names (e.g., `["INBOX"]`, `["INBOX", "Wiki-Feed"]`). All configured folders are scanned on each run.

**FR-61: Email Discovery via UID**
The command must use IMAP UIDs (not sequence numbers) combined with UIDVALIDITY to identify messages. UIDVALIDITY changes indicate the folder has been rebuilt, requiring a full rescan. The system must fetch all UIDs in the configured folder(s) and compare against the processed-message state file to identify new (unprocessed) emails.

**FR-62: Email Body Extraction**
For each unprocessed email, the system must extract:
- **Subject**: used as the source title/name
- **Body**: prefer `text/plain` part; if only `text/html` is available, convert HTML to markdown. If both exist, use `text/plain`.
- **Date**: the email's `Date` header, stored as metadata
- **From**: the sender address, stored as metadata
- **Message-ID**: the RFC 2822 `Message-ID` header, stored in the state file as a secondary deduplication key

**FR-63: Attachment Extraction**
The system must extract all attachments from each email. Supported attachment formats are those already supported by the ingest pipeline: `.md`, `.txt`, `.pdf`, `.json`, `.csv`, `.png`, `.jpg`, `.jpeg`, `.webp`, `.docx`, `.xlsx`, `.xls`. Unsupported attachment formats must be logged as warnings and skipped.

**FR-64: Email Body as Source Document**
The email subject and body must be composed into a single markdown source document with the following structure:
```markdown
# <Subject>

**From**: <sender>
**Date**: <date>

<body content>
```
This document is saved to `sources/files/` with the naming pattern `email-<YYYY-MM-DD-HHmmss>-<sanitized-subject>.md` and ingested through the standard pipeline.

**FR-65: Attachment as Source Document**
Each extracted attachment must be saved to `sources/files/` with the naming pattern `email-att-<YYYY-MM-DD-HHmmss>-<original-filename>` (with deduplication suffix if needed) and ingested through the standard pipeline independently. Attachments are linked to their parent email via metadata (`parentEmailMessageId`).

**FR-66: Email Metadata Propagation**
All source entries created from a single email (body + attachments) must carry the following metadata in the source registry:
- `source`: `"email"`
- `emailMessageId`: the RFC 2822 `Message-ID` header value
- `emailFrom`: sender address
- `emailDate`: ISO 8601 date from the email's `Date` header
- `emailSubject`: the email subject line
- `mailboxName`: the configured mailbox name (see FR-71)

**FR-67: Processed Email State Tracking**
The system must maintain a persistent JSON state file at `<rootDir>/sources/mailbox-state.json` that records which emails have been successfully processed. The structure:
```json
{
  "mailboxes": {
    "<mailbox-name>": {
      "folders": {
        "INBOX": {
          "uidValidity": 12345,
          "processedUIDs": [1001, 1002, 1003],
          "lastProcessedAt": "2026-04-12T10:30:00Z"
        }
      }
    }
  },
  "processedMessageIds": ["<msg-id-1@example.com>", "<msg-id-2@example.com>"]
}
```
- `processedUIDs` per folder tracks UIDs that have been ingested.
- `processedMessageIds` is a global set of Message-ID headers for cross-folder/cross-mailbox deduplication.
- If `uidValidity` changes between runs, the system must clear `processedUIDs` for that folder and fall back to `processedMessageIds` for deduplication.

**FR-68: Atomic State Updates**
The state file must be updated only after each email (body + all its attachments) has been fully and successfully ingested. If ingestion of an email fails partway, the email's UID must NOT be recorded as processed, ensuring retry on the next run.

**FR-69: Processing Order**
Emails must be processed in chronological order (oldest first by UID within each folder).

**FR-70: Batch Logging**
The command must log a summary at the end of each run:
- Number of new emails found
- Number successfully ingested
- Number of failures (with email subjects)
- Number of attachments processed
- Total wiki pages created/updated

### Multi-Mailbox Support

**FR-71: Named Mailbox Configurations**
The configuration supports multiple named mailbox configurations under a `mailboxes` key. Each mailbox has a unique name used as an identifier in state tracking and metadata. Example:
```json
{
  "mailboxes": {
    "work": {
      "host": "imap.company.com",
      "port": 993,
      "tls": true,
      "user": "user@company.com",
      "password": "secret",
      "folders": ["INBOX"],
      "passwordExpiry": "2026-12-31"
    },
    "research": {
      "host": "imap.gmail.com",
      "port": 993,
      "tls": true,
      "user": "researcher@gmail.com",
      "password": "app-password",
      "folders": ["INBOX", "Wiki-Feed"],
      "passwordExpiry": "2027-01-15"
    }
  }
}
```

**FR-72: Password Expiry Warning**
If a mailbox configuration includes `passwordExpiry` (ISO 8601 date string), the CLI must warn to stderr when the password is within 7 days of expiring, consistent with the existing `apiKeyExpiry` behavior (FR-39).

### Integration with Existing Systems

**FR-73: Standard Ingest Pipeline**
Email bodies and attachments must be ingested via the existing `IngestPipeline.ingest()` method, reusing all existing functionality: source registration, summary generation, entity/topic extraction, cross-referencing, index updates, and log entries. No modifications to the core ingest pipeline are required.

**FR-74: Sources Catalog Entry**
Email sources should appear in the sources catalog (`sources-catalog.md`) if the wiki maintains one, with the email's Message-ID as the reference identifier.

**FR-75: Log Entries**
Each email ingestion must append `INGEST` log entries to `wiki/log.md` via the standard `LogWriter`, consistent with other ingest operations.

---

## 3. Non-Functional Requirements

**NFR-01: No Daemon Mode**
The `mail-check` command runs once (connect, fetch, process, disconnect) and exits. It is designed to be scheduled externally (e.g., cron, launchd, Task Scheduler). The command must not loop or sleep internally.

**NFR-02: Connection Timeout**
IMAP connections must have a configurable timeout. If the server does not respond within the timeout period, the command must fail with a clear error message and a non-zero exit code.

**NFR-03: Memory Efficiency**
Attachments must be streamed/saved to disk before processing rather than held entirely in memory. Large emails with multiple large attachments must not cause out-of-memory conditions.

**NFR-04: Credential Security**
IMAP passwords should preferably be provided via environment variables rather than stored in the config file. The configuration guide must document both options and recommend environment variables. Passwords must never be logged, even in verbose mode.

**NFR-05: Idempotency**
Running the command multiple times in succession (even concurrently) must not produce duplicate wiki pages. The state file and Message-ID deduplication ensure this.

**NFR-06: Graceful Failure**
If processing one email fails, the command must continue processing remaining emails. The failed email is not marked as processed and will be retried on the next run. A non-zero exit code is returned if any email fails.

---

## 4. Configuration Requirements

All configuration fields are required unless explicitly marked optional. Missing required fields must raise a `ConfigurationError` with the field name. No default or fallback values are permitted.

### New Config Section: `mailboxes`

| Field | Config Path | Env Var | Required | Purpose |
|-------|-------------|---------|----------|---------|
| Mailbox host | `mailboxes.<name>.host` | `WIKI_MAILBOX_<NAME>_HOST` | Yes | IMAP server hostname |
| Mailbox port | `mailboxes.<name>.port` | `WIKI_MAILBOX_<NAME>_PORT` | Yes | IMAP server port (typically 993 for TLS) |
| TLS enabled | `mailboxes.<name>.tls` | `WIKI_MAILBOX_<NAME>_TLS` | Yes | Whether to use TLS/SSL connection |
| Username | `mailboxes.<name>.user` | `WIKI_MAILBOX_<NAME>_USER` | Yes | IMAP authentication username |
| Password | `mailboxes.<name>.password` | `WIKI_MAILBOX_<NAME>_PASSWORD` | Yes | IMAP authentication password |
| Folders | `mailboxes.<name>.folders` | `WIKI_MAILBOX_<NAME>_FOLDERS` | Yes | Comma-separated list of IMAP folder names to scan |
| Password expiry | `mailboxes.<name>.passwordExpiry` | N/A | No (optional) | ISO 8601 date; warns within 7 days of expiry |
| Connection timeout | `mailboxes.<name>.connectionTimeout` | `WIKI_MAILBOX_<NAME>_TIMEOUT` | Yes | Connection timeout in milliseconds |

**Environment variable naming**: For mailbox names, convert to uppercase (e.g., mailbox named `work` uses `WIKI_MAILBOX_WORK_HOST`).

**Configuration priority**: Same as existing (CLI args > env vars > config file), per FR-37.

**Validation rules**:
- `host` must be a non-empty string
- `port` must be a positive integer
- `tls` must be a boolean
- `user` must be a non-empty string
- `password` must be a non-empty string
- `folders` must be a non-empty array of non-empty strings
- `connectionTimeout` must be a positive integer
- `passwordExpiry` if present must be a valid ISO 8601 date string

---

## 5. Integration Points

| Integration Point | How It Connects |
|---|---|
| **IngestPipeline** | Email body and each attachment are passed to `IngestPipeline.ingest()` as file paths (saved to `sources/files/`). The pipeline handles registration, summarization, entity extraction, cross-referencing, index updates, and logging. |
| **SourceRegistry** | Email sources are registered via the existing registry with metadata fields identifying them as email-sourced. |
| **Config Loader** | The `loadConfig()` function must be extended to parse the new `mailboxes` section and validate it. The `WikiConfig` type must be extended with an optional `mailboxes` field. |
| **Config Validator** | Validation must enforce all required mailbox fields when the `mailboxes` section is present. Validation is only triggered when the `mail-check` command is invoked. |
| **LogWriter** | Standard `INGEST` log entries are written for each email processed. |
| **IndexManager** | Standard index updates occur as part of the ingest pipeline. |
| **CLI (Commander)** | A new `mail-check` command is registered on the main program. |

---

## 6. CLI Interface

### Command: `wiki mail-check`

```
wiki mail-check [options]
```

**Description**: Check configured mailboxes for new emails and ingest them into the wiki.

**Options**:

| Option | Description |
|--------|-------------|
| `--mailbox <name>` | Process only the named mailbox (if omitted, process all configured mailboxes) |
| `--dry-run` | Show what would be processed without making changes (inherited global option) |
| `--verbose` | Show detailed output including IMAP commands and LLM calls (inherited global option) |
| `--limit <n>` | Maximum number of emails to process per run (useful for initial large-mailbox ingestion) |
| `--reset-state` | Clear the processed-email state for the specified mailbox (or all if no `--mailbox`), forcing reprocessing. Prompts for confirmation. |

**Examples**:

```bash
# Check all configured mailboxes
npx tsx src/cli.ts mail-check

# Check only the "work" mailbox
npx tsx src/cli.ts mail-check --mailbox work

# Dry run to see what would be ingested
npx tsx src/cli.ts mail-check --dry-run

# Limit to 10 emails per run (useful for initial backlog)
npx tsx src/cli.ts mail-check --limit 10

# Reset state and reprocess all emails in "research" mailbox
npx tsx src/cli.ts mail-check --mailbox research --reset-state

# Verbose output for debugging connection issues
npx tsx src/cli.ts mail-check --verbose
```

**Cron scheduling example** (check every 15 minutes):
```bash
*/15 * * * * cd /path/to/wiki && npx tsx src/cli.ts mail-check >> /var/log/wiki-mail.log 2>&1
```

---

## 7. Data Model

### Mailbox State File: `sources/mailbox-state.json`

```typescript
interface MailboxState {
  mailboxes: Record<string, MailboxFolderState>;
  /** Global set of processed Message-ID headers for cross-mailbox deduplication */
  processedMessageIds: string[];
}

interface MailboxFolderState {
  folders: Record<string, FolderState>;
}

interface FolderState {
  /** IMAP UIDVALIDITY value; if it changes, processedUIDs must be cleared */
  uidValidity: number;
  /** List of IMAP UIDs that have been successfully processed */
  processedUIDs: number[];
  /** ISO 8601 timestamp of last successful processing in this folder */
  lastProcessedAt: string;
}
```

### Extended WikiConfig Type

```typescript
interface MailboxConfig {
  host: string;
  port: number;
  tls: boolean;
  user: string;
  password: string;
  folders: string[];
  passwordExpiry?: string;
  connectionTimeout: number;
}

interface WikiConfig {
  llm: LLMConfig;
  wiki: WikiPaths;
  obsidian: ObsidianConfig;
  mailboxes?: Record<string, MailboxConfig>;  // optional; required only for mail-check
}
```

### Source Registry Metadata (per email)

Existing `SourceEntry.metadata` record gains the following keys for email sources:
- `source`: `"email"`
- `emailMessageId`: RFC 2822 Message-ID
- `emailFrom`: sender address
- `emailDate`: ISO 8601 date
- `emailSubject`: email subject line
- `mailboxName`: name of the mailbox configuration

---

## 8. Edge Cases

| Edge Case | Handling |
|-----------|----------|
| **Duplicate email across mailboxes** | The global `processedMessageIds` set in the state file catches emails forwarded to or appearing in multiple mailboxes. The Message-ID header is the deduplication key. |
| **UIDVALIDITY change** | When UIDVALIDITY for a folder differs from the stored value, clear `processedUIDs` for that folder and rely on `processedMessageIds` for deduplication. Log a warning. |
| **Large attachments** | Attachments are saved to disk immediately. The existing ingest pipeline handles large files. No in-memory size limit beyond what Node.js supports for file I/O. |
| **Unsupported attachment type** | Log a warning with the filename and MIME type, skip the attachment, continue processing the rest of the email. |
| **Empty email body** | If the email has no text body (only attachments), create a minimal source document with just the subject and metadata headers. |
| **HTML-only email body** | Convert HTML to markdown using a lightweight converter (e.g., `turndown` or `node-html-to-text`). |
| **Inline images in HTML emails** | Inline images (CID references) are treated as attachments if they have supported image formats. |
| **Connection failure** | Log an error for the failed mailbox and continue to the next configured mailbox. Return non-zero exit code. |
| **Authentication failure** | Log a clear error message (without exposing the password) and continue to the next mailbox. |
| **Partial email failure** | If the body ingests successfully but an attachment fails, do NOT mark the email as processed. Retry entire email on next run. Already-ingested sources from this email will be detected as duplicates via content hash. |
| **Concurrent runs** | The state file is read at startup and written atomically (tmp + rename) after each email. Two concurrent runs may process the same email twice, but content-hash deduplication in the source registry prevents duplicate wiki pages. |
| **Mailbox with thousands of unread emails** | The `--limit` option caps emails per run. Without it, all unprocessed emails are ingested in one run. |
| **Email with no Message-ID header** | Generate a synthetic ID from the SHA-256 hash of `from + date + subject`. Log a warning. |
| **Encoded subjects (RFC 2047)** | The IMAP library must handle MIME-encoded subject decoding (e.g., `=?UTF-8?B?...?=`). Most Node.js IMAP libraries handle this automatically. |
| **Multipart emails** | Navigate the MIME tree to find `text/plain` or `text/html` body parts and extract all attachment parts recursively. |
| **Config has `mailboxes` section but `mail-check` is not invoked** | The `mailboxes` section is ignored; no validation occurs. Validation only happens when `mail-check` runs. |
| **`mail-check` invoked but no `mailboxes` in config** | Raise a `ConfigurationError` with field `mailboxes`: "No mailbox configurations found. Add a 'mailboxes' section to config.json." |

---

## 9. Acceptance Criteria

1. **AC-01**: Running `wiki mail-check` with a valid IMAP configuration connects to the mailbox, discovers new emails, and ingests them (body + attachments) into the wiki.
2. **AC-02**: Running `wiki mail-check` a second time immediately after a successful run processes zero new emails (idempotency).
3. **AC-03**: An email with 3 attachments (1 PDF, 1 DOCX, 1 PNG) produces 4 source entries in the registry: 1 for the email body, 3 for the attachments.
4. **AC-04**: The `mailbox-state.json` file is created on first run and correctly tracks processed UIDs and Message-IDs.
5. **AC-05**: An email with an unsupported attachment (e.g., `.zip`) logs a warning and still ingests the email body and any supported attachments.
6. **AC-06**: Running `wiki mail-check --mailbox work` only processes the "work" mailbox, not others.
7. **AC-07**: Running `wiki mail-check --limit 5` processes at most 5 emails even if more are available.
8. **AC-08**: Running `wiki mail-check --dry-run` outputs what would be processed without creating files or updating state.
9. **AC-09**: If the IMAP server is unreachable, the command logs an error and exits with a non-zero code.
10. **AC-10**: If one email fails to ingest, subsequent emails are still processed, and the failed email is retried on the next run.
11. **AC-11**: Email sources appear in `wiki list-sources` with metadata identifying them as email-sourced.
12. **AC-12**: The `wiki status` command includes mail-check statistics (last check time, emails processed count) if mailboxes are configured.
13. **AC-13**: Configuration missing any required mailbox field (host, port, tls, user, password, folders, connectionTimeout) raises a `ConfigurationError`.
14. **AC-14**: Running `wiki mail-check --reset-state --mailbox work` clears the state for the "work" mailbox and prompts for confirmation.
15. **AC-15**: Password expiry warning appears on stderr when a mailbox password is within 7 days of expiring.
16. **AC-16**: Generated wiki pages from email ingestion contain proper cross-references and appear in `wiki/index.md`.

---

## 10. Out of Scope

The following are explicitly NOT part of this feature:

1. **Sending emails** -- The system only reads/receives; it never sends emails.
2. **SMTP/POP3 support** -- Only IMAP is supported. POP3 deletes messages and lacks UID tracking.
3. **OAuth2/XOAUTH2 authentication** -- Initial implementation supports username/password (including app passwords). OAuth2 can be added later.
4. **Email deletion or flagging** -- The system does not modify emails on the server (no delete, no mark-as-read, no flag changes). Emails remain untouched.
5. **Real-time push notifications (IMAP IDLE)** -- The command is polling-based. IMAP IDLE for real-time push is deferred.
6. **Email threading/conversation reconstruction** -- Each email is ingested independently. Reconstructing email threads into a single wiki page is deferred.
7. **Calendar invites / VCALENDAR** -- ICS attachments are not parsed for calendar events.
8. **S/MIME or PGP decryption** -- Encrypted emails are not supported.
9. **Mailbox folder creation or management** -- The tool only reads from existing folders.
10. **GUI or web interface for mailbox configuration** -- Configuration is via config.json and environment variables only.
11. **Rate limiting or throttling against the IMAP server** -- The command processes emails as fast as the server allows.

---

## Appendix: Suggested npm Packages

| Package | Purpose |
|---------|---------|
| `imapflow` | Modern, promise-based IMAP client with excellent UID support, MIME parsing, and streaming. Actively maintained. |
| `mailparser` | Full MIME parser for extracting body parts and attachments from raw email messages. Works with `imapflow`. |
| `turndown` | HTML-to-markdown converter for HTML-only email bodies. |

These are suggestions; the implementation team may choose alternatives that satisfy the same requirements.
