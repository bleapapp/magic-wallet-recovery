import {
  type Address,
  concat,
  encodeFunctionData,
  type Hex,
  hexToBigInt,
  isAddressEqual,
  type PublicClient,
  parseEventLogs,
  parseSignature,
  recoverMessageAddress,
  serializeSignature,
  size,
  type TransactionReceipt,
  toHex,
} from 'viem';
import {
  getUserOperationHash,
  toPackedUserOperation,
  type UserOperation,
} from 'viem/account-abstraction';
import { entryPoint07Abi, kernelAbi } from './abis.js';
import { ADDRESSES, EXEC_MODE_SINGLE, PERMISSION_SIGNER_PREFIX, USER_OP_GAS } from './constants.js';
import {
  describeRevert,
  describeRevertData,
  explainError,
  isRevert,
  RecoveryError,
} from './errors.js';
import { withGasMargin } from './transactions.js';

/** One call made by the wallet: the only shape a slow withdrawal accepts. */
export interface WalletCall {
  target: Address;
  value: bigint;
  data: Hex;
}

export type SlowWithdrawUserOperation = UserOperation<'0.7'>;

/** `Kernel.execute(mode, target ‖ value ‖ data)` for a single call. */
export function encodeExecuteCallData(call: WalletCall): Hex {
  return encodeFunctionData({
    abi: kernelAbi,
    functionName: 'execute',
    args: [EXEC_MODE_SINGLE, concat([call.target, toHex(call.value, { size: 32 }), call.data])],
  });
}

/**
 * Runs the wallet's `execute` as the EntryPoint would, against the latest state. A revert here means
 * the withdrawal itself would fail (e.g. not enough balance), so it is reported before signing.
 * Returns the gas limit to use for the call, and whether the call could be simulated: the later
 * simulation of the whole operation can't tell, because the EntryPoint does not revert when the
 * wallet's call fails.
 */
export async function simulateWalletCall(
  client: PublicClient,
  wallet: Address,
  call: WalletCall,
): Promise<{ callGasLimit: bigint; simulated: boolean }> {
  const data = encodeExecuteCallData(call);
  try {
    const estimate = await client.estimateGas({ account: ADDRESSES.entryPoint, to: wallet, data });
    const withMargin = withGasMargin(estimate);
    return {
      callGasLimit:
        // biome-ignore lint/complexity/useMathMinMax: bigint values, which Math.max doesn't accept.
        withMargin > USER_OP_GAS.minCallGasLimit ? withMargin : USER_OP_GAS.minCallGasLimit,
      simulated: true,
    };
  } catch (error) {
    if (isRevert(error)) throw withdrawalWouldFail(error);
  }
  // Some nodes refuse to estimate gas for a call sent from a contract address. Running the call
  // with the fallback limit still shows that it succeeds within that limit.
  const callGasLimit = USER_OP_GAS.fallbackCallGasLimit;
  try {
    await client.call({ account: ADDRESSES.entryPoint, to: wallet, data, gas: callGasLimit });
    return { callGasLimit, simulated: true };
  } catch (error) {
    if (isRevert(error)) throw withdrawalWouldFail(error);
    return { callGasLimit, simulated: false };
  }
}

function withdrawalWouldFail(error: unknown): RecoveryError {
  return new RecoveryError('This withdrawal would fail.', {
    hint: describeRevert(error) ?? explainError(error),
    cause: error,
  });
}

/**
 * Builds the slow-withdrawal UserOperation: one call, nonce key 0 (the wallet's root permission),
 * no factory, no paymaster, and both fee fields set to 0. With zero fees the EntryPoint requires no
 * prefund, so neither the wallet nor the EntryPoint needs any native token.
 */
export async function buildSlowWithdrawUserOp(
  client: PublicClient,
  params: { wallet: Address; call: WalletCall; callGasLimit: bigint },
): Promise<SlowWithdrawUserOperation> {
  const nonce = await client.readContract({
    address: ADDRESSES.entryPoint,
    abi: entryPoint07Abi,
    functionName: 'getNonce',
    args: [params.wallet, 0n],
  });
  return {
    sender: params.wallet,
    nonce,
    callData: encodeExecuteCallData(params.call),
    callGasLimit: params.callGasLimit,
    verificationGasLimit: USER_OP_GAS.verificationGasLimit,
    preVerificationGas: 0n,
    maxFeePerGas: 0n,
    maxPriorityFeePerGas: 0n,
    signature: '0x',
  };
}

export function getSlowWithdrawUserOpHash(userOp: SlowWithdrawUserOperation, chainId: number): Hex {
  return getUserOperationHash({
    chainId,
    entryPointAddress: ADDRESSES.entryPoint,
    entryPointVersion: '0.7',
    userOperation: { ...userOp, signature: '0x' },
  });
}

const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

/**
 * Returns the signature as 65 bytes `r ‖ s ‖ v` with `v` in {27, 28} and a low `s` (EIP-2), which
 * is what both module versions accept. Wallets normally already produce this form.
 */
export function normalizeSignature(signature: Hex): Hex {
  if (size(signature) !== 65) {
    throw new RecoveryError(`Expected a 65-byte signature, got ${size(signature)} bytes.`);
  }
  const { r, s, yParity } = parseSignature(signature);
  let sValue = hexToBigInt(s);
  let parity = yParity;
  if (sValue > SECP256K1_N / 2n) {
    sValue = SECP256K1_N - sValue;
    parity = parity === 0 ? 1 : 0;
  }
  return serializeSignature({ r, s: toHex(sValue, { size: 32 }), yParity: parity });
}

/** Checks that `signature` signs `userOpHash` (EIP-191) with `expectedSigner`'s key. */
export async function verifyOwnerSignature(
  userOpHash: Hex,
  signature: Hex,
  expectedSigner: Address,
): Promise<Hex> {
  const normalized = normalizeSignature(signature);
  const recovered = await recoverMessageAddress({
    message: { raw: userOpHash },
    signature: normalized,
  });
  if (!isAddressEqual(recovered, expectedSigner)) {
    throw new RecoveryError(
      `The signature comes from ${recovered}, not from the wallet's signer ${expectedSigner}.`,
      {
        hint: 'Make sure your browser wallet or key file uses the account registered for this wallet.',
      },
    );
  }
  return normalized;
}

/**
 * The UserOperation signature for a root permission without policies: `0xff` followed by the
 * owner's 65-byte signature. A 65-byte owner signature is what selects the slow-withdrawal path.
 */
export function encodeSlowWithdrawSignature(ownerSignature: Hex): Hex {
  return concat([PERMISSION_SIGNER_PREFIX, normalizeSignature(ownerSignature)]);
}

/** `EntryPoint.handleOps([userOp], beneficiary)`: submits the operation without any bundler. */
export function encodeHandleOps(userOp: SlowWithdrawUserOperation, beneficiary: Address): Hex {
  return encodeFunctionData({
    abi: entryPoint07Abi,
    functionName: 'handleOps',
    args: [[toPackedUserOperation(userOp)], beneficiary],
  });
}

/** Runs `handleOps` against the latest state. Throws a readable error if the wallet rejects it. */
export async function simulateHandleOps(
  client: PublicClient,
  from: Address,
  userOp: SlowWithdrawUserOperation,
): Promise<void> {
  try {
    await client.call({
      account: from,
      to: ADDRESSES.entryPoint,
      data: encodeHandleOps(userOp, from),
    });
  } catch (error) {
    if (!isRevert(error)) {
      throw new RecoveryError('Could not simulate the operation.', {
        hint: explainError(error),
        cause: error,
      });
    }
    throw new RecoveryError('The wallet would reject this operation.', {
      hint: describeRevert(error) ?? explainError(error),
      cause: error,
    });
  }
}

export interface UserOperationResult {
  found: boolean;
  success: boolean;
  /** Explanation of why the wallet's call failed, if it did. */
  revertReason?: string;
}

/**
 * Reads the outcome of a UserOperation from the `handleOps` receipt. The transaction itself
 * succeeds even when the wallet's call fails, so this is the result that matters.
 */
export function readUserOperationResult(
  receipt: TransactionReceipt,
  userOpHash: Hex,
): UserOperationResult {
  const logs = receipt.logs.filter((log) => isAddressEqual(log.address, ADDRESSES.entryPoint));
  const events = parseEventLogs({
    abi: entryPoint07Abi,
    logs,
    eventName: ['UserOperationEvent', 'UserOperationRevertReason'],
  });
  const matches = (hash: Hex) => hash.toLowerCase() === userOpHash.toLowerCase();
  let found = false;
  let success = false;
  let revertReason: string | undefined;
  for (const event of events) {
    if (event.eventName === 'UserOperationEvent' && matches(event.args.userOpHash)) {
      found = true;
      success = event.args.success;
    }
    if (event.eventName === 'UserOperationRevertReason' && matches(event.args.userOpHash)) {
      revertReason =
        event.args.revertReason === '0x' ? undefined : describeRevertData(event.args.revertReason);
    }
  }
  return { found, success, revertReason };
}
