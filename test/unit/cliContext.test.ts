import { HttpRequestError, TimeoutError } from 'viem';
import { describe, expect, it } from 'vitest';
import { connectionProblem, parseHex, UsageError } from '../../src/cli/context.js';

describe('parseHex', () => {
  it('accepts whole bytes of 0x-prefixed hex', () => {
    expect(parseHex('0x', 'call-data')).toBe('0x');
    expect(parseHex('0xa9059cbb', 'call-data')).toBe('0xa9059cbb');
  });

  it('refuses an odd number of digits, which means part of the value is missing', () => {
    expect(() => parseHex('0xa9059cbb0', 'call-data')).toThrow(UsageError);
    expect(() => parseHex('0xa9059cbb0', 'call-data')).toThrow('odd number');
  });

  it('refuses a value that is not hex', () => {
    expect(() => parseHex('a9059cbb', 'call-data')).toThrow('0x-prefixed');
    expect(() => parseHex(undefined, 'call-data')).toThrow('0x-prefixed');
  });
});

describe('connectionProblem', () => {
  // An endpoint URL can embed an API key: it must never be shown.
  const url = 'https://rpc.invalid/v1/PLACEHOLDER_API_KEY';

  it('gives the HTTP status, without the URL', () => {
    const refused = connectionProblem(new HttpRequestError({ url, status: 401 }));
    expect(refused).toContain('HTTP 401');
    expect(refused).not.toContain('PLACEHOLDER_API_KEY');
    expect(connectionProblem(new HttpRequestError({ url, status: 503 }))).toContain('503');
  });

  it('gives the system error code of a connection that failed', () => {
    const dns = Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' });
    const cause = new TypeError('fetch failed', { cause: dns });
    const failed = new HttpRequestError({ url, cause });
    expect(connectionProblem(failed)).toBe('Network error ENOTFOUND.');
  });

  it('reports a timeout', () => {
    expect(connectionProblem(new TimeoutError({ body: {}, url }))).toContain('in time');
  });

  it('says nothing when it does not know', () => {
    expect(connectionProblem(new Error('something else'))).toBeUndefined();
  });
});
