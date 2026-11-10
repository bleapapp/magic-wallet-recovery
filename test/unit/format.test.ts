import { describe, expect, it } from 'vitest';
import {
  formatAmount,
  formatDuration,
  formatTimestamp,
  parseAddressInput,
  parseTokenAmount,
} from '../../src/core/format.js';
import { sanitizeLabel, sanitizeText } from '../../src/core/text.js';

describe('formatDuration', () => {
  it.each([
    [0n, '0 s'],
    [45n, '45 s'],
    [3_600n, '1 h'],
    [86_399n, '23 h 59 min'],
    [86_400n, '1 d'],
    [259_200n, '3 d'],
    [266_400n, '3 d 2 h'],
  ])('formats %s seconds as %s', (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected);
  });
});

describe('formatTimestamp', () => {
  it('formats a Unix timestamp in UTC', () => {
    expect(formatTimestamp(1_700_000_000n)).toBe('2023-11-14 22:13 UTC');
  });
});

describe('amounts', () => {
  it('formats with decimals and symbol', () => {
    expect(formatAmount(1_416_080_000n, 6, 'USDC')).toBe('1416.08 USDC');
  });

  it.each([
    ['1416.08', 6, 1_416_080_000n],
    ['1', 18, 10n ** 18n],
    ['0.000001', 6, 1n],
  ])('parses %s with %s decimals', (input, decimals, expected) => {
    expect(parseTokenAmount(input, decimals)).toBe(expected);
  });

  it.each(['', 'abc', '1,5', '-1', '0.0000001'])('refuses "%s" for a 6-decimal token', (input) => {
    expect(() => parseTokenAmount(input, 6)).toThrow();
  });
});

describe('parseAddressInput', () => {
  // The EntryPoint address, in its EIP-55 checksummed form.
  const CHECKSUMMED = '0x0000000071727De22E5E9d8BAf0edAc6f37da032';

  it('accepts a checksummed, all-lowercase or all-uppercase address', () => {
    expect(parseAddressInput(CHECKSUMMED, 'The address')).toBe(CHECKSUMMED);
    expect(parseAddressInput(` ${CHECKSUMMED.toLowerCase()} `, 'The address')).toBe(CHECKSUMMED);
    expect(parseAddressInput(`0x${CHECKSUMMED.slice(2).toUpperCase()}`, 'The address')).toBe(
      CHECKSUMMED,
    );
  });

  it('refuses a mixed-case address whose checksum does not match', () => {
    const typo = CHECKSUMMED.replace('De22', 'de22');
    expect(() => parseAddressInput(typo, 'The address')).toThrow('typo');
  });

  it.each(['', '0x1234', `${CHECKSUMMED}00`, 'not an address'])('refuses "%s"', (input) => {
    expect(() => parseAddressInput(input, 'The address')).toThrow('40 hexadecimal');
  });
});

describe('sanitizeLabel', () => {
  it('removes control characters such as terminal escape codes', () => {
    expect(sanitizeLabel('\u001b[31mUSDC\u001b[0m')).toBe('[31mUSDC[0m');
    expect(sanitizeLabel('US\nDC')).toBe('USDC');
  });

  it('shortens long labels and never returns an empty string', () => {
    expect(sanitizeLabel('A'.repeat(40))).toBe(`${'A'.repeat(24)}…`);
    expect(sanitizeLabel('\u0000')).toBe('?');
  });

  it('removes bidirectional overrides and zero-width characters', () => {
    expect(sanitizeLabel('US\u202eDC\u200b')).toBe('USDC');
  });

  it('removes other invisible characters', () => {
    // Soft hyphen, word joiner, a tag character, a line separator and a Hangul filler.
    expect(sanitizeLabel('U\u00adS\u2060D\u{e0041}C\u2028\u3164')).toBe('USDC');
  });

  it('keeps visible non-ASCII text', () => {
    expect(sanitizeLabel('USD\u20ae')).toBe('USD\u20ae');
    expect(sanitizeLabel('Caf\u00e9')).toBe('Caf\u00e9');
  });
});

describe('sanitizeText', () => {
  it('keeps line breaks but removes escape sequences from revert reasons', () => {
    expect(sanitizeText('first line\n\u001b]0;title\u0007second line')).toBe(
      'first line\n]0;titlesecond line',
    );
  });
});
