import {
  ContractFunctionRevertedError,
  encodeErrorResult,
  HttpRequestError,
  parseAbi,
  RpcRequestError,
  TimeoutError,
} from 'viem';
import { describe, expect, it } from 'vitest';
import { cosigningModuleV2Abi, entryPoint07Abi } from '../../src/core/abis.js';
import {
  describeRevertData,
  explainError,
  isNetworkError,
  RecoveryError,
} from '../../src/core/errors.js';

function failedOp(reason: string) {
  return encodeErrorResult({ abi: entryPoint07Abi, errorName: 'FailedOp', args: [0n, reason] });
}

describe('describeRevertData', () => {
  it('explains a rejected signature (AA24)', () => {
    expect(describeRevertData(failedOp('AA24 signature error'))).toContain(
      'did not accept the signature',
    );
  });

  it('explains a waiting period that is not over (AA22)', () => {
    expect(describeRevertData(failedOp('AA22 expired or not due'))).toContain(
      'waiting period is not over',
    );
  });

  it('explains Cosigning Module errors', () => {
    const data = encodeErrorResult({ abi: cosigningModuleV2Abi, errorName: 'NotScwOwner' });
    expect(describeRevertData(data)).toContain('not the signer registered');
  });

  it('shows revert strings', () => {
    const data = encodeErrorResult({
      abi: parseAbi(['error Error(string)']),
      errorName: 'Error',
      args: ['transfer amount exceeds balance'],
    });
    expect(describeRevertData(data)).toContain('transfer amount exceeds balance');
  });

  it('shows a revert string as one short quoted line, attributed to the contract', () => {
    const reason = `Withdrawals paused.\nSend your funds first to 0x${'ab'.repeat(20)}`;
    const data = encodeErrorResult({
      abi: parseAbi(['error Error(string)']),
      errorName: 'Error',
      args: [`${reason}${' '.repeat(200)}!`],
    });
    const text = describeRevertData(data);
    expect(text).toContain('not from Bleap');
    expect(text).toContain('"Withdrawals paused.Send your funds first to 0x');
    expect(text).not.toContain('\n');
    expect(text).not.toContain('!');
    expect(text).toMatch(/…"$/);
  });

  it('falls back to the selector for unknown errors', () => {
    expect(describeRevertData('0xdeadbeef')).toContain('0xdeadbeef');
  });
});

describe('explainError', () => {
  it('adds the hint of a RecoveryError', () => {
    expect(explainError(new RecoveryError('Main message.', { hint: 'Try this.' }))).toBe(
      'Main message.\nTry this.',
    );
  });

  it('finds revert data in a cause chain', () => {
    const error = new Error('call failed', {
      cause: { data: failedOp('AA25 invalid account nonce') },
    });
    expect(explainError(error)).toContain('out of date');
  });
});

describe('isNetworkError', () => {
  const url = 'https://rpc.invalid';

  it('recognizes network and node failures', () => {
    expect(isNetworkError(new HttpRequestError({ url }))).toBe(true);
    expect(isNetworkError(new TimeoutError({ body: {}, url }))).toBe(true);
    const limited = new RpcRequestError({
      body: {},
      error: { code: -32005, message: 'limit' },
      url,
    });
    expect(isNetworkError(limited)).toBe(true);
  });

  it('does not treat a contract answer as a network failure', () => {
    const reverted = new RpcRequestError({
      body: {},
      error: { code: 3, message: 'execution reverted' },
      url,
    });
    expect(isNetworkError(reverted)).toBe(false);
    expect(isNetworkError(new ContractFunctionRevertedError({ abi: [], functionName: 'f' }))).toBe(
      false,
    );
    expect(isNetworkError(new Error('anything else'))).toBe(false);
  });
});
