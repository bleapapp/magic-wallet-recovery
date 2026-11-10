import { parseArgs } from 'node:util';
import { getChainInfo, isBleapAppNetwork } from '../../core/chains.js';
import { RecoveryError } from '../../core/errors.js';
import { formatDuration, formatTimestamp } from '../../core/format.js';
import { inspectWallet } from '../../core/inspect.js';
import { APP_NETWORK_TRIGGER_NOTICE, planCancel, planTrigger } from '../../core/slowWithdrawal.js';
import {
  COMMON_OPTIONS,
  connect,
  localSigner,
  parseAddress,
  parseChainId,
  SIGNER_OPTIONS,
  UsageError,
} from '../context.js';
import { executeTransaction } from '../flow.js';
import { loadSignerAccount } from '../key.js';
import { green, info, print } from '../output.js';
import { isInteractive } from '../prompt.js';

export const triggerHelp = `Usage: magic-wallet-recovery trigger --chain <id> --wallet <address> [options]

Starts a slow withdrawal: the waiting period begins, and nothing leaves your wallet yet. Once it
is over, use the withdraw command. Your signer account sends this transaction and pays its fee.

Use the Bleap app on every EVM network it officially supports: starting a slow withdrawal on one
of them automatically suspends your Bleap account. On the networks that the chains command marks
as Bleap app networks, this command refuses to run unless you add --emergency. If funds are
missing in the app, contact Bleap support instead.

  --chain <id>          Chain ID of the network
  --wallet <address>    Your Magic Wallet address, as shown in the Bleap app
  --rpc <url>           Your own RPC endpoint (default: a public endpoint, when known)
  --key-file <path>     File containing your signer private key (see "Signer key" in --help)
  --emergency           Required on a Bleap app network (see above)
  --yes                 Do not ask for confirmation (not recommended)
`;

export const cancelHelp = `Usage: magic-wallet-recovery cancel --chain <id> --wallet <address> [options]

Cancels a slow withdrawal started on this network (for example by mistake). Your signer account
sends this transaction and pays its fee.

  --chain <id>          Chain ID of the network
  --wallet <address>    Your Magic Wallet address, as shown in the Bleap app
  --rpc <url>           Your own RPC endpoint (default: a public endpoint, when known)
  --key-file <path>     File containing your signer private key (see "Signer key" in --help)
  --yes                 Do not ask for confirmation (not recommended)
`;

const options = { ...COMMON_OPTIONS, ...SIGNER_OPTIONS, emergency: { type: 'boolean' } } as const;

async function run(args: string[], mode: 'trigger' | 'cancel'): Promise<void> {
  const { values } = parseArgs({ args, options, strict: true });
  if (values.help) {
    print(mode === 'trigger' ? triggerHelp : cancelHelp);
    return;
  }
  if (mode === 'cancel' && values.emergency) {
    throw new UsageError('--emergency only applies to the trigger command.');
  }
  const chainId = parseChainId(values.chain);
  // Checked before asking for the key, so nobody types it in for nothing.
  if (mode === 'trigger' && isBleapAppNetwork(chainId) && !values.emergency) {
    throw new RecoveryError(
      `The Bleap app supports ${getChainInfo(chainId).name}. Use the app on this network.`,
      {
        hint: `${APP_NETWORK_TRIGGER_NOTICE} If this is an emergency and you accept this, run the command again with --emergency.`,
      },
    );
  }
  const wallet = parseAddress(values.wallet, 'wallet');
  const network = await connect(chainId, values.rpc);
  const account = await loadSignerAccount({
    keyFile: values['key-file'],
    interactive: isInteractive(),
    log: info,
  });
  const signer = localSigner(network, account);

  const status = await inspectWallet(network.client, { wallet, signer: account.address });
  const plan =
    mode === 'trigger'
      ? planTrigger(status, account.address, { emergency: values.emergency })
      : planCancel(status, account.address);
  await executeTransaction(network, signer, plan, values.yes);

  // Each message is only printed once the wallet's state, read again, confirms it.
  const after = await inspectWallet(network.client, { wallet });
  const state = after.account?.slowWithdrawal;
  if (mode === 'cancel') {
    if (state?.status === 'not-triggered') print(green('\nThe slow withdrawal is cancelled.'));
  } else if (state && state.status !== 'not-triggered') {
    print(
      green(
        `\nThe slow withdrawal has started. You can withdraw from ${formatTimestamp(state.withdrawableAt)} (in ${formatDuration(state.remainingSeconds)}).`,
      ),
    );
  }
}

export const runTrigger = (args: string[]) => run(args, 'trigger');
export const runCancel = (args: string[]) => run(args, 'cancel');
