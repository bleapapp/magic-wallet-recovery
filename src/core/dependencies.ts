import {
  type Address,
  bytesToHex,
  concat,
  createPublicClient,
  fallback,
  getCreate2Address,
  type Hex,
  hexToBytes,
  http,
  isAddressEqual,
  keccak256,
  type PublicClient,
  pad,
  toHex,
} from 'viem';
import { getChainInfo } from './chains.js';
import { ADDRESSES } from './constants.js';
import { explainError, RecoveryError } from './errors.js';
import type { TransactionPlan } from './transactions.js';

/** A public transaction that deployed a contract. Any source works: the code is identical. */
export interface CreationSource {
  chainId: number;
  txHash: Hex;
}

/**
 * A contract that can be recreated at its usual address on a network where it is missing, by
 * sending its original creation code to the deterministic deployment proxy.
 *
 * The creation code itself is not stored in this repository. It is read from one of the public
 * `sources` and accepted only if its hash is `initCodeHash`, which also fixes the address.
 */
export interface Dependency {
  key: DependencyKey;
  name: string;
  address: Address;
  /** CREATE2 salt used with the deterministic deployment proxy. */
  salt: Hex;
  initCodeHash: Hex;
  initCodeSize: number;
  sources: readonly CreationSource[];
}

export type DependencyKey =
  | 'entryPoint'
  | 'kernelImplementation'
  | 'kernelFactory'
  | 'cosigningModuleV1'
  | 'cosigningModuleV2';

const ZERO_SALT: Hex = `0x${'00'.repeat(32)}`;
const BLEAP_MODULE_SALT: Hex = '0xab7167684f2a172da10107b6af0c13539f6cf8bc0ed94539c7970d9d8b15f2b2';

export const DEPENDENCIES: Record<DependencyKey, Dependency> = {
  entryPoint: {
    key: 'entryPoint',
    name: 'EntryPoint v0.7',
    address: ADDRESSES.entryPoint,
    salt: '0x90d8084deab30c2a37c45e8d47f49f2f7965183cb6990a98943ef94940681de3',
    initCodeHash: '0x30516d9cdbeabfaf62ea32d081a10ee3b95b92e5549cfc86353bbe85741c1404',
    initCodeSize: 16_650,
    sources: [
      { chainId: 1, txHash: '0x5c81ea86f6c54481d3e21c78675b4f1d985c1fa62b678dcdfdf7934ddd6e127e' },
      {
        chainId: 42161,
        txHash: '0x7a6fe1e9e21ad803572597430f7ab9fedcf26a46a57ac6e51d58b380e2cf6eb5',
      },
    ],
  },
  kernelImplementation: {
    key: 'kernelImplementation',
    name: 'Kernel v3.1 implementation',
    address: ADDRESSES.kernelImplementation,
    salt: ZERO_SALT,
    initCodeHash: '0x323219ce0d6b7528fe5d6c14ae2b57d4ef71c351f069dfc1c203dca3664be47e',
    initCodeSize: 23_387,
    sources: [
      { chainId: 1, txHash: '0x3beb10fe3617303b3e559a5ab189a111b8e26f95996d8ebc86c2eada9d48c7ee' },
      {
        chainId: 42161,
        txHash: '0x22b55b526acdfdceb223740528294773e7fb01632ba8823bf100de7e4e0bec5f',
      },
    ],
  },
  kernelFactory: {
    key: 'kernelFactory',
    name: 'Kernel v3.1 factory',
    address: ADDRESSES.kernelFactory,
    salt: ZERO_SALT,
    initCodeHash: '0x48918c4d09b4b6da1e81b4ed16591ed79fa4e04fdc8bf9c0b21b84daeba2b06f',
    initCodeSize: 1_164,
    sources: [
      { chainId: 1, txHash: '0xe5701bab5431307852ce77394faf2f15dd1d200e95c737e9327fd4ef88da3f73' },
      {
        chainId: 42161,
        txHash: '0x5333c8c7071fd191a56a4aff5895d13cc11a44f68f148c97114196449f1969b7',
      },
    ],
  },
  cosigningModuleV1: {
    key: 'cosigningModuleV1',
    name: 'Bleap Cosigning Module V1',
    address: ADDRESSES.cosigningModuleV1,
    salt: BLEAP_MODULE_SALT,
    initCodeHash: '0xb5c519d6044029a42043606acf95c2279416b7794a857ce76039f3d1b907ae60',
    initCodeSize: 9_615,
    sources: [
      { chainId: 1, txHash: '0x4cd3082b03de213153be78c945f3332ffb12e8d8cd991906a2844624b19e7f89' },
      {
        chainId: 42161,
        txHash: '0xd1bd07b5c7e520e8ce1bcc798c8ab3b1817cc639ba61f155f5f807380b354114',
      },
      { chainId: 56, txHash: '0x4bc30f9c8d73760491595589849278f9f9c0ce4d3378356c9d5d7d9cf77fecd9' },
    ],
  },
  cosigningModuleV2: {
    key: 'cosigningModuleV2',
    name: 'Bleap Cosigning Module V2',
    address: ADDRESSES.cosigningModuleV2,
    salt: BLEAP_MODULE_SALT,
    initCodeHash: '0x82481f93f4335eeb6a18541b4cdcbc9490a709d28d7f21156bc1b954f0626989',
    initCodeSize: 6_431,
    sources: [
      { chainId: 1, txHash: '0x92097e2e89870cd5c2d0e06cbcfe7b161cbd89e50b249345f8d81c93c1fa81f4' },
      {
        chainId: 42161,
        txHash: '0x354a7b562d777fb5570e44d613cf0f09d4bf824d4c4dfce6537017870938ec96',
      },
      {
        chainId: 8453,
        txHash: '0x04e29abd168a5f69eb271c50bb6b44282eae978228be957760b3b7cd3c7467d7',
      },
      { chainId: 56, txHash: '0xffeb40388da15b4ada3680681403d4a73adaebe2700e91c618010626f75bdd93' },
    ],
  },
};

/**
 * Contracts a wallet needs on a network to be deployed from its original setup and then used for a
 * slow withdrawal, in deployment order.
 */
export const WALLET_DEPENDENCY_KEYS: readonly DependencyKey[] = [
  'entryPoint',
  'kernelImplementation',
  'kernelFactory',
  'cosigningModuleV1',
];

/** Address a dependency's creation code deploys to through the deterministic deployment proxy. */
export function dependencyAddress(dependency: Dependency): Address {
  return getCreate2Address({
    from: ADDRESSES.deterministicDeployer,
    salt: dependency.salt,
    bytecodeHash: dependency.initCodeHash,
  });
}

export interface DependencyStatus {
  dependency: Dependency;
  deployed: boolean;
}

export async function hasCode(client: PublicClient, address: Address): Promise<boolean> {
  const code = await client.getCode({ address });
  return code !== undefined && code !== '0x';
}

/** Checks which dependencies already have code on the client's network. */
export async function checkDependencies(
  client: PublicClient,
  keys: readonly DependencyKey[] = WALLET_DEPENDENCY_KEYS,
): Promise<DependencyStatus[]> {
  return Promise.all(
    keys.map(async (key) => {
      const dependency = DEPENDENCIES[key];
      return { dependency, deployed: await hasCode(client, dependency.address) };
    }),
  );
}

/**
 * Extracts a dependency's creation code from the input of a transaction that deployed it, whether
 * the transaction called the deterministic deployment proxy directly or through another contract.
 * Returns `undefined` unless the extracted code has exactly the expected hash.
 */
export function extractCreationCode(input: Hex, dependency: Dependency): Hex | undefined {
  const bytes = hexToBytes(input);
  const salt = hexToBytes(dependency.salt);
  const size = dependency.initCodeSize;
  // When called through another contract, the proxy's input (`salt ‖ code`) is an ABI `bytes`
  // value, so it is preceded by its length.
  const lengthWord = hexToBytes(pad(toHex(32 + size), { size: 32 }));
  const candidates = [0];
  for (let i = 0; i + 64 <= bytes.length; i++) {
    if (startsWith(bytes, lengthWord, i)) candidates.push(i + 32);
  }
  for (const start of candidates) {
    if (start + 32 + size > bytes.length || !startsWith(bytes, salt, start)) continue;
    const code = bytes.subarray(start + 32, start + 32 + size);
    if (keccak256(code) === dependency.initCodeHash) return bytesToHex(code);
  }
  return undefined;
}

function startsWith(bytes: Uint8Array, prefix: Uint8Array, offset: number): boolean {
  if (offset + prefix.length > bytes.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (bytes[offset + i] !== prefix[i]) return false;
  }
  return true;
}

/** Reads the input of a source transaction. */
export type TransactionInputReader = (source: CreationSource) => Promise<Hex>;

/**
 * Reads source transactions through public RPC endpoints. `rpcUrls` lets you replace the
 * endpoints of a source network (e.g. with your own node).
 */
export function publicTransactionReader(
  rpcUrls: Record<number, readonly string[]> = {},
): TransactionInputReader {
  return async (source) => {
    const urls = rpcUrls[source.chainId] ?? getChainInfo(source.chainId).rpcUrls;
    if (urls.length === 0) throw new Error(`no RPC endpoint for chain ${source.chainId}`);
    const client = createPublicClient({
      transport: fallback(urls.map((url) => http(url, { timeout: 20_000 }))),
      // Never follow CCIP-Read (EIP-3668) redirects to URLs chosen by a contract.
      ccipRead: false,
    });
    const tx = await client.getTransaction({ hash: source.txHash });
    if (tx.hash.toLowerCase() !== source.txHash.toLowerCase()) {
      throw new Error('the endpoint returned a different transaction');
    }
    return tx.input;
  };
}

/** Finds a dependency's verified creation code from its public sources. */
export async function fetchCreationCode(
  dependency: Dependency,
  readInput: TransactionInputReader = publicTransactionReader(),
): Promise<{ code: Hex; source: CreationSource }> {
  if (!isAddressEqual(dependencyAddress(dependency), dependency.address)) {
    throw new RecoveryError(`Internal check failed for ${dependency.name}: unexpected address.`);
  }
  const problems: string[] = [];
  for (const source of dependency.sources) {
    const network = getChainInfo(source.chainId).name;
    try {
      const code = extractCreationCode(await readInput(source), dependency);
      if (code) return { code, source };
      problems.push(`${network}: the transaction does not contain the expected code`);
    } catch (error) {
      problems.push(`${network}: ${explainError(error)}`);
    }
  }
  throw new RecoveryError(`Could not read the creation code of ${dependency.name}.`, {
    hint: `Tried: ${problems.join('; ')}. Check your internet connection and try again. If it keeps failing, the command-line tool can read it through endpoints you choose: deploy --source-rpc <chain ID>=<url>.`,
  });
}

/** Transaction that recreates a dependency at its usual address. Anyone can send it. */
export function planDependencyDeployment(
  dependency: Dependency,
  code: Hex,
  source: CreationSource,
): TransactionPlan {
  if (keccak256(code) !== dependency.initCodeHash) {
    throw new RecoveryError(`The creation code of ${dependency.name} does not match.`);
  }
  return {
    title: `Deploy ${dependency.name}`,
    summary: [
      { label: 'Contract', value: dependency.name },
      { label: 'Address', value: dependency.address },
      {
        label: 'How',
        value: 'Replays its original creation through the deterministic deployment proxy',
      },
      {
        label: 'Code copied from',
        value: `${getChainInfo(source.chainId).name} transaction ${source.txHash}`,
      },
    ],
    to: ADDRESSES.deterministicDeployer,
    data: concat([dependency.salt, code]),
    value: 0n,
  };
}
