# ImapFlow bodyStructure Traversal and MIME Handling Patterns

**Date**: 2026-04-12
**Status**: Complete
**Purpose**: Deep technical reference for implementing the hybrid IMAP fetch approach in the LLM Wiki mailbox ingest feature.
**Related**: investigation-mailbox-ingest.md, refined-request-mailbox-ingest.md

---

## Table of Contents

1. [Overview](#1-overview)
2. [The bodyStructure Object](#2-the-bodystructure-object)
3. [Walking the MIME Tree](#3-walking-the-mime-tree)
4. [Fetching Parts with download()](#4-fetching-parts-with-download)
5. [Handling Inline CID Attachments (multipart/related)](#5-handling-inline-cid-attachments-multipartrelated)
6. [postal-mime Fallback Pattern](#6-postal-mime-fallback-pattern)
7. [Attachment Filename Decoding (RFC 2231 and RFC 2047)](#7-attachment-filename-decoding-rfc-2231-and-rfc-2047)
8. [Complete Integration Pattern](#8-complete-integration-pattern)
9. [Edge Cases and Pitfalls](#9-edge-cases-and-pitfalls)
10. [Assumptions and Scope](#10-assumptions-and-scope)
11. [References](#11-references)

---

## 1. Overview

ImapFlow provides a parsed MIME tree via the `bodyStructure` property when a message is fetched with `{ bodyStructure: true }`. This tree exactly mirrors the RFC 3501 IMAP BODYSTRUCTURE response but is presented as a clean JavaScript object graph rather than raw IMAP protocol text.

The hybrid fetch strategy recommended in `investigation-mailbox-ingest.md` uses:
1. `fetchOne(uid, { envelope: true, bodyStructure: true }, { uid: true })` — metadata and MIME tree (no body content downloaded)
2. `client.download(uid, partNumber, { uid: true })` — stream specific MIME parts by their dot-notation part number
3. `fetchOne(uid, { source: true }, { uid: true })` + `PostalMime.parse(source)` — fallback for complex/malformed structures

This document details the exact patterns for steps 1 through 3, with TypeScript code for each.

---

## 2. The bodyStructure Object

### 2.1 MessageStructureNode Interface

ImapFlow ships its own TypeScript definitions (no `@types/imapflow` needed). The `bodyStructure` property on a fetched message is a `MessageStructureNode`:

```typescript
interface MessageStructureNode {
  // Part identifier — absent on the root node, present on all children
  // Used directly as the `part` argument to client.download()
  part?: string;                          // e.g. "1", "2", "1.1", "1.2.3"

  // Full MIME Content-Type string — no separate subtype field
  type?: string;                          // e.g. "text/plain", "multipart/mixed", "image/jpeg"

  // Content-Type parameters
  parameters?: Record<string, string>;   // e.g. { name: "report.pdf", charset: "utf-8" }

  // Content-ID — only present on single-part (non-multipart) nodes
  // Used for CID references in multipart/related (inline images in HTML)
  id?: string;                            // e.g. "<0__=rhksjt@example.com>"

  // Content transfer encoding
  encoding?: string;                      // "base64", "quoted-printable", "7bit", "8bit"

  // Size of the encoded part in bytes (before decoding)
  size?: number;

  // Human-readable description (rarely set)
  description?: string;

  // Content-Disposition header value
  disposition?: string;                   // "attachment" or "inline" or undefined

  // Content-Disposition parameters
  dispositionParameters?: Record<string, string>; // e.g. { filename: "report.pdf" }

  // Language tags (rarely used)
  language?: string[];

  // Content-Location URL (rarely used)
  location?: string;

  // Child nodes — present only for multipart/* and message/rfc822 types
  childNodes?: MessageStructureNode[];
}
```

**Critical note**: `node.type` is always the full MIME type string (`"text/plain"`, `"multipart/mixed"`). There is no separate `subtype` property.

### 2.2 Real-World bodyStructure Examples

#### Simple Plain-Text Email

```json
{
  "type": "text/plain",
  "parameters": { "charset": "utf-8" },
  "encoding": "7bit",
  "size": 312
}
```

The root node itself is the body. It has no `part` field. To download it, use part `"1"` (imapflow convention: the root single-part body is addressed as `"1"`).

#### multipart/mixed with Plain Text + PDF Attachment

```json
{
  "type": "multipart/mixed",
  "childNodes": [
    {
      "part": "1",
      "type": "text/plain",
      "parameters": { "charset": "utf-8" },
      "encoding": "quoted-printable",
      "size": 845
    },
    {
      "part": "2",
      "type": "application/pdf",
      "parameters": { "name": "report.pdf" },
      "encoding": "base64",
      "size": 2859132,
      "disposition": "attachment",
      "dispositionParameters": { "filename": "report.pdf" }
    }
  ]
}
```

#### multipart/alternative (Plain Text + HTML)

```json
{
  "type": "multipart/alternative",
  "childNodes": [
    {
      "part": "1",
      "type": "text/plain",
      "parameters": { "charset": "iso-8859-1" },
      "encoding": "quoted-printable",
      "size": 2815
    },
    {
      "part": "2",
      "type": "text/html",
      "parameters": { "charset": "utf-8" },
      "encoding": "quoted-printable",
      "size": 4171
    }
  ]
}
```

**Rule**: In `multipart/alternative`, all children represent the same content in different formats. Prefer `text/plain` for wiki ingestion; fall back to `text/html` if only HTML is present.

#### multipart/mixed with multipart/alternative Body + Attachment

This is the most common real-world layout for emails with both HTML and plain-text bodies plus a file attachment:

```json
{
  "type": "multipart/mixed",
  "childNodes": [
    {
      "part": "1",
      "type": "multipart/alternative",
      "childNodes": [
        {
          "part": "1.1",
          "type": "text/plain",
          "parameters": { "charset": "utf-8" },
          "encoding": "quoted-printable",
          "size": 1200
        },
        {
          "part": "1.2",
          "type": "text/html",
          "parameters": { "charset": "utf-8" },
          "encoding": "quoted-printable",
          "size": 4800
        }
      ]
    },
    {
      "part": "2",
      "type": "application/pdf",
      "parameters": { "name": "invoice.pdf" },
      "encoding": "base64",
      "size": 150000,
      "disposition": "attachment",
      "dispositionParameters": { "filename": "invoice.pdf" }
    }
  ]
}
```

The plain text body is at part `"1.1"`, HTML at `"1.2"`, attachment at `"2"`.

#### multipart/related (HTML with Inline Images)

The `multipart/related` type bundles an HTML body with its embedded images. The images are referenced via `cid:` URIs in the HTML:

```json
{
  "type": "multipart/related",
  "childNodes": [
    {
      "part": "1",
      "type": "text/html",
      "parameters": { "charset": "us-ascii" },
      "encoding": "7bit",
      "size": 119,
      "disposition": "inline"
    },
    {
      "part": "2",
      "type": "image/jpeg",
      "parameters": { "name": "logo.jpg" },
      "id": "<0__=rhksjt@example.com>",
      "encoding": "base64",
      "size": 143804,
      "disposition": "inline",
      "dispositionParameters": { "filename": "logo.jpg" }
    }
  ]
}
```

The HTML at part `"1"` contains `<img src="cid:0__=rhksjt@example.com">`. The `node.id` on part `"2"` holds the full Content-ID including angle brackets: `<0__=rhksjt@example.com>`. To match the `cid:` URI, strip the angle brackets: `node.id.replace(/^<|>$/g, '')`.

#### Complex Nested Structure: multipart/mixed + multipart/alternative + multipart/related

A typical newsletter or corporate email that has plain text fallback, HTML with embedded images, AND a file attachment:

```json
{
  "type": "multipart/mixed",
  "childNodes": [
    {
      "part": "1",
      "type": "multipart/alternative",
      "childNodes": [
        {
          "part": "1.1",
          "type": "text/plain",
          "encoding": "quoted-printable",
          "size": 2815
        },
        {
          "part": "1.2",
          "type": "multipart/related",
          "childNodes": [
            {
              "part": "1.2.1",
              "type": "text/html",
              "encoding": "quoted-printable",
              "size": 4171,
              "disposition": "inline"
            },
            {
              "part": "1.2.2",
              "type": "image/jpeg",
              "parameters": { "name": "banner.jpg" },
              "id": "<3245dsf7435@example.com>",
              "encoding": "base64",
              "size": 189906,
              "disposition": "inline",
              "dispositionParameters": { "filename": "banner.jpg" }
            }
          ]
        }
      ]
    },
    {
      "part": "2",
      "type": "application/zip",
      "parameters": { "name": "archive.zip" },
      "encoding": "base64",
      "size": 524288,
      "disposition": "attachment",
      "dispositionParameters": { "filename": "archive.zip" }
    }
  ]
}
```

- Plain text body: part `"1.1"`
- HTML body: part `"1.2.1"`
- Inline image (CID): part `"1.2.2"`
- Regular attachment: part `"2"`

---

## 3. Walking the MIME Tree

### 3.1 Finding Text Body Parts

```typescript
import type { MessageStructureNode } from 'imapflow';

/**
 * Finds the first text/plain body part, excluding parts explicitly
 * marked as attachments. Returns the part number string, or null.
 *
 * For the root single-part text body (no `part` field), returns "1".
 */
function findPlainTextPart(node: MessageStructureNode): string | null {
    // Skip nodes explicitly marked as attachments
    if (node.disposition === 'attachment') {
        return null;
    }

    if (node.type === 'text/plain') {
        return node.part ?? '1';
    }

    if (node.childNodes) {
        for (const child of node.childNodes) {
            const found = findPlainTextPart(child);
            if (found) return found;
        }
    }

    return null;
}

/**
 * Finds the first text/html body part, excluding attachment-disposition parts.
 * Returns the part number string, or null.
 */
function findHtmlPart(node: MessageStructureNode): string | null {
    if (node.disposition === 'attachment') {
        return null;
    }

    if (node.type === 'text/html') {
        return node.part ?? '1';
    }

    if (node.childNodes) {
        for (const child of node.childNodes) {
            const found = findHtmlPart(child);
            if (found) return found;
        }
    }

    return null;
}
```

**Important**: In a `multipart/alternative` node, `findPlainTextPart` will return the first `text/plain` child it encounters. Since plain text comes before HTML in well-formed `multipart/alternative` parts, the depth-first search finds the plain text first. This is the correct behavior.

### 3.2 Finding Regular Attachments

```typescript
export interface AttachmentInfo {
    part: string;
    type: string;
    filename: string;
    size: number;
    encoding: string;
    isInline: boolean;
    contentId?: string;    // CID for inline images (without angle brackets)
}

/**
 * Recursively walks the bodyStructure tree and collects all attachment parts.
 *
 * Identifies attachments by two criteria:
 *   1. Explicit: node.disposition === 'attachment'
 *   2. Implicit: node.type is not text/*, not multipart/*, and has no disposition
 *      (some IMAP servers omit the Content-Disposition for attachments)
 *
 * Inline images (disposition === 'inline', has a Content-ID) are included
 * separately — callers can filter by isInline and contentId.
 */
export function findAllAttachments(node: MessageStructureNode): AttachmentInfo[] {
    const attachments: AttachmentInfo[] = [];

    // Only leaf nodes (non-multipart) can be attachments
    if (!node.childNodes) {
        const topType = (node.type ?? '').split('/')[0];
        const isExplicitAttachment = node.disposition === 'attachment';
        const isExplicitInline = node.disposition === 'inline';
        const isImplicitAttachment =
            node.type !== undefined &&
            topType !== 'text' &&
            topType !== 'multipart' &&
            node.disposition == null;

        if (isExplicitAttachment || isImplicitAttachment) {
            attachments.push({
                part: node.part ?? '1',
                type: node.type ?? 'application/octet-stream',
                filename: extractFilename(node),
                size: node.size ?? 0,
                encoding: node.encoding ?? 'base64',
                isInline: false,
                contentId: node.id ? stripAngleBrackets(node.id) : undefined
            });
        } else if (isExplicitInline && node.id) {
            // Inline image with CID (embedded in HTML via multipart/related)
            attachments.push({
                part: node.part ?? '1',
                type: node.type ?? 'application/octet-stream',
                filename: extractFilename(node),
                size: node.size ?? 0,
                encoding: node.encoding ?? 'base64',
                isInline: true,
                contentId: stripAngleBrackets(node.id)
            });
        }
    }

    // Recurse into multipart children
    if (node.childNodes) {
        for (const child of node.childNodes) {
            attachments.push(...findAllAttachments(child));
        }
    }

    return attachments;
}

/**
 * Extracts the filename for a MIME part, checking both
 * Content-Disposition parameters and Content-Type parameters.
 *
 * ImapFlow decodes RFC 2231 and RFC 2047 encoded filenames automatically
 * when it parses the BODYSTRUCTURE response via libmime.
 */
function extractFilename(node: MessageStructureNode): string {
    return (
        node.dispositionParameters?.filename ??
        node.parameters?.name ??
        node.description ??
        'attachment'
    );
}

function stripAngleBrackets(id: string): string {
    return id.replace(/^<|>$/g, '');
}
```

### 3.3 Detecting Body Structure Type

This helper determines the overall email shape before traversal, which helps choose the fetch strategy:

```typescript
export type EmailShape =
    | 'text-only'           // Single text/plain or text/html root
    | 'alternative'         // multipart/alternative (plain + html)
    | 'mixed'               // multipart/mixed (body + attachments)
    | 'complex';            // Anything else (nested multiparts, related, etc.)

export function detectEmailShape(structure: MessageStructureNode): EmailShape {
    const type = structure.type ?? '';

    if (type === 'text/plain' || type === 'text/html') {
        return 'text-only';
    }

    if (type === 'multipart/alternative') {
        // Confirm all children are leaf text nodes
        const allText = structure.childNodes?.every(
            n => !n.childNodes && (n.type ?? '').startsWith('text/')
        );
        return allText ? 'alternative' : 'complex';
    }

    if (type === 'multipart/mixed') {
        // Simple mixed: one text or alternative child + non-nested attachments
        const hasOnlyLeafChildren = structure.childNodes?.every(
            n => !n.childNodes || n.type === 'multipart/alternative'
        );
        return hasOnlyLeafChildren ? 'mixed' : 'complex';
    }

    return 'complex';
}
```

---

## 4. Fetching Parts with download()

### 4.1 Method Signature

```typescript
// Download a single part as a readable stream (decoded)
const { meta, content } = await client.download(
    uid: string,      // Message UID (as string)
    part: string,     // Part number, e.g. "1", "2", "1.1"
    options?: { uid?: boolean; maxBytes?: number }
);

// meta properties:
// meta.contentType: string   — MIME type of the part
// meta.filename: string      — Decoded filename (if available)
// meta.expectedSize: number  — Expected size in bytes after decoding

// content: ReadableStream (Node.js)
// ImapFlow automatically decodes base64/quoted-printable during streaming.
// Text parts are automatically converted to UTF-8.
```

```typescript
// Download multiple parts at once — returns Buffers (not streams)
const parts = await client.downloadMany(
    uid: string,
    partNumbers: string[],
    options?: { uid?: boolean }
);
// parts is an object: { [partNumber]: { meta, content: Buffer } }
```

### 4.2 Streaming a Text Part to a Buffer

```typescript
import type { ImapFlow } from 'imapflow';

async function downloadPartToBuffer(
    client: ImapFlow,
    uid: number,
    part: string
): Promise<Buffer> {
    const { content } = await client.download(
        String(uid),
        part,
        { uid: true }
    );

    const chunks: Buffer[] = [];
    for await (const chunk of content) {
        chunks.push(chunk);
    }
    return Buffer.concat(chunks);
}

// Usage:
const textBuf = await downloadPartToBuffer(client, uid, '1.1');
const bodyText = textBuf.toString('utf-8');
```

### 4.3 Streaming an Attachment to a File

```typescript
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import type { ImapFlow } from 'imapflow';

async function downloadAttachmentToFile(
    client: ImapFlow,
    uid: number,
    part: string,
    destPath: string
): Promise<{ contentType: string; filename: string; sizeBytes: number }> {
    const { meta, content } = await client.download(
        String(uid),
        part,
        { uid: true }
    );

    await pipeline(content, createWriteStream(destPath));

    return {
        contentType: meta.contentType,
        filename: meta.filename ?? 'attachment',
        sizeBytes: meta.expectedSize
    };
}
```

**Important**: `client.download()` automatically decodes the transfer encoding (base64, quoted-printable). The bytes written to the file are the decoded binary content, not the raw encoded bytes.

### 4.4 Using downloadMany() for Multiple Parts

```typescript
async function downloadAttachmentsToDir(
    client: ImapFlow,
    uid: number,
    attachments: AttachmentInfo[],
    outputDir: string
): Promise<void> {
    const parts = await client.downloadMany(
        String(uid),
        attachments.map(a => a.part),
        { uid: true }
    );

    for (const att of attachments) {
        const data = parts[att.part];
        if (data?.content) {
            const destPath = `${outputDir}/${sanitizeFilename(att.filename)}`;
            await fs.writeFile(destPath, data.content);
        }
    }
}
```

**Note**: `downloadMany()` returns Buffers (not streams), so all parts are fully loaded into memory. Prefer per-part `download()` with streaming for large attachments.

### 4.5 The Root Part Special Case

When the root bodyStructure node has no `childNodes` (simple single-part message), it also has no `part` field. ImapFlow's convention is to address this as part `"1"`:

```typescript
function getBodyPart(node: MessageStructureNode): string {
    // Root single-part messages have no `part` field;
    // use "1" as the IMAP addressing convention for the body.
    return node.part ?? '1';
}
```

---

## 5. Handling Inline CID Attachments (multipart/related)

### 5.1 What multipart/related Means

In `multipart/related`, all parts work together to form a single presentation unit. The first child is typically the HTML body; subsequent children are resources (images, CSS) referenced by `cid:` URIs in the HTML.

The IMAP BODYSTRUCTURE for a real `multipart/related` message looks like:
```
(
  ("TEXT" "HTML" ("CHARSET" "US-ASCII") NIL NIL "7BIT" 119 2 NIL ("INLINE" NIL) NIL)
  ("IMAGE" "JPEG" ("NAME" "4356415.jpg") "<0__=rhksjt>" NIL "BASE64" 143804
   NIL ("INLINE" ("FILENAME" "4356415.jpg")) NIL)
  "RELATED" ("BOUNDARY" "0__=5tgd3d") ("INLINE" NIL) NIL
)
```

ImapFlow parses this to `node.type === 'multipart/related'` with two children. The second child has `node.id === '<0__=rhksjt>'`.

In the HTML at part `"1"`, there is an `<img src="cid:0__=rhksjt">`. The `cid:` value matches `node.id` after stripping the angle brackets.

### 5.2 Extracting the HTML Body from multipart/related

When encountering `multipart/related`, the HTML body is always the first child (or the child explicitly marked as `text/html`):

```typescript
function findHtmlInRelated(node: MessageStructureNode): string | null {
    if (node.type !== 'multipart/related') return null;

    if (!node.childNodes || node.childNodes.length === 0) return null;

    // The HTML body is typically the first child of multipart/related.
    // Per RFC 2387, the "root" part should be the first, but some clients
    // put it elsewhere. Fall back to searching for text/html.
    const firstChild = node.childNodes[0];
    if (firstChild.type === 'text/html') {
        return firstChild.part ?? '1';
    }

    // Fallback: search all children for text/html
    for (const child of node.childNodes) {
        if (child.type === 'text/html') {
            return child.part ?? '1';
        }
    }

    return null;
}
```

### 5.3 Collecting Inline CID Images

```typescript
interface InlineImage {
    part: string;
    contentId: string;       // Without angle brackets, matches cid: references in HTML
    mimeType: string;
    filename: string;
    size: number;
}

function findInlineCidImages(node: MessageStructureNode): InlineImage[] {
    const images: InlineImage[] = [];

    if (node.type === 'multipart/related' && node.childNodes) {
        // Skip the first child (the HTML body itself)
        for (const child of node.childNodes.slice(1)) {
            if (child.id && child.disposition !== 'attachment') {
                images.push({
                    part: child.part ?? '1',
                    contentId: stripAngleBrackets(child.id),
                    mimeType: child.type ?? 'application/octet-stream',
                    filename: extractFilename(child),
                    size: child.size ?? 0
                });
            }
        }
    }

    // Recurse into nested multipart structures
    if (node.childNodes) {
        for (const child of node.childNodes) {
            images.push(...findInlineCidImages(child));
        }
    }

    return images;
}
```

### 5.4 Decision: Include or Skip Inline CID Images

For the wiki ingest use case, inline CID images embedded in HTML are generally not worth ingesting (they are decorative/structural). The recommended policy is:

- **Include** inline images that have a meaningful filename (e.g., `diagram.png`, `chart.jpg`)
- **Skip** inline images with auto-generated filenames (e.g., UUIDs, no extension)
- **Always skip** for the initial implementation; add as an option later

```typescript
function shouldIngestInlineImage(image: InlineImage): boolean {
    const ext = image.filename.split('.').pop()?.toLowerCase() ?? '';
    const meaningfulExtensions = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'];
    const hasMeaningfulFilename = meaningfulExtensions.includes(ext) &&
        !image.filename.match(/^[0-9a-f\-]{32,}/i); // skip UUID-style names
    return hasMeaningfulFilename;
}
```

---

## 6. postal-mime Fallback Pattern

### 6.1 When to Use the Fallback

Use `PostalMime.parse()` on the full message source when:
1. `bodyStructure` traversal yields no `text/plain` and no `text/html` part
2. A `download()` call fails with an unexpected error for a part
3. The root `bodyStructure` node is `message/rfc822` (forwarded message wrapped in itself)
4. The `bodyStructure.type` is something unexpected (e.g., some servers return malformed structures)

### 6.2 Fetching the Full Source

```typescript
import type { ImapFlow } from 'imapflow';

async function fetchFullSource(
    client: ImapFlow,
    uid: number
): Promise<Buffer> {
    const message = await client.fetchOne(
        String(uid),
        { source: true },
        { uid: true }
    );

    if (!message?.source) {
        throw new Error(`Message ${uid}: source not returned`);
    }

    // message.source is a Buffer containing the raw RFC822 bytes
    return message.source;
}
```

### 6.3 Parsing with PostalMime

```typescript
import PostalMime from 'postal-mime';
import type { Email, Attachment } from 'postal-mime';

interface ParsedEmail {
    subject: string | null;
    from: string | null;
    date: string | null;
    messageId: string | null;
    text: string | null;
    html: string | null;
    attachments: ParsedAttachment[];
}

interface ParsedAttachment {
    filename: string | null;
    mimeType: string;
    disposition: string | null;
    contentId: string | null;
    content: ArrayBuffer;
    isInline: boolean;
}

async function parseWithPostalMime(source: Buffer): Promise<ParsedEmail> {
    // PostalMime accepts Buffer natively in Node.js.
    // Use attachmentEncoding: 'arraybuffer' (default) for binary content.
    const email: Email = await PostalMime.parse(source);

    return {
        subject: email.subject ?? null,
        from: extractAddress(email.from),
        date: email.date ?? null,
        messageId: email.messageId ?? null,
        text: email.text ?? null,
        html: email.html ?? null,
        attachments: email.attachments.map(att => ({
            filename: att.filename ?? null,
            mimeType: att.mimeType,
            disposition: att.disposition ?? null,
            contentId: att.contentId ?? null,
            content: att.content as ArrayBuffer,
            isInline: att.related ?? false
        }))
    };
}

function extractAddress(from: Email['from']): string | null {
    if (!from) return null;
    if ('group' in from && from.group) {
        // Address group — use first member
        return from.group[0]?.address ?? null;
    }
    return (from as { address: string }).address ?? null;
}
```

### 6.4 Saving postal-mime Attachment Content to File

```typescript
import { writeFile } from 'node:fs/promises';

async function savePostalMimeAttachment(
    attachment: ParsedAttachment,
    destPath: string
): Promise<void> {
    // attachment.content is an ArrayBuffer — convert to Buffer for Node.js fs
    const buffer = Buffer.from(attachment.content);
    await writeFile(destPath, buffer);
}
```

### 6.5 Integration: Fallback Detection and Dispatch

```typescript
async function extractEmailContent(
    client: ImapFlow,
    uid: number,
    bodyStructure: MessageStructureNode
): Promise<ParsedEmail> {
    const textPart = findPlainTextPart(bodyStructure);
    const htmlPart = findHtmlPart(bodyStructure);
    const attachments = findAllAttachments(bodyStructure);

    // Trigger fallback if no body parts found at all
    const noBodyFound = !textPart && !htmlPart;

    if (noBodyFound || bodyStructure.type === 'message/rfc822') {
        // Fallback: fetch full source and parse
        const source = await fetchFullSource(client, uid);
        return parseWithPostalMime(source);
    }

    // Primary path: selective part download
    let text: string | null = null;
    let html: string | null = null;
    const parsedAttachments: ParsedAttachment[] = [];

    if (textPart) {
        const buf = await downloadPartToBuffer(client, uid, textPart);
        text = buf.toString('utf-8');
    }

    if (htmlPart) {
        const buf = await downloadPartToBuffer(client, uid, htmlPart);
        html = buf.toString('utf-8');
    }

    // Note: attachments are streamed to disk separately; not collected here

    return {
        subject: null, // filled from envelope
        from: null,    // filled from envelope
        date: null,    // filled from envelope
        messageId: null, // filled from envelope
        text,
        html,
        attachments: parsedAttachments
    };
}
```

---

## 7. Attachment Filename Decoding (RFC 2231 and RFC 2047)

### 7.1 The Encoding Problem

Email attachment filenames appear in two MIME headers:
- `Content-Disposition: attachment; filename="report.pdf"` (or `filename*=utf-8''report.pdf` for RFC 2231)
- `Content-Type: application/pdf; name="report.pdf"` (legacy, still common)

There are two competing standards for encoding non-ASCII filenames:
- **RFC 2231** (correct): `filename*=utf-8''caf%C3%A9.pdf` or continuation `filename*0*=...`
- **RFC 2047** (technically incorrect but widely used): `filename="=?utf-8?B?Y2Fmw6ku...?="`

Many email clients (especially Outlook) use RFC 2047 encoding for `Content-Disposition` parameters despite RFC 2047 explicitly forbidding this in MIME parameters. A robust implementation must handle both.

### 7.2 How ImapFlow Handles Encoding

ImapFlow uses `libmime` internally to parse IMAP BODYSTRUCTURE responses. `libmime` implements RFC 2231 decoding for MIME parameters. It also handles the common RFC 2047 violation (encoded-words in parameter values).

**Result**: The `dispositionParameters.filename` and `parameters.name` values returned by imapflow in the `bodyStructure` object are already fully decoded Unicode strings. You do not need to manually decode them.

However, this decoding happens only in the `bodyStructure` path. If you fetch raw headers or use the `source` path, you must decode manually.

### 7.3 postal-mime Filename Decoding

postal-mime also fully decodes filenames in the `Attachment.filename` field. Both RFC 2231 and RFC 2047 are handled. The `decodeWords()` utility is available for manual decoding of encoded-word strings in other contexts:

```typescript
import { decodeWords } from 'postal-mime';

// Manually decode an RFC 2047 encoded string
const raw = '=?utf-8?B?44Ko44Od44K544Kr44O844OJ?=';
const decoded = decodeWords(raw);
// Result: "エポスカード"
```

### 7.4 Edge Cases in Filename Extraction

```typescript
function extractFilenameRobust(node: MessageStructureNode): string | null {
    // Priority 1: Content-Disposition filename parameter (RFC 2183 compliant)
    if (node.dispositionParameters?.filename) {
        return sanitizeFilename(node.dispositionParameters.filename);
    }

    // Priority 2: Content-Type name parameter (legacy, but common)
    if (node.parameters?.name) {
        return sanitizeFilename(node.parameters.name);
    }

    // Priority 3: Content-Description (last resort, rarely useful)
    if (node.description) {
        return sanitizeFilename(node.description);
    }

    // No filename available — caller must generate one
    return null;
}

/**
 * Sanitizes a filename for safe filesystem use.
 * Removes path separators, null bytes, and control characters.
 * Collapses whitespace. Truncates to 255 chars.
 */
function sanitizeFilename(name: string): string {
    return name
        .replace(/[/\\:*?"<>|]/g, '_')   // filesystem-unsafe chars
        .replace(/\x00/g, '')              // null bytes
        .replace(/[\x01-\x1f]/g, '')       // control characters
        .replace(/\s+/g, ' ')              // collapse whitespace
        .trim()
        .slice(0, 255)
        || 'attachment';                   // fallback if result is empty
}
```

### 7.5 Generating Fallback Filenames

When no filename is found, generate a meaningful name:

```typescript
function generateFallbackFilename(node: MessageStructureNode, index: number): string {
    const type = node.type ?? 'application/octet-stream';
    const ext = mimeTypeToExtension(type);
    return `attachment-${index + 1}${ext}`;
}

function mimeTypeToExtension(mimeType: string): string {
    const map: Record<string, string> = {
        'application/pdf': '.pdf',
        'application/msword': '.doc',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
        'application/vnd.ms-excel': '.xls',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
        'application/zip': '.zip',
        'image/jpeg': '.jpg',
        'image/png': '.png',
        'image/gif': '.gif',
        'image/webp': '.webp',
        'text/plain': '.txt',
        'text/html': '.html',
        'text/csv': '.csv'
    };
    return map[mimeType] ?? '';
}
```

---

## 8. Complete Integration Pattern

This section shows the full, production-ready pattern combining everything above.

### 8.1 Types

```typescript
import type { MessageStructureNode, ImapFlow } from 'imapflow';

export interface EmailBodyResult {
    text: string | null;
    html: string | null;
    usedFallback: boolean;
}

export interface AttachmentResult {
    filename: string;
    mimeType: string;
    savedPath: string;
    isInline: boolean;
    contentId?: string;
    sizeBytes: number;
}
```

### 8.2 Primary Path: Selective Part Download

```typescript
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

export async function extractEmailBody(
    client: ImapFlow,
    uid: number,
    bodyStructure: MessageStructureNode
): Promise<EmailBodyResult> {
    const textPart = findPlainTextPart(bodyStructure);
    const htmlPart = findHtmlPart(bodyStructure);

    if (!textPart && !htmlPart) {
        // Trigger fallback
        const source = await fetchFullSource(client, uid);
        const parsed = await parseWithPostalMime(source);
        return {
            text: parsed.text,
            html: parsed.html,
            usedFallback: true
        };
    }

    let text: string | null = null;
    let html: string | null = null;

    if (textPart) {
        const buf = await downloadPartToBuffer(client, uid, textPart);
        text = buf.toString('utf-8');
    }

    if (htmlPart) {
        const buf = await downloadPartToBuffer(client, uid, htmlPart);
        html = buf.toString('utf-8');
    }

    return { text, html, usedFallback: false };
}

export async function saveAttachments(
    client: ImapFlow,
    uid: number,
    bodyStructure: MessageStructureNode,
    outputDir: string,
    supportedExtensions: Set<string>
): Promise<AttachmentResult[]> {
    await mkdir(outputDir, { recursive: true });

    const allAttachments = findAllAttachments(bodyStructure);
    const results: AttachmentResult[] = [];
    let index = 0;

    for (const att of allAttachments) {
        const rawFilename = att.filename;
        const ext = rawFilename.split('.').pop()?.toLowerCase() ?? '';

        // Skip unsupported formats
        if (!supportedExtensions.has(ext)) {
            continue;
        }

        const safeFilename = sanitizeFilename(rawFilename) || generateFallbackFilename(
            { type: att.type } as MessageStructureNode,
            index
        );
        const destPath = path.join(outputDir, safeFilename);

        const { meta, content } = await client.download(
            String(uid),
            att.part,
            { uid: true }
        );

        await pipeline(content, createWriteStream(destPath));

        results.push({
            filename: safeFilename,
            mimeType: att.type,
            savedPath: destPath,
            isInline: att.isInline,
            contentId: att.contentId,
            sizeBytes: meta.expectedSize
        });

        index++;
    }

    return results;
}
```

### 8.3 Fallback Path (postal-mime)

When the primary path fails or yields no body:

```typescript
export async function extractEmailBodyFallback(
    client: ImapFlow,
    uid: number
): Promise<{
    text: string | null;
    html: string | null;
    attachments: Array<{ filename: string | null; mimeType: string; content: Buffer }>
}> {
    const source = await fetchFullSource(client, uid);
    const parsed = await parseWithPostalMime(source);

    return {
        text: parsed.text,
        html: parsed.html,
        attachments: parsed.attachments.map(att => ({
            filename: att.filename,
            mimeType: att.mimeType,
            content: Buffer.from(att.content)
        }))
    };
}
```

### 8.4 Top-Level Message Processing Orchestrator

```typescript
import { ImapFlow } from 'imapflow';
import type { FetchMessageObject } from 'imapflow';

export async function processMessage(
    client: ImapFlow,
    uid: number,
    outputDir: string,
    supportedExtensions: Set<string>
): Promise<{
    body: EmailBodyResult;
    attachments: AttachmentResult[];
}> {
    // Step 1: Fetch metadata and MIME tree (no body download yet)
    const message = await client.fetchOne(
        String(uid),
        { envelope: true, bodyStructure: true },
        { uid: true }
    );

    if (!message) {
        throw new Error(`Message UID ${uid} not found`);
    }

    // Step 2: Extract body via selective download
    let body: EmailBodyResult;
    try {
        body = await extractEmailBody(client, uid, message.bodyStructure);
    } catch (err) {
        // Step 3: Fall back to full source parse on any download error
        const fallbackResult = await extractEmailBodyFallback(client, uid);
        body = {
            text: fallbackResult.text,
            html: fallbackResult.html,
            usedFallback: true
        };
    }

    // Step 4: Download attachments (primary path only when bodyStructure is intact)
    let attachments: AttachmentResult[] = [];
    if (!body.usedFallback) {
        attachments = await saveAttachments(
            client,
            uid,
            message.bodyStructure,
            outputDir,
            supportedExtensions
        );
    }

    return { body, attachments };
}
```

---

## 9. Edge Cases and Pitfalls

### 9.1 Root Part Number Convention

The root node of `bodyStructure` never has a `part` field. If the root is a single-part text body (not multipart), you download it as part `"1"`. This is an IMAP convention — ImapFlow's `download()` accepts `"1"` for the entire body of a non-multipart message.

```typescript
// Safe: always use node.part ?? '1' for leaf nodes
const partNumber = node.part ?? '1';
```

### 9.2 Servers That Omit Content-Disposition

Some older IMAP servers (and some non-compliant servers) send attachments without a `Content-Disposition` header. In this case, `node.disposition` is `undefined` even for binary file attachments.

The fallback heuristic: if `node.type` is not `text/*` and not `multipart/*`, treat it as an implicit attachment regardless of `disposition`. This is the approach used in imapflow's own `findAttachments()` example in its documentation.

```typescript
const isImplicitAttachment =
    topType !== 'text' &&
    topType !== 'multipart' &&
    node.disposition == null;
```

### 9.3 message/rfc822 Parts (Forwarded Messages)

A forwarded email appears in `bodyStructure` as a child node with `type === 'message/rfc822'`. This node has `childNodes` (the structure of the forwarded message). The entire forwarded message can be downloaded by its part number and then parsed again with postal-mime.

```typescript
function findForwardedMessages(node: MessageStructureNode): string[] {
    const parts: string[] = [];
    if (node.type === 'message/rfc822' && node.part) {
        parts.push(node.part);
    }
    if (node.childNodes) {
        for (const child of node.childNodes) {
            parts.push(...findForwardedMessages(child));
        }
    }
    return parts;
}
```

For the initial wiki ingest implementation, forwarded messages should be treated as an attachment (download and ingest separately). Set `rfc822Attachments: true` in postal-mime options when using the fallback path to treat them as attachments.

### 9.4 Extremely Large Attachments

`client.download()` supports a `maxBytes` option to cap the download:

```typescript
const { meta, content } = await client.download(
    String(uid),
    part,
    { uid: true, maxBytes: 25 * 1024 * 1024 } // 25MB cap
);
```

For the wiki ingest use case, apply this cap to prevent runaway downloads of enormous binary files.

### 9.5 Empty MIME Parts

Some messages have MIME parts with `size: 0`. These should be skipped during download to avoid unnecessary network round-trips:

```typescript
if ((att.size ?? 0) === 0) {
    continue; // Skip empty parts
}
```

### 9.6 Character Encoding in Text Parts

ImapFlow's `download()` automatically converts text parts to UTF-8 based on the `charset` parameter in `node.parameters`. If the charset is absent or unknown, the bytes are returned as-is (typically Latin-1 or ASCII). When using the downloaded buffer as a string, always specify 'utf-8' and accept that some older emails may have encoding issues.

### 9.7 Cannot Run Commands Inside fetch() Loop

This is a critical imapflow constraint: calling `client.download()` inside a `client.fetch()` async iterator loop will cause a deadlock. The solution is to collect UIDs first via `client.search()`, then process each with `client.fetchOne()` and `client.download()` outside the iterator:

```typescript
// WRONG: causes deadlock
for await (const msg of client.fetch('1:*', { bodyStructure: true })) {
    await client.download(msg.uid, '1', { uid: true }); // DEADLOCK
}

// CORRECT: collect UIDs first, then process individually
const uids = await client.search({ seen: false }, { uid: true });
for (const uid of uids) {
    const msg = await client.fetchOne(String(uid), { bodyStructure: true }, { uid: true });
    const { content } = await client.download(String(uid), '1', { uid: true });
    // process...
}
```

### 9.8 postal-mime Instance Reuse

postal-mime instances are single-use. Do not reuse a `new PostalMime()` instance for multiple messages. The static `PostalMime.parse()` method creates a new instance internally and is the recommended approach:

```typescript
// CORRECT: static parse creates a fresh instance each time
const email = await PostalMime.parse(source);

// WRONG: manual instance reuse is not supported
const parser = new PostalMime();
const email1 = await parser.parse(source1); // OK
const email2 = await parser.parse(source2); // Undefined behavior
```

---

## 10. Assumptions and Scope

### 10.1 Assumptions Made

| Assumption | Confidence | Impact if Wrong |
|------------|------------|-----------------|
| ImapFlow decodes RFC 2231 and RFC 2047 filenames automatically via libmime | HIGH | Would need to add manual decoding step using postal-mime's `decodeWords()` |
| `node.part ?? '1'` correctly addresses the root single-part body | HIGH | Root body download would fail; need to use `false` as the part argument |
| `multipart/alternative` always places text/plain before text/html | MEDIUM | findPlainTextPart may return HTML part on some servers; add type check |
| `node.id` contains the full Content-ID with angle brackets | HIGH | `stripAngleBrackets()` would produce incorrect CID matching |
| ImapFlow streaming via `download()` handles all encoding types | HIGH | Some exotic encodings (uuencode) may require postal-mime fallback |
| postal-mime `parse()` accepts Node.js `Buffer` directly | HIGH | Would need `Buffer.from(source).buffer` (ArrayBuffer conversion) |
| `downloadMany()` loads entire parts into memory (no streaming) | HIGH | If wrong, streaming attachments via `downloadMany()` would not be needed |

### 10.2 Uncertainties and Gaps

- **imapflow TypeScript types**: The official `MessageStructureNode` interface could not be read directly from the source (GitHub directory listing returned 404 for `types/index.d.ts`). The interface in Section 2.1 is reconstructed from documentation, search results, and real-world examples. Verify against `node_modules/imapflow/lib/imap-flow.d.ts` after installation.

- **RFC 2231 parameter continuations**: ImapFlow's `libmime` dependency handles RFC 2231 parameter continuations (e.g., `filename*0*=utf-8''cafe; filename*1*=%CC%81.pdf`). However, it was not explicitly confirmed from source code. This is assumed based on `libmime` being a full MIME parameter parser.

- **Server-specific bodyStructure quirks**: Gmail, Yahoo, Dovecot, and Exchange all have known idiosyncrasies in their BODYSTRUCTURE responses. The patterns in this document reflect RFC-compliant behavior; specific server quirks may require additional handling discovered during integration testing.

- **multipart/related root part identification**: RFC 2387 says the root part of `multipart/related` should be specified by a `start` parameter. If present, the root part is not necessarily the first child. The patterns in Section 5 assume the common (but not guaranteed) convention of first-child-is-root.

### 10.3 Clarifying Questions for Follow-up

1. Should inline CID images be saved and ingested into the wiki, or always skipped? The current implementation skips them by default.
2. Is there a maximum attachment size limit for ingestion? The 25MB cap in Section 9.4 is a suggested default.
3. Should forwarded messages (`message/rfc822` parts) be recursively ingested, or treated as a single opaque attachment?
4. When the postal-mime fallback is used (because bodyStructure traversal fails), should the failure be logged as a warning, or silently handled?

---

## 11. References

| # | Source | URL | Information Gathered |
|---|--------|-----|---------------------|
| 1 | ImapFlow Official Docs — Fetching Messages | https://imapflow.com/docs/guides/fetching-messages | bodyStructure fetch options, findAttachments pattern, findPartByType pattern, download/downloadMany API |
| 2 | ImapFlow Official Docs — Fetching Examples | https://imapflow.com/docs/examples/fetching-messages | Complete code examples for attachment download, body extraction, search+fetch pattern |
| 3 | ImapFlow Client API Reference | https://imapflow.com/docs/api/imapflow-client | Constructor options, method signatures, connection management |
| 4 | ImapFlow GitHub README | https://raw.githubusercontent.com/postalsys/imapflow/master/README.md | Library overview, feature list, quick example |
| 5 | postal-mime GitHub README | https://raw.githubusercontent.com/postalsys/postal-mime/master/README.md | Full API reference, Attachment type definition, options, decodeWords utility |
| 6 | Context7 — ImapFlow docs | https://context7.com/postalsys/imapflow/llms.txt | download() API details, fetch() async iterator, fetchOne() examples |
| 7 | Context7 — postal-mime docs | https://context7.com/postalsys/postal-mime/llms.txt | parse() API, TypeScript examples, multipart parsing example |
| 8 | IMAP BODYSTRUCTURE formatted examples | http://sgerwk.altervista.org/imapbodystructure.html | Real-world IMAP BODYSTRUCTURE protocol responses for multipart/related, multipart/alternative |
| 9 | ImapFlow npm page | https://www.npmjs.com/package/imapflow | Package metadata, TypeScript types availability confirmation |
| 10 | RFC 2231 — MIME Parameter Value and Encoded Word Extensions | https://datatracker.ietf.org/doc/html/rfc2231 | RFC 2231 encoding format, asterisk notation, percent-encoded UTF-8 |
| 11 | Medium — Getting Email Content Out of ImapFlow Using Node.js | https://medium.com/@python-javascript-php-html-css/retrieving-email-content-with-node-js-using-imapflow-b8444159dd80 | Practical imapflow usage examples including bodyStructure traversal |
| 12 | Web search — bodyStructure node.id CID inline multipart/related | (aggregated) | node.id field confirmation, CID matching approach, angle bracket stripping |

### Recommended for Deep Reading

- **ImapFlow Fetching Messages guide** (https://imapflow.com/docs/guides/fetching-messages): The canonical reference for all fetch patterns. Contains the official `findAttachments()` and `findPartByType()` examples that are the basis for this document's traversal code.
- **IMAP BODYSTRUCTURE formatted examples** (http://sgerwk.altervista.org/imapbodystructure.html): Shows real raw IMAP protocol responses for complex nested structures including multipart/related with inline CID images. Essential for understanding what imapflow parses.
- **postal-mime README** (https://raw.githubusercontent.com/postalsys/postal-mime/master/README.md): Complete postal-mime API including all TypeScript types, parsing options, and the `decodeWords()` utility for manual RFC 2047 decoding.

---

## Summary of Key Findings

1. **bodyStructure node.type is always the full MIME type string** — `"text/plain"`, `"multipart/mixed"`, etc. There is no separate subtype property. Use `node.type.startsWith('text/')` or `node.type === 'text/plain'` for type checks.

2. **Part numbers are dot-notation strings** — `"1"`, `"1.2"`, `"1.2.1"`. The root node has no `part` field; address it as `"1"` when calling `download()`. Pass the `part` value directly to `client.download(uid, part, { uid: true })`.

3. **Filename decoding is handled by imapflow/postal-mime** — Both RFC 2231 (correct standard) and RFC 2047 (common violation) are decoded automatically. The `dispositionParameters.filename` and `parameters.name` values in the `bodyStructure` object are fully decoded Unicode strings.

4. **inline CID images are identified by `node.id` and `node.disposition === 'inline'`** — The `node.id` value includes angle brackets (e.g., `<abc123@example.com>`). Strip them before comparing to `cid:` URI references in HTML.

5. **`download()` streams decoded content** — ImapFlow automatically decodes base64 and quoted-printable during streaming. The bytes from `content` are the actual binary file data, suitable for direct `fs.createWriteStream()` piping.

6. **The fallback trigger conditions** — Use `PostalMime.parse()` when: (a) no text/plain or text/html part found after traversal; (b) root type is `message/rfc822`; (c) `download()` throws an unexpected error.

7. **postal-mime accepts Node.js Buffer directly** — No conversion needed. `await PostalMime.parse(buffer)` works correctly with a `Buffer` instance returned by `message.source`.

8. **Never call `client.download()` inside `client.fetch()` iterator** — This causes a deadlock. Always collect UIDs first via `client.search()`, then process each with `client.fetchOne()` + `client.download()`.
