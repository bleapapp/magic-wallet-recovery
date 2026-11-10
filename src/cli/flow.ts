import type { TransactionReceipt } from 'viem';
import { RecoveryError } from '../core/errors.js';
import {
  type PreparedTransaction,
  prepareTransaction,
  type RecoverySigner,
  sendPreparedTransaction,
  type TransactionPlan,
} from '../core/transactions.js';
import type { NetworkContext } from './context.js';
import {
  printPreparedTransaction,
  printTransactionConfirmed,
  printTransactionSent,
} from './output.js';
import { confirm, isInteractive } from './prompt.js';

/**
 * Asks for approval, unless `--yes` was given. Refuses to guess in a non-interactive shell.
 * `declined` is the error raised when the person says no.
 */
export async function approve(
  question: string,
  yes: boolean | undefined,
  declined: RecoveryError = new RecoveryError('Cancelled. Nothing was sent.'),
): Promise<void> {
  if (yes) return;
  if (!isInteractive()) {
    throw new RecoveryError('Confirmation needed, but this is not an interactive terminal.', {
      hint: 'Run the command in a terminal, or pass --yes if you have reviewed what it does.',
    });
  }
  if (!(await confirm(question))) throw declined;
}

/** Simulates a transaction, shows it, asks for approval, sends it and waits for it. */
export async function executeTransaction(
  network: NetworkContext,
  signer: RecoverySigner,
  plan: TransactionPlan,
  yes: boolean | undefined,
): Promise<{ prepared: PreparedTransaction; receipt: TransactionReceipt }> {
  const prepared = await prepareTransaction(network.client, signer.address, plan);
  printPreparedTransaction(prepared, network.chain);
  await approve('Send this transaction?', yes);
  const receipt = await sendPreparedTransaction(network.client, signer, prepared, {
    onSent: (hash) => printTransactionSent(hash, network.chain),
  });
  printTransactionConfirmed();
  return { prepared, receipt };
}
