# @azure-rest/ai-inference — Error Response Types & Handling

**Research date**: 2026-04-09
**Package version researched**: 1.0.0-beta.6 (latest beta) / core-client-rest 2.5.1
**Sources**: Official GitHub source, Microsoft Learn docs, GitHub issues tracker

---

## Overview

The `@azure-rest/ai-inference` package follows the Azure REST Level Client (RLC) pattern. Unlike traditional SDKs that throw on HTTP errors, **this client never throws on non-2xx responses by default**. Instead, every call returns a response object, and callers are responsible for inspecting it. The `isUnexpected()` function is the primary tool for error detection and TypeScript type narrowing.

---

## Key Concepts

### The REST Level Client Pattern

The client returns a union type for every operation. For chat completions, the resolved type is:

```typescript
GetChatCompletions200Response | GetChatCompletionsDefaultResponse
```

- `GetChatCompletions200Response` — the success branch; `body` is typed as `ChatCompletionsOutput`
- `GetChatCompletionsDefaultResponse` — the error branch; `body` is typed as `ErrorResponse`

Before `isUnexpected()` is called, the TypeScript compiler cannot distinguish which branch you are on, so accessing `response.body.choices` would be a type error. The `isUnexpected()` call acts as a type guard that collapses the union.

---

## 1. `isUnexpected()` — Type Guard Mechanics

### Source definition (from `src/isUnexpected.ts`)

```typescript
// Overload for chat completions
export function isUnexpected(
  response: GetChatCompletions200Response | GetChatCompletionsDefaultResponse,
): response is GetChatCompletionsDefaultResponse;

// Overload for embeddings
export function isUnexpected(
  response: GetEmbeddings200Response | GetEmbeddingsDefaultResponse,
): response is GetEmbeddingsDefaultResponse;

// Overload for image embeddings
export function isUnexpected(
  response: GetImageEmbeddings200Response | GetImageEmbeddingsDefaultResponse,
): response is GetImageEmbeddingsDefaultResponse;

// Overload for model info
export function isUnexpected(
  response: GetModelInfo200Response | GetModelInfoDefaultResponse,
): response is GetModelInfoDefaultResponse;
```

### How it works internally

The function checks `response.status` (a `string`, e.g., `"200"`) against an internal map of known-good status codes per route:

```typescript
const responseMap: Record<string, string[]> = {
  "POST /chat/completions": ["200"],
  "GET /info":              ["200"],
  "POST /embeddings":       ["200"],
  "POST /images/embeddings": ["200"],
};
```

If the response status is **not** in the expected list for the route, `isUnexpected()` returns `true`.

### Type narrowing effect

```typescript
import ModelClient, { isUnexpected } from "@azure-rest/ai-inference";
import type {
  GetChatCompletions200Response,
  GetChatCompletionsDefaultResponse,
} from "@azure-rest/ai-inference";

const response = await client.path("/chat/completions").post({ body: { ... } });

if (isUnexpected(response)) {
  // TypeScript now knows: response is GetChatCompletionsDefaultResponse
  // response.body is ErrorResponse
  // response.body.error is ErrorModel
  console.error(response.body.error.code);    // string
  console.error(response.body.error.message); // string
  return;
}

// TypeScript now knows: response is GetChatCompletions200Response
// response.body is ChatCompletionsOutput
console.log(response.body.choices[0].message.content);
```

---

## 2. Error Body Structure

### `ErrorResponse` (from `@azure-rest/core-client` `src/common.ts`)

```typescript
/** A response containing error details. */
export interface ErrorResponse {
  /** The error object. */
  error: ErrorModel;
}

/** The error object. */
export interface ErrorModel {
  /** One of a server-defined set of error codes. */
  code: string;
  /** A human-readable representation of the error. */
  message: string;
  /** The target of the error. */
  target?: string;
  /** An array of details about specific errors that led to this reported error. */
  details: Array<ErrorModel>;
  /** An object containing more specific information than the current object about the error. */
  innererror?: InnerError;
}

/** Per Microsoft One API guidelines. */
export interface InnerError {
  /** One of a server-defined set of error codes. */
  code: string;
  /** Nested inner error (recursive). */
  innererror?: InnerError;
}
```

### Access pattern after `isUnexpected()` returns `true`

```typescript
if (isUnexpected(response)) {
  const err = response.body.error; // ErrorModel

  console.error("Code:   ", err.code);        // e.g. "content_filter", "parameter_not_supported"
  console.error("Message:", err.message);     // human-readable string
  console.error("Target: ", err.target);      // optional — which field caused the error
  console.error("Details:", err.details);     // Array<ErrorModel> — may be empty array
  if (err.innererror) {
    console.error("Inner code:", err.innererror.code);
  }
}
```

### Example error payloads from the API

**Content filter (HTTP 400):**
```json
{
  "error": {
    "code": "content_filter",
    "message": "The response was filtered",
    "target": "messages",
    "details": []
  }
}
```

**Invalid parameter (HTTP 422):**
```json
{
  "error": {
    "code": "parameter_not_supported",
    "message": "One of the parameters contain invalid values.",
    "target": "body.response_format",
    "details": []
  }
}
```

**Rate limit (HTTP 429):**
```json
{
  "error": {
    "code": "TooManyRequests",
    "message": "Rate limit is exceeded.",
    "details": []
  }
}
```

**Authentication error (HTTP 401):**
```json
{
  "error": {
    "code": "Unauthorized",
    "message": "Access token is invalid or expired.",
    "details": []
  }
}
```

---

## 3. HTTP Status Code Access

### `response.status` is typed as `string`, not `number`

This is a deliberate design of the RLC pattern. **Always compare against string literals.**

```typescript
if (isUnexpected(response)) {
  const status = response.status; // type: string

  // Correct — string comparison
  if (response.status === "429") { /* rate limited */ }
  if (response.status === "401") { /* unauthorized */ }
  if (response.status === "400") { /* bad request */ }

  // WRONG — do not use number comparison
  if (response.status === 429) { /* TypeScript error: string !== number */ }
}
```

### `HttpResponse` base type (from `@azure-rest/core-client` `src/common.ts`)

```typescript
export type HttpResponse = {
  request:  PipelineRequest;  // The originating request
  headers:  RawHttpHeaders;   // Raw response headers (string record)
  body:     unknown;          // Typed by the specific response subtype
  status:   string;           // Always a string, e.g. "200", "429"
};
```

---

## 4. Accessing Response Headers

### Header types on error responses

From `src/responses.ts`, the error response type for chat completions is:

```typescript
export interface GetChatCompletionsDefaultHeaders {
  /** String error code indicating what went wrong. */
  "x-ms-error-code"?: string;
}

export interface GetChatCompletionsDefaultResponse extends HttpResponse {
  status:  string;
  body:    ErrorResponse;
  headers: RawHttpHeaders & GetChatCompletionsDefaultHeaders;
}
```

`RawHttpHeaders` is `Record<string, string>` — all header values are strings.

### Accessing headers

```typescript
if (isUnexpected(response)) {
  // Azure-specific error code header (always present on errors)
  const msErrorCode = response.headers["x-ms-error-code"]; // string | undefined

  // Standard retry header (present on 429 responses)
  const retryAfter = response.headers["retry-after"];       // string | undefined

  // Azure rate limit headers (may also carry retry timing)
  const retryAfterMs = response.headers["retry-after-ms"];  // string | undefined
  const resetTokens  = response.headers["x-ratelimit-reset-tokens"]; // string | undefined
}
```

### Important caveat: `retry-after` header reliability

**Known issue (confirmed in GitHub issue #36988, April 2025):** When using the `@azure/openai` SDK (which wraps this client), the `Retry-After` header is **not consistently surfaced** in the error object's `.catch()` handler. This appears to be a CORS exposure issue in browser environments (`Access-Control-Expose-Headers` must include `Retry-After`).

In **Node.js** environments using `@azure-rest/ai-inference` directly (not the openai wrapper), the header is accessible via `response.headers["retry-after"]`. This is the recommended approach for server-side retry logic.

```typescript
// Safe header access with parsing
function getRetryAfterSeconds(response: GetChatCompletionsDefaultResponse): number | null {
  const raw = response.headers["retry-after"];
  if (!raw) return null;

  // The value may be a delay-seconds integer or an HTTP-date string
  const asNumber = parseInt(raw, 10);
  if (!isNaN(asNumber)) return asNumber;

  // If it's an HTTP date, compute the delta
  const date = new Date(raw);
  if (!isNaN(date.getTime())) {
    return Math.max(0, Math.ceil((date.getTime() - Date.now()) / 1000));
  }

  return null;
}
```

---

## 5. `ChatCompletionsOutput` vs Error Response Types

### `ChatCompletionsOutput` (from `src/outputModels.ts`)

```typescript
export interface ChatCompletionsOutput {
  id:      string;         // Unique completion ID
  created: number;         // Unix timestamp (seconds)
  model:   string;         // Model name used
  choices: Array<ChatChoiceOutput>;
  usage:   CompletionsUsageOutput;
}

export interface ChatChoiceOutput {
  index:         number;
  finish_reason: CompletionsFinishReasonOutput | null; // type alias for string
  message:       ChatResponseMessageOutput;
}

export interface ChatResponseMessageOutput {
  role:        ChatRoleOutput;              // type alias for string: "system"|"user"|"assistant"|"tool"|"developer"
  content:     string | null;
  tool_calls?: Array<ChatCompletionsToolCallOutput>;
}

export interface CompletionsUsageOutput {
  completion_tokens: number;
  prompt_tokens:     number;
  total_tokens:      number;
}
```

### Full type contrast

| Aspect | Success (`200`) | Error (default) |
|--------|-----------------|-----------------|
| TypeScript type | `GetChatCompletions200Response` | `GetChatCompletionsDefaultResponse` |
| `response.status` | `"200"` (literal) | `string` (any non-200) |
| `response.body` type | `ChatCompletionsOutput` | `ErrorResponse` |
| `response.body.choices` | `Array<ChatChoiceOutput>` | Does not exist |
| `response.body.error` | Does not exist | `ErrorModel` |
| `response.headers` | `RawHttpHeaders` | `RawHttpHeaders & GetChatCompletionsDefaultHeaders` |

---

## 6. Practical Error Handling Patterns

### Pattern 1: Basic error check (minimal)

```typescript
import ModelClient, { isUnexpected } from "@azure-rest/ai-inference";
import { AzureKeyCredential } from "@azure/core-auth";

const client = ModelClient(endpoint, new AzureKeyCredential(apiKey));

const response = await client.path("/chat/completions").post({
  body: { messages: [{ role: "user", content: "Hello" }] },
});

if (isUnexpected(response)) {
  // Throw the error object itself — it has .code and .message
  throw response.body.error;
}

const text = response.body.choices[0].message.content;
```

### Pattern 2: Structured error handling by status code

```typescript
import ModelClient, { isUnexpected } from "@azure-rest/ai-inference";
import type { GetChatCompletionsDefaultResponse } from "@azure-rest/ai-inference";

class AzureApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: string,
    public readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = "AzureApiError";
  }
}

function parseAzureError(response: GetChatCompletionsDefaultResponse): AzureApiError {
  const { code, message } = response.body.error;
  const status = response.status;

  let retryAfter: number | null = null;
  const rawRetry = response.headers["retry-after"];
  if (rawRetry) {
    const parsed = parseInt(rawRetry, 10);
    retryAfter = isNaN(parsed) ? null : parsed;
  }

  return new AzureApiError(code, message, status, retryAfter);
}

async function callWithErrorHandling() {
  const response = await client.path("/chat/completions").post({
    body: { messages: [{ role: "user", content: "Hello" }] },
  });

  if (isUnexpected(response)) {
    const err = parseAzureError(response);

    switch (response.status) {
      case "429":
        console.warn(`Rate limited. Retry after ${err.retryAfterSeconds ?? "unknown"} seconds.`);
        throw err;
      case "401":
        console.error("Authentication failed. Check API key.");
        throw err;
      case "400":
        console.error(`Bad request: [${err.code}] ${err.message}`);
        throw err;
      case "500":
      case "503":
        console.error(`Server error (${response.status}): ${err.message}`);
        throw err;
      default:
        console.error(`Unexpected error ${response.status}: ${err.message}`);
        throw err;
    }
  }

  return response.body;
}
```

### Pattern 3: Exponential backoff retry with `retry-after` respect

```typescript
import ModelClient, { isUnexpected } from "@azure-rest/ai-inference";
import type { GetChatCompletionsDefaultResponse } from "@azure-rest/ai-inference";

interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
}

function getRetryDelayMs(
  response: GetChatCompletionsDefaultResponse,
  attempt: number,
  baseDelayMs: number,
): number {
  // Prefer server-specified retry-after
  const rawRetryAfter = response.headers["retry-after"];
  if (rawRetryAfter) {
    const seconds = parseInt(rawRetryAfter, 10);
    if (!isNaN(seconds)) return seconds * 1000;
  }

  // Check millisecond variant
  const rawRetryAfterMs = response.headers["retry-after-ms"];
  if (rawRetryAfterMs) {
    const ms = parseInt(rawRetryAfterMs, 10);
    if (!isNaN(ms)) return ms;
  }

  // Fall back to exponential backoff with jitter
  const exponential = baseDelayMs * Math.pow(2, attempt);
  const jitter = Math.random() * 1000;
  return exponential + jitter;
}

async function callWithRetry(
  client: ReturnType<typeof ModelClient>,
  messages: Array<{ role: string; content: string }>,
  options: RetryOptions = { maxAttempts: 3, baseDelayMs: 1000 },
): Promise<string> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < options.maxAttempts; attempt++) {
    const response = await client.path("/chat/completions").post({
      body: { messages },
    });

    if (!isUnexpected(response)) {
      return response.body.choices[0].message.content ?? "";
    }

    // Only retry on transient errors
    const isRetryable = ["429", "500", "502", "503", "504"].includes(response.status);

    if (!isRetryable || attempt === options.maxAttempts - 1) {
      const err = response.body.error;
      throw new Error(`Azure API error [${err.code}]: ${err.message}`);
    }

    const delayMs = getRetryDelayMs(response, attempt, options.baseDelayMs);
    console.warn(
      `Attempt ${attempt + 1} failed (${response.status}). ` +
      `Retrying in ${Math.round(delayMs)}ms...`
    );
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  throw lastError ?? new Error("Retry attempts exhausted");
}
```

### Pattern 4: Type-safe header access helper

```typescript
import type { GetChatCompletionsDefaultResponse } from "@azure-rest/ai-inference";

/**
 * Extracts all diagnostically useful information from an error response.
 * Safe to call only after isUnexpected() returns true.
 */
function extractErrorDiagnostics(response: GetChatCompletionsDefaultResponse) {
  return {
    // HTTP level
    httpStatus:   response.status,                              // string

    // Azure error envelope
    errorCode:    response.body.error.code,                    // string
    errorMessage: response.body.error.message,                 // string
    errorTarget:  response.body.error.target,                  // string | undefined
    errorDetails: response.body.error.details,                 // Array<ErrorModel>
    innerError:   response.body.error.innererror,              // InnerError | undefined

    // Azure-specific headers
    msErrorCode:  response.headers["x-ms-error-code"],         // string | undefined
    retryAfter:   response.headers["retry-after"],             // string | undefined
    retryAfterMs: response.headers["retry-after-ms"],          // string | undefined
    requestId:    response.headers["x-ms-request-id"],         // string | undefined
  };
}
```

---

## 7. Streaming Responses — Error Handling

For streaming responses (SSE), error detection works differently because the response is consumed as a Node.js stream:

```typescript
import { createSseStream } from "@azure/core-sse";
import type { IncomingMessage } from "node:http";

const response = await client
  .path("/chat/completions")
  .post({ body: { messages, stream: true, max_tokens: 128 } })
  .asNodeStream();

// For streaming, check status directly (isUnexpected is not applicable here)
if (response.status !== "200") {
  // The body is a stream — read it to get the error JSON
  throw new Error(`Stream request failed with status ${response.status}`);
}

if (!response.body) {
  throw new Error("Response stream is undefined");
}

const sses = createSseStream(response.body as IncomingMessage);
for await (const event of sses) {
  if (event.data === "[DONE]") break;
  const chunk = JSON.parse(event.data);
  process.stdout.write(chunk.choices[0]?.delta?.content ?? "");
}
```

---

## 8. Common Error Codes Reference

| HTTP Status | Error Code | Description |
|-------------|-----------|-------------|
| 400 | `content_filter` | Response filtered by content policy |
| 400 | `invalid_request` | Malformed request body |
| 401 | `Unauthorized` | API key missing or invalid |
| 403 | `Forbidden` | Insufficient permissions |
| 404 | `ResourceNotFound` | Endpoint or model not found |
| 422 | `parameter_not_supported` | Parameter value is invalid |
| 429 | `TooManyRequests` | Rate limit exceeded |
| 500 | `InternalServerError` | Server-side failure |
| 503 | `ServiceUnavailable` | Service temporarily down |

---

## Assumptions & Scope

### Interpretations made

| Assumption | Confidence | Impact if Wrong |
|------------|------------|-----------------|
| Research targets `@azure-rest/ai-inference` (REST Level Client), not `@azure/openai` (higher-level SDK) | HIGH | The `@azure/openai` SDK throws `RestError` on errors and has different type patterns entirely |
| `retry-after` header research covers Node.js server-side usage, not browser | HIGH | Browser environments may not expose this header due to CORS restrictions |
| Types sourced from `main` branch (1.0.0-beta.6 era) are current | MEDIUM | Package is still in beta; types may change in stable release |
| `ErrorModel.details` is always present (not optional) per source definition | HIGH | The source shows `details: Array<ErrorModel>` without `?`, but the array may be empty |

### What is explicitly excluded

- The `@azure/openai` SDK (different package, throws `RestError`, different error shape)
- The Azure OpenAI service REST API directly (different endpoint structure)
- Python SDK (`azure-ai-inference`) — different language
- Browser-specific CORS header issues beyond the documented caveat

### Uncertainties & Gaps

- **`retry-after` in error `body`**: The error body JSON from the API does not include a `retry_after` field; it is only available as an HTTP header. This is confirmed by the `ErrorModel` type definition.
- **`x-ms-error-code` header vs `body.error.code`**: These may carry the same value or differ. The header (`x-ms-error-code`) is a string error code set by Azure infrastructure; the body `code` is set by the model service. No official documentation clarifies whether they always match.
- **Stable release type stability**: The package is `1.0.0-beta.6`. The `ErrorResponse` interface comes from `@azure-rest/core-client` which is stable (`2.5.1`), making the error types more reliable than the inference-specific types.

### Clarifying Questions for Follow-up

1. Will the Wiki CLI need to handle streaming responses, or only non-streaming (`/chat/completions` without `stream: true`)?
2. Should retry logic live inside the provider class or be delegated to the caller?
3. Is browser environment support required? (Affects `retry-after` header availability)
4. Should the error handling distinguish between the Azure AI Foundry endpoint and GitHub Models endpoint? (Both use `@azure-rest/ai-inference` but may return different error payloads.)

---

## References

| Source | URL | Information Gathered |
|--------|-----|---------------------|
| `isUnexpected.ts` — GitHub source | https://github.com/Azure/azure-sdk-for-js/blob/main/sdk/ai/ai-inference-rest/src/isUnexpected.ts | Exact overload signatures, internal logic, responseMap |
| `responses.ts` — GitHub source | https://github.com/Azure/azure-sdk-for-js/blob/main/sdk/ai/ai-inference-rest/src/responses.ts | `GetChatCompletions200Response`, `GetChatCompletionsDefaultResponse`, header interfaces |
| `outputModels.ts` — GitHub source | https://github.com/Azure/azure-sdk-for-js/blob/main/sdk/ai/ai-inference-rest/src/outputModels.ts | `ChatCompletionsOutput`, `ChatChoiceOutput`, `ChatResponseMessageOutput`, `CompletionsUsageOutput` |
| `common.ts` (`@azure-rest/core-client`) — GitHub source | https://github.com/Azure/azure-sdk-for-js/blob/main/sdk/core/core-client-rest/src/common.ts | `ErrorResponse`, `ErrorModel`, `InnerError`, `HttpResponse` (status as string) |
| Microsoft Learn — ai-inference README | https://learn.microsoft.com/en-us/javascript/api/overview/azure/ai-inference-rest-readme?view=azure-node-preview | Official usage examples, `isUnexpected` basic pattern |
| GitHub Issue #36988 — Retry-After header | https://github.com/Azure/azure-sdk-for-js/issues/36988 | `retry-after` header behavior in 429 responses, browser CORS issue |
| npm — @azure-rest/ai-inference | https://www.npmjs.com/package/@azure-rest/ai-inference | Package metadata, version history |
| npm — @azure-rest/core-client | https://www.npmjs.com/package/@azure-rest/core-client | Core client package version (2.5.1) |
| Microsoft Learn — ErrorResponse interface | https://learn.microsoft.com/en-us/javascript/api/@azure-rest/core-client/errorresponse?view=azure-node-latest | Official docs for error interface |
| Azure SDK TypeScript Guidelines | https://azure.github.io/azure-sdk/typescript_design.html | RLC pattern design rationale |
