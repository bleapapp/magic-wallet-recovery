import {
  type Address,
  type Hex,
  isAddressEqual,
  type PublicClient,
  parseEventLogs,
  type TransactionReceipt,
} from 'viem';
import { erc20Abi } from './abis.js';
import { actionToCall, describeAction, type WithdrawAction } from './actions.js';
import { ADDRESSES, type ModuleVersion } from './constants.js';
import { explainError, RecoveryError } from './errors.js';
import { formatDuration, formatTimestamp, type SummaryItem } from './format.js';
import { getSupportedAccount, type WalletStatus } from './inspect.js';
import { type PreparedTransaction, prepareTransaction } from './transactions.js';
import {
  buildSlowWithdrawUserOp,
  encodeHandleOps,
  encodeSlowWithdrawSignature,
  getSlowWithdrawUserOpHash,
  readUserOperationResult,
  type SlowWithdrawUserOperation,
  simulateHandleOps,
  simulateWalletCall,
  type UserOperationResult,
  verifyOwnerSignature,
  type WalletCall,
} from './userOp.js';

/**
 * Shown before the owner signs a withdrawal. The signature is the real approval: the final check
 * sends the signed operation to the network endpoint, and anyone who has it can submit it (the
 * EntryPoint accepts it from any sender), until another operation of the wallet uses its nonce.
 */
export const SIGNING_NOTICE =
  'Signing authorizes this withdrawal. Once signed, it can be submitted by anyone who has the signature, not only by this tool. Check every line above before you sign.';

/**
 * Shown whenever a signed withdrawal is not submitted, whether the person declined or a later step
 * failed: neither revokes the signature.
 */
export const SIGNED_NOT_SUBMITTED_NOTICE =
  'The withdrawal was not submitted, but it is signed, and the final check shares the signed withdrawal with your network endpoint: anyone who has it can still submit it, to the destination you approved. If you do not want it to happen, cancel the slow withdrawal now. If you start a new slow withdrawal later, this signed withdrawal becomes valid again at the end of the waiting period, until another withdrawal from this wallet is executed.';

/**
 * Adds {@link SIGNED_NOT_SUBMITTED_NOTICE} to an error raised after a withdrawal was signed and
 * before it was sent: whatever went wrong, the signature stays usable.
 */
export function withSignedNotice(error: unknown): RecoveryError {
  if (error instanceof RecoveryError && error.hint?.includes(SIGNED_NOT_SUBMITTED_NOTICE)) {
    return error;
  }
  const message = error instanceof RecoveryError ? error.message : explainError(error);
  const hint = error instanceof RecoveryError ? error.hint : undefined;
  return new RecoveryError(message, {
    hint: hint ? `${hint}\n${SIGNED_NOT_SUBMITTED_NOTICE}` : SIGNED_NOT_SUBMITTED_NOTICE,
    cause: error,
  });
}

/** A withdrawal checked and simulated, waiting for the owner's signature. */
export interface PreparedWithdrawal {
  chainId: number;
  wallet: Address;
  signer: Address;
  moduleVersion: ModuleVersion;
  action: WithdrawAction;
  call: WalletCall;
  title: string;
  summary: SummaryItem[];
  warnings: string[];
  userOp: SlowWithdrawUserOperation;
  /** The 32-byte hash the signer signs with `personal_sign`. */
  userOpHash: Hex;
}

/** Throws unless the wallet can make a slow withdrawal right now with this signer. */
export function assertCanWithdraw(status: WalletStatus, signer: Address) {
  const account = getSupportedAccount(status);
  if ('problems' in account) throw new RecoveryError(account.problems.join(' '));
  if (!isAddressEqual(account.signer, signer)) {
    throw new RecoveryError(
      `This wallet's signer is ${account.signer}, but you are using ${signer}.`,
      { hint: 'Use the private key exported from the Bleap account that owns this wallet.' },
    );
  }
  const state = account.slowWithdrawal;
  if (state.status === 'not-triggered') {
    throw new RecoveryError('No slow withdrawal is in progress for this wallet on this network.', {
      hint: 'Start one first (trigger), then wait for the waiting period to end.',
    });
  }
  if (state.status === 'waiting') {
    throw new RecoveryError(
      `The waiting period is not over yet: ${formatDuration(state.remainingSeconds)} left (until ${formatTimestamp(state.withdrawableAt)}).`,
    );
  }
  return account;
}

/**
 * Checks and simulates a withdrawal and builds the UserOperation to sign. Nothing is signed or sent.
 */
export async function prepareWithdrawal(
  client: PublicClient,
  params: { status: WalletStatus; signer: Address; action: WithdrawAction },
): Promise<PreparedWithdrawal> {
  const { status, signer, action } = params;
  const account = assertCanWithdraw(status, signer);
  const description = await describeAction(
    client,
    { chainId: status.chainId, wallet: status.wallet, signer: account.signer },
    action,
  );
  const call = actionToCall(status.wallet, action);
  const { callGasLimit, simulated } = await simulateWalletCall(client, status.wallet, call);
  const warnings = [...description.warnings];
  if (!simulated) {
    warnings.push(
      'Your network node could not simulate this transfer on its own. The final check before sending confirms that your wallet accepts the operation, but not that the transfer itself succeeds. If it fails, nothing is moved and only the network fee is spent: you can try again, for example with another RPC endpoint.',
    );
  }
  const userOp = await buildSlowWithdrawUserOp(client, {
    wallet: status.wallet,
    call,
    callGasLimit,
  });
  return {
    chainId: status.chainId,
    wallet: status.wallet,
    signer: account.signer,
    moduleVersion: account.module.version,
    action,
    call,
    title: description.title,
    summary: [
      ...description.summary,
      {
        label: 'Operation fee',
        value: '0 (you only pay the network fee of the final transaction)',
      },
    ],
    warnings,
    userOp,
    userOpHash: getSlowWithdrawUserOpHash(userOp, status.chainId),
  };
}

/**
 * Takes the owner's signature, checks it, and simulates the whole operation through the EntryPoint.
 * Returns the transaction that submits it, to be sent from `submitter` (usually the signer).
 *
 * The simulation sends the signed operation to the network endpoint, so from here on it can be
 * submitted by others: any error thrown after the signature check carries
 * {@link SIGNED_NOT_SUBMITTED_NOTICE}.
 */
export async function finalizeWithdrawal(
  client: PublicClient,
  withdrawal: PreparedWithdrawal,
  ownerSignature: Hex,
  submitter: Address,
): Promise<PreparedTransaction & { userOp: SlowWithdrawUserOperation }> {
  // A signature from another account is not valid for this wallet, so it needs no notice.
  const signature = await verifyOwnerSignature(
    withdrawal.userOpHash,
    ownerSignature,
    withdrawal.signer,
  );
  const userOp: SlowWithdrawUserOperation = {
    ...withdrawal.userOp,
    signature: encodeSlowWithdrawSignature(signature),
  };
  try {
    await simulateHandleOps(client, submitter, userOp);
    const tx = await prepareTransaction(client, submitter, {
      title: `Submit: ${withdrawal.title}`,
      summary: [
        ...withdrawal.summary,
        { label: 'Submitted to', value: `EntryPoint ${ADDRESSES.entryPoint}` },
      ],
      warnings: withdrawal.warnings,
      to: ADDRESSES.entryPoint,
      data: encodeHandleOps(userOp, submitter),
      value: 0n,
    });
    return { ...tx, userOp };
  } catch (error) {
    throw withSignedNotice(error);
  }
}

/** Reads the outcome of a submitted withdrawal. Throws if the wallet's call did not succeed. */
export function checkWithdrawalReceipt(
  receipt: TransactionReceipt,
  withdrawal: PreparedWithdrawal,
): UserOperationResult {
  const result = readUserOperationResult(receipt, withdrawal.userOpHash);
  if (!result.found) {
    throw new RecoveryError(
      `The transaction ${receipt.transactionHash} did not execute the withdrawal. Check it on a block explorer.`,
    );
  }
  if (!result.success) {
    throw new RecoveryError(
      `The withdrawal was submitted but the wallet's call failed (${receipt.transactionHash}).`,
      {
        hint: result.revertReason,
      },
    );
  }
  // The wallet ignores what the token returns, so a token that answers `false` instead of reverting
  // leaves a successful operation that moved nothing (the check before signing can't rule out a
  // change in between). A standard token records every transfer with a `Transfer` event.
  const { action } = withdrawal;
  if (
    action.kind === 'erc20' &&
    !recordsTokenTransfer(receipt, action.token, withdrawal.wallet, action.to)
  ) {
    throw new RecoveryError(
      `The withdrawal was executed (${receipt.transactionHash}), but the token did not record a transfer to ${action.to}.`,
      {
        hint: 'Some tokens refuse a transfer by answering "false" instead of failing. Check your wallet\'s balances before trying again.',
      },
    );
  }
  return result;
}

/** True when the receipt has the token's `Transfer` event from `from` to `to`. */
function recordsTokenTransfer(
  receipt: TransactionReceipt,
  token: Address,
  from: Address,
  to: Address,
): boolean {
  const logs = receipt.logs.filter((log) => isAddressEqual(log.address, token));
  return parseEventLogs({ abi: erc20Abi, logs, eventName: 'Transfer' }).some(
    (event) => isAddressEqual(event.args.from, from) && isAddressEqual(event.args.to, to),
  );
}
