import {
  type Address,
  type Chain,
  createPublicClient,
  createWalletClient,
  fallback,
  type Hex,
  http,
  isHex,
  type PublicClient,
  TimeoutError,
  type Transport,
} from 'viem';
import type { PrivateKeyAccount } from 'viem/accounts';
import { type ChainInfo, getChainInfo, toViemChain } from '../core/chains.js';
import { explainError, RecoveryError } from '../core/errors.js';
import { parseAddressInput } from '../core/format.js';
import type { RecoverySigner } from '../core/transactions.js';

/** Raised for invalid command-line input: the CLI exits with code 2 and suggests `--help`. */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

/** Options every command accepts. */
export const COMMON_OPTIONS = {
  chain: { type: 'string' },
  rpc: { type: 'string' },
  wallet: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
} as const;

export const SIGNER_OPTIONS = {
  'key-file': { type: 'string' },
  yes: { type: 'boolean', short: 'y' },
} as const;

export interface NetworkContext {
  chain: ChainInfo;
  viemChain: Chain;
  transport: Transport;
  client: PublicClient;
}

export function parseAddress(value: string | undefined, name: string): Address {
  if (!value) throw new UsageError(`Missing --${name} <address>.`);
  try {
    return parseAddressInput(value, `--${name} "${value}"`);
  } catch (error) {
    throw new UsageError(explainError(error));
  }
}

export function parseChainId(value: string | undefined): number {
  if (!value)
    throw new UsageError(
      'Missing --chain <id> (for example 1 for Ethereum, 43114 for Avalanche C-Chain).',
    );
  if (!/^\d+$/.test(value)) throw new UsageError(`--chain: "${value}" is not a chain ID.`);
  return Number(value);
}

export function parseHex(value: string | undefined, name: string): Hex {
  if (!value || !isHex(value))
    throw new UsageError(`--${name}: expected a 0x-prefixed hexadecimal value.`);
  // Bytes are two digits each: an odd count means a digit is missing, and encoding would silently
  // pad it, shifting everything after the gap.
  if (value.length % 2 !== 0) {
    throw new UsageError(
      `--${name}: odd number of hexadecimal digits, so part of the value is missing. Copy it again.`,
    );
  }
  return value;
}

export function parseInteger(value: string | undefined, name: string): bigint {
  if (!value || !/^\d+$/.test(value)) throw new UsageError(`--${name}: expected a whole number.`);
  return BigInt(value);
}

/** Connects to a network and checks that the endpoint really serves the expected chain. */
export async function connect(chainId: number, rpcUrl?: string): Promise<NetworkContext> {
  const chain = getChainInfo(chainId);
  const urls = rpcUrl ? [rpcUrl] : [...chain.rpcUrls];
  if (urls.length === 0) {
    throw new UsageError(`No public endpoint is built in for chain ${chainId}. Pass --rpc <url>.`);
  }
  const transport = urls.length > 1 ? fallback(urls.map((url) => http(url))) : http(urls[0]);
  const viemChain = toViemChain(chain, rpcUrl);
  // No CCIP-Read (EIP-3668): a contract this tool reads, such as a token address the user typed,
  // could otherwise make it fetch a URL of the contract's choosing.
  const client = createPublicClient({ chain: viemChain, transport, ccipRead: false });
  const actual = await client.getChainId().catch((error: unknown) => {
    throw new RecoveryError(`Could not reach the RPC endpoint for ${chain.name}.`, {
      hint: connectionProblem(error),
      cause: error,
    });
  });
  if (actual !== chainId) {
    throw new RecoveryError(
      `The RPC endpoint serves chain ${actual}, not chain ${chainId}. Nothing was done.`,
    );
  }
  return { chain, viemChain, transport, client };
}

/**
 * Says why an endpoint could not be reached, only from fields that can't contain its URL (which may
 * embed an API key): the HTTP status, or the system error code (`ENOTFOUND`, `ECONNREFUSED`…).
 */
export function connectionProblem(error: unknown): string | undefined {
  type Fields = { status?: unknown; code?: unknown; cause?: unknown };
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current && typeof current === 'object'; depth++) {
    if (current instanceof TimeoutError) return 'The endpoint did not answer in time.';
    const { status, code, cause } = current as Fields;
    if (typeof status === 'number') {
      return status === 401 || status === 403
        ? `The endpoint refused the request (HTTP ${status}). If its URL contains an API key, check the key.`
        : `The endpoint answered with HTTP status ${status}.`;
    }
    if (typeof code === 'string') return `Network error ${code}.`;
    current = cause;
  }
  return undefined;
}

/** A signer backed by a local private key. The key never leaves this process. */
export function localSigner(network: NetworkContext, account: PrivateKeyAccount): RecoverySigner {
  const walletClient = createWalletClient({
    account,
    chain: network.viemChain,
    transport: network.transport,
  });
  return {
    address: account.address,
    sendTransaction: (tx) =>
      walletClient.sendTransaction({ to: tx.to, data: tx.data, value: tx.value, gas: tx.gas }),
    signRawMessage: (message) => account.signMessage({ message: { raw: message } }),
  };
}
