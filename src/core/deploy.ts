import { type Address, getAddress, type Hex, isAddressEqual, type PublicClient } from 'viem';
import { kernelFactoryAbi } from './abis.js';
import { getChainInfo } from './chains.js';
import { ADDRESSES, type ModuleVersion } from './constants.js';
import {
  checkDependencies,
  type Dependency,
  type DependencyKey,
  type DependencyStatus,
  hasCode,
} from './dependencies.js';
import { RecoveryError } from './errors.js';
import {
  computeWalletAddress,
  decodeInitData,
  findDeploymentInCalldata,
  rebuildOriginalDeployment,
  type WalletDeployment,
  walletDeploymentCall,
} from './initCode.js';
import { inspectWallet } from './inspect.js';
import type { TransactionPlan } from './transactions.js';

/** Where a wallet's original setup comes from. */
export type DeploymentSource =
  | { kind: 'signer'; signer: Address }
  | { kind: 'transaction'; input: Hex };

export interface DeploymentPlan {
  chainId: number;
  wallet: Address;
  deployment: WalletDeployment;
  /** Signer the wallet was created for. */
  signer: Address;
  moduleVersion: ModuleVersion;
  alreadyDeployed: boolean;
  dependencies: DependencyStatus[];
  /** Dependencies to deploy first, in order. */
  missing: Dependency[];
  deterministicDeployerAvailable: boolean;
}

/**
 * Finds the wallet's original setup and checks that it deploys to `wallet`. Nothing is sent before
 * this check passes, so the tool can never deploy a wallet at another address.
 */
export function resolveOriginalDeployment(
  wallet: Address,
  source: DeploymentSource,
): WalletDeployment {
  if (source.kind === 'transaction') {
    const found = findDeploymentInCalldata(source.input, wallet);
    if (!found) {
      throw new RecoveryError('This transaction does not contain the setup of this wallet.', {
        hint: 'Use the transaction that first deployed the wallet on another network.',
      });
    }
    return found;
  }
  const rebuilt = rebuildOriginalDeployment(source.signer);
  if (!isAddressEqual(rebuilt.address, wallet)) {
    throw new RecoveryError(
      `The wallet address ${wallet} cannot be rebuilt from the signer ${source.signer}.`,
      {
        hint: 'Check that the wallet address is the one shown in the Bleap app, and that the key is the one exported from the same account. If both are right, use the hash of the transaction that first deployed the wallet on another network.',
      },
    );
  }
  return rebuilt;
}

export async function planWalletDeployment(
  client: PublicClient,
  params: { wallet: Address; source: DeploymentSource; expectedSigner?: Address },
): Promise<DeploymentPlan> {
  const wallet = getAddress(params.wallet);
  const deployment = resolveOriginalDeployment(wallet, params.source);
  const decoded = decodeInitData(deployment.initData);
  if (!decoded?.signer || !decoded.moduleVersion) {
    throw new RecoveryError(
      'The setup of this wallet uses a configuration this tool does not support.',
      {
        hint: 'The tool only deploys the plain setup: Cosigning Module V1 or V2 as the only signer, without policies, hooks or other modules.',
      },
    );
  }
  if (params.expectedSigner && !isAddressEqual(decoded.signer, params.expectedSigner)) {
    throw new RecoveryError(
      `This wallet was created for the signer ${decoded.signer}, but you are using ${params.expectedSigner}.`,
      { hint: 'Use the private key exported from the Bleap account that owns this wallet.' },
    );
  }
  const moduleKey: DependencyKey =
    decoded.moduleVersion === 'V1' ? 'cosigningModuleV1' : 'cosigningModuleV2';
  const [chainId, alreadyDeployed, dependencies, deterministicDeployerAvailable] =
    await Promise.all([
      client.getChainId(),
      hasCode(client, wallet),
      checkDependencies(client, ['entryPoint', 'kernelImplementation', 'kernelFactory', moduleKey]),
      hasCode(client, ADDRESSES.deterministicDeployer),
    ]);
  return {
    chainId,
    wallet,
    deployment,
    signer: decoded.signer,
    moduleVersion: decoded.moduleVersion,
    alreadyDeployed,
    dependencies,
    missing: dependencies.filter((d) => !d.deployed).map((d) => d.dependency),
    deterministicDeployerAvailable,
  };
}

/** Throws if missing dependencies can't be recreated on this network. */
export function assertDependenciesDeployable(plan: DeploymentPlan): void {
  if (plan.missing.length > 0 && !plan.deterministicDeployerAvailable) {
    throw new RecoveryError(
      `Some contracts your wallet needs are missing on this network (${plan.missing.map((d) => d.name).join(', ')}), and the deterministic deployment proxy (${ADDRESSES.deterministicDeployer}) is not available here to recreate them.`,
      { hint: 'The tool cannot deploy your wallet on this network.' },
    );
  }
}

/** The transaction that deploys the wallet itself, once every dependency is in place. */
export async function planWalletDeploymentTx(
  client: PublicClient,
  plan: DeploymentPlan,
): Promise<TransactionPlan> {
  if (plan.alreadyDeployed || (await hasCode(client, plan.wallet))) {
    throw new RecoveryError('The wallet is already deployed on this network.');
  }
  const stillMissing = (
    await checkDependencies(
      client,
      plan.dependencies.map((d) => d.dependency.key),
    )
  )
    .filter((d) => !d.deployed)
    .map((d) => d.dependency.name);
  if (stillMissing.length > 0) {
    throw new RecoveryError(`Deploy the missing contracts first: ${stillMissing.join(', ')}.`);
  }
  const { initData, salt } = plan.deployment;
  // Checked offline, then on-chain: networks that compute contract addresses differently are refused.
  if (!isAddressEqual(computeWalletAddress(initData, salt), plan.wallet)) {
    throw new RecoveryError('Internal check failed: the setup does not match the wallet address.');
  }
  const onChainAddress = await client.readContract({
    address: ADDRESSES.kernelFactory,
    abi: kernelFactoryAbi,
    functionName: 'getAddress',
    args: [initData, salt],
  });
  if (!isAddressEqual(onChainAddress, plan.wallet)) {
    throw new RecoveryError(
      `On this network the factory would deploy the wallet at ${onChainAddress}, not at ${plan.wallet}.`,
      {
        hint: 'This network computes contract addresses differently. Your wallet cannot be recreated here.',
      },
    );
  }
  const chain = getChainInfo(plan.chainId);
  const call = walletDeploymentCall(plan.deployment);
  return {
    title: 'Deploy your Magic Wallet',
    summary: [
      { label: 'Network', value: `${chain.name} (chain ID ${chain.id})` },
      { label: 'Wallet address', value: `${plan.wallet} (same as on your other networks)` },
      { label: 'Signer', value: plan.signer },
      {
        label: 'Setup',
        value: `Original setup: Cosigning Module ${plan.moduleVersion}, no other modules`,
      },
      { label: 'Factory', value: ADDRESSES.kernelFactory },
    ],
    warnings: [],
    to: call.to,
    data: call.data,
    value: 0n,
  };
}

/** Confirms that the deployed wallet has the expected signer. */
export async function verifyWalletDeployment(
  client: PublicClient,
  plan: DeploymentPlan,
): Promise<void> {
  const status = await inspectWallet(client, { wallet: plan.wallet, signer: plan.signer });
  if (!status.deployed) throw new RecoveryError('The wallet has no code after deployment.');
  if (status.signerMatches !== true) {
    throw new RecoveryError('The deployed wallet does not report the expected signer.');
  }
}
