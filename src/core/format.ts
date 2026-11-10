import { type Address, formatUnits, getAddress, isAddress, parseUnits } from 'viem';
import { RecoveryError } from './errors.js';

/** A line of a human-readable summary shown before an action is approved. */
export interface SummaryItem {
  label: string;
  value: string;
}

/** Formats a duration in seconds, e.g. `2 d 3 h`, `23 h 59 min`, `45 s`. */
export function formatDuration(seconds: bigint): string {
  if (seconds <= 0n) return '0 s';
  const days = seconds / 86_400n;
  const hours = (seconds % 86_400n) / 3_600n;
  const minutes = (seconds % 3_600n) / 60n;
  const secs = seconds % 60n;
  const parts: string[] = [];
  if (days > 0n) parts.push(`${days} d`);
  if (hours > 0n) parts.push(`${hours} h`);
  if (minutes > 0n && days === 0n) parts.push(`${minutes} min`);
  if (secs > 0n && days === 0n && hours === 0n) parts.push(`${secs} s`);
  return parts.join(' ');
}

/** Formats a Unix timestamp as `YYYY-MM-DD HH:MM UTC`. */
export function formatTimestamp(timestamp: bigint): string {
  const iso = new Date(Number(timestamp) * 1000).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

/** Formats a token amount with its symbol, e.g. `1416.08 USDC`. */
export function formatAmount(value: bigint, decimals: number, symbol?: string): string {
  const amount = formatUnits(value, decimals);
  return symbol ? `${amount} ${symbol}` : amount;
}

/**
 * Parses an amount typed by a person (e.g. `1416.08`) into the token's smallest unit. Refuses
 * more decimals than the token has, rather than rounding silently.
 */
export function parseTokenAmount(value: string, decimals: number): bigint {
  const text = value.trim();
  if (!/^\d+(\.\d+)?$/.test(text)) {
    throw new RecoveryError(
      `"${value}" is not a valid amount (use a dot for decimals, e.g. 12.5).`,
    );
  }
  const fraction = text.split('.')[1] ?? '';
  if (fraction.length > decimals) {
    throw new RecoveryError(`This token has ${decimals} decimals; "${value}" has more.`);
  }
  return parseUnits(text, decimals);
}

/**
 * Parses an address typed or pasted by a person; `name` describes it in error messages. A
 * mixed-case address carries an EIP-55 checksum, which catches most typing mistakes, so it must
 * match. An all-lowercase or all-uppercase address has no checksum to check.
 */
export function parseAddressInput(value: string, name: string): Address {
  const text = value.trim();
  if (!isAddress(text, { strict: false })) {
    throw new RecoveryError(`${name} must be 0x followed by 40 hexadecimal characters.`);
  }
  const digits = text.slice(2);
  const hasChecksum = digits !== digits.toLowerCase() && digits !== digits.toUpperCase();
  if (hasChecksum && !isAddress(text, { strict: true })) {
    throw new RecoveryError(
      `${name} has a typo: its mix of upper- and lower-case letters (its checksum) does not match. Copy the address again.`,
    );
  }
  return getAddress(text);
}
