import { parseArgs } from 'node:util';
import type { Address, PublicClient, TransactionReceipt } from 'viem';
import { readErc20, type WithdrawAction } from '../../core/actions.js';
import { RecoveryError } from '../../core/errors.js';
import { parseTokenAmount } from '../../core/format.js';
import { inspectWallet } from '../../core/inspect.js';
import { sendPreparedTransaction } from '../../core/transactions.js';
import {
  checkWithdrawalReceipt,
  finalizeWithdrawal,
  prepareWithdrawal,
  SIGNING_NOTICE,
  withSignedNotice,
} from '../../core/withdraw.js';
import {
  COMMON_OPTIONS,
  connect,
  localSigner,
  parseAddress,
  parseChainId,
  parseHex,
  parseInteger,
  SIGNER_OPTIONS,
  UsageError,
} from '../context.js';
import { approve } from '../flow.js';
import { loadSignerAccount } from '../key.js';
import {
  bold,
  green,
  info,
  print,
  printPreparedTransaction,
  printSummary,
  printTransactionConfirmed,
  printTransactionSent,
  printWarnings,
} from '../output.js';
import { isInteractive } from '../prompt.js';

export const withdrawHelp = `Usage: magic-wallet-recovery withdraw --chain <id> --wallet <address> <asset options> [options]

Moves one asset out of your Magic Wallet once the waiting period is over. You review the
withdrawal, sign it with your key, then your signer account submits it and pays the network fee.
The wallet itself needs no native token. Run it again for each asset.

  --chain <id>               Chain ID of the network
  --wallet <address>         Your Magic Wallet address, as shown in the Bleap app
  --rpc <url>                Your own RPC endpoint (default: a public endpoint, when known)
  --key-file <path>          File containing your signer private key (see "Signer key" in --help)
  --to <address>             Destination (default: your signer account; not with --call-target)
  --yes                      Do not ask for confirmation (not recommended)

Asset options (choose one):
  --asset native --amount <amount|max>         The network's native token (ETH, AVAX, POL, ...)
  --asset <token> --amount <amount|max>        An ERC-20 token, by contract address
  --nft <contract> --token-id <id>             An ERC-721 NFT
  --erc1155 <contract> --token-id <id> --amount <n>
                                               ERC-1155 tokens
  --call-target <address> --call-data <hex> [--call-value <wei>]
                                               Advanced: any single call made by the wallet
`;

const options = {
  ...COMMON_OPTIONS,
  ...SIGNER_OPTIONS,
  asset: { type: 'string' },
  amount: { type: 'string' },
  to: { type: 'string' },
  nft: { type: 'string' },
  erc1155: { type: 'string' },
  'token-id': { type: 'string' },
  'call-target': { type: 'string' },
  'call-data': { type: 'string' },
  'call-value': { type: 'string' },
} as const;

type WithdrawValues = {
  asset?: string;
  amount?: string;
  to?: string;
  nft?: string;
  erc1155?: string;
  'token-id'?: string;
  'call-target'?: string;
  'call-data'?: string;
  'call-value'?: string;
};

export async function runWithdraw(args: string[]): Promise<void> {
  const { values } = parseArgs({ args, options, strict: true });
  if (values.help) {
    print(withdrawHelp);
    return;
  }
  const chainId = parseChainId(values.chain);
  const wallet = parseAddress(values.wallet, 'wallet');
  const network = await connect(chainId, values.rpc);
  const account = await loadSignerAccount({
    keyFile: values['key-file'],
    interactive: isInteractive(),
    log: info,
  });
  const signer = localSigner(network, account);

  const status = await inspectWallet(network.client, { wallet, signer: account.address });
  const action = await buildAction(network.client, values, wallet, account.address);
  const withdrawal = await prepareWithdrawal(network.client, {
    status,
    signer: account.address,
    action,
  });

  print();
  print(bold(withdrawal.title));
  printSummary(withdrawal.summary);
  printWarnings([...withdrawal.warnings, SIGNING_NOTICE]);
  await approve('Sign this withdrawal with your key?', values.yes);

  const signature = await signer.signRawMessage(withdrawal.userOpHash);
  // Until the transaction is sent, any way out (declining, a failed check, a node or fee error)
  // leaves a usable signed withdrawal behind, so it always ends with the notice.
  let sent = false;
  let receipt: TransactionReceipt;
  try {
    const tx = await finalizeWithdrawal(network.client, withdrawal, signature, signer.address);
    printPreparedTransaction(tx, network.chain);
    await approve('Submit it now?', values.yes, new RecoveryError('Not submitted.'));
    receipt = await sendPreparedTransaction(network.client, signer, tx, {
      onSent: (hash) => {
        sent = true;
        printTransactionSent(hash, network.chain);
      },
    });
  } catch (error) {
    throw sent ? error : withSignedNotice(error);
  }
  printTransactionConfirmed();
  checkWithdrawalReceipt(receipt, withdrawal);
  print(green(`\nDone: ${withdrawal.title}.`));
}

async function buildAction(
  client: PublicClient,
  values: WithdrawValues,
  wallet: Address,
  signer: Address,
): Promise<WithdrawAction> {
  const chosen = [values.asset, values.nft, values.erc1155, values['call-target']].filter(Boolean);
  if (chosen.length !== 1) {
    throw new UsageError('Choose exactly one of --asset, --nft, --erc1155 or --call-target.');
  }
  const to = values.to ? parseAddress(values.to, 'to') : signer;

  if (values['call-target']) {
    if (values.to) {
      throw new UsageError(
        '--to does not apply to --call-target: the call data alone decides where anything goes.',
      );
    }
    return {
      kind: 'call',
      target: parseAddress(values['call-target'], 'call-target'),
      data: parseHex(values['call-data'], 'call-data'),
      value: values['call-value'] ? parseInteger(values['call-value'], 'call-value') : 0n,
    };
  }
  if (values.nft) {
    return {
      kind: 'erc721',
      token: parseAddress(values.nft, 'nft'),
      tokenId: parseInteger(values['token-id'], 'token-id'),
      to,
    };
  }
  if (values.erc1155) {
    return {
      kind: 'erc1155',
      token: parseAddress(values.erc1155, 'erc1155'),
      tokenId: parseInteger(values['token-id'], 'token-id'),
      amount: parseInteger(values.amount, 'amount'),
      to,
    };
  }
  if (!values.amount) throw new UsageError('Missing --amount <amount|max>.');
  if (values.asset === 'native') {
    const amount =
      values.amount === 'max'
        ? await client.getBalance({ address: wallet })
        : parseTokenAmount(values.amount, 18);
    return { kind: 'native', to, amount };
  }
  const token = await readErc20(client, parseAddress(values.asset, 'asset'), wallet);
  const amount =
    values.amount === 'max' ? token.balance : parseTokenAmount(values.amount, token.decimals);
  return { kind: 'erc20', token: token.address, to, amount };
}
