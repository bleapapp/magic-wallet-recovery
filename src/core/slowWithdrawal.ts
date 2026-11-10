import { type Address, encodeFunctionData, isAddressEqual } from 'viem';
import { cosigningModuleV1Abi } from './abis.js';
import { getChainInfo, isBleapAppNetwork } from './chains.js';
import { RecoveryError } from './errors.js';
import { formatDuration } from './format.js';
import { getSupportedAccount, type SupportedAccount, type WalletStatus } from './inspect.js';
import type { TransactionPlan } from './transactions.js';

/**
 * Shown before starting a slow withdrawal on a network the Bleap app supports. The person must
 * confirm it explicitly: on those networks the app is the way to move funds.
 */
export const APP_NETWORK_TRIGGER_NOTICE =
  'The Bleap app supports this network: use the app here. Starting a slow withdrawal on this network automatically suspends your Bleap account, and cancelling it does not lift the suspension. Only do it in an emergency. If funds are missing or not credited in the app, contact Bleap support instead.';

/**
 * Shown before starting a slow withdrawal on any other network, in case the Bleap app supports it
 * but this version of the tools doesn't know it yet.
 */
export const TRIGGER_REMINDER =
  'If the Bleap app supports this network, stop here and use the app: starting a slow withdrawal on a network the app supports automatically suspends your Bleap account.';

/** Shown before cancelling a slow withdrawal on a network the Bleap app supports. */
export const APP_NETWORK_CANCEL_NOTICE =
  'Cancelling stops the slow withdrawal, but it does not lift the suspension of your Bleap account. Contact Bleap support for your account.';

function requireSignerAccount(status: WalletStatus, signer: Address): SupportedAccount {
  const account = getSupportedAccount(status);
  if ('problems' in account) throw new RecoveryError(account.problems.join(' '));
  if (!isAddressEqual(account.signer, signer)) {
    throw new RecoveryError(
      `This wallet's signer is ${account.signer}, but you are using ${signer}.`,
      {
        hint: 'Only the signer registered for the wallet can start or cancel a slow withdrawal.',
      },
    );
  }
  return account;
}

/**
 * Transaction that starts the waiting period. It is sent by the signer account directly to the
 * Cosigning Module (it is not a wallet operation), so it is paid by the signer account.
 *
 * On a network the Bleap app supports, `emergency` must be set: it records that the person read
 * and accepted {@link APP_NETWORK_TRIGGER_NOTICE}.
 */
export function planTrigger(
  status: WalletStatus,
  signer: Address,
  options: { emergency?: boolean } = {},
): TransactionPlan {
  const chain = getChainInfo(status.chainId);
  const appNetwork = isBleapAppNetwork(status.chainId);
  if (appNetwork && !options.emergency) {
    throw new RecoveryError(`The Bleap app supports ${chain.name}. Use the app on this network.`, {
      hint: APP_NETWORK_TRIGGER_NOTICE,
    });
  }
  const account = requireSignerAccount(status, signer);
  if (account.slowWithdrawal.status !== 'not-triggered') {
    throw new RecoveryError(
      'A slow withdrawal is already in progress for this wallet on this network.',
    );
  }
  // Both versions have the same `triggerSlowWithdraw(bytes32,address)` signature.
  const data = encodeFunctionData({
    abi: cosigningModuleV1Abi,
    functionName: 'triggerSlowWithdraw',
    args: [account.moduleSignerId, status.wallet],
  });
  const waiting =
    account.module.version === 'V1'
      ? `${formatDuration(account.timelockSeconds)} (the module's current setting)`
      : formatDuration(account.timelockSeconds);
  return {
    title: 'Start the slow withdrawal',
    summary: [
      { label: 'Network', value: `${chain.name} (chain ID ${chain.id})` },
      { label: 'Wallet', value: status.wallet },
      { label: 'Signer (sends this transaction)', value: account.signer },
      {
        label: 'Cosigning Module',
        value: `${account.module.version} at ${account.module.address}`,
      },
      { label: 'Waiting period', value: waiting },
    ],
    warnings: [
      appNetwork ? APP_NETWORK_TRIGGER_NOTICE : TRIGGER_REMINDER,
      'Nothing leaves your wallet now. When the waiting period is over, you choose what to move and where.',
    ],
    to: account.module.address,
    data,
    value: 0n,
  };
}

/** Transaction that cancels a slow withdrawal in progress (or a finished waiting period). */
export function planCancel(status: WalletStatus, signer: Address): TransactionPlan {
  const account = requireSignerAccount(status, signer);
  if (account.slowWithdrawal.status === 'not-triggered') {
    throw new RecoveryError('No slow withdrawal is in progress for this wallet on this network.');
  }
  const chain = getChainInfo(status.chainId);
  const data = encodeFunctionData({
    abi: cosigningModuleV1Abi,
    functionName: 'unTriggerSlowWithdraw',
    args: [account.moduleSignerId, status.wallet],
  });
  return {
    title: 'Cancel the slow withdrawal',
    summary: [
      { label: 'Network', value: `${chain.name} (chain ID ${chain.id})` },
      { label: 'Wallet', value: status.wallet },
      { label: 'Signer (sends this transaction)', value: account.signer },
      {
        label: 'Cosigning Module',
        value: `${account.module.version} at ${account.module.address}`,
      },
    ],
    warnings: [
      ...(isBleapAppNetwork(status.chainId) ? [APP_NETWORK_CANCEL_NOTICE] : []),
      'If you start a new slow withdrawal later, the full waiting period starts again.',
    ],
    to: account.module.address,
    data,
    value: 0n,
  };
}
