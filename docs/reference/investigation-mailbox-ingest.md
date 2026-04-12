# Investigation: IMAP Mailbox Ingest for LLM Wiki

**Date**: 2026-04-12
**Status**: Complete
**Related**: refined-request-mailbox-ingest.md, codebase-scan-mailbox-ingest.md

---

## 1. IMAP Libraries for Node.js

### 1.1 imapflow (Recommended)

- **Package**: `imapflow`
- **Author**: Postal Systems (Andris Reinman, creator of Nodemailer)
- **License**: MIT
- **Repository**: https://github.com/postalsys/imapflow
- **TypeScript**: Built-in type definitions included in the package
- **API Style**: Modern async/await, Promise-based
- **Actively Maintained**: Yes, commits through 2025, part of the EmailEngine ecosystem

**Key Features**:
- Async/await API throughout -- all methods return Promises
- Automatic IMAP extension handling (CONDSTORE, QRESYNC, IDLE, COMPRESS)
- Message streaming via async iterators for memory-efficient processing
- Built-in mailbox locking mechanism for safe concurrent access
- Proxy support (SOCKS, HTTP CONNECT)
- Gmail-specific support (labels, X-GM-EXT-1 search)
- TLS/SSL support built-in (`secure: true` option)

**IMAP Feature Coverage** (all required by the spec):
- **UID FETCH**: Full support. `fetchOne()`, `fetch()`, `fetchAll()` all accept `{ uid: true }` option. Can fetch by UID ranges or arrays of UIDs.
- **SEARCH**: Rich search API with structured query objects (`client.search({ seen: false }, { uid: true })`). Supports flag, address, content, date, size, header, and UID-based searches. Can combine criteria with AND/OR/NOT.
- **BODYSTRUCTURE**: `fetchOne('*', { bodyStructure: true })` returns the full MIME tree with `childNodes`, `type`, `disposition`, `dispositionParameters`, `encoding`, `size`.
- **Attachment Handling**: `download()` method streams specific MIME parts by part number. `downloadMany()` fetches multiple parts at once. Built-in `findAttachments()` pattern using bodyStructure traversal.
- **UIDVALIDITY**: Exposed via `client.mailbox.uidValidity` after opening a mailbox.
- **Envelope**: `fetchOne('*', { envelope: true })` returns subject, from, to, date, messageId, inReplyTo in parsed form.

**Connection Pattern** (fits the spec's connect-fetch-disconnect model):
```typescript
const client = new ImapFlow({
    host: 'imap.example.com',
    port: 993,
    secure: true,
    auth: { user: '...', pass: '...' },
    logger: false // or custom logger
});
await client.connect();
let lock = await client.getMailboxLock('INBOX');
try {
    // fetch operations here
} finally {
    lock.release();
}
await client.logout();
```

**Important Constraint**: Cannot run IMAP commands inside `fetch()` async iterator loop (deadlock). Must use `fetchAll()` or collect UIDs first, then process. This is acceptable for our use case since we collect UIDs via `search()` first, then fetch each message individually.

**Assessment**: Excellent fit. Modern API aligns perfectly with the project's async/await patterns. Built-in TypeScript types. The same author maintains both imapflow and the recommended email parser (postal-mime). Active maintenance ensures long-term viability.

### 1.2 node-imap (imap package)

- **Package**: `imap`
- **Author**: mscdex
- **License**: MIT
- **Repository**: https://github.com/mscdex/node-imap
- **TypeScript**: No built-in types; `@types/imap` exists (community-maintained)
- **API Style**: Callback-based with EventEmitter pattern
- **Maintenance**: Effectively abandoned. Last meaningful update years ago. Requires Node.js v10+.

**Key Features**:
- Raw IMAP access with full protocol control
- UID and sequence-based fetching
- TLS support
- No auto-decoding of messages/attachments (leaves headers as-is)

**Drawbacks**:
- Callback-based API requires wrapping in Promises for modern code
- No streaming via async iterators
- EventEmitter pattern is verbose and error-prone (see the 50+ line examples in README for basic operations)
- No auto-decoding -- requires manual MIME parsing for everything
- Community TypeScript types may lag behind or be incomplete
- Abandoned maintenance means no fixes for edge cases or new server behaviors

**Assessment**: Not recommended. The callback-based API is a poor fit for the project's modern TypeScript/async patterns. The verbosity of even basic operations adds significant implementation complexity.

### 1.3 imap-simple

- **Package**: `imap-simple`
- **Author**: chadxz (originally), various forks
- **License**: MIT
- **TypeScript**: `@types/imap-simple` exists (community-maintained)
- **API Style**: Promise wrapper around `node-imap`
- **Maintenance**: The original repo appears abandoned. Multiple forks exist with varying maintenance status.

**Key Features**:
- Simplifies `node-imap` with a Promise-based wrapper
- Simpler connection/search/fetch API
- Built on top of `node-imap` (inherits its limitations)

**Drawbacks**:
- Depends on the abandoned `node-imap` underneath
- No streaming support for large messages
- Community TypeScript types
- Fragmented maintenance across forks
- Limited IMAP extension support (only what `node-imap` provides)

**Assessment**: Not recommended. While it improves on `node-imap`'s API, it inherits the abandoned dependency. Using a wrapper around an unmaintained library adds risk without sufficient benefit over `imapflow`.

### 1.4 Comparison Summary

| Criterion | imapflow | imap (node-imap) | imap-simple |
|-----------|----------|-------------------|-------------|
| API style | async/await | callbacks + events | Promises (wraps node-imap) |
| TypeScript | Built-in | @types (community) | @types (community) |
| Maintained | Active (2025) | Abandoned | Abandoned / fragmented |
| UID support | Native | Native | Via node-imap |
| SEARCH | Rich structured API | Raw IMAP search | Simplified wrapper |
| Streaming | Async iterators + download() | EventEmitter streams | No |
| BODYSTRUCTURE | Parsed tree | Raw struct | Via node-imap |
| TLS | Built-in | Built-in | Via node-imap |
| UIDVALIDITY | Exposed on mailbox | Exposed on box | Via node-imap |
| IMAP extensions | Auto-detected | Manual | Via node-imap |

---

## 2. Email Parsing Libraries

### 2.1 postal-mime (Recommended)

- **Package**: `postal-mime`
- **Author**: Postal Systems (Andris Reinman -- same as imapflow)
- **License**: MIT
- **Repository**: https://github.com/postalsys/postal-mime
- **TypeScript**: Comprehensive built-in type definitions
- **Dependencies**: Zero external dependencies

**Key Features**:
- Works in Node.js, browsers, and serverless environments
- Fully typed with comprehensive TypeScript definitions (`Email`, `Address`, `Mailbox`, `Header`, `Attachment`, `PostalMimeOptions`)
- Zero dependencies -- minimal footprint
- RFC 2822/5322 compliant
- Handles complex MIME structures (multipart, nested parts, attachments)
- Security limits (max nesting depth, max header size)
- Accepts `string`, `ArrayBuffer/Uint8Array`, `Blob`, `Buffer`, or `ReadableStream`
- Supports ESM and CommonJS

**API**:
```typescript
import PostalMime from 'postal-mime';
import type { Email, Attachment } from 'postal-mime';

const email: Email = await PostalMime.parse(rawMessage);
// email.subject, email.from, email.to, email.date
// email.text (plain text body)
// email.html (HTML body)
// email.attachments (Attachment[])
```

**Attachment Handling**:
- Each `Attachment` has: `filename`, `mimeType`, `disposition`, `content` (ArrayBuffer by default, or base64/utf8 via options)
- Inline images (CID) are included as attachments with `disposition: 'inline'` and `contentId` field
- Configurable encoding via `attachmentEncoding` option

**What It Does NOT Do**:
- No HTML-to-markdown/text conversion (need separate library like `turndown`)
- Not a streaming parser -- loads entire message into memory (acceptable for email-sized messages, typically under 25MB)

**Recommended by mailparser maintainers**: The mailparser README explicitly states it is in maintenance mode and recommends postal-mime for new projects.

**Assessment**: Excellent fit. Same author as imapflow ensures compatibility. Built-in TypeScript types, zero dependencies, modern API. The non-streaming approach is acceptable since individual emails are typically well within memory limits, and attachments are extracted as ArrayBuffers that can be immediately written to disk.

### 2.2 mailparser

- **Package**: `mailparser`
- **Author**: Nodemailer project (Andris Reinman)
- **License**: MIT (with custom terms on the nodemailer.com homepage)
- **TypeScript**: Built-in types
- **Status**: **Maintenance mode** -- security fixes only, no new features

**Key Features**:
- Streaming parser -- can handle very large messages (100MB+)
- Advanced MIME parsing
- Part of the Nodemailer ecosystem

**Drawbacks**:
- In maintenance mode (the README explicitly directs new projects to postal-mime)
- Has external dependencies
- Streaming is overkill for typical email sizes
- The author's own recommendation is to use postal-mime instead

**Assessment**: Viable but not recommended for new projects given the author's own deprecation notice. postal-mime is the successor.

### 2.3 Built-in imapflow Capabilities

imapflow can fetch parsed envelopes (subject, from, to, date, messageId) and BODYSTRUCTURE without needing an external parser. For the full message body and attachment content extraction, an external parser is still needed.

**What imapflow provides natively**:
- `envelope`: Parsed subject, from, to, cc, bcc, date, messageId, inReplyTo
- `bodyStructure`: Parsed MIME tree with part numbers, types, sizes, filenames
- `download(uid, partNumber)`: Stream a specific MIME part by part number
- Individual body parts via `bodyParts` fetch option

**What still needs external parsing**:
- Full MIME message parsing when fetching `source` (raw RFC822)
- Decoding of encoded body parts (quoted-printable, base64)

**Hybrid Approach (Recommended)**: Use imapflow's `envelope` for metadata (subject, from, date, messageId) and `bodyStructure` for attachment discovery, then use imapflow's `download()` to stream individual parts. Use postal-mime only when the full raw message needs parsing (e.g., for complex multipart text extraction). This minimizes memory usage and avoids downloading the entire message source when only metadata + specific parts are needed.

### 2.4 Comparison Summary

| Criterion | postal-mime | mailparser | imapflow built-in |
|-----------|-------------|------------|-------------------|
| TypeScript | Built-in, comprehensive | Built-in | Built-in (part of imapflow) |
| Dependencies | Zero | Multiple | N/A (part of imapflow) |
| Streaming | No (loads in memory) | Yes | Yes (download() streams) |
| Maintenance | Active | Maintenance mode | Active |
| Attachment extraction | Full | Full | Via bodyStructure + download() |
| HTML body extraction | Yes | Yes | Via bodyParts fetch |
| Encoding handling | Full (RFC compliant) | Full | Partial |

---

## 3. HTML-to-Markdown Conversion

### 3.1 turndown (Recommended)

- **Package**: `turndown`
- **License**: MIT
- **TypeScript**: `@types/turndown` available
- **Status**: Stable, mature library

**Features**:
- Converts HTML to Markdown
- Configurable heading style (setext/atx), code block style, list markers
- Extensible with custom rules
- Works in Node.js and browsers
- Plugin system (e.g., `turndown-plugin-gfm` for GitHub Flavored Markdown tables, strikethrough)

**Usage**:
```typescript
import TurndownService from 'turndown';
const turndownService = new TurndownService({ headingStyle: 'atx' });
const markdown = turndownService.turndown(htmlString);
```

**Assessment**: The standard choice for HTML-to-markdown in Node.js. Mature, well-documented, configurable. The `@types/turndown` package provides TypeScript support. Aligns with the spec's suggestion and the project's Obsidian-compatible markdown output.

### 3.2 Alternatives Considered

- **node-html-to-text**: Converts HTML to plain text (not markdown). Loses formatting structure. Not suitable since the wiki wants markdown.
- **rehype-remark + remark-stringify**: AST-based HTML-to-markdown pipeline. More powerful but significantly heavier. Overkill for email body conversion.

---

## 4. State Persistence

### 4.1 Recommended Approach: JSON File with UIDs and Message-IDs

The spec defines a clear state model in `sources/mailbox-state.json`. This aligns perfectly with the existing project patterns:

**Existing Pattern**: `SourceRegistry` uses `sources/registry.json` with atomic writes (tmp file + rename). The `MailboxStateManager` should follow the identical pattern.

**State Structure** (from spec):
```json
{
  "mailboxes": {
    "work": {
      "folders": {
        "INBOX": {
          "uidValidity": 12345,
          "processedUIDs": [1001, 1002, 1003],
          "lastProcessedAt": "2026-04-12T10:30:00Z"
        }
      }
    }
  },
  "processedMessageIds": ["<msg-id-1@example.com>"]
}
```

### 4.2 UIDVALIDITY Handling

UIDVALIDITY is critical for correctness. When an IMAP server rebuilds a folder (e.g., after migration or corruption), it changes the UIDVALIDITY value, meaning all previously known UIDs are no longer valid.

**Handling Strategy**:
1. On each run, after opening a folder, compare `client.mailbox.uidValidity` with the stored value
2. If unchanged: use `processedUIDs` for efficient deduplication
3. If changed: clear `processedUIDs` for that folder, log a warning, fall back to `processedMessageIds` for deduplication
4. Store the new `uidValidity` value

**Implementation Note**: The `processedMessageIds` array acts as the safety net. Even if UIDs are invalidated, Message-IDs (RFC 2822 header) remain stable across server rebuilds, folder moves, and even cross-mailbox deduplication.

### 4.3 Scalability Considerations

For mailboxes with thousands of processed emails, the `processedUIDs` array and `processedMessageIds` array will grow. At 10,000 entries:
- `processedUIDs`: ~60KB (numbers as JSON)
- `processedMessageIds`: ~600KB (average 60-char Message-ID strings)
- Total state file: under 1MB -- negligible for JSON read/write performance

For extreme cases (100K+ emails), consider converting `processedMessageIds` to a `Set<string>` in memory (which is already the natural implementation) and potentially pruning very old entries. However, this is an optimization that can be deferred.

### 4.4 Atomic Write Pattern

Follow the existing `SourceRegistry` pattern:
```typescript
// Write to temp file first
const tmpPath = statePath + '.tmp';
await fs.writeFile(tmpPath, JSON.stringify(state, null, 2));
// Atomic rename
await fs.rename(tmpPath, statePath);
```

This ensures the state file is never in a corrupted half-written state, even if the process is killed mid-write.

---

## 5. Architecture Pattern

### 5.1 Connection Management

The command follows a strict connect-fetch-disconnect pattern per the spec's NFR-01 (No Daemon Mode):

```
For each configured mailbox:
  1. Connect to IMAP server
  2. For each configured folder:
     a. Open folder (getMailboxLock)
     b. Check UIDVALIDITY
     c. Search for all UIDs
     d. Filter out already-processed UIDs
     e. For each unprocessed UID (oldest first):
        - Fetch envelope + bodyStructure
        - Check Message-ID against processedMessageIds
        - Extract and save email body to sources/files/
        - Extract and save attachments to sources/files/
        - Call pipeline.ingest() for body
        - Call pipeline.ingest() for each attachment
        - Update state file (atomic write)
     f. Release mailbox lock
  3. Disconnect (logout)
```

### 5.2 Fetching Strategy

Two approaches were considered for fetching email content:

**Approach A: Fetch full source + parse with postal-mime**
- Fetch entire RFC822 source via `fetchOne(uid, { source: true }, { uid: true })`
- Parse with `PostalMime.parse(source)` to get body + attachments
- Simpler code, single fetch per message
- Higher memory usage (entire message in memory)

**Approach B: Use imapflow's structured fetch + download (Recommended)**
- Fetch metadata via `fetchOne(uid, { envelope: true, bodyStructure: true }, { uid: true })`
- Walk the bodyStructure tree to find text/plain, text/html, and attachment parts
- Use `client.download(uid, partNumber, { uid: true })` to stream each part to disk
- Lower memory usage (stream attachments directly to files)
- More code but aligns with NFR-03 (Memory Efficiency)

**Recommendation**: **Approach B** for production. It avoids loading entire messages with large attachments into memory. The bodyStructure tree walking is slightly more complex but imapflow's documentation provides the exact pattern (the `findAttachments()` example in their docs).

**Fallback consideration**: For messages where bodyStructure traversal fails to find a text part (rare edge cases with unusual MIME structures), fall back to Approach A -- fetch full source and parse with postal-mime. This provides a safety net without sacrificing the normal-case efficiency.

### 5.3 Error Handling

Per NFR-06 (Graceful Failure) and the spec's edge cases:

1. **Per-mailbox**: If connection to one mailbox fails, log error, continue to next mailbox
2. **Per-email**: If processing one email fails (ingest error, attachment error), do NOT update state for that email, log the failure, continue to next email
3. **Partial email failure**: If body ingests but an attachment fails, do NOT mark the email as processed. On retry, the pipeline's content-hash deduplication will prevent duplicate body pages.
4. **Connection timeout**: Use imapflow's built-in connection timeout. If exceeded, treat as mailbox-level failure.
5. **Non-zero exit code**: If any email or mailbox fails, return exit code 1.

### 5.4 Message Processing Flow (Detailed)

```
fetchEnvelope(uid) -> { subject, from, date, messageId }
fetchBodyStructure(uid) -> MIME tree

Walk MIME tree:
  - Find text/plain part -> download, use as body
  - If no text/plain, find text/html part -> download, convert with turndown
  - Find attachment parts -> for each:
      - Check extension against supported formats
      - If supported: download to sources/files/
      - If unsupported: log warning, skip

Compose email body markdown:
  # <Subject>
  
  **From**: <sender>
  **Date**: <date>
  
  <body content>

Save to sources/files/email-<timestamp>-<sanitized-subject>.md
Call pipeline.ingest(bodyPath, { metadata: emailMetadata })

For each saved attachment:
  Call pipeline.ingest(attachmentPath, { metadata: attachmentMetadata })

If all succeed:
  Update state (add UID to processedUIDs, add Message-ID to processedMessageIds)
```

---

## 6. Security Considerations

### 6.1 Password Storage

The spec supports two approaches, consistent with the existing `WIKI_LLM_API_KEY` pattern:

1. **Environment variables (recommended)**: `WIKI_MAILBOX_<NAME>_PASSWORD`
   - Passwords never touch disk
   - Compatible with cron jobs (set in the cron environment or a sourced env file)
   - Standard practice for CI/CD and automated systems

2. **Config file**: `config.json` under `mailboxes.<name>.password`
   - Convenient for development
   - Risk: config file may be committed to version control
   - Mitigation: the configuration guide should warn about this and recommend `.gitignore` for config.json

**Rule**: Passwords must NEVER be logged, even in verbose mode. The imapflow client should be configured with a custom logger that redacts credentials.

### 6.2 App Passwords

Major email providers require app-specific passwords when 2FA is enabled:

| Provider | App Password Setup |
|----------|-------------------|
| **Gmail** | Google Account > Security > 2-Step Verification > App Passwords. Generates a 16-character password. |
| **Outlook/Microsoft 365** | Does NOT support app passwords for IMAP as of 2024. Requires OAuth2 (out of scope for initial implementation). Microsoft has been deprecating basic auth for IMAP. |
| **Yahoo** | Account Security > Generate app password |
| **iCloud** | Apple ID > App-Specific Passwords |
| **FastMail** | Settings > Privacy & Security > App passwords |
| **Self-hosted (Dovecot, etc.)** | Regular passwords work, app passwords depend on server config |

**Important Note on Microsoft/Outlook**: Microsoft has deprecated basic authentication for IMAP in Exchange Online / Microsoft 365. This means username/password authentication will NOT work for Outlook.com, Hotmail, or Microsoft 365 mailboxes. OAuth2 (XOAUTH2) is required, which is explicitly out of scope for the initial implementation. The configuration guide must document this limitation clearly.

### 6.3 TLS/STARTTLS

- **Port 993 (IMAPS)**: TLS from the start. Set `secure: true` in imapflow. This is the standard and recommended approach.
- **Port 143 (IMAP + STARTTLS)**: Plain connection upgraded to TLS via STARTTLS command. Set `secure: false` in imapflow; it auto-negotiates STARTTLS if the server supports it.
- **No TLS**: imapflow supports it but should be strongly discouraged. The configuration guide should warn against it.

imapflow handles TLS negotiation automatically. The `tls` field in the mailbox config maps directly to imapflow's `secure` option.

### 6.4 Password Expiry

The spec includes `passwordExpiry` (FR-72), following the existing `apiKeyExpiry` pattern (FR-39). The implementation should reuse the `checkApiKeyExpiry()` logic from `src/config/validator.ts`, adapted for mailbox passwords:

```typescript
function checkPasswordExpiry(mailboxName: string, expiryDate: string): void {
    // Same 7-day warning logic as checkApiKeyExpiry()
    // Writes warning to stderr
}
```

---

## 7. Dependency Summary

### Required New Dependencies

| Package | Version | Purpose | Size Impact |
|---------|---------|---------|-------------|
| `imapflow` | latest | IMAP client | ~180KB (has deps: `encoding-japanese`, `libmime`, `node-forge`) |
| `postal-mime` | latest | MIME email parser | ~45KB (zero dependencies) |
| `turndown` | latest | HTML-to-markdown | ~30KB (zero dependencies) |
| `@types/turndown` | latest | TypeScript types for turndown | Dev dependency only |

**Total production dependency impact**: ~255KB of direct code, plus imapflow's transitive dependencies. This is modest and proportional to the feature scope.

**Note**: `imapflow` depends on `node-forge` for TLS operations when Node.js native TLS is insufficient (e.g., certain proxy scenarios). For standard TLS connections, Node.js native TLS is used.

### No Changes to Existing Dependencies

The existing project dependencies (commander, gray-matter, @anthropic-ai/sdk, @extractus/article-extractor) are unaffected.

---

## 8. Recommendations

### IMAP Library: imapflow

**Justification**: 
- Modern async/await API that matches the project's TypeScript patterns
- Built-in TypeScript type definitions
- Actively maintained by the same author who created Nodemailer (the most widely used Node.js email library)
- Native UID support, SEARCH, BODYSTRUCTURE, and streaming download -- all required features
- Built-in mailbox locking prevents concurrent access issues
- Automatic IMAP extension detection reduces edge-case handling code
- The connection pattern (connect, lock, operate, release, logout) maps directly to the spec's run-once requirement

### Email Parser: postal-mime (primary) + imapflow structured fetch (hybrid)

**Justification**:
- Use imapflow's `envelope` for metadata (subject, from, date, messageId) -- avoids parsing the full message
- Use imapflow's `bodyStructure` for attachment discovery -- avoids downloading the entire message
- Use imapflow's `download()` to stream parts to disk -- memory efficient
- Use postal-mime as fallback for complex MIME structures where bodyStructure traversal is insufficient
- postal-mime has zero dependencies, built-in TypeScript types, and is the officially recommended successor to mailparser
- Same author as imapflow ensures API compatibility

### HTML-to-Markdown: turndown

**Justification**:
- Standard library for this purpose in the Node.js ecosystem
- Configurable output style (atx headings for Obsidian compatibility)
- TypeScript types available via `@types/turndown`
- Extensible with GFM plugin if tables/strikethrough are needed

### State Management: JSON file with atomic writes

**Justification**:
- Matches the existing `SourceRegistry` pattern (tmp file + rename)
- Dual-layer deduplication (UIDs per folder + Message-IDs globally) handles all edge cases
- UIDVALIDITY tracking prevents stale UID references
- Simple, transparent, debuggable (human-readable JSON)
- No external database dependency

### Architecture: Run-once, per-email atomic state updates

**Justification**:
- Connect-fetch-disconnect per run matches cron scheduling model
- Per-email state updates ensure failed emails are retried without reprocessing successful ones
- Per-mailbox error isolation means one failing mailbox does not block others
- The hybrid fetch approach (metadata via envelope, content via download) balances code simplicity and memory efficiency

---

## 9. Implementation Effort Estimate

| Component | Estimated Complexity | Notes |
|-----------|---------------------|-------|
| `src/source/imap.ts` (IMAP wrapper) | Medium | Connect, search UIDs, fetch envelope/bodyStructure, download parts, disconnect. ~200 lines. |
| `src/source/mailbox-state.ts` (State manager) | Low | Load/save JSON, UID tracking, UIDVALIDITY check, Message-ID dedup. ~150 lines. Model after SourceRegistry. |
| `src/commands/mail-check.ts` (Command) | Medium | Orchestration loop, per-email processing, error handling, summary output. ~250 lines. Model after ingest.ts. |
| `src/config/types.ts` changes | Low | Add `MailboxConfig` interface and optional `mailboxes` field to `WikiConfig`. ~20 lines. |
| `src/config/validator.ts` changes | Low | Add `validateMailboxConfig()` and `checkPasswordExpiry()`. ~60 lines. Model after existing validation. |
| `src/config/loader.ts` changes | Low-Medium | Extend `applyEnvOverrides()` for `WIKI_MAILBOX_<NAME>_*` pattern. ~40 lines. |
| Tests | Medium | IMAP wrapper tests (mock server), state manager tests, config validation tests. ~300 lines across 3-4 test files. |

**Total new code**: Approximately 700-1000 lines of production code, plus 300+ lines of tests.

---

## 10. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Microsoft 365 basic auth blocked | High | Users with Outlook/M365 cannot use the feature | Document limitation clearly. OAuth2 support as future enhancement. |
| IMAP server quirks (non-standard behavior) | Medium | Parsing failures for specific providers | imapflow handles most quirks automatically. postal-mime fallback for body extraction. |
| Large mailbox initial ingestion | Medium | Timeout or memory issues | `--limit` option caps emails per run. Streaming downloads prevent memory issues. |
| UIDVALIDITY changes causing reprocessing | Low | Extra LLM calls for already-ingested emails | Message-ID dedup prevents duplicate wiki pages. Content hash in pipeline catches remaining duplicates. |
| imapflow library abandonment | Very Low | Need to migrate to alternative | Library is core to the EmailEngine commercial product, ensuring ongoing maintenance. |

---

## Technical Research Guidance

Research needed: Yes

### Topic 1: imapflow bodyStructure traversal patterns
- **Why**: The hybrid fetch approach relies on correctly walking the MIME tree to find text/plain, text/html, and attachment parts. Edge cases (deeply nested multipart/mixed within multipart/alternative, inline images with CID references) need validated traversal logic.
- **Focus**: Test with real emails from Gmail, Yahoo, and corporate Exchange servers to ensure bodyStructure parsing covers common patterns. Verify the `findAttachments()` pattern from imapflow docs handles inline images (CID) correctly.
- **Depth**: medium

### Topic 2: imapflow + postal-mime integration for fallback parsing
- **Why**: When bodyStructure traversal fails, the fallback fetches the full message source and parses with postal-mime. The exact integration pattern (Buffer from imapflow source -> postal-mime parse) needs validation.
- **Focus**: Write a small proof-of-concept that fetches a message via `fetchOne(uid, { source: true })` and passes `message.source` to `PostalMime.parse()`. Verify attachment extraction produces correct filenames and content.
- **Depth**: shallow

### Topic 3: turndown output quality for email HTML
- **Why**: Email HTML is notoriously messy (inline styles, table-based layouts, non-standard tags). The markdown output quality may vary significantly.
- **Focus**: Test turndown with representative email HTML from marketing emails, newsletters, and corporate email clients (Outlook's Word-based HTML renderer). Determine if custom turndown rules are needed.
- **Depth**: shallow

### Topic 4: Microsoft 365 / Exchange Online IMAP access
- **Why**: Microsoft has been deprecating basic authentication for IMAP. If many target users have M365 mailboxes, this is a significant limitation.
- **Focus**: Verify the exact current status of basic auth for IMAP in M365 (as of 2026). Research whether imapflow supports XOAUTH2 for future OAuth2 implementation. Determine the scope of adding OAuth2 as a follow-up feature.
- **Depth**: medium
