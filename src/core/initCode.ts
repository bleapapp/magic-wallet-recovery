import {
  type Address,
  bytesToHex,
  concat,
  decodeAbiParameters,
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  getAddress,
  getCreate2Address,
  type Hex,
  hexToBytes,
  isAddressEqual,
  keccak256,
  pad,
  size,
  slice,
  toFunctionSelector,
  zeroAddress,
} from 'viem';
import { kernelAbi, kernelFactoryAbi } from './abis.js';
import {
  ADDRESSES,
  KERNEL_PROXY_INIT_CODE_HASH,
  MODULE_ADDRESSES,
  type ModuleVersion,
  NO_HOOK,
  PERMISSION_FLAG_ALL,
  VALIDATION_TYPE_PERMISSION,
  WALLET_SALT,
} from './constants.js';

/**
 * Everything needed to deploy a wallet through the Kernel factory:
 * `KernelFactory.createAccount(initData, salt)` deploys the wallet at `address` on any network.
 */
export interface WalletDeployment {
  address: Address;
  /** `Kernel.initialize(...)` call data. */
  initData: Hex;
  /** Salt passed to the Kernel factory. */
  salt: Hex;
}

/** Signer data the Cosigning Module stores at install time (V1: 20 raw bytes, V2: ABI-encoded). */
export function signerInstallData(signer: Address, version: ModuleVersion): Hex {
  return version === 'V1' ? signer : encodeAbiParameters([{ type: 'address' }], [signer]);
}

/**
 * Kernel permission ID of a root permission whose signer is the Cosigning Module and which has no
 * policies. It is the first 4 bytes of a hash of the permission configuration.
 */
export function rootPermissionId(signer: Address, version: ModuleVersion): Hex {
  const policyId = encodeAbiParameters([{ type: 'bytes[]' }], [[]]);
  const signerId = encodeAbiParameters(
    [{ type: 'bytes' }],
    [concat([MODULE_ADDRESSES[version], signerInstallData(signer, version)])],
  );
  const permissionData = encodeAbiParameters(
    [{ type: 'bytes[]' }],
    [[policyId, PERMISSION_FLAG_ALL, signerId]],
  );
  return slice(keccak256(permissionData), 0, 4);
}

/** Kernel validation ID (bytes21) of a permission: `0x02 ‖ permissionId ‖ 16 zero bytes`. */
export function permissionValidationId(permissionId: Hex): Hex {
  return pad(concat([VALIDATION_TYPE_PERMISSION, permissionId]), { size: 21, dir: 'right' });
}

/** The bytes32 `id` the Cosigning Module expects: the 4-byte permission ID, left-aligned. */
export function moduleSignerId(permissionId: Hex): Hex {
  return pad(permissionId, { size: 32, dir: 'right' });
}

/** Install data of the root permission: one signer entry, no policies. */
export function rootValidatorData(signer: Address, version: ModuleVersion): Hex {
  const entry = concat([
    PERMISSION_FLAG_ALL,
    MODULE_ADDRESSES[version],
    signerInstallData(signer, version),
  ]);
  return encodeAbiParameters([{ type: 'bytes[]' }], [[lowercase(entry)]]);
}

/** `Kernel.initialize(...)` call data for a wallet whose root signer is `signer`. */
export function kernelInitData(signer: Address, version: ModuleVersion): Hex {
  return lowercase(
    encodeFunctionData({
      abi: kernelAbi,
      functionName: 'initialize',
      args: [
        permissionValidationId(rootPermissionId(signer, version)),
        zeroAddress,
        rootValidatorData(signer, version),
        '0x',
        [],
      ],
    }),
  );
}

/** Hex built with `concat` keeps the case of checksummed addresses; bytes decoded from the chain don't. */
function lowercase(hex: Hex): Hex {
  return hex.toLowerCase() as Hex;
}

/** Address the Kernel factory deploys `initData` to. Pure computation, works for any network. */
export function computeWalletAddress(initData: Hex, salt: Hex = WALLET_SALT): Address {
  const create2Salt = keccak256(encodePacked(['bytes', 'bytes32'], [initData, salt]));
  return getCreate2Address({
    from: ADDRESSES.kernelFactory,
    salt: create2Salt,
    bytecodeHash: KERNEL_PROXY_INIT_CODE_HASH,
  });
}

/**
 * Rebuilds the original deployment of a Magic Wallet from its signer address.
 *
 * Every Magic Wallet is created with the same recipe: a root permission on Cosigning Module V1 with
 * the signer as owner, no hook, no extra modules, factory index 0. The address therefore only depends
 * on the signer. A wallet that later moved to Cosigning Module V2 on one network keeps this original
 * recipe everywhere else, so redeploying it elsewhere recreates its original (V1) configuration.
 */
export function rebuildOriginalDeployment(signer: Address): WalletDeployment {
  const initData = kernelInitData(signer, 'V1');
  return { address: computeWalletAddress(initData), initData, salt: WALLET_SALT };
}

/** Call that deploys a wallet through the Kernel factory. */
export function walletDeploymentCall(deployment: WalletDeployment): { to: Address; data: Hex } {
  return {
    to: ADDRESSES.kernelFactory,
    data: encodeFunctionData({
      abi: kernelFactoryAbi,
      functionName: 'createAccount',
      args: [deployment.initData, deployment.salt],
    }),
  };
}

const INITIALIZE_SELECTOR = toFunctionSelector('initialize(bytes21,address,bytes,bytes,bytes[])');

/**
 * Finds a wallet's init data in the input of the transaction that first deployed it, whatever the
 * shape of that transaction (EntryPoint `handleOps`, meta-factory, factory, or a batch of those).
 *
 * In every one of these encodings the init data is an ABI `bytes` value, so it is preceded by its
 * length, and the factory salt sits two words before it. Each candidate is accepted only if it
 * deploys to `wallet`, so a wrong match is impossible.
 */
export function findDeploymentInCalldata(
  input: Hex,
  wallet: Address,
): WalletDeployment | undefined {
  const bytes = hexToBytes(input);
  const selector = hexToBytes(INITIALIZE_SELECTOR);
  for (let start = 32; start + selector.length <= bytes.length; start++) {
    if (!selector.every((byte, i) => bytes[start + i] === byte)) continue;
    const length = readLengthWord(bytes, start - 32);
    if (length === undefined || length < selector.length || start + length > bytes.length) continue;
    const initData = bytesToHex(bytes.subarray(start, start + length));
    const salts: Hex[] = [WALLET_SALT];
    if (start >= 64) salts.unshift(bytesToHex(bytes.subarray(start - 64, start - 32)));
    for (const salt of salts) {
      const address = computeWalletAddress(initData, salt);
      if (isAddressEqual(address, wallet)) return { address, initData, salt };
    }
  }
  return undefined;
}

/** Reads a 32-byte big-endian word as a length, if it is small enough to be one. */
function readLengthWord(bytes: Uint8Array, offset: number): number | undefined {
  if (offset < 0 || offset + 32 > bytes.length) return undefined;
  let value = 0;
  for (let i = offset; i < offset + 32; i++) {
    const byte = bytes[i] ?? 0;
    if (i < offset + 28) {
      if (byte !== 0) return undefined;
      continue;
    }
    value = value * 256 + byte;
  }
  return value;
}

/** What a wallet's init data says about its root permission. */
export interface DecodedInitData {
  rootValidationId: Hex;
  module: Address;
  moduleVersion?: ModuleVersion;
  signer?: Address;
}

/** Hook values Kernel treats as "no hook" at initialization. */
const NO_HOOK_VALUES: readonly Address[] = [zeroAddress, NO_HOOK];

/**
 * Decodes the init data of a plain Magic Wallet setup: a root permission with a single signer
 * entry, no policies, no hook and no other modules. Returns `undefined` for anything else, so a
 * deployment is never described as the plain setup when it installs more.
 */
export function decodeInitData(initData: Hex): DecodedInitData | undefined {
  try {
    const { functionName, args } = decodeFunctionData({ abi: kernelAbi, data: initData });
    if (functionName !== 'initialize') return undefined;
    const [rootValidationId, hook, validatorData, hookData, initConfig] = args;
    if (!NO_HOOK_VALUES.some((value) => isAddressEqual(value, hook))) return undefined;
    if (hookData !== '0x' || initConfig.length > 0) return undefined;
    const [entries] = decodeAbiParameters([{ type: 'bytes[]' }], validatorData);
    // Policies come before the signer entry: a single entry means there are none.
    if (entries.length !== 1) return undefined;
    const signerEntry = entries[0];
    if (!signerEntry || size(signerEntry) < 22) return undefined;
    const module = getAddress(slice(signerEntry, 2, 22));
    const signerData = slice(signerEntry, 22);
    const moduleVersion = (Object.keys(MODULE_ADDRESSES) as ModuleVersion[]).find((version) =>
      isAddressEqual(MODULE_ADDRESSES[version], module),
    );
    let signer: Address | undefined;
    if (size(signerData) === 20) signer = getAddress(signerData);
    else if (size(signerData) === 32) signer = getAddress(slice(signerData, 12));
    return { rootValidationId, module, moduleVersion, signer };
  } catch {
    return undefined;
  }
}
