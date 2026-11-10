import { parseArgs } from 'node:util';
import { inspectWallet } from '../../core/inspect.js';
import { tokensToRead } from '../../core/tokens.js';
import { COMMON_OPTIONS, connect, parseAddress, parseChainId } from '../context.js';
import { print, printStatus, toJson } from '../output.js';

export const inspectHelp = `Usage: magic-wallet-recovery inspect --chain <id> --wallet <address> [options]

Shows the state of a Magic Wallet on one network. Read-only: no key needed, nothing is sent.

  --chain <id>          Chain ID of the network (e.g. 1 for Ethereum)
  --wallet <address>    Your Magic Wallet address, as shown in the Bleap app
  --rpc <url>           Your own RPC endpoint (default: a public endpoint, when known)
  --token <address>     Also show the balance of this ERC-20 token (repeatable)
  --signer <address>    Check the wallet against this signer address
  --json                Print the result as JSON
`;

const options = {
  ...COMMON_OPTIONS,
  token: { type: 'string', multiple: true },
  signer: { type: 'string' },
  json: { type: 'boolean' },
} as const;

export async function runInspect(args: string[]): Promise<void> {
  const { values } = parseArgs({ args, options, strict: true });
  if (values.help) {
    print(inspectHelp);
    return;
  }

  const chainId = parseChainId(values.chain);
  const wallet = parseAddress(values.wallet, 'wallet');
  const signer = values.signer ? parseAddress(values.signer, 'signer') : undefined;
  const extraTokens = (values.token ?? []).map((token) => parseAddress(token, 'token'));
  const tokens = tokensToRead(chainId, extraTokens);

  const network = await connect(chainId, values.rpc);
  const status = await inspectWallet(network.client, { wallet, tokens, signer });
  if (values.json) print(toJson(status));
  else printStatus(status, network.chain);
}
