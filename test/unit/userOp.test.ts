import {
  concat,
  decodeFunctionData,
  encodeAbiParameters,
  encodeErrorResult,
  encodeEventTopics,
  type Hex,
  hexToBigInt,
  keccak256,
  pad,
  parseAbi,
  parseSignature,
  serializeSignature,
  size,
  type TransactionReceipt,
  toHex,
} from 'viem';
import { getUserOperationHash } from 'viem/account-abstraction';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it } from 'vitest';
import { entryPoint07Abi, kernelAbi } from '../../src/core/abis.js';
import { ADDRESSES, EXEC_MODE_SINGLE } from '../../src/core/constants.js';
import {
  encodeExecuteCallData,
  encodeHandleOps,
  encodeSlowWithdrawSignature,
  getSlowWithdrawUserOpHash,
  normalizeSignature,
  readUserOperationResult,
  type SlowWithdrawUserOperation,
  verifyOwnerSignature,
} from '../../src/core/userOp.js';

const WALLET = '0x2222222222222222222222222222222222222222';
const TARGET = '0x3333333333333333333333333333333333333333';
const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

const userOp: SlowWithdrawUserOperation = {
  sender: WALLET,
  nonce: 0n,
  callData: encodeExecuteCallData({ target: TARGET, value: 5n, data: '0x1234' }),
  callGasLimit: 150_000n,
  verificationGasLimit: 400_000n,
  preVerificationGas: 0n,
  maxFeePerGas: 0n,
  maxPriorityFeePerGas: 0n,
  signature: '0x',
};

describe('callData', () => {
  it('is Kernel.execute with a single call', () => {
    expect(userOp.callData.slice(0, 10)).toBe('0xe9ae5c53');
    const decoded = decodeFunctionData({ abi: kernelAbi, data: userOp.callData });
    if (decoded.functionName !== 'execute') throw new Error(`unexpected ${decoded.functionName}`);
    const [mode, executionCalldata] = decoded.args;
    expect(mode).toBe(EXEC_MODE_SINGLE);
    expect(executionCalldata).toBe(concat([TARGET, toHex(5n, { size: 32 }), '0x1234']));
  });
});

describe('signature', () => {
  const account = privateKeyToAccount(generatePrivateKey());
  const hash = keccak256('0x01');

  it('is 0xff followed by the 65-byte owner signature', async () => {
    const signature = await account.signMessage({ message: { raw: hash } });
    const encoded = encodeSlowWithdrawSignature(signature);
    expect(size(encoded)).toBe(66);
    expect(encoded.slice(0, 4)).toBe('0xff');
    expect(encoded.slice(4)).toBe(signature.slice(2));
  });

  it('accepts a signature from the signer', async () => {
    const signature = await account.signMessage({ message: { raw: hash } });
    await expect(verifyOwnerSignature(hash, signature, account.address)).resolves.toBe(signature);
  });

  it('refuses a signature from another account', async () => {
    const other = privateKeyToAccount(generatePrivateKey());
    const signature = await other.signMessage({ message: { raw: hash } });
    await expect(verifyOwnerSignature(hash, signature, account.address)).rejects.toThrow(
      "not from the wallet's signer",
    );
  });

  it('turns a high-s signature into its canonical form', async () => {
    const signature = await account.signMessage({ message: { raw: hash } });
    const { r, s, yParity } = parseSignature(signature);
    const highS = serializeSignature({
      r,
      s: toHex(SECP256K1_N - hexToBigInt(s), { size: 32 }),
      yParity: yParity === 0 ? 1 : 0,
    });
    expect(normalizeSignature(highS)).toBe(signature);
  });

  it('turns v = 0/1 into v = 27/28', async () => {
    const signature = await account.signMessage({ message: { raw: hash } });
    const v = Number.parseInt(signature.slice(-2), 16) - 27;
    const raw = `${signature.slice(0, -2)}0${v}` as Hex;
    expect(normalizeSignature(raw)).toBe(signature);
  });

  it('refuses signatures that are not 65 bytes', () => {
    expect(() => normalizeSignature('0x1234')).toThrow('65-byte');
  });
});

describe('hash and submission', () => {
  it('hashes the operation like the EntryPoint (v0.7)', () => {
    expect(getSlowWithdrawUserOpHash(userOp, 1)).toBe(
      getUserOperationHash({
        chainId: 1,
        entryPointAddress: ADDRESSES.entryPoint,
        entryPointVersion: '0.7',
        userOperation: userOp,
      }),
    );
    expect(getSlowWithdrawUserOpHash(userOp, 1)).not.toBe(getSlowWithdrawUserOpHash(userOp, 10));
  });

  it('submits the operation with zero fees and the submitter as beneficiary', () => {
    const data = encodeHandleOps({ ...userOp, signature: '0xff' }, TARGET);
    const { functionName, args } = decodeFunctionData({ abi: entryPoint07Abi, data });
    expect(functionName).toBe('handleOps');
    const [ops, beneficiary] = args as unknown as [
      { gasFees: Hex; initCode: Hex; sender: string }[],
      string,
    ];
    expect(beneficiary.toLowerCase()).toBe(TARGET);
    expect(ops[0]?.gasFees).toBe(pad('0x', { size: 32 }));
    expect(ops[0]?.initCode).toBe('0x');
    expect(ops[0]?.sender.toLowerCase()).toBe(WALLET);
  });
});

describe('readUserOperationResult', () => {
  const userOpHash = keccak256('0x02');

  function receiptWith(success: boolean, revertReason?: Hex): TransactionReceipt {
    const logs = [
      {
        address: ADDRESSES.entryPoint,
        topics: encodeEventTopics({
          abi: entryPoint07Abi,
          eventName: 'UserOperationEvent',
          args: {
            userOpHash,
            sender: WALLET,
            paymaster: '0x0000000000000000000000000000000000000000',
          },
        }),
        data: encodeAbiParameters(
          parseAbi(['function f(uint256,bool,uint256,uint256)'])[0].inputs,
          [0n, success, 0n, 50_000n],
        ),
      },
    ];
    if (revertReason) {
      logs.push({
        address: ADDRESSES.entryPoint,
        topics: encodeEventTopics({
          abi: entryPoint07Abi,
          eventName: 'UserOperationRevertReason',
          args: { userOpHash, sender: WALLET },
        }),
        data: encodeAbiParameters(parseAbi(['function f(uint256,bytes)'])[0].inputs, [
          0n,
          revertReason,
        ]),
      });
    }
    return { logs } as unknown as TransactionReceipt;
  }

  it('reports a successful operation', () => {
    expect(readUserOperationResult(receiptWith(true), userOpHash)).toEqual({
      found: true,
      success: true,
      revertReason: undefined,
    });
  });

  it('reports why the wallet call failed', () => {
    const reason = encodeErrorResult({
      abi: parseAbi(['error Error(string)']),
      errorName: 'Error',
      args: ['transfer amount exceeds balance'],
    });
    const result = readUserOperationResult(receiptWith(false, reason), userOpHash);
    expect(result.success).toBe(false);
    expect(result.revertReason).toContain('transfer amount exceeds balance');
  });

  it('does not find an operation with another hash', () => {
    expect(readUserOperationResult(receiptWith(true), keccak256('0x03')).found).toBe(false);
  });
});
