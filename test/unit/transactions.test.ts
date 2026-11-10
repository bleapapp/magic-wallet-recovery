import type { PublicClient, ReplacementReason } from 'viem';
import { describe, expect, it, vi } from 'vitest';
import {
  type PreparedTransaction,
  type RecoverySigner,
  sendPreparedTransaction,
} from '../../src/core/transactions.js';

const SIGNER = '0x4444444444444444444444444444444444444444';
const HASH = `0x${'cd'.repeat(32)}` as const;

const tx: PreparedTransaction = {
  title: 'Cancel the slow withdrawal',
  summary: [],
  to: '0x5B424D5133fAE2cE64ce739cec0796343E957131',
  data: '0x1234',
  value: 0n,
  from: SIGNER,
  chainId: 1,
  gas: 100_000n,
};

const signer: RecoverySigner = {
  address: SIGNER,
  sendTransaction: () => Promise.resolve(HASH),
  signRawMessage: () => Promise.reject(new Error('not used')),
};

/** A client whose receipt is successful, optionally after the wallet replaced the transaction. */
function fakeClient(replacement?: ReplacementReason) {
  return {
    getChainId: vi.fn().mockResolvedValue(1),
    waitForTransactionReceipt: vi
      .fn()
      .mockImplementation(({ onReplaced }: { onReplaced?: (r: unknown) => void }) => {
        if (replacement) onReplaced?.({ reason: replacement });
        return Promise.resolve({ status: 'success', transactionHash: HASH, logs: [] });
      }),
  } as unknown as PublicClient;
}

describe('sendPreparedTransaction', () => {
  it('returns the receipt of a successful transaction', async () => {
    await expect(sendPreparedTransaction(fakeClient(), signer, tx)).resolves.toMatchObject({
      status: 'success',
    });
  });

  it('accepts a transaction that was only repriced (sped up)', async () => {
    await expect(
      sendPreparedTransaction(fakeClient('repriced'), signer, tx),
    ).resolves.toMatchObject({ status: 'success' });
  });

  it.each<ReplacementReason>(['cancelled', 'replaced'])(
    'reports a transaction %s in the wallet as not executed',
    async (reason) => {
      await expect(sendPreparedTransaction(fakeClient(reason), signer, tx)).rejects.toThrow(
        'not executed',
      );
    },
  );

  it('refuses to send when the network changed', async () => {
    const client = fakeClient();
    vi.mocked(client.getChainId).mockResolvedValue(8453);
    const sendTransaction = vi.fn().mockResolvedValue(HASH);
    await expect(
      sendPreparedTransaction(client, { ...signer, sendTransaction }, tx),
    ).rejects.toThrow('network changed');
    expect(sendTransaction).not.toHaveBeenCalled();
  });
});
