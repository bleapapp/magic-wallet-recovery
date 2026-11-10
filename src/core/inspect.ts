import {
  type Address,
  getAddress,
  type Hex,
  hexToBigInt,
  isAddressEqual,
  type PublicClient,
  slice,
  zeroAddress,
} from 'viem';
import { cosigningModuleV1Abi, cosigningModuleV2Abi, erc20Abi, kernelAbi } from './abis.js';
import { isBleapAppNetwork } from './chains.js';
import {
  ADDRESSES,
  ERC1967_IMPLEMENTATION_SLOT,
  KERNEL_V3_1_ACCOUNT_ID,
  MODULE_ADDRESSES,
  type ModuleVersion,
  NO_HOOK,
  VALIDATION_TYPE_PERMISSION,
} from './constants.js';
import { checkDependencies, type DependencyStatus, hasCode } from './dependencies.js';
import { isNetworkError, unlessNetworkError } from './errors.js';
import { moduleSignerId, rebuildOriginalDeployment } from './initCode.js';
import { sanitizeLabel } from './text.js';
import { findKnownToken } from './tokens.js';

/** Where the slow withdrawal of a wallet stands on one network. */
export type SlowWithdrawalState =
  | { status: 'not-triggered' }
  | {
      status: 'waiting' | 'ready';
      /** When the slow withdrawal was started (Unix seconds). */
      triggeredAt: bigint;
      /** First block timestamp at which the withdrawal operation is accepted. */
      withdrawableAt: bigint;
      /** Seconds left until `withdrawableAt` (0 when ready). */
      remainingSeconds: bigint;
    };

/** What the tool reads from a deployed Magic Wallet. */
export interface AccountInfo {
  implementation?: Address;
  accountId?: string;
  rootValidationId?: Hex;
  /** 4-byte Kernel permission ID of the root permission. */
  rootPermissionId?: Hex;
  /** bytes32 ID the Cosigning Module uses for the root permission. */
  moduleSignerId?: Hex;
  module?: { version?: ModuleVersion; address: Address };
  policyCount?: number;
  hook?: Address;
  /** Signer registered for the root permission: the only account that can recover funds. */
  signer?: Address;
  /** Waiting period configured on the module, in seconds (applies to new triggers). */
  timelockSeconds?: bigint;
  slowWithdrawal?: SlowWithdrawalState;
  /** Reasons this tool can't operate the wallet. Empty when the wallet is supported. */
  unsupported: string[];
  /** Unusual but non-blocking findings. */
  warnings: string[];
}

export interface TokenBalance {
  token: Address;
  symbol?: string;
  decimals?: number;
  balance?: bigint;
  error?: string;
}

export interface WalletStatus {
  chainId: number;
  wallet: Address;
  blockNumber: bigint;
  blockTimestamp: bigint;
  deployed: boolean;
  nativeBalance: bigint;
  tokens: TokenBalance[];
  /** Present when the wallet is deployed on this network. */
  account?: AccountInfo;
  /** For a wallet that is not deployed: the contracts needed to deploy it, and whether they exist. */
  dependencies?: DependencyStatus[];
  /**
   * For a wallet that is not deployed, when a signer is given: the wallet address rebuilt from that
   * signer, and whether it is this wallet. A wallet that doesn't match can't be deployed from it.
   */
  rebuild?: { signer: Address; address: Address; matches: boolean };
  /** Set when a signer is given and the wallet is deployed: is it the registered signer? */
  signerMatches?: boolean;
}

export interface InspectOptions {
  wallet: Address;
  /** ERC-20 tokens to read balances for. */
  tokens?: readonly Address[];
  /** Signer account to check against the wallet. */
  signer?: Address;
}

/** Reads everything relevant about a wallet on the client's network. Read-only. */
export async function inspectWallet(
  client: PublicClient,
  options: InspectOptions,
): Promise<WalletStatus> {
  const wallet = getAddress(options.wallet);
  const [chainId, block, deployed, nativeBalance, tokens] = await Promise.all([
    client.getChainId(),
    client.getBlock(),
    hasCode(client, wallet),
    client.getBalance({ address: wallet }),
    Promise.all((options.tokens ?? []).map((token) => readTokenBalance(client, token, wallet))),
  ]);

  const status: WalletStatus = {
    chainId,
    wallet,
    blockNumber: block.number,
    blockTimestamp: block.timestamp,
    deployed,
    nativeBalance,
    // A listed token shows its registry label: two tokens of a network can share a symbol.
    tokens: tokens.map((token) => ({
      ...token,
      symbol: findKnownToken(chainId, token.token)?.symbol ?? token.symbol,
    })),
  };

  if (!deployed) {
    status.dependencies = await checkDependencies(client);
    if (options.signer) {
      const rebuilt = rebuildOriginalDeployment(options.signer);
      status.rebuild = {
        signer: getAddress(options.signer),
        address: rebuilt.address,
        matches: isAddressEqual(rebuilt.address, wallet),
      };
    }
    return status;
  }

  status.account = await readAccount(client, wallet, block.timestamp);
  if (options.signer && status.account.signer) {
    status.signerMatches = isAddressEqual(options.signer, status.account.signer);
  }
  return status;
}

async function readTokenBalance(
  client: PublicClient,
  token: Address,
  owner: Address,
): Promise<TokenBalance> {
  const address = getAddress(token);
  try {
    const [balance, decimals, symbol] = await Promise.all([
      client.readContract({ address, abi: erc20Abi, functionName: 'balanceOf', args: [owner] }),
      client.readContract({ address, abi: erc20Abi, functionName: 'decimals' }),
      client
        .readContract({ address, abi: erc20Abi, functionName: 'symbol' })
        .then((value) => sanitizeLabel(value))
        .catch(() => undefined),
    ]);
    return { token: address, balance, decimals, symbol };
  } catch (error) {
    return {
      token: address,
      error: isNetworkError(error)
        ? 'could not be read (network problem): check again'
        : 'not an ERC-20 token on this network',
    };
  }
}

async function readAccount(
  client: PublicClient,
  wallet: Address,
  now: bigint,
): Promise<AccountInfo> {
  const info: AccountInfo = { unsupported: [], warnings: [] };
  // A contract that is not a Kernel rejects these calls; a network failure is reported as such.
  const [implementationSlot, accountId, rootValidationId] = await Promise.all([
    client
      .getStorageAt({ address: wallet, slot: ERC1967_IMPLEMENTATION_SLOT })
      .catch(unlessNetworkError(undefined)),
    client
      .readContract({ address: wallet, abi: kernelAbi, functionName: 'accountId' })
      .catch(unlessNetworkError(undefined)),
    client
      .readContract({ address: wallet, abi: kernelAbi, functionName: 'rootValidator' })
      .catch(unlessNetworkError(undefined)),
  ]);

  if (implementationSlot && hexToBigInt(implementationSlot) !== 0n) {
    info.implementation = getAddress(slice(implementationSlot, 12));
  }
  info.accountId = accountId;
  if (info.implementation && !isAddressEqual(info.implementation, ADDRESSES.kernelImplementation)) {
    info.warnings.push(
      `The wallet uses a Kernel implementation other than v3.1 (${info.implementation}). The tool simulates every step, but has only been tested with v3.1.`,
    );
  } else if (accountId && accountId !== KERNEL_V3_1_ACCOUNT_ID) {
    info.warnings.push(`Unexpected account ID: ${sanitizeLabel(accountId, 40)}.`);
  }

  if (!rootValidationId) {
    info.unsupported.push('This address is not a Magic Wallet (it has no Kernel root validator).');
    return info;
  }
  info.rootValidationId = rootValidationId;
  if (slice(rootValidationId, 0, 1) !== VALIDATION_TYPE_PERMISSION) {
    info.unsupported.push("The wallet's root validator is not a Cosigning Module permission.");
    return info;
  }

  const permissionId = slice(rootValidationId, 1, 5);
  info.rootPermissionId = permissionId;
  info.moduleSignerId = moduleSignerId(permissionId);

  const [permission, validation] = await Promise.all([
    client.readContract({
      address: wallet,
      abi: kernelAbi,
      functionName: 'permissionConfig',
      args: [permissionId],
    }),
    client.readContract({
      address: wallet,
      abi: kernelAbi,
      functionName: 'validationConfig',
      args: [rootValidationId],
    }),
  ]);

  const moduleAddress = getAddress(permission.signer);
  const version = (Object.keys(MODULE_ADDRESSES) as ModuleVersion[]).find((v) =>
    isAddressEqual(MODULE_ADDRESSES[v], moduleAddress),
  );
  info.module = { version, address: moduleAddress };
  info.policyCount = permission.policyData.length;
  info.hook = validation.hook;

  if (!version) {
    info.unsupported.push(
      `The root permission uses a signer module this tool does not know (${moduleAddress}).`,
    );
    return info;
  }
  if (info.policyCount > 0) {
    info.unsupported.push('The root permission has policies, which this tool does not support.');
  }
  if (!isAddressEqual(validation.hook, NO_HOOK)) {
    info.unsupported.push(
      'The root permission has an execution hook, which this tool does not support.',
    );
  }

  // `signers` and `timelockForSlowWithdraw` have the same signature in both module versions.
  const [signer, timelock] = await Promise.all([
    client.readContract({
      address: moduleAddress,
      abi: cosigningModuleV1Abi,
      functionName: 'signers',
      args: [wallet, info.moduleSignerId],
    }),
    client.readContract({
      address: moduleAddress,
      abi: cosigningModuleV1Abi,
      functionName: 'timelockForSlowWithdraw',
    }),
  ]);
  info.timelockSeconds = timelock;
  if (isAddressEqual(signer, zeroAddress)) {
    info.unsupported.push('No signer is registered for the root permission.');
  } else {
    info.signer = getAddress(signer);
  }

  info.slowWithdrawal =
    version === 'V1'
      ? await readSlowWithdrawalV1(client, moduleAddress, wallet, timelock, now)
      : await readSlowWithdrawalV2(client, moduleAddress, wallet, now);
  return info;
}

/**
 * V1 accepts the withdrawal once `block.timestamp - triggeredAt > timelock` (strictly greater), and
 * it reads the module's current timelock at that moment.
 */
async function readSlowWithdrawalV1(
  client: PublicClient,
  module: Address,
  wallet: Address,
  timelock: bigint,
  now: bigint,
): Promise<SlowWithdrawalState> {
  const triggeredAt = await client.readContract({
    address: module,
    abi: cosigningModuleV1Abi,
    functionName: 'triggeredSlowWithdrawals',
    args: [wallet],
  });
  return slowWithdrawalStateV1(triggeredAt, timelock, now);
}

/**
 * V2 stores the deadline (`readyAt`) when the slow withdrawal starts and returns it to the
 * EntryPoint as `validAfter`, which accepts the operation from that timestamp on.
 */
async function readSlowWithdrawalV2(
  client: PublicClient,
  module: Address,
  wallet: Address,
  now: bigint,
): Promise<SlowWithdrawalState> {
  const [triggeredAt, readyAt] = await client.readContract({
    address: module,
    abi: cosigningModuleV2Abi,
    functionName: 'triggeredSlowWithdrawals',
    args: [wallet],
  });
  return slowWithdrawalStateV2(BigInt(triggeredAt), BigInt(readyAt), now);
}

/** V1: the operation is accepted once `now - triggeredAt > timelock` (one second after the end). */
export function slowWithdrawalStateV1(
  triggeredAt: bigint,
  timelock: bigint,
  now: bigint,
): SlowWithdrawalState {
  if (triggeredAt === 0n) return { status: 'not-triggered' };
  return slowWithdrawalState(triggeredAt, triggeredAt + timelock + 1n, now);
}

/** V2: the EntryPoint accepts the operation from `readyAt` on (`validAfter` is inclusive). */
export function slowWithdrawalStateV2(
  triggeredAt: bigint,
  readyAt: bigint,
  now: bigint,
): SlowWithdrawalState {
  if (readyAt === 0n) return { status: 'not-triggered' };
  return slowWithdrawalState(triggeredAt, readyAt, now);
}

function slowWithdrawalState(
  triggeredAt: bigint,
  withdrawableAt: bigint,
  now: bigint,
): SlowWithdrawalState {
  const remainingSeconds = withdrawableAt > now ? withdrawableAt - now : 0n;
  return {
    status: remainingSeconds === 0n ? 'ready' : 'waiting',
    triggeredAt,
    withdrawableAt,
    remainingSeconds,
  };
}

/** The account info of a wallet the tool can operate, or an error explaining why it can't. */
export interface SupportedAccount extends AccountInfo {
  module: { version: ModuleVersion; address: Address };
  moduleSignerId: Hex;
  signer: Address;
  timelockSeconds: bigint;
  slowWithdrawal: SlowWithdrawalState;
}

export function getSupportedAccount(
  status: WalletStatus,
): SupportedAccount | { problems: string[] } {
  if (!status.deployed || !status.account) {
    return { problems: ['The wallet is not deployed on this network yet.'] };
  }
  const account = status.account;
  if (account.unsupported.length > 0) return { problems: account.unsupported };
  const { module, moduleSignerId, signer, timelockSeconds, slowWithdrawal } = account;
  if (
    !module?.version ||
    !moduleSignerId ||
    !signer ||
    timelockSeconds === undefined ||
    !slowWithdrawal
  ) {
    return { problems: ['The wallet could not be read completely. Try again.'] };
  }
  return {
    ...account,
    module: { version: module.version, address: module.address },
    moduleSignerId,
    signer,
    timelockSeconds,
    slowWithdrawal,
  };
}

/** What the person should do next on this network. */
export type NextStep =
  | { step: 'deploy'; message: string }
  | { step: 'mismatch'; message: string }
  | { step: 'trigger'; message: string }
  | { step: 'wait'; message: string }
  | { step: 'withdraw'; message: string }
  | { step: 'unsupported'; message: string };

export function nextStep(status: WalletStatus): NextStep {
  if (!status.deployed) {
    if (status.rebuild && !status.rebuild.matches) {
      return {
        step: 'mismatch',
        message: `This address is not the Magic Wallet of the signer account ${status.rebuild.signer}: the Magic Wallet of that account is ${status.rebuild.address}. Check that you entered the address the Bleap app shows to receive funds, and that the signer account is the one whose private key you exported from the same Bleap account.`,
      };
    }
    return {
      step: 'deploy',
      message:
        'Your wallet is not deployed on this network yet. Deploy it to reach the funds at its address.',
    };
  }
  const account = getSupportedAccount(status);
  if ('problems' in account) return { step: 'unsupported', message: account.problems.join(' ') };
  switch (account.slowWithdrawal.status) {
    case 'not-triggered':
      return {
        step: 'trigger',
        message: isBleapAppNetwork(status.chainId)
          ? 'The Bleap app supports this network: use the app here. A slow withdrawal on this network is for emergencies only, because starting one suspends your Bleap account.'
          : 'Start a slow withdrawal. Once the waiting period is over, you can move any asset out.',
      };
    case 'waiting':
      return { step: 'wait', message: 'The waiting period is running.' };
    case 'ready':
      return { step: 'withdraw', message: 'The waiting period is over. You can move assets out.' };
  }
}
