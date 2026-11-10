import type { Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it } from 'vitest';
import { assertNoKeyInArguments, assertNotSignerKey, parsePrivateKey } from '../../src/cli/key.js';

// A placeholder value with the shape of a key. It is not a real key.
const PLACEHOLDER_KEY: Hex = `0x${'ab'.repeat(32)}`;
const TX_HASH: Hex = `0x${'cd'.repeat(32)}`;

describe('parsePrivateKey', () => {
  it('accepts a key with or without 0x, and trims whitespace', () => {
    expect(parsePrivateKey(`${PLACEHOLDER_KEY}\n`)).toBe(PLACEHOLDER_KEY);
    expect(parsePrivateKey(PLACEHOLDER_KEY.slice(2))).toBe(PLACEHOLDER_KEY);
  });

  it('refuses a recovery phrase', () => {
    const phrase = Array.from({ length: 12 }, () => 'word').join(' ');
    expect(() => parsePrivateKey(phrase)).toThrow('recovery phrase');
  });

  it('refuses anything that is not 32 bytes of hex', () => {
    expect(() => parsePrivateKey('0x1234')).toThrow('64 hexadecimal characters');
    expect(() => parsePrivateKey(`0x${'zz'.repeat(32)}`)).toThrow();
  });
});

describe('assertNoKeyInArguments', () => {
  it('refuses a key passed as an argument', () => {
    expect(() => assertNoKeyInArguments(['--chain', '1', PLACEHOLDER_KEY])).toThrow(
      'command-line argument',
    );
    expect(() => assertNoKeyInArguments([`--rpc=${PLACEHOLDER_KEY}`])).toThrow(
      'command-line argument',
    );
  });

  it('allows a transaction hash where one is expected', () => {
    expect(() => assertNoKeyInArguments(['--deployment-tx', TX_HASH])).not.toThrow();
    expect(() => assertNoKeyInArguments([`--deployment-tx=${TX_HASH}`])).not.toThrow();
  });

  it('refuses 32 bytes of hex as call data, which is never a valid call', () => {
    expect(() => assertNoKeyInArguments(['--call-data', PLACEHOLDER_KEY])).toThrow(
      'command-line argument',
    );
    expect(() => assertNoKeyInArguments([`--call-data=${PLACEHOLDER_KEY}`])).toThrow(
      'command-line argument',
    );
  });

  it("refuses the signer's own key given as a transaction hash", () => {
    const account = privateKeyToAccount(PLACEHOLDER_KEY);
    expect(() => assertNotSignerKey(PLACEHOLDER_KEY, account, 'deployment-tx')).toThrow(
      'signer private key',
    );
    expect(() => assertNotSignerKey(TX_HASH, account, 'deployment-tx')).not.toThrow();
  });

  it('allows ordinary arguments', () => {
    expect(() =>
      assertNoKeyInArguments([
        '--chain',
        '1',
        '--wallet',
        '0x2222222222222222222222222222222222222222',
      ]),
    ).not.toThrow();
  });
});
