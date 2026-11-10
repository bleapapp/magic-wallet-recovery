import type { Address, Hex, PublicClient, ReplacementReason, TransactionReceipt } from 'viem';
import { GAS_MARGIN_PERCENT } from './constants.js';
import { explainError, RecoveryError } from './errors.js';
import type { SummaryItem } from './format.js';

/**
 * The account that signs and pays: a local key in the CLI, the browser wallet on the web page.
 * Keys never leave this object, and the core library never sees them.
 */
export interface RecoverySigner {
  address: Address;
  /**
   * Sends a transaction from `address` and returns its hash. `gas` is the simulated estimate plus a
   * margin. A browser wallet sizes the gas itself instead, because it may send the call in another
   * form.
   */
  sendTransaction(tx: { to: Address; data: Hex; value: bigint; gas: bigint }): Promise<Hex>;
  /** EIP-191 `personal_sign` over raw bytes (here, always a 32-byte hash). */
  signRawMessage(message: Hex): Promise<Hex>;
}

/** A transaction described for a person, before simulation. */
export interface TransactionPlan {
  title: string;
  summary: SummaryItem[];
  warnings?: string[];
  to: Address;
  data: Hex;
  value: bigint;
}

/** A transaction that was simulated successfully and is ready to be approved and sent. */
export interface PreparedTransaction extends TransactionPlan {
  from: Address;
  chainId: number;
  gas: bigint;
  /** Estimated network fee in the native token's smallest unit, when the node returns a gas price. */
  estimatedFee?: bigint;
}

export function withGasMargin(gas: bigint): bigint {
  return gas + (gas * GAS_MARGIN_PERCENT) / 100n;
}

/**
 * Simulates a transaction (gas estimation runs it against the latest state) and estimates its fee.
 * Throws a readable error if the transaction would fail, so nothing is ever signed blindly.
 */
export async function prepareTransaction(
  client: PublicClient,
  from: Address,
  plan: TransactionPlan,
): Promise<PreparedTransaction> {
  let estimate: bigint;
  try {
    estimate = await client.estimateGas({
      account: from,
      to: plan.to,
      data: plan.data,
      value: plan.value,
    });
  } catch (error) {
    throw new RecoveryError(`${plan.title}: this transaction would fail.`, {
      hint: explainError(error),
      cause: error,
    });
  }
  const gas = withGasMargin(estimate);
  const [chainId, gasPrice] = await Promise.all([
    client.getChainId(),
    client.getGasPrice().catch(() => undefined),
  ]);
  return {
    ...plan,
    from,
    chainId,
    gas,
    estimatedFee: gasPrice === undefined ? undefined : gas * gasPrice,
  };
}

/**
 * Sends a prepared transaction, waits for it, and fails loudly if it reverted on-chain or was
 * cancelled or replaced in the wallet. `onSent` receives the hash as soon as the transaction is
 * sent, before it is confirmed.
 */
export async function sendPreparedTransaction(
  client: PublicClient,
  signer: RecoverySigner,
  tx: PreparedTransaction,
  options: { onSent?: (hash: Hex) => void } = {},
): Promise<TransactionReceipt> {
  const chainId = await client.getChainId();
  if (chainId !== tx.chainId) {
    throw new RecoveryError(
      `The network changed (expected chain ID ${tx.chainId}, got ${chainId}). Nothing was sent.`,
    );
  }
  const hash = await signer.sendTransaction({
    to: tx.to,
    data: tx.data,
    value: tx.value,
    gas: tx.gas,
  });
  options.onSent?.(hash);
  // When the transaction is replaced (e.g. "speed up" or "cancel" in a browser wallet), viem
  // returns the receipt of the replacement, which only did the same thing if it was repriced.
  const replaced: { reason?: ReplacementReason } = {};
  const receipt = await client
    .waitForTransactionReceipt({
      hash,
      onReplaced: ({ reason }) => {
        replaced.reason = reason;
      },
    })
    .catch((error: unknown) => {
      throw new RecoveryError(
        `${tx.title}: the transaction was sent (${hash}), but its confirmation could not be read yet.`,
        {
          hint: 'Check it on a block explorer before trying again: sending it a second time would cost another network fee.',
          cause: error,
        },
      );
    });
  if (replaced.reason !== undefined && replaced.reason !== 'repriced') {
    throw new RecoveryError(
      `${tx.title}: the transaction (${hash}) was ${replaced.reason === 'cancelled' ? 'cancelled' : 'replaced by another transaction'} in your wallet, so it was not executed.`,
      { hint: 'Check your wallet again before trying again.' },
    );
  }
  if (receipt.status !== 'success') {
    throw new RecoveryError(`${tx.title}: the transaction was included but failed (${hash}).`);
  }
  return receipt;
}
