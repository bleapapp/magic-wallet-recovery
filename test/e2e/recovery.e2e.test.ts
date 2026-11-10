/**
 * End-to-end recovery on a fresh local chain that has none of the wallet's contracts: the
 * "foreign network" case. The contracts are recreated from their public creation transactions on
 * Ethereum mainnet, so the code under test is the exact code deployed in production.
 *
 * Requires Foundry's `anvil`. Set E2E_REFERENCE_RPC_URL to read Ethereum through your own endpoint.
 */
import {
  type Address,
  concat,
  createPublicClient,
  createTestClient,
  createWalletClient,
  defineChain,
  encodeFunctionData,
  type Hex,
  http,
  type PublicClient,
  pad,
  parseEther,
  stringToHex,
  type TestClient,
  toHex,
} from 'viem';
import { generatePrivateKey, type PrivateKeyAccount, privateKeyToAccount } from 'viem/accounts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildSlowWithdrawUserOp,
  checkWithdrawalReceipt,
  computeWalletAddress,
  type DeploymentPlan,
  encodeSlowWithdrawSignature,
  erc20Abi,
  fetchCreationCode,
  finalizeWithdrawal,
  getSlowWithdrawUserOpHash,
  hasCode,
  inspectWallet,
  kernelInitData,
  nextStep,
  planCancel,
  planDependencyDeployment,
  planTrigger,
  planWalletDeployment,
  planWalletDeploymentTx,
  prepareTransaction,
  prepareWithdrawal,
  publicTransactionReader,
  type RecoverySigner,
  rebuildOriginalDeployment,
  sendPreparedTransaction,
  simulateHandleOps,
  type TransactionPlan,
  verifyWalletDeployment,
  WALLET_SALT,
  type WithdrawAction,
  walletDeploymentCall,
} from '../../src/core/index.js';
import { type Anvil, startAnvil } from './anvil.js';

const REFERENCE_RPC_URL =
  process.env.E2E_REFERENCE_RPC_URL || 'https://ethereum-rpc.publicnode.com';
const readSource = publicTransactionReader({ 1: [REFERENCE_RPC_URL] });
const FOREIGN_CHAIN_ID = 7_000_001;
const WETH: Address = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
/** MetaMask's smart account contract for EIP-7702 (EIP7702StatelessDeleGator). */
const METAMASK_SMART_ACCOUNT: Address = '0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B';

const chain = defineChain({
  id: FOREIGN_CHAIN_ID,
  name: 'Foreign test network',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['http://127.0.0.1'] } },
});

let anvil: Anvil;
let client: PublicClient;
let testClient: TestClient;
const reference = createPublicClient({ transport: http(REFERENCE_RPC_URL) });

beforeAll(async () => {
  anvil = await startAnvil(FOREIGN_CHAIN_ID);
  client = createPublicClient({ chain, transport: http(anvil.url) });
  testClient = createTestClient({ chain, mode: 'anvil', transport: http(anvil.url) });
});

afterAll(async () => {
  await anvil?.stop();
});

function signerFor(account: PrivateKeyAccount): RecoverySigner {
  const walletClient = createWalletClient({ account, chain, transport: http(anvil.url) });
  return {
    address: account.address,
    sendTransaction: (tx) =>
      walletClient.sendTransaction({ to: tx.to, data: tx.data, value: tx.value, gas: tx.gas }),
    signRawMessage: (message) => account.signMessage({ message: { raw: message } }),
  };
}

async function send(signer: RecoverySigner, plan: TransactionPlan) {
  const tx = await prepareTransaction(client, signer.address, plan);
  return sendPreparedTransaction(client, signer, tx);
}

async function deployMissingContracts(signer: RecoverySigner, plan: DeploymentPlan) {
  for (const dependency of plan.missing) {
    const { code, source } = await fetchCreationCode(dependency, readSource);
    await send(signer, planDependencyDeployment(dependency, code, source));
    expect(await hasCode(client, dependency.address)).toBe(true);
  }
}

/** The full withdrawal flow: prepare, sign, verify and simulate, submit, check the result. */
async function withdraw(signer: RecoverySigner, wallet: Address, action: WithdrawAction) {
  const status = await inspectWallet(client, { wallet, signer: signer.address });
  const prepared = await prepareWithdrawal(client, { status, signer: signer.address, action });
  const signature = await signer.signRawMessage(prepared.userOpHash);
  const tx = await finalizeWithdrawal(client, prepared, signature, signer.address);
  const receipt = await sendPreparedTransaction(client, signer, tx);
  return checkWithdrawalReceipt(receipt, prepared);
}

/** Signs and simulates an operation without the tool's own checks, to see what the chain says. */
async function simulateDirectly(signer: RecoverySigner, wallet: Address) {
  const call = { target: signer.address, value: 1n, data: '0x' as Hex };
  const userOp = await buildSlowWithdrawUserOp(client, { wallet, call, callGasLimit: 100_000n });
  const hash = getSlowWithdrawUserOpHash(userOp, FOREIGN_CHAIN_ID);
  const signature = encodeSlowWithdrawSignature(await signer.signRawMessage(hash));
  return simulateHandleOps(client, signer.address, { ...userOp, signature });
}

async function waitPast(seconds: bigint) {
  await testClient.increaseTime({ seconds: Number(seconds) });
  await testClient.mine({ blocks: 1 });
}

/** Copies a contract's code from the reference network to the same address on the local chain. */
async function plantCode(address: Address) {
  const code = await reference.getCode({ address });
  if (!code) throw new Error(`could not read the code of ${address} from the reference network`);
  await testClient.setCode({ address, bytecode: code });
}

/**
 * Switches an account to MetaMask's smart account with EIP-7702, as MetaMask does: the account
 * keeps its key and address, but has code on this network.
 */
async function switchToSmartAccount(owner: PrivateKeyAccount) {
  await plantCode(METAMASK_SMART_ACCOUNT);
  const ownerClient = createWalletClient({ account: owner, chain, transport: http(anvil.url) });
  const authorization = await ownerClient.signAuthorization({
    contractAddress: METAMASK_SMART_ACCOUNT,
    executor: 'self',
  });
  await client.waitForTransactionReceipt({
    hash: await ownerClient.sendTransaction({
      authorizationList: [authorization],
      to: owner.address,
    }),
  });
  expect(await client.getCode({ address: owner.address })).toBe(
    concat(['0xef0100', METAMASK_SMART_ACCOUNT]).toLowerCase(),
  );
}

/** WETH9 from Ethereum, placed on the local chain to test ERC-20 withdrawals. */
async function plantWeth() {
  await plantCode(WETH);
  // WETH9 keeps `symbol` (slot 1) and `decimals` (slot 2) in storage, which copying code doesn't do.
  await testClient.setStorageAt({ address: WETH, index: 2, value: pad(toHex(18)) });
  await testClient.setStorageAt({
    address: WETH,
    index: 1,
    value: concat([pad(stringToHex('WETH'), { size: 31, dir: 'right' }), toHex(8, { size: 1 })]),
  });
}

describe('V1 wallet on a network without any of its contracts', () => {
  const owner = privateKeyToAccount(generatePrivateKey());
  const wallet = rebuildOriginalDeployment(owner.address).address;
  const destination = privateKeyToAccount(generatePrivateKey()).address;
  let signer: RecoverySigner;

  beforeAll(async () => {
    signer = signerFor(owner);
    await testClient.setBalance({ address: owner.address, value: parseEther('100') });
  });

  it('sees an undeployed wallet whose address can be rebuilt', async () => {
    const status = await inspectWallet(client, { wallet, signer: owner.address });
    expect(status.deployed).toBe(false);
    expect(status.rebuild?.matches).toBe(true);
    expect(status.dependencies?.every((dependency) => !dependency.deployed)).toBe(true);
    expect(nextStep(status).step).toBe('deploy');
  });

  it('recreates the missing contracts and deploys the wallet at its address', async () => {
    const plan = await planWalletDeployment(client, {
      wallet,
      source: { kind: 'signer', signer: owner.address },
      expectedSigner: owner.address,
    });
    expect(plan.deterministicDeployerAvailable).toBe(true);
    expect(plan.missing.map((dependency) => dependency.key)).toEqual([
      'entryPoint',
      'kernelImplementation',
      'kernelFactory',
      'cosigningModuleV1',
    ]);
    await deployMissingContracts(signer, plan);
    await send(signer, await planWalletDeploymentTx(client, plan));
    await verifyWalletDeployment(client, plan);

    const status = await inspectWallet(client, { wallet, signer: owner.address });
    expect(status.account?.module?.version).toBe('V1');
    expect(status.account?.signer).toBe(owner.address);
    expect(status.account?.timelockSeconds).toBe(86_400n);
    expect(status.account?.unsupported).toEqual([]);
  });

  it('refuses to withdraw before a slow withdrawal is started', async () => {
    const status = await inspectWallet(client, { wallet });
    const action: WithdrawAction = { kind: 'native', to: owner.address, amount: 1n };
    await expect(
      prepareWithdrawal(client, { status, signer: owner.address, action }),
    ).rejects.toThrow('No slow withdrawal');
  });

  it('starts the slow withdrawal', async () => {
    const status = await inspectWallet(client, { wallet, signer: owner.address });
    await send(signer, planTrigger(status, owner.address));
    const after = await inspectWallet(client, { wallet });
    expect(after.account?.slowWithdrawal?.status).toBe('waiting');
  });

  it('is rejected by the wallet during the waiting period', async () => {
    await testClient.setBalance({ address: wallet, value: parseEther('1') });
    await expect(simulateDirectly(signer, wallet)).rejects.toMatchObject({
      hint: expect.stringContaining('AA24'),
    });
  });

  it('withdraws the native token once the waiting period is over', async () => {
    await waitPast(86_401n);
    const before = await client.getBalance({ address: destination });
    const result = await withdraw(signer, wallet, {
      kind: 'native',
      to: destination,
      amount: parseEther('0.4'),
    });
    expect(result.success).toBe(true);
    expect(await client.getBalance({ address: destination })).toBe(before + parseEther('0.4'));
  });

  it('withdraws an ERC-20 token', async () => {
    await plantWeth();
    const ownerClient = createWalletClient({ account: owner, chain, transport: http(anvil.url) });
    await client.waitForTransactionReceipt({
      hash: await ownerClient.sendTransaction({ to: WETH, value: parseEther('2') }),
    });
    await client.waitForTransactionReceipt({
      hash: await ownerClient.writeContract({
        address: WETH,
        abi: erc20Abi,
        functionName: 'transfer',
        args: [wallet, parseEther('2')],
      }),
    });

    const result = await withdraw(signer, wallet, {
      kind: 'erc20',
      token: WETH,
      to: owner.address,
      amount: parseEther('1.5'),
    });
    expect(result.success).toBe(true);
    const left = await client.readContract({
      address: WETH,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [wallet],
    });
    expect(left).toBe(parseEther('0.5'));
  });

  it('makes any single call from the wallet', async () => {
    const data = encodeFunctionData({
      abi: erc20Abi,
      functionName: 'approve',
      args: [destination, 123n],
    });
    const result = await withdraw(signer, wallet, { kind: 'call', target: WETH, value: 0n, data });
    expect(result.success).toBe(true);
    const allowance = await client.readContract({
      address: WETH,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [wallet, destination],
    });
    expect(allowance).toBe(123n);
  });

  it('refuses a call to the wallet itself', async () => {
    const status = await inspectWallet(client, { wallet });
    const action: WithdrawAction = { kind: 'call', target: wallet, value: 0n, data: '0x' };
    await expect(
      prepareWithdrawal(client, { status, signer: owner.address, action }),
    ).rejects.toThrow('call itself');
  });

  it('cancels the slow withdrawal', async () => {
    const status = await inspectWallet(client, { wallet, signer: owner.address });
    await send(signer, planCancel(status, owner.address));
    const after = await inspectWallet(client, { wallet });
    expect(after.account?.slowWithdrawal?.status).toBe('not-triggered');
  });
});

describe('V2 wallet', () => {
  // On networks the app supports, wallets later move their root permission to Cosigning Module V2.
  // Here such a wallet is created directly with a V2 root, which takes the same recovery path.
  const owner = privateKeyToAccount(generatePrivateKey());
  const initData = kernelInitData(owner.address, 'V2');
  const wallet = computeWalletAddress(initData);
  let signer: RecoverySigner;

  beforeAll(async () => {
    signer = signerFor(owner);
    await testClient.setBalance({ address: owner.address, value: parseEther('10') });
  });

  it('deploys from a deployment transaction and recreates Cosigning Module V2', async () => {
    const input = walletDeploymentCall({ address: wallet, initData, salt: WALLET_SALT }).data;
    const plan = await planWalletDeployment(client, {
      wallet,
      source: { kind: 'transaction', input },
      expectedSigner: owner.address,
    });
    expect(plan.moduleVersion).toBe('V2');
    expect(plan.missing.map((dependency) => dependency.key)).toEqual(['cosigningModuleV2']);
    await deployMissingContracts(signer, plan);
    await send(signer, await planWalletDeploymentTx(client, plan));
    await verifyWalletDeployment(client, plan);
  });

  it('withdraws after the 72-hour waiting period', async () => {
    const status = await inspectWallet(client, { wallet, signer: owner.address });
    expect(status.account?.module?.version).toBe('V2');
    expect(status.account?.timelockSeconds).toBe(259_200n);
    await send(signer, planTrigger(status, owner.address));
    await testClient.setBalance({ address: wallet, value: parseEther('1') });

    // During the waiting period, the EntryPoint itself refuses the operation.
    await expect(simulateDirectly(signer, wallet)).rejects.toMatchObject({
      hint: expect.stringContaining('AA22'),
    });

    await waitPast(259_200n);
    const result = await withdraw(signer, wallet, {
      kind: 'native',
      to: owner.address,
      amount: parseEther('1'),
    });
    expect(result.success).toBe(true);
    expect(await client.getBalance({ address: wallet })).toBe(0n);
  });
});

describe('V1 wallet whose signer account is a smart account (EIP-7702)', () => {
  // A browser wallet can switch the signer account to a smart account on a network: the account
  // keeps its key and address, but has code there. Here it points to MetaMask's smart account
  // contract, as after MetaMask switches it.
  const owner = privateKeyToAccount(generatePrivateKey());
  const wallet = rebuildOriginalDeployment(owner.address).address;
  let signer: RecoverySigner;

  beforeAll(async () => {
    signer = signerFor(owner);
    await testClient.setBalance({ address: owner.address, value: parseEther('10') });
    await switchToSmartAccount(owner);
  });

  it('deploys the wallet', async () => {
    const plan = await planWalletDeployment(client, {
      wallet,
      source: { kind: 'signer', signer: owner.address },
      expectedSigner: owner.address,
    });
    // Normally deployed by the first test group already.
    await deployMissingContracts(signer, plan);
    await send(signer, await planWalletDeploymentTx(client, plan));
    await verifyWalletDeployment(client, plan);
  });

  it('starts the slow withdrawal', async () => {
    const status = await inspectWallet(client, { wallet, signer: owner.address });
    await send(signer, planTrigger(status, owner.address));
    const after = await inspectWallet(client, { wallet });
    expect(after.account?.slowWithdrawal?.status).toBe('waiting');
  });

  it('withdraws to the signer account once the waiting period is over', async () => {
    await testClient.setBalance({ address: wallet, value: parseEther('1') });
    await waitPast(86_401n);
    const before = await client.getBalance({ address: owner.address });
    const result = await withdraw(signer, wallet, {
      kind: 'native',
      to: owner.address,
      amount: parseEther('1'),
    });
    expect(result.success).toBe(true);
    expect(await client.getBalance({ address: wallet })).toBe(0n);
    // The signer account pays the fee, which is far less than what it receives.
    expect(await client.getBalance({ address: owner.address })).toBeGreaterThan(before);
  });
});

describe('V2 wallet whose signer account is a smart account (EIP-7702)', () => {
  // On the app's networks the root permission uses Cosigning Module V2, and starting a slow
  // withdrawal there suspends the Bleap account: the owner's signature must still be accepted
  // when the signer account has code.
  const owner = privateKeyToAccount(generatePrivateKey());
  const initData = kernelInitData(owner.address, 'V2');
  const wallet = computeWalletAddress(initData);
  let signer: RecoverySigner;

  beforeAll(async () => {
    signer = signerFor(owner);
    await testClient.setBalance({ address: owner.address, value: parseEther('10') });
    await switchToSmartAccount(owner);
  });

  it('deploys the wallet', async () => {
    const input = walletDeploymentCall({ address: wallet, initData, salt: WALLET_SALT }).data;
    const plan = await planWalletDeployment(client, {
      wallet,
      source: { kind: 'transaction', input },
      expectedSigner: owner.address,
    });
    // Normally deployed by the V2 wallet group already.
    await deployMissingContracts(signer, plan);
    await send(signer, await planWalletDeploymentTx(client, plan));
    await verifyWalletDeployment(client, plan);
  });

  it('withdraws to the signer account after the 72-hour waiting period', async () => {
    const status = await inspectWallet(client, { wallet, signer: owner.address });
    expect(status.account?.module?.version).toBe('V2');
    await send(signer, planTrigger(status, owner.address));
    await testClient.setBalance({ address: wallet, value: parseEther('1') });
    await waitPast(259_200n);
    const result = await withdraw(signer, wallet, {
      kind: 'native',
      to: owner.address,
      amount: parseEther('1'),
    });
    expect(result.success).toBe(true);
    expect(await client.getBalance({ address: wallet })).toBe(0n);
  });
});
