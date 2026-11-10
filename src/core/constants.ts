import type { Address, Hex } from 'viem';

/**
 * Contracts every Magic Wallet relies on. They are deployed with CREATE2, so each one has the same
 * address on every EVM network where it exists.
 */
export const ADDRESSES = {
  /** ERC-4337 EntryPoint v0.7. */
  entryPoint: '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
  /** Kernel v3.1 smart account implementation (the wallet is an ERC-1967 proxy pointing to it). */
  kernelImplementation: '0xBAC849bB641841b44E965fB01A4Bf5F074f84b4D',
  /** Kernel v3.1 factory. The wallet address is derived from this factory and the init data. */
  kernelFactory: '0xaac5D4240AF87249B3f71BC8E4A2cae074A3E419',
  /** Meta-factory (FactoryStaker) that forwards to the Kernel factory. Optional for this tool. */
  metaFactory: '0xd703aaE79538628d27099B8c4f621bE4CCd142d5',
  /** Bleap Cosigning Module, version 1. */
  cosigningModuleV1: '0x61576D9ef23514bfe6F080E22CcFFf473cf11A1A',
  /** Bleap Cosigning Module, version 2. */
  cosigningModuleV2: '0x5B424D5133fAE2cE64ce739cec0796343E957131',
  /** Deterministic deployment proxy used to deploy all the contracts above. */
  deterministicDeployer: '0x4e59b44847b379578588920cA78FbF26c0B4956C',
} as const satisfies Record<string, Address>;

export type ModuleVersion = 'V1' | 'V2';

export const MODULE_ADDRESSES: Record<ModuleVersion, Address> = {
  V1: ADDRESSES.cosigningModuleV1,
  V2: ADDRESSES.cosigningModuleV2,
};

/**
 * keccak256 of the ERC-1967 proxy creation code that the Kernel v3.1 factory deploys for each wallet.
 * Used to compute a wallet address offline (CREATE2 from the factory).
 */
export const KERNEL_PROXY_INIT_CODE_HASH: Hex =
  '0x85d96aa1c9a65886d094915d76ccae85f14027a02c1647dde659f869460f03e6';

/** Value of `accountId()` on a Kernel v3.1 account. */
export const KERNEL_V3_1_ACCOUNT_ID = 'kernel.advanced.v0.3.1';

/** ERC-1967 implementation storage slot. */
export const ERC1967_IMPLEMENTATION_SLOT: Hex =
  '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';

/** Salt passed to the Kernel factory when a Magic Wallet is created (index 0). */
export const WALLET_SALT: Hex = `0x${'00'.repeat(32)}`;

/** Kernel `execute` mode for one call that reverts on failure (CALLTYPE_SINGLE, EXECTYPE_DEFAULT). */
export const EXEC_MODE_SINGLE: Hex = `0x${'00'.repeat(32)}`;

/** Kernel validation type byte for a permission-based validator. */
export const VALIDATION_TYPE_PERMISSION: Hex = '0x02';

/** Permission flag used for the root permission (applies to UserOps and signatures). */
export const PERMISSION_FLAG_ALL: Hex = '0x0000';

/**
 * A Kernel permission without policies expects this byte in front of the signer's signature.
 * The remaining 65 bytes are handed to the Cosigning Module.
 */
export const PERMISSION_SIGNER_PREFIX: Hex = '0xff';

/** Hook value Kernel stores for a validator installed without a hook. */
export const NO_HOOK: Address = '0x0000000000000000000000000000000000000001';

/** Gas limits used for the slow-withdrawal UserOperation. Fees are 0, so these cost nothing extra. */
export const USER_OP_GAS = {
  verificationGasLimit: 400_000n,
  minCallGasLimit: 100_000n,
  /** Used when the node cannot estimate the inner call (rare). */
  fallbackCallGasLimit: 500_000n,
} as const;

/** Safety margin applied to gas estimates, in percent. */
export const GAS_MARGIN_PERCENT = 25n;
