import {
  type Address,
  encodeAbiParameters,
  encodeEventTopics,
  HttpRequestError,
  keccak256,
  type PublicClient,
  type TransactionReceipt,
  zeroAddress,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it, vi } from 'vitest';
import { entryPoint07Abi, erc20Abi } from '../../src/core/abis.js';
import { actionToCall, type WithdrawAction } from '../../src/core/actions.js';
import { ADDRESSES } from '../../src/core/constants.js';
import { RecoveryError } from '../../src/core/errors.js';
import {
  encodeExecuteCallData,
  getSlowWithdrawUserOpHash,
  type SlowWithdrawUserOperation,
} from '../../src/core/userOp.js';
import {
  checkWithdrawalReceipt,
  finalizeWithdrawal,
  type PreparedWithdrawal,
  SIGNED_NOT_SUBMITTED_NOTICE,
  withSignedNotice,
} from '../../src/core/withdraw.js';

const WALLET = '0x2222222222222222222222222222222222222222';
const DESTINATION = '0x4444444444444444444444444444444444444444';
const OTHER = '0x5555555555555555555555555555555555555555';
const TOKEN = '0x6666666666666666666666666666666666666666';

const owner = privateKeyToAccount(generatePrivateKey());
const erc20Action: WithdrawAction = { kind: 'erc20', token: TOKEN, to: DESTINATION, amount: 1n };

function prepared(action: WithdrawAction = erc20Action): PreparedWithdrawal {
  const call = actionToCall(WALLET, action);
  const userOp: SlowWithdrawUserOperation = {
    sender: WALLET,
    nonce: 0n,
    callData: encodeExecuteCallData(call),
    callGasLimit: 150_000n,
    verificationGasLimit: 400_000n,
    preVerificationGas: 0n,
    maxFeePerGas: 0n,
    maxPriorityFeePerGas: 0n,
    signature: '0x',
  };
  return {
    chainId: 1,
    wallet: WALLET,
    signer: owner.address,
    moduleVersion: 'V1',
    action,
    call,
    title: 'Send 1 TKN',
    summary: [],
    warnings: [],
    userOp,
    userOpHash: getSlowWithdrawUserOpHash(userOp, 1),
  };
}

/** A receipt where the operation succeeded, with the given token `Transfer` events. */
function receipt(
  withdrawal: PreparedWithdrawal,
  ...transfers: { token: Address; from: Address; to: Address }[]
): TransactionReceipt {
  const logs = [
    {
      address: ADDRESSES.entryPoint,
      topics: encodeEventTopics({
        abi: entryPoint07Abi,
        eventName: 'UserOperationEvent',
        args: { userOpHash: withdrawal.userOpHash, sender: WALLET, paymaster: zeroAddress },
      }),
      data: encodeAbiParameters(
        [{ type: 'uint256' }, { type: 'bool' }, { type: 'uint256' }, { type: 'uint256' }],
        [0n, true, 0n, 50_000n],
      ),
    },
    ...transfers.map(({ token, from, to }) => ({
      address: token,
      topics: encodeEventTopics({ abi: erc20Abi, eventName: 'Transfer', args: { from, to } }),
      data: encodeAbiParameters([{ type: 'uint256' }], [1n]),
    })),
  ];
  return { logs, transactionHash: keccak256('0x01') } as unknown as TransactionReceipt;
}

describe('checkWithdrawalReceipt', () => {
  it('accepts an ERC-20 withdrawal when the token recorded the transfer', () => {
    const withdrawal = prepared();
    const result = checkWithdrawalReceipt(
      receipt(withdrawal, { token: TOKEN, from: WALLET, to: DESTINATION }),
      withdrawal,
    );
    expect(result.success).toBe(true);
  });

  it('does not report an ERC-20 withdrawal as done when the token recorded no transfer', () => {
    // A token that answers `false` instead of reverting: the operation succeeds, nothing moves.
    const withdrawal = prepared();
    expect(() => checkWithdrawalReceipt(receipt(withdrawal), withdrawal)).toThrow(
      'did not record a transfer',
    );
  });

  it('only counts a transfer by the token, from the wallet, to the destination', () => {
    const withdrawal = prepared();
    const elsewhere = receipt(
      withdrawal,
      { token: OTHER, from: WALLET, to: DESTINATION },
      { token: TOKEN, from: WALLET, to: OTHER },
      { token: TOKEN, from: OTHER, to: DESTINATION },
    );
    expect(() => checkWithdrawalReceipt(elsewhere, withdrawal)).toThrow(
      'did not record a transfer',
    );
  });

  it('looks for no token transfer in other kinds of withdrawal', () => {
    const withdrawal = prepared({ kind: 'native', to: DESTINATION, amount: 1n });
    expect(checkWithdrawalReceipt(receipt(withdrawal), withdrawal).success).toBe(true);
  });
});

describe('withSignedNotice', () => {
  it('adds the notice to the hint once, keeping the message', () => {
    const error = withSignedNotice(new RecoveryError('Not submitted.', { hint: 'Some detail.' }));
    expect(error.message).toBe('Not submitted.');
    expect(error.hint).toBe(`Some detail.\n${SIGNED_NOT_SUBMITTED_NOTICE}`);
    expect(withSignedNotice(error)).toBe(error);
  });

  it('explains any other error', () => {
    const error = withSignedNotice(new Error('insufficient funds for gas'));
    expect(error.message).toBe('insufficient funds for gas');
    expect(error.hint).toBe(SIGNED_NOT_SUBMITTED_NOTICE);
  });
});

describe('finalizeWithdrawal', () => {
  const failingCheck = (failure: Error) =>
    ({ call: vi.fn().mockRejectedValue(failure) }) as unknown as PublicClient;

  it.each([
    ['the node fails', new HttpRequestError({ url: 'https://rpc.invalid' })],
    ['the wallet rejects the operation', new Error('execution reverted')],
  ])(
    'says the signature stays usable when the final check fails because %s',
    async (_, failure) => {
      const withdrawal = prepared();
      const signature = await owner.signMessage({ message: { raw: withdrawal.userOpHash } });
      const error = await finalizeWithdrawal(
        failingCheck(failure),
        withdrawal,
        signature,
        owner.address,
      ).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(RecoveryError);
      expect((error as RecoveryError).hint).toContain(SIGNED_NOT_SUBMITTED_NOTICE);
    },
  );

  it('adds no notice to a signature from another account, which the wallet would not accept', async () => {
    const withdrawal = prepared();
    const other = privateKeyToAccount(generatePrivateKey());
    const signature = await other.signMessage({ message: { raw: withdrawal.userOpHash } });
    const client = failingCheck(new Error('unreachable'));
    const error = await finalizeWithdrawal(client, withdrawal, signature, other.address).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(RecoveryError);
    expect((error as RecoveryError).hint ?? '').not.toContain(SIGNED_NOT_SUBMITTED_NOTICE);
    expect(client.call).not.toHaveBeenCalled();
  });
});
