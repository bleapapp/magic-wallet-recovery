import {
  decodeFunctionData,
  encodeAbiParameters,
  type Hex,
  HttpRequestError,
  type PublicClient,
  zeroAddress,
} from 'viem';
import { describe, expect, it, vi } from 'vitest';
import { erc20Abi, erc721Abi } from '../../src/core/abis.js';
import { actionToCall, describeAction, type WithdrawAction } from '../../src/core/actions.js';
import { MODULE_ADDRESSES } from '../../src/core/constants.js';

const WALLET = '0x2222222222222222222222222222222222222222';
const SIGNER = '0x4444444444444444444444444444444444444444';
const OTHER = '0x5555555555555555555555555555555555555555';
const TOKEN = '0x6666666666666666666666666666666666666666';
const MODULE_V1 = MODULE_ADDRESSES.V1;
const MODULE_V2 = MODULE_ADDRESSES.V2;

const encodeBool = (value: boolean) => encodeAbiParameters([{ type: 'bool' }], [value]);

/** A client double: balances, contract reads and the answer to `transfer` are what the test needs. */
function fakeClient(
  options: {
    nativeBalance?: bigint;
    tokenBalance?: bigint;
    contracts?: string[];
    transferResult?: Hex;
  } = {},
) {
  return {
    call: vi.fn().mockResolvedValue({ data: options.transferResult ?? encodeBool(true) }),
    getBalance: vi.fn().mockResolvedValue(options.nativeBalance ?? 10n ** 18n),
    getCode: vi
      .fn()
      .mockImplementation(({ address }: { address: string }) =>
        Promise.resolve(options.contracts?.includes(address) ? '0x60806040' : undefined),
      ),
    readContract: vi.fn().mockImplementation(({ functionName }: { functionName: string }) => {
      if (functionName === 'balanceOf') return Promise.resolve(options.tokenBalance ?? 1_000_000n);
      if (functionName === 'decimals') return Promise.resolve(6);
      if (functionName === 'symbol') return Promise.resolve('USDC');
      return Promise.reject(new Error(`unexpected ${functionName}`));
    }),
  } as unknown as PublicClient;
}

const context = { chainId: 1, wallet: WALLET, signer: SIGNER } as const;

describe('actionToCall', () => {
  it('sends the native token with a plain value transfer', () => {
    expect(actionToCall(WALLET, { kind: 'native', to: SIGNER, amount: 5n })).toEqual({
      target: SIGNER,
      value: 5n,
      data: '0x',
    });
  });

  it('calls transfer on the token for an ERC-20', () => {
    const call = actionToCall(WALLET, { kind: 'erc20', token: TOKEN, to: SIGNER, amount: 7n });
    expect(call.target).toBe(TOKEN);
    expect(call.value).toBe(0n);
    const decoded = decodeFunctionData({ abi: erc20Abi, data: call.data });
    expect(decoded.functionName).toBe('transfer');
    expect(decoded.args).toEqual([SIGNER, 7n]);
  });

  it('calls safeTransferFrom from the wallet for an NFT', () => {
    const call = actionToCall(WALLET, { kind: 'erc721', token: TOKEN, to: SIGNER, tokenId: 9n });
    const decoded = decodeFunctionData({ abi: erc721Abi, data: call.data });
    expect(decoded.args).toEqual([WALLET, SIGNER, 9n]);
  });
});

describe('describeAction', () => {
  it('describes an ERC-20 transfer to the signer without warnings', async () => {
    const action: WithdrawAction = { kind: 'erc20', token: TOKEN, to: SIGNER, amount: 1_000_000n };
    const description = await describeAction(fakeClient(), context, action);
    expect(description.title).toBe('Send 1 USDC');
    expect(description.warnings).toEqual([]);
    expect(description.summary).toContainEqual({ label: 'To', value: SIGNER });
  });

  it('warns when the destination is not the signer, or is a contract', async () => {
    const action: WithdrawAction = { kind: 'native', to: OTHER, amount: 1n };
    const description = await describeAction(fakeClient({ contracts: [OTHER] }), context, action);
    expect(description.warnings).toHaveLength(2);
  });

  it.each<[string, WithdrawAction]>([
    ['a call to the wallet itself', { kind: 'call', target: WALLET, value: 0n, data: '0x' }],
    ['the wallet as destination', { kind: 'native', to: WALLET, amount: 1n }],
    ['the zero address', { kind: 'native', to: zeroAddress, amount: 1n }],
    ['the token contract as destination', { kind: 'erc20', token: TOKEN, to: TOKEN, amount: 1n }],
    ['a zero amount', { kind: 'native', to: SIGNER, amount: 0n }],
    ['more than the native balance', { kind: 'native', to: SIGNER, amount: 10n ** 19n }],
    ['more than the token balance', { kind: 'erc20', token: TOKEN, to: SIGNER, amount: 10n ** 7n }],
  ])('refuses %s', async (_, action) => {
    await expect(describeAction(fakeClient(), context, action)).rejects.toThrow();
  });

  // A call from the wallet to its module could remove the signer and lock the wallet for good.
  it.each<[string, WithdrawAction]>([
    ['a call to module V1', { kind: 'call', target: MODULE_V1, value: 0n, data: '0x' }],
    ['a call to module V2', { kind: 'call', target: MODULE_V2, value: 0n, data: '0x' }],
    ['a module as token contract', { kind: 'erc20', token: MODULE_V1, to: SIGNER, amount: 1n }],
  ])('refuses %s', async (_, action) => {
    await expect(describeAction(fakeClient(), context, action)).rejects.toThrow('Cosigning Module');
  });

  it('labels a listed token with its registry label, not its on-chain symbol', async () => {
    // Bridged USDC.e on Arbitrum One reports the symbol "USDC" on-chain.
    const usdce = '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8';
    const action: WithdrawAction = { kind: 'erc20', token: usdce, to: SIGNER, amount: 1_000_000n };
    const description = await describeAction(fakeClient(), { ...context, chainId: 42161 }, action);
    expect(description.title).toBe('Send 1 USDC.e');
  });

  it('treats a rejected ownerOf call as a token the wallet does not own', async () => {
    const action: WithdrawAction = { kind: 'erc721', token: TOKEN, to: SIGNER, tokenId: 1n };
    await expect(describeAction(fakeClient(), context, action)).rejects.toThrow('does not own');
  });

  it('reports a network failure as such, not as a fact about the token', async () => {
    const client = fakeClient();
    vi.mocked(client.readContract).mockRejectedValue(
      new HttpRequestError({ url: 'https://rpc.invalid' }),
    );
    const nft: WithdrawAction = { kind: 'erc721', token: TOKEN, to: SIGNER, tokenId: 1n };
    await expect(describeAction(client, context, nft)).rejects.toThrow('Could not read');
    const erc20: WithdrawAction = { kind: 'erc20', token: TOKEN, to: SIGNER, amount: 1n };
    await expect(describeAction(client, context, erc20)).rejects.toThrow('Could not read');
  });

  it('runs an ERC-20 transfer from the wallet first', async () => {
    const client = fakeClient();
    const action: WithdrawAction = { kind: 'erc20', token: TOKEN, to: SIGNER, amount: 1n };
    await describeAction(client, context, action);
    expect(client.call).toHaveBeenCalledWith({
      account: WALLET,
      to: TOKEN,
      data: actionToCall(WALLET, action).data,
    });
  });

  it('refuses an ERC-20 transfer the token answers with false', async () => {
    const client = fakeClient({ transferResult: encodeBool(false) });
    const action: WithdrawAction = { kind: 'erc20', token: TOKEN, to: SIGNER, amount: 1n };
    await expect(describeAction(client, context, action)).rejects.toThrow('"false"');
  });

  it('accepts a token whose transfer returns nothing, like USDT on Ethereum', async () => {
    const client = fakeClient({ transferResult: '0x' });
    const action: WithdrawAction = { kind: 'erc20', token: TOKEN, to: SIGNER, amount: 1n };
    await expect(describeAction(client, context, action)).resolves.toBeDefined();
  });

  it('leaves a reverting transfer to the simulation, but reports a network failure', async () => {
    const action: WithdrawAction = { kind: 'erc20', token: TOKEN, to: SIGNER, amount: 1n };
    const reverting = fakeClient();
    vi.mocked(reverting.call).mockRejectedValue(new Error('execution reverted'));
    await expect(describeAction(reverting, context, action)).resolves.toBeDefined();
    const offline = fakeClient();
    vi.mocked(offline.call).mockRejectedValue(new HttpRequestError({ url: 'https://rpc.invalid' }));
    await expect(describeAction(offline, context, action)).rejects.toThrow('Could not read');
  });

  it('flags custom calls and shows their call data in full', async () => {
    const data = `0x095ea7b3${'00'.repeat(64)}` as const;
    const action: WithdrawAction = { kind: 'call', target: TOKEN, value: 0n, data };
    const description = await describeAction(fakeClient(), context, action);
    expect(description.warnings[0]).toContain('custom call');
    expect(description.summary).toContainEqual({ label: 'Call data', value: `${data} (68 bytes)` });
  });

  it('refuses call data with an odd number of hexadecimal digits', async () => {
    const action: WithdrawAction = { kind: 'call', target: TOKEN, value: 0n, data: '0xa9059cbb0' };
    await expect(describeAction(fakeClient(), context, action)).rejects.toThrow('odd number');
  });
});
