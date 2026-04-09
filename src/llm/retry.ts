// src/llm/retry.ts -- Provider-agnostic retry wrapper with exponential backoff for transient LLM errors

/**
 * Options for controlling retry behaviour.
 */
export interface RetryOptions {
  /** Maximum number of retry attempts. Default: 3 */
  maxRetries: number;
  /** Initial delay in milliseconds before the first retry. Default: 1000 */
  initialDelayMs: number;
  /** Maximum delay cap in milliseconds. Default: 30000 */
  maxDelayMs: number;
  /** Multiplier applied to the delay after each attempt. Default: 2 */
  backoffFactor: number;
}

const DEFAULT_OPTIONS: RetryOptions = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffFactor: 2,
};

/** HTTP status codes that should be retried with backoff */
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

/** HTTP status codes that indicate non-retryable client errors */
const FAIL_FAST_STATUS_CODES = new Set([400, 401, 403]);

/**
 * Extract an HTTP status code from an error object using duck-typing.
 * Works across Anthropic SDK, Google GenAI ApiError, Azure SDK, and others.
 *
 * Checks (in order):
 *   - error.status (Anthropic APIError, Google GenAI ApiError)
 *   - error.statusCode (some SDKs)
 *   - error.response?.status (Axios-style errors)
 *
 * Returns null if no HTTP status can be determined.
 */
export function getHttpStatus(error: unknown): number | null {
  if (error == null || typeof error !== 'object') {
    return null;
  }

  const err = error as Record<string, unknown>;

  // error.status (Anthropic, Google GenAI)
  if (typeof err.status === 'number' && err.status >= 100 && err.status < 600) {
    return err.status;
  }

  // error.statusCode (some SDKs)
  if (typeof err.statusCode === 'number' && err.statusCode >= 100 && err.statusCode < 600) {
    return err.statusCode;
  }

  // error.response?.status (Axios-style)
  if (err.response != null && typeof err.response === 'object') {
    const resp = err.response as Record<string, unknown>;
    if (typeof resp.status === 'number' && resp.status >= 100 && resp.status < 600) {
      return resp.status;
    }
  }

  return null;
}

/**
 * Extract the Retry-After delay (in milliseconds) from an error's headers.
 * Supports both seconds-based and date-based Retry-After values.
 *
 * Returns null if no valid Retry-After header is found.
 */
export function getRetryAfterMs(error: unknown): number | null {
  if (error == null || typeof error !== 'object') {
    return null;
  }

  const err = error as Record<string, unknown>;

  // Check error.headers?.['retry-after']
  if (err.headers != null && typeof err.headers === 'object') {
    const headers = err.headers as Record<string, unknown>;
    const retryAfter = headers['retry-after'];

    if (typeof retryAfter === 'string') {
      // Try parsing as seconds first
      const seconds = parseFloat(retryAfter);
      if (!isNaN(seconds) && seconds > 0) {
        return Math.ceil(seconds * 1000);
      }

      // Try parsing as HTTP-date
      const date = new Date(retryAfter);
      if (!isNaN(date.getTime())) {
        const delayMs = date.getTime() - Date.now();
        return delayMs > 0 ? delayMs : null;
      }
    }

    if (typeof retryAfter === 'number' && retryAfter > 0) {
      return Math.ceil(retryAfter * 1000);
    }
  }

  return null;
}

/**
 * Execute an async function with automatic retry for transient errors.
 * Provider-agnostic: uses duck-typed HTTP status extraction to classify errors.
 *
 * Retryable errors (with exponential backoff):
 *   - 429 Rate Limit -- respects Retry-After header when present
 *   - 500, 502, 503, 504 Server errors
 *
 * Non-retryable (fail fast):
 *   - 400 Bad Request
 *   - 401 Unauthorized
 *   - 403 Forbidden
 *   - Unknown status or non-HTTP errors
 */
export async function callWithRetry<T>(
  fn: () => Promise<T>,
  maxRetries?: number,
): Promise<T> {
  const opts: RetryOptions = {
    ...DEFAULT_OPTIONS,
    ...(maxRetries !== undefined ? { maxRetries } : {}),
  };

  for (let attempt = 1; attempt <= opts.maxRetries + 1; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      const status = getHttpStatus(error);

      // Fail fast for known non-retryable status codes
      if (status !== null && FAIL_FAST_STATUS_CODES.has(status)) {
        throw error;
      }

      // Retry for known retryable status codes
      if (status !== null && RETRYABLE_STATUS_CODES.has(status)) {
        if (attempt > opts.maxRetries) {
          throw error;
        }

        // For 429, respect Retry-After header if present
        const retryAfterMs = status === 429 ? getRetryAfterMs(error) : null;
        const backoffDelay = Math.min(
          opts.initialDelayMs * Math.pow(opts.backoffFactor, attempt),
          opts.maxDelayMs,
        );
        const delay = retryAfterMs !== null
          ? Math.min(retryAfterMs, opts.maxDelayMs)
          : backoffDelay;

        await sleep(delay);
        continue;
      }

      // Unknown status or non-HTTP error -- fail fast
      throw error;
    }
  }

  // This line should be unreachable, but TypeScript needs it
  throw new Error('Max retries exceeded');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
