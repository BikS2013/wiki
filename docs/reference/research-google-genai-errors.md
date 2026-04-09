# @google/genai Error Handling Reference

## Overview

The `@google/genai` npm package (SDK version 1.49.0 at time of research) is the current
Google-maintained TypeScript/JavaScript SDK for Gemini and Vertex AI. It replaces the
deprecated `@google/generative-ai` package.

This document covers everything needed to classify errors for retry logic: error class
hierarchy, available properties (including HTTP status codes), how to distinguish between
error categories, and TypeScript code patterns for robust retry classification.

---

## Key Concepts

### Single Public Error Class

The JavaScript/TypeScript SDK exposes **one** public error class: `ApiError`.

Unlike the Python SDK (`python-genai`) which defines `APIError`, `ClientError`, and
`ServerError` as distinct classes, the JS/TS SDK uses only `ApiError` for all HTTP-level
errors. There is no `ClientError` or `ServerError` export in `@google/genai` for TypeScript.

> **Important**: Web search results and community discussions often conflate the Python
> SDK error class names (`ClientError`, `ServerError`) with the TypeScript SDK. Do not use
> these class names for `instanceof` checks in TypeScript — they do not exist in the JS/TS
> package.

### The `throwErrorIfNotOK` Internal Function

Internally, the SDK's `_api_client.ts` contains a `throwErrorIfNotOK` function that runs
after every HTTP response. It inspects the response status and throws an `ApiError` for
any response with HTTP status codes in the range 400–599.

---

## Error Class: `ApiError`

### Source Definition

File: `src/errors.ts` in the `googleapis/js-genai` repository.

```typescript
export interface ApiErrorInfo {
  /** The error message. */
  message: string;
  /** The HTTP status code. */
  status: number;
}

export class ApiError extends Error {
  /** HTTP status code */
  status: number;

  constructor(options: ApiErrorInfo) {
    super(options.message);
    this.name = 'ApiError';
    this.status = options.status;
    Object.setPrototypeOf(this, ApiError.prototype);
  }
}
```

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `name` | `string` | Always `'ApiError'` |
| `message` | `string` | JSON-stringified error body from the API |
| `status` | `number` | HTTP status code (e.g. 400, 401, 403, 429, 500, 503) |
| `stack` | `string \| undefined` | Standard Error stack trace |

### How `status` Is Populated

The `throwErrorIfNotOK` function sets `status` directly from `response.status` (the HTTP
status code of the fetch response). For streaming responses, a parallel code path in
`processStreamResponse` reads `errorJson['code']` from the JSON chunk. Both paths produce
a numeric HTTP status code on `ApiError.status`.

```typescript
// From _api_client.ts (simplified)
async function throwErrorIfNotOK(response: Response | undefined) {
  if (!response.ok) {
    const status: number = response.status;
    let errorBody: Record<string, unknown>;

    if (response.headers.get('content-type')?.includes('application/json')) {
      errorBody = await response.json();
    } else {
      errorBody = {
        error: {
          message: await response.text(),
          code: response.status,
          status: response.statusText,
        },
      };
    }

    const errorMessage = JSON.stringify(errorBody);
    if (status >= 400 && status < 600) {
      throw new ApiError({ message: errorMessage, status: status });
    }
    throw new Error(errorMessage);
  }
}
```

### The `message` Field Format

The `message` is a JSON-stringified version of the raw API error body. For JSON responses
from the API, it looks like:

```json
"{\"error\":{\"code\":429,\"message\":\"You exceeded your current quota...\",\"status\":\"RESOURCE_EXHAUSTED\"}}"
```

To extract the Google API status string (e.g. `"RESOURCE_EXHAUSTED"`) you must parse
`error.message` as JSON.

---

## HTTP Status Code Mapping

### Error Categories

| HTTP Range | Category | When It Occurs |
|------------|----------|----------------|
| 4xx | Client errors | Bad request, auth failure, quota exceeded |
| 5xx | Server errors | Internal server error, service unavailable |

### Specific Status Codes

| HTTP Code | Google Status String | Meaning | Retry? |
|-----------|---------------------|---------|--------|
| 400 | `INVALID_ARGUMENT` | Malformed request, missing fields, bad parameters | No |
| 400 | `FAILED_PRECONDITION` | Free tier not available in region, billing not enabled | No |
| 401 | *(auth error)* | API key not accepted, OAuth required | No |
| 403 | `PERMISSION_DENIED` | API key lacks permissions, wrong key for tuned model | No |
| 404 | `NOT_FOUND` | Model not found, resource not found | No |
| 408 | *(timeout)* | Request timeout | Yes |
| 429 | `RESOURCE_EXHAUSTED` | Rate limit exceeded, quota exceeded | Yes (with backoff) |
| 500 | `INTERNAL` | Internal server error | Yes (with backoff) |
| 502 | *(gateway)* | Bad gateway | Yes |
| 503 | `UNAVAILABLE` | Service temporarily overloaded or down | Yes |
| 504 | `DEADLINE_EXCEEDED` | Processing deadline exceeded, context too large | Yes (with backoff) |

### SDK Default Retry Status Codes

The SDK's built-in retry mechanism (via `p-retry`) uses this exact list:

```typescript
const DEFAULT_RETRY_HTTP_STATUS_CODES = [
  408, // Request timeout
  429, // Too many requests
  500, // Internal server error
  502, // Bad gateway
  503, // Service unavailable
  504, // Gateway timeout
];
```

This list is defined in `src/_api_client.ts` and is synchronized with the Python SDK
(comment in source: `// LINT.ThenChange(//depot/google3/third_party/py/google/genai/_api_client.py)`).

---

## Quota Exceeded vs. Rate Limit

Both quota exhaustion and rate limiting produce HTTP **429** with Google status string
`RESOURCE_EXHAUSTED`. The distinction is in the error message text within the JSON body:

- **Rate limit (RPM/TPM)**: `"You are sending too many requests per minute"`
- **Quota exhaustion**: `"You exceeded your current quota, please check your plan and billing details."`

To distinguish them you must parse `error.message` and inspect the nested JSON. There is
no separate error class or distinct property for quota vs. rate limit in the JS/TS SDK.

---

## Error Shape Examples

### 429 RESOURCE_EXHAUSTED (Rate Limit / Quota)

```
ApiError.name    = 'ApiError'
ApiError.status  = 429
ApiError.message = '{"error":{"code":429,"message":"You exceeded your current quota, please check your plan and billing details.","status":"RESOURCE_EXHAUSTED"}}'
```

### 401 Unauthorized (Auth Failure)

```
ApiError.name    = 'ApiError'
ApiError.status  = 401
ApiError.message = '{"error":{"code":401,"message":"API keys are not supported by this API. Expected OAuth2 access token or other authentication credentials that assert a principal.","status":"UNAUTHENTICATED"}}'
```

### 403 PERMISSION_DENIED

```
ApiError.name    = 'ApiError'
ApiError.status  = 403
ApiError.message = '{"error":{"code":403,"message":"Your API key doesn\'t have the required permissions.","status":"PERMISSION_DENIED"}}'
```

### 400 INVALID_ARGUMENT

```
ApiError.name    = 'ApiError'
ApiError.status  = 400
ApiError.message = '{"error":{"code":400,"message":"Tool use with function calling is unsupported","status":"INVALID_ARGUMENT"}}'
```

### 500 INTERNAL

```
ApiError.name    = 'ApiError'
ApiError.status  = 500
ApiError.message = '{"error":{"code":500,"message":"An internal error has occurred. Please retry or report in https://developers.generativeai.google/guide/troubleshooting","status":"INTERNAL"}}'
```

### 503 UNAVAILABLE

```
ApiError.name    = 'ApiError'
ApiError.status  = 503
ApiError.message = '{"error":{"code":503,"message":"The service may be temporarily overloaded or down.","status":"UNAVAILABLE"}}'
```

### Non-JSON Response (e.g. network-level "Not Found")

```
ApiError.name    = 'ApiError'
ApiError.status  = 404
ApiError.message = '{"error":{"code":"http_error","message":"Not Found"}}'
```

Note: In this case `code` is the string `"http_error"` rather than a number — this is a
known SDK behavior for non-JSON API responses.

---

## TypeScript Usage Examples

### Basic Error Handling

```typescript
import { GoogleGenAI, ApiError } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

try {
  const result = await ai.models.generateContent({
    model: 'gemini-2.0-flash',
    contents: 'Hello',
  });
} catch (e) {
  if (e instanceof ApiError) {
    console.error('API error name:', e.name);      // 'ApiError'
    console.error('HTTP status:', e.status);        // e.g. 429
    console.error('Message:', e.message);           // JSON string
  } else {
    throw e; // Re-throw non-API errors
  }
}
```

### Error Classification Helper

This utility parses the error and returns a structured classification suitable for
retry logic decisions.

```typescript
import { ApiError } from '@google/genai';

export type ErrorCategory =
  | 'rate_limit'
  | 'quota_exceeded'
  | 'auth_error'
  | 'permission_denied'
  | 'invalid_request'
  | 'not_found'
  | 'server_error'
  | 'timeout'
  | 'unavailable'
  | 'unknown';

export interface ClassifiedError {
  category: ErrorCategory;
  httpStatus: number;
  googleStatus: string | null;
  retryable: boolean;
  originalError: ApiError;
}

function parseGoogleStatus(message: string): string | null {
  try {
    const body = JSON.parse(message) as Record<string, unknown>;
    const error = body['error'] as Record<string, unknown> | undefined;
    if (error && typeof error['status'] === 'string') {
      return error['status'];
    }
  } catch {
    // message is not valid JSON
  }
  return null;
}

export function classifyApiError(error: ApiError): ClassifiedError {
  const status = error.status;
  const googleStatus = parseGoogleStatus(error.message);

  // Non-retryable client errors
  if (status === 400) {
    return {
      category: 'invalid_request',
      httpStatus: status,
      googleStatus,
      retryable: false,
      originalError: error,
    };
  }

  if (status === 401) {
    return {
      category: 'auth_error',
      httpStatus: status,
      googleStatus,
      retryable: false,
      originalError: error,
    };
  }

  if (status === 403) {
    return {
      category: 'permission_denied',
      httpStatus: status,
      googleStatus,
      retryable: false,
      originalError: error,
    };
  }

  if (status === 404) {
    return {
      category: 'not_found',
      httpStatus: status,
      googleStatus,
      retryable: false,
      originalError: error,
    };
  }

  // Retryable: rate limit and quota
  if (status === 429) {
    // Both rate limiting and quota exhaustion return 429 RESOURCE_EXHAUSTED.
    // Distinguish by message text if needed:
    const isQuota =
      error.message.includes('quota') ||
      error.message.includes('billing') ||
      error.message.includes('plan');

    return {
      category: isQuota ? 'quota_exceeded' : 'rate_limit',
      httpStatus: status,
      googleStatus,
      retryable: true,
      originalError: error,
    };
  }

  // Retryable: timeout
  if (status === 408) {
    return {
      category: 'timeout',
      httpStatus: status,
      googleStatus,
      retryable: true,
      originalError: error,
    };
  }

  // Retryable: server errors
  if (status === 503) {
    return {
      category: 'unavailable',
      httpStatus: status,
      googleStatus,
      retryable: true,
      originalError: error,
    };
  }

  if (status === 500 || status === 502 || status === 504) {
    return {
      category: 'server_error',
      httpStatus: status,
      googleStatus,
      retryable: true,
      originalError: error,
    };
  }

  return {
    category: 'unknown',
    httpStatus: status,
    googleStatus,
    retryable: false,
    originalError: error,
  };
}
```

### Retry Logic with Exponential Backoff

```typescript
import { GoogleGenAI, ApiError } from '@google/genai';
import { classifyApiError } from './error-classifier';

const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitter: boolean;
}

const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxAttempts: 5,
  baseDelayMs: 1000,
  maxDelayMs: 60000,
  jitter: true,
};

function calculateBackoffDelay(
  attempt: number,
  options: RetryOptions,
): number {
  const exponential = options.baseDelayMs * Math.pow(2, attempt);
  const capped = Math.min(exponential, options.maxDelayMs);
  if (!options.jitter) return capped;
  // Full jitter: random delay between 0 and the capped exponential
  return Math.random() * capped;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = DEFAULT_RETRY_OPTIONS,
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < options.maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof ApiError)) {
        // Non-API errors (network failure, etc.) are not retried
        throw error;
      }

      const classified = classifyApiError(error);
      lastError = error;

      if (!classified.retryable) {
        // Auth errors, permission denied, invalid requests — do not retry
        throw error;
      }

      if (attempt < options.maxAttempts - 1) {
        const delayMs = calculateBackoffDelay(attempt, options);
        console.warn(
          `Attempt ${attempt + 1} failed with ${classified.httpStatus} ` +
          `(${classified.category}). Retrying in ${Math.round(delayMs)}ms...`,
        );
        await sleep(delayMs);
      }
    }
  }

  throw lastError ?? new Error('All retry attempts exhausted');
}

// Usage example
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const result = await withRetry(() =>
  ai.models.generateContent({
    model: 'gemini-2.0-flash',
    contents: 'Summarize this document...',
  })
);
```

### Checking Error Type with `instanceof`

```typescript
import { ApiError } from '@google/genai';

function handleError(error: unknown): void {
  if (error instanceof ApiError) {
    // HTTP-level API error — has .status and .message
    const isRateLimit = error.status === 429;
    const isAuthFailure = error.status === 401 || error.status === 403;
    const isServerError = error.status >= 500;
    const isClientError = error.status >= 400 && error.status < 500;
    // ...
  } else if (error instanceof Error) {
    // Generic JS error (e.g. network failure, timeout abort)
    // error.message may contain details
  }
}
```

### Type Guard Function

```typescript
import { ApiError } from '@google/genai';

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function isRetryableApiError(error: unknown): boolean {
  if (!isApiError(error)) return false;
  return [408, 429, 500, 502, 503, 504].includes(error.status);
}

export function isAuthError(error: unknown): boolean {
  if (!isApiError(error)) return false;
  return error.status === 401 || error.status === 403;
}

export function isRateLimitError(error: unknown): boolean {
  if (!isApiError(error)) return false;
  return error.status === 429;
}
```

---

## SDK Built-in Retry Configuration

The SDK has its own built-in retry mechanism using `p-retry`. To enable it, pass
`retryOptions` in `httpOptions` when constructing the client:

```typescript
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    retryOptions: {
      attempts: 3, // Total attempts including the initial call
    },
  },
});
```

The SDK's built-in retry uses the same retryable status codes listed above (408, 429, 500,
502, 503, 504). It does **not** apply exponential backoff — it uses `p-retry` defaults.
For production use cases requiring controlled backoff and jitter, implement custom retry
logic as shown above instead of relying solely on the built-in option.

---

## Python SDK Comparison (for Reference)

The Python `google-genai` SDK (`python-genai`) defines a richer error hierarchy:

| Python Class | JS/TS Equivalent | When Thrown |
|--------------|-----------------|-------------|
| `APIError` | `ApiError` | Base class |
| `ClientError` | `ApiError` (status 400-499) | 4xx HTTP responses |
| `ServerError` | `ApiError` (status 500-599) | 5xx HTTP responses |

In the Python SDK, `error.code` is the numeric HTTP status code, `error.status` is the
Google status string (e.g. `"RESOURCE_EXHAUSTED"`), and `error.message` is the human-
readable message.

In the JS/TS SDK, `error.status` is the numeric HTTP code and `error.message` contains
the entire JSON body as a string — the Google status string must be extracted by parsing
`error.message`.

---

## Common Pitfalls

### 1. Expecting `ClientError` or `ServerError` Classes

Do not write `error instanceof ClientError` in TypeScript. These classes do not exist in
the JS/TS SDK exports. Use `error instanceof ApiError` combined with `error.status` range
checks.

### 2. Treating `error.message` as Plain Text

`error.message` is a JSON string. To extract the Google API status string or the inner
message text, parse it:

```typescript
function extractGoogleApiMessage(apiError: ApiError): string {
  try {
    const body = JSON.parse(apiError.message) as {
      error?: { message?: string };
    };
    return body.error?.message ?? apiError.message;
  } catch {
    return apiError.message;
  }
}
```

### 3. Retrying 429 Without Respecting `Retry-After`

The Gemini API may return a `Retry-After` header on 429 responses. The SDK does not
expose response headers on `ApiError`. If precise rate-limit window compliance is needed,
you must intercept at the fetch level or accept that exponential backoff with jitter
approximates the requirement adequately.

### 4. Conflating 429 Rate Limit with 429 Quota Exhaustion

Both conditions return HTTP 429. Rate limits reset within minutes (per-minute or per-day
limits). Quota exhaustion requires billing plan changes and will not resolve with retries.
Inspect the message text to distinguish them if quota exhaustion should trigger alerting
rather than retries.

### 5. Not Importing `ApiError` for `instanceof` Checks

`instanceof` only works when the same class reference is used. Always import `ApiError`
directly from `@google/genai`:

```typescript
import { ApiError } from '@google/genai'; // Correct
```

Do not rely on `error.name === 'ApiError'` as the sole check — it works for duck-typing
but `instanceof` is more reliable for TypeScript type narrowing.

---

## Assumptions & Scope

### Interpretations Made

| Assumption | Confidence | Impact if Wrong |
|------------|------------|-----------------|
| `ClientError` and `ServerError` do not exist as exported JS/TS classes | HIGH | Code using `instanceof ClientError` would break at runtime |
| `error.status` is always a numeric HTTP code | HIGH | Classification by status range would be unreliable |
| The message format is JSON-stringified error body | HIGH | Parsing logic for Google status strings would fail |
| SDK version 1.49.0 is current at time of research | HIGH | API surface may evolve in future versions |
| 429 for quota vs. rate-limit distinguished by message text only | MEDIUM | Google may add distinct error codes in future |

### What Is Explicitly Out of Scope

- WebSocket / Live API error codes (different mechanism via close codes)
- Vertex AI-specific quota systems (different from Gemini API quotas)
- Client-side validation errors thrown before any HTTP call is made
- `p-retry` configuration details beyond what is relevant to custom retry logic

### Uncertainties and Gaps

- **`Retry-After` header**: It is unclear if the Gemini API reliably sends this header on
  429 responses; the SDK does not expose it on `ApiError`.
- **Future `ClientError`/`ServerError` in JS SDK**: The Python SDK has them; the JS SDK
  may add them in a future version. Watch the `src/errors.ts` file for changes.
- **Non-JSON 404 message format**: Issue #1204 showed `code: "http_error"` (a string)
  rather than a number for some network-level errors. This edge case may affect numeric
  status comparisons if the message is parsed.

---

## References

| # | Source | URL | Information Gathered |
|---|--------|-----|---------------------|
| 1 | js-genai GitHub — errors.ts | https://github.com/googleapis/js-genai/blob/main/src/errors.ts | `ApiError` class definition, `ApiErrorInfo` interface, property types |
| 2 | js-genai GitHub — _api_client.ts | https://github.com/googleapis/js-genai/blob/main/src/_api_client.ts | `throwErrorIfNotOK` implementation, `DEFAULT_RETRY_HTTP_STATUS_CODES`, retry logic |
| 3 | js-genai README | https://github.com/googleapis/js-genai/blob/main/README.md | Official error handling example using `e.name`, `e.message`, `e.status` |
| 4 | js-genai API Report | https://github.com/googleapis/js-genai/blob/main/api-report/genai-node.api.md | Public API surface confirmation: only `ApiError` and `ApiErrorInfo` exported |
| 5 | python-genai errors.py | https://github.com/googleapis/python-genai/blob/main/google/genai/errors.py | `ClientError`, `ServerError` subclass definitions; status-based dispatch logic |
| 6 | Gemini API Troubleshooting | https://ai.google.dev/gemini-api/docs/troubleshooting | Official HTTP status code table: 400-504, Google status strings, descriptions |
| 7 | npm @google/genai | https://www.npmjs.com/package/@google/genai | Package version (1.49.0), installation, ecosystem context |
| 8 | GitHub Issue #1204 | https://github.com/googleapis/js-genai/issues/1204 | `ApiError` with `code: "http_error"` (string) for non-JSON 404 responses |
| 9 | GitHub Issue #1058 | https://github.com/googleapis/js-genai/issues/1058 | `ApiError` shape for 500 INTERNAL from throwErrorIfNotOK |
| 10 | GitHub Issue #426 | https://github.com/googleapis/js-genai/issues/426 | `ApiError` shape for 401 Unauthorized from Vertex AI |
| 11 | Context7 — js-genai docs | https://github.com/googleapis/js-genai | `ApiError` has `.name`, `.message`, `.status`; `HttpRetryOptions` interface |

### Recommended for Deep Reading

- **`src/errors.ts`** (source #1): The definitive class definition. Short file, worth reading directly to track future changes.
- **`src/_api_client.ts`** (source #2): Contains `throwErrorIfNotOK`, `processStreamResponse` error path, and `DEFAULT_RETRY_HTTP_STATUS_CODES` — all critical for understanding exactly when and how errors are thrown.
- **Gemini API Troubleshooting page** (source #6): Official status code table with human-readable descriptions and recommended solutions.
