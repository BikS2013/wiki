// test_scripts/test-retry.ts -- Tests for llm/retry.ts

import { describe, it } from 'node:test';
import assert from 'node:assert';

import { callWithRetry, getHttpStatus, getRetryAfterMs } from '../src/llm/retry.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create an Error with a numeric .status property (mimics SDK errors). */
function httpError(status: number, message?: string): Error {
  const err = new Error(message ?? `HTTP ${status}`);
  (err as any).status = status;
  return err;
}

// ---------------------------------------------------------------------------
// getHttpStatus
// ---------------------------------------------------------------------------

describe('getHttpStatus', () => {
  it('extracts .status from error object', () => {
    assert.strictEqual(getHttpStatus(httpError(429)), 429);
  });

  it('extracts .statusCode from error object', () => {
    const err = new Error('fail');
    (err as any).statusCode = 503;
    assert.strictEqual(getHttpStatus(err), 503);
  });

  it('extracts .response.status (Axios-style)', () => {
    const err = new Error('fail');
    (err as any).response = { status: 500 };
    assert.strictEqual(getHttpStatus(err), 500);
  });

  it('returns null for non-object', () => {
    assert.strictEqual(getHttpStatus(null), null);
    assert.strictEqual(getHttpStatus('string'), null);
    assert.strictEqual(getHttpStatus(42), null);
  });

  it('returns null for error without status', () => {
    assert.strictEqual(getHttpStatus(new Error('no status')), null);
  });
});

// ---------------------------------------------------------------------------
// getRetryAfterMs
// ---------------------------------------------------------------------------

describe('getRetryAfterMs', () => {
  it('parses seconds-based Retry-After header', () => {
    const err = new Error('rate limited');
    (err as any).headers = { 'retry-after': '2' };
    const ms = getRetryAfterMs(err);
    assert.strictEqual(ms, 2000);
  });

  it('parses numeric Retry-After header', () => {
    const err = new Error('rate limited');
    (err as any).headers = { 'retry-after': 5 };
    const ms = getRetryAfterMs(err);
    assert.strictEqual(ms, 5000);
  });

  it('returns null when no headers', () => {
    assert.strictEqual(getRetryAfterMs(new Error('no headers')), null);
  });

  it('returns null for non-object', () => {
    assert.strictEqual(getRetryAfterMs(null), null);
  });
});

// ---------------------------------------------------------------------------
// callWithRetry
// ---------------------------------------------------------------------------

describe('callWithRetry', () => {
  it('succeeds on first try without retrying', async () => {
    let callCount = 0;
    const result = await callWithRetry(async () => {
      callCount++;
      return 'ok';
    });
    assert.strictEqual(result, 'ok');
    assert.strictEqual(callCount, 1);
  });

  it('retries on 429 (rate limit) and eventually succeeds', async () => {
    let callCount = 0;
    const result = await callWithRetry(async () => {
      callCount++;
      if (callCount < 3) {
        throw httpError(429, 'Rate limited');
      }
      return 'recovered';
    }, 3);
    assert.strictEqual(result, 'recovered');
    assert.strictEqual(callCount, 3);
  });

  it('retries on 500 (server error) and eventually succeeds', async () => {
    let callCount = 0;
    const result = await callWithRetry(async () => {
      callCount++;
      if (callCount < 2) {
        throw httpError(500, 'Internal Server Error');
      }
      return 'recovered';
    }, 3);
    assert.strictEqual(result, 'recovered');
    assert.strictEqual(callCount, 2);
  });

  it('fails fast on 401 (unauthorized) without retrying', async () => {
    let callCount = 0;
    await assert.rejects(
      callWithRetry(async () => {
        callCount++;
        throw httpError(401, 'Unauthorized');
      }, 3),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.strictEqual((err as any).status, 401);
        return true;
      },
    );
    assert.strictEqual(callCount, 1);
  });

  it('fails fast on 400 (bad request) without retrying', async () => {
    let callCount = 0;
    await assert.rejects(
      callWithRetry(async () => {
        callCount++;
        throw httpError(400, 'Bad Request');
      }, 3),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.strictEqual((err as any).status, 400);
        return true;
      },
    );
    assert.strictEqual(callCount, 1);
  });

  it('throws after max retries are exhausted', async () => {
    let callCount = 0;
    await assert.rejects(
      callWithRetry(async () => {
        callCount++;
        throw httpError(503, 'Service Unavailable');
      }, 2),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.strictEqual((err as any).status, 503);
        return true;
      },
    );
    // maxRetries=2 means up to 3 total attempts (1 initial + 2 retries)
    assert.strictEqual(callCount, 3);
  });

  it('fails fast on unknown/non-HTTP errors', async () => {
    let callCount = 0;
    await assert.rejects(
      callWithRetry(async () => {
        callCount++;
        throw new Error('network failure');
      }, 3),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes('network failure'));
        return true;
      },
    );
    assert.strictEqual(callCount, 1);
  });
});
