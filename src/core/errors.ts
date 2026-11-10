import {
  BaseError,
  ContractFunctionRevertedError,
  decodeErrorResult,
  type Hex,
  HttpRequestError,
  isHex,
  RpcError,
  RpcRequestError,
  SocketClosedError,
  TimeoutError,
  WebSocketRequestError,
} from 'viem';
import { knownErrorsAbi } from './abis.js';
import { sanitizeLabel, sanitizeText } from './text.js';

/** An error whose message is written for the person using the tool. */
export class RecoveryError extends Error {
  readonly hint?: string;

  constructor(message: string, options?: { hint?: string; cause?: unknown }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'RecoveryError';
    this.hint = options?.hint;
  }
}

/** EntryPoint error codes (the `AAxx` prefix of `FailedOp` reasons). */
const ENTRY_POINT_REASONS: Record<string, string> = {
  AA10: 'The wallet is already deployed.',
  AA13: 'The wallet could not be deployed.',
  AA20: 'The wallet is not deployed on this network yet.',
  AA21: 'The wallet would have to pay a fee for the operation. This tool sets operation fees to zero, so prepare it again.',
  AA22: 'The waiting period is not over yet. Wait a little and try again.',
  AA23: 'The wallet rejected the operation while checking it.',
  AA24: "The wallet did not accept the signature. Check that the waiting period is over, that the slow withdrawal is still in progress, and that you are using the wallet's signer account.",
  AA25: 'The operation is out of date (another operation was executed in the meantime). Prepare it again.',
  AA26: 'Checking the operation used more gas than allowed. Prepare it again.',
  AA90: 'The fee recipient address is invalid.',
  AA95: 'The transaction ran out of gas. Try again: the gas limit will be estimated again.',
};

/** Errors raised by the wallet, the Cosigning Module or the factory. */
const CONTRACT_ERRORS: Record<string, string> = {
  NotScwOwner: 'The account you are using is not the signer registered for this wallet.',
  NotRootPermission: "The permission used is not the wallet's main (root) permission.",
  SlowWithdrawAlreadyTriggered: 'A slow withdrawal is already in progress for this wallet.',
  SlowWithdrawNotTriggered: 'No slow withdrawal is in progress for this wallet.',
  InvalidCaller: 'Only the EntryPoint can execute operations for this wallet.',
  InvalidValidator: 'The wallet does not accept this kind of operation.',
  SignerPrefixNotPresent: 'The operation signature is not formatted correctly.',
  InvalidSignature: 'The signature is not formatted correctly.',
  InitializeError:
    'The wallet could not be initialized. A contract it relies on may be missing on this network.',
};

/**
 * Turns any error into a message for the person using the tool. Revert reasons and node messages
 * are untrusted text, so control and invisible characters are removed.
 */
export function explainError(error: unknown): string {
  return sanitizeText(rawExplanation(error));
}

function rawExplanation(error: unknown): string {
  if (error instanceof RecoveryError) {
    return error.hint ? `${error.message}\n${error.hint}` : error.message;
  }
  const revert = describeRevert(error);
  if (revert) return revert;
  if (error instanceof BaseError) return error.shortMessage;
  if (error instanceof Error) return error.message;
  return String(error);
}

/** Finds revert data anywhere in an error chain and explains it, if it can. */
export function describeRevert(error: unknown): string | undefined {
  if (error instanceof BaseError) {
    const reverted = error.walk((cause) => cause instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError) {
      if (reverted.data) return describeDecodedError(reverted.data.errorName, reverted.data.args);
      if (reverted.reason) return contractMessage(reverted.reason);
    }
  }
  const data = findRevertData(error);
  if (!data) return undefined;
  return describeRevertData(data);
}

/** Explains raw revert data (`0x` + 4-byte selector + arguments). */
export function describeRevertData(data: Hex): string {
  try {
    const { errorName, args } = decodeErrorResult({ abi: knownErrorsAbi, data });
    return describeDecodedError(errorName, args);
  } catch {
    return `The contract reverted (${data.slice(0, 10)}).`;
  }
}

function describeDecodedError(errorName: string, args: readonly unknown[] | undefined): string {
  const [first, second, third] = args ?? [];
  if (errorName === 'FailedOp' || errorName === 'FailedOpWithRevert') {
    const reason = typeof second === 'string' ? second : '';
    const known = ENTRY_POINT_REASONS[reason.slice(0, 4)];
    const inner = errorName === 'FailedOpWithRevert' && isHex(third) ? third : undefined;
    const innerText = inner && inner !== '0x' ? ` ${describeRevertData(inner)}` : '';
    return `${known ?? 'The EntryPoint rejected the operation.'} (${reason})${innerText}`;
  }
  if (errorName === 'Error' && typeof first === 'string') {
    return contractMessage(first);
  }
  const known = CONTRACT_ERRORS[errorName];
  return known ? `${known} (${errorName})` : `The contract reverted with ${errorName}.`;
}

/**
 * A revert string is written by the contract, which can be a token anyone deployed and sent to the
 * wallet: one short quoted line, attributed to the contract, so it can't pass for the tool's text.
 */
function contractMessage(reason: string): string {
  const quoted = `"${sanitizeLabel(reason, 120)}"`;
  return `The contract reverted with this message (from the contract, not from Bleap): ${quoted}`;
}

/** Walks an error's `cause` chain looking for revert data, wherever the node put it. */
function findRevertData(error: unknown): Hex | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 12 && current && typeof current === 'object'; depth++) {
    const data = (current as { data?: unknown }).data;
    if (isRevertData(data)) return data;
    if (data && typeof data === 'object') {
      const nested = (data as { data?: unknown }).data;
      if (isRevertData(nested)) return nested;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

function isRevertData(value: unknown): value is Hex {
  return typeof value === 'string' && isHex(value) && value.length >= 10;
}

/** True when an error is a contract revert rather than a network or node problem. */
export function isRevert(error: unknown): boolean {
  if (describeRevert(error)) return true;
  const text =
    error instanceof BaseError ? `${error.shortMessage} ${error.details}` : String(error);
  return /revert/i.test(text);
}

const NETWORK_ERRORS = [
  HttpRequestError,
  RpcRequestError,
  RpcError,
  SocketClosedError,
  TimeoutError,
  WebSocketRequestError,
];

/**
 * True when a call failed because of the network or the node (worth trying again), rather than
 * because of the contract's answer (a revert, no data, or data that doesn't decode).
 */
export function isNetworkError(error: unknown): boolean {
  if (!(error instanceof BaseError) || isRevert(error)) return false;
  return error.walk((cause) => NETWORK_ERRORS.some((type) => cause instanceof type)) !== null;
}

/** Throws a readable error if `error` is a network or node failure; does nothing otherwise. */
export function rethrowNetworkError(error: unknown): void {
  if (isNetworkError(error)) {
    throw new RecoveryError(
      'Could not read from the network. Try again, or use another RPC endpoint.',
      {
        hint: explainError(error),
        cause: error,
      },
    );
  }
}

/**
 * Error handler for a read whose failure says something about the contract (for example "this is
 * not a Magic Wallet"): returns `fallback` when the contract rejected the call, and throws when the
 * network or node failed, so a temporary outage is never reported as a fact about the contract.
 */
export function unlessNetworkError<T>(fallback: T): (error: unknown) => T {
  return (error) => {
    rethrowNetworkError(error);
    return fallback;
  };
}
