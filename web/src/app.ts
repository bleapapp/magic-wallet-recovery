import {
  type Address,
  createPublicClient,
  createWalletClient,
  custom,
  type EIP1193Provider,
  formatUnits,
  getAddress,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
} from 'viem';
import { readErc20, type WithdrawAction } from '../../src/core/actions.js';
import { getChainInfo, toViemChain } from '../../src/core/chains.js';
import {
  fetchCreationCode,
  hasCode,
  planDependencyDeployment,
} from '../../src/core/dependencies.js';
import {
  assertDependenciesDeployable,
  type DeploymentPlan,
  planWalletDeployment,
  planWalletDeploymentTx,
  verifyWalletDeployment,
} from '../../src/core/deploy.js';
import { explainError, RecoveryError } from '../../src/core/errors.js';
import { parseAddressInput, parseTokenAmount } from '../../src/core/format.js';
import { inspectWallet, type TokenBalance, type WalletStatus } from '../../src/core/inspect.js';
import { planCancel, planTrigger } from '../../src/core/slowWithdrawal.js';
import { tokensToRead } from '../../src/core/tokens.js';
import {
  type PreparedTransaction,
  prepareTransaction,
  type RecoverySigner,
  sendPreparedTransaction,
  type TransactionPlan,
} from '../../src/core/transactions.js';
import {
  checkWithdrawalReceipt,
  finalizeWithdrawal,
  type PreparedWithdrawal,
  prepareWithdrawal,
  SIGNED_NOT_SUBMITTED_NOTICE,
} from '../../src/core/withdraw.js';
import {
  type BrowserWallet,
  discoverWallets,
  readChainId,
  requestAccount,
  switchNetwork,
} from './wallets.js';

export interface Connection {
  wallet: BrowserWallet;
  account: Address;
  chainId: number;
}

export type PendingKind = 'dependency' | 'wallet' | 'trigger' | 'cancel' | 'withdrawal';

export interface WithdrawForm {
  /** `native`, a token address, or `other` (address typed in `otherToken`). */
  asset: string;
  otherToken: string;
  amount: string;
  to: string;
}

export interface State {
  wallets: BrowserWallet[];
  walletsSearched: boolean;
  connection?: Connection;
  walletInput: string;
  status?: WalletStatus;
  deployPlan?: DeploymentPlan;
  withdrawForm: WithdrawForm;
  withdrawal?: PreparedWithdrawal;
  /**
   * The withdrawal was signed and its transaction not sent yet. The signature stays usable however
   * the page drops the withdrawal, so dropping it shows {@link SIGNED_NOT_SUBMITTED_NOTICE}.
   */
  withdrawalSigned: boolean;
  pending?: { kind: PendingKind; tx: PreparedTransaction };
  /** The person confirmed a slow withdrawal on a network the Bleap app supports is an emergency. */
  emergencyConfirmed: boolean;
  sent: { title: string; hash: Hex; chainId: number }[];
  extraTokens: Address[];
  busy?: string;
  error?: string;
  notice?: string;
}

export const state: State = {
  wallets: [],
  walletsSearched: false,
  walletInput: '',
  withdrawForm: { asset: 'native', otherToken: '', amount: '', to: '' },
  withdrawalSigned: false,
  emergencyConfirmed: false,
  sent: [],
  extraTokens: [],
};

let renderer: () => void = () => {};

export function setRenderer(render: () => void): void {
  renderer = render;
}

function update(patch: Partial<State>): void {
  Object.assign(state, patch);
  renderer();
}

/**
 * Runs an async step with a busy indicator; any error is shown in plain language. If the browser
 * wallet switches account or network while the step runs, what the step read or prepared belongs
 * to the previous one, so it is discarded (unless switching is what the step does).
 */
async function step(
  label: string,
  task: () => Promise<void>,
  options: { changesConnection?: boolean } = {},
): Promise<void> {
  if (state.busy) return;
  const before = connectionSnapshot();
  update({ busy: label, error: undefined, notice: undefined });
  try {
    await task();
  } catch (error) {
    state.error = explainError(error);
  } finally {
    if (!options.changesConnection && !sameConnection(before, connectionSnapshot())) {
      resetFlows();
      state.error =
        'Your browser wallet switched account or network during this step, so its result was discarded. Check your wallet again.';
    }
    update({ busy: undefined });
  }
}

interface ConnectionSnapshot {
  provider?: EIP1193Provider;
  account?: Address;
  chainId?: number;
}

function connectionSnapshot(): ConnectionSnapshot {
  const connection = state.connection;
  return {
    provider: connection?.wallet.provider,
    account: connection?.account,
    chainId: connection?.chainId,
  };
}

function sameConnection(a: ConnectionSnapshot, b: ConnectionSnapshot): boolean {
  return a.provider === b.provider && a.account === b.account && a.chainId === b.chainId;
}

// Clients ---------------------------------------------------------------------------------------

function requireConnection(): Connection {
  if (!state.connection) throw new RecoveryError('Connect your browser wallet first.');
  return state.connection;
}

function provider(): EIP1193Provider {
  return requireConnection().wallet.provider;
}

/** Reads go through the browser wallet's own RPC endpoint for the selected network. */
function publicClient(): PublicClient {
  const { chainId } = requireConnection();
  return createPublicClient({
    chain: toViemChain(getChainInfo(chainId)),
    transport: custom(provider()),
    // No CCIP-Read (EIP-3668): a contract this page reads, such as a token address the user typed,
    // could otherwise make it fetch a URL of the contract's choosing.
    ccipRead: false,
  });
}

/** Signing happens in the browser wallet: this page never sees a private key. */
function browserSigner(): RecoverySigner {
  const { account, chainId } = requireConnection();
  const walletClient = createWalletClient({
    account,
    chain: toViemChain(getChainInfo(chainId)),
    transport: custom(provider()),
  });
  return {
    address: account,
    // No gas limit: the browser wallet may send the call in another form, for example through a
    // smart account (EIP-7702), which needs more gas than the call simulated here. The wallet sizes
    // the gas for the transaction it actually sends.
    sendTransaction: (tx) =>
      walletClient.sendTransaction({ to: tx.to, data: tx.data, value: tx.value }),
    signRawMessage: (message) => walletClient.signMessage({ message: { raw: message } }),
  };
}

// Wallet connection -------------------------------------------------------------------------------

export function startDiscovery(): void {
  discoverWallets((wallets) => update({ wallets }));
  setTimeout(() => update({ walletsSearched: true }), 600);
}

const subscribedProviders = new WeakSet<EIP1193Provider>();

export function connect(wallet: BrowserWallet): Promise<void> {
  return step(
    'Waiting for your browser wallet…',
    async () => {
      const account = await requestAccount(wallet.provider);
      const chainId = await startOnDefaultNetwork(wallet.provider);
      resetFlows();
      state.connection = { wallet, account, chainId };
      state.withdrawForm.to = account;
      if (subscribedProviders.has(wallet.provider)) return;
      subscribedProviders.add(wallet.provider);
      // Events from a wallet that is no longer the connected one are ignored.
      const isActive = () => state.connection?.wallet.provider === wallet.provider;
      wallet.provider.on?.('accountsChanged', (accounts: readonly Address[]) => {
        const next = accounts[0];
        if (!state.connection || !isActive()) return;
        state.notice = undefined;
        resetFlows();
        if (!next) {
          update({ connection: undefined });
          return;
        }
        state.connection.account = getAddress(next);
        state.withdrawForm.to = state.connection.account;
        update({
          notice: withResetNotice('Your browser wallet switched account. Check your wallet again.'),
        });
      });
      wallet.provider.on?.('chainChanged', (chainId: string) => {
        if (!state.connection || !isActive()) return;
        state.notice = undefined;
        resetFlows();
        state.connection.chainId = Number(chainId);
        update({
          notice: withResetNotice(`Network changed to ${getChainInfo(Number(chainId)).name}.`),
        });
      });
    },
    { changesConnection: true },
  );
}

/** The network the page starts on. */
const DEFAULT_CHAIN_ID = 1;

/**
 * Asks the browser wallet to switch to {@link DEFAULT_CHAIN_ID}, whichever network it last used on
 * this page. If the person declines, or the wallet can't switch, the page stays on the wallet's
 * network: the network selector shows it and can change it.
 */
async function startOnDefaultNetwork(wallet: EIP1193Provider): Promise<number> {
  if ((await readChainId(wallet)) !== DEFAULT_CHAIN_ID) {
    try {
      await switchNetwork(wallet, DEFAULT_CHAIN_ID);
    } catch {
      // Declined or not possible: keep the wallet's network.
    }
  }
  return readChainId(wallet);
}

export function changeNetwork(chainId: number): Promise<void> {
  return step(
    'Switching network in your browser wallet…',
    async () => {
      await switchNetwork(provider(), chainId);
      const actual = await readChainId(provider());
      resetFlows();
      requireConnection().chainId = actual;
    },
    { changesConnection: true },
  );
}

function resetFlows(): void {
  state.status = undefined;
  state.deployPlan = undefined;
  state.emergencyConfirmed = false;
  dropWithdrawal();
}

/**
 * Forgets the withdrawal and the transaction waiting for approval. A signed withdrawal stays usable
 * when it is not submitted, so the page says so, and how to stop it, whichever way it is dropped.
 */
function dropWithdrawal(): void {
  state.withdrawal = undefined;
  state.pending = undefined;
  if (!state.withdrawalSigned) return;
  state.withdrawalSigned = false;
  state.notice = SIGNED_NOT_SUBMITTED_NOTICE;
}

/** `message`, followed by the notice a reset may have just set (see {@link dropWithdrawal}). */
function withResetNotice(message: string): string {
  return state.notice ? `${message}\n\n${state.notice}` : message;
}

// Inspection -------------------------------------------------------------------------------------

export function setWalletInput(value: string): void {
  state.walletInput = value.trim();
}

function walletAddress(): Address {
  const wallet = parseAddressInput(state.walletInput, 'Your Magic Wallet address');
  const { account } = requireConnection();
  if (wallet === account) {
    throw new RecoveryError(
      'This is the address of your signer account, not of your Magic Wallet.',
      {
        hint: 'Your Magic Wallet address is the one shown in the Bleap app when you receive funds. Funds sent to your signer account are already controlled by your browser wallet.',
      },
    );
  }
  return wallet;
}

export function checkWallet(): Promise<void> {
  return step('Reading your wallet…', () => refreshStatus());
}

/**
 * Reads the wallet's status. Only "Check wallet" reads the address field: every later step keeps
 * using the wallet that was checked, even if the field was edited in the meantime.
 */
async function refreshStatus(wallet: Address = walletAddress()): Promise<void> {
  const connection = requireConnection();
  const { chainId, account } = connection;
  resetFlows();
  const status = await inspectWallet(publicClient(), {
    wallet,
    tokens: tokensToRead(chainId, state.extraTokens),
    signer: account,
  });
  if (status.chainId !== chainId) {
    // The browser wallet is on another network than this page knew: never show one network's
    // status as another's. The step discards what it read.
    connection.chainId = status.chainId;
    throw new RecoveryError('Your browser wallet switched network. Check your wallet again.');
  }
  state.status = status;
  keepWithdrawFormInSync(status);
}

/** The tokens the withdrawal form offers: those the wallet holds. */
export function withdrawableTokens(status: WalletStatus): TokenBalance[] {
  return status.tokens.filter((token) => token.balance !== undefined && token.balance > 0n);
}

/** Forgets a token the form no longer offers (none left, or another network), so it isn't used. */
function keepWithdrawFormInSync(status: WalletStatus): void {
  const form = state.withdrawForm;
  if (form.asset === 'native' || form.asset === 'other') return;
  const offered = withdrawableTokens(status).some(
    (token) => token.token.toLowerCase() === form.asset.toLowerCase(),
  );
  if (!offered) {
    form.asset = 'native';
    form.amount = '';
  }
}

export function addToken(address: string): Promise<void> {
  return step('Reading the token…', async () => {
    const token = parseAddressInput(address, 'The token contract address');
    const { wallet } = requireStatus();
    if (!state.extraTokens.includes(token)) state.extraTokens.push(token);
    await refreshStatus(wallet);
  });
}

// Deployment -------------------------------------------------------------------------------------

export function planDeployment(): Promise<void> {
  return step('Rebuilding your wallet setup…', async () => {
    const { account } = requireConnection();
    const plan = await planWalletDeployment(publicClient(), {
      wallet: requireStatus().wallet,
      source: { kind: 'signer', signer: account },
      expectedSigner: account,
    });
    assertDependenciesDeployable(plan);
    state.deployPlan = plan;
  });
}

/** Prepares the next deployment transaction: a missing contract first, then the wallet. */
export function prepareNextDeployment(): Promise<void> {
  return step('Preparing the next transaction…', async () => {
    const plan = state.deployPlan;
    if (!plan) throw new RecoveryError('Start the deployment again.');
    const client = publicClient();
    for (const dependency of plan.missing) {
      if (await hasCode(client, dependency.address)) continue;
      state.busy = `Reading the creation code of ${dependency.name} from a public network…`;
      renderer();
      const { code, source } = await fetchCreationCode(dependency);
      await preparePending('dependency', planDependencyDeployment(dependency, code, source));
      return;
    }
    await preparePending('wallet', await planWalletDeploymentTx(client, plan));
  });
}

// Slow withdrawal ---------------------------------------------------------------------------------

export function setEmergencyConfirmed(confirmed: boolean): void {
  update({ emergencyConfirmed: confirmed });
}

export function prepareTriggerTx(): Promise<void> {
  return step('Preparing…', async () => {
    const status = requireStatus();
    const plan = planTrigger(status, requireConnection().account, {
      emergency: state.emergencyConfirmed,
    });
    await preparePending('trigger', plan);
  });
}

export function prepareCancelTx(): Promise<void> {
  return step('Preparing…', async () => {
    const status = requireStatus();
    await preparePending('cancel', planCancel(status, requireConnection().account));
  });
}

function requireStatus(): WalletStatus {
  if (!state.status) throw new RecoveryError('Check your wallet first.');
  return state.status;
}

// Withdrawal --------------------------------------------------------------------------------------

export function updateWithdrawForm(patch: Partial<WithdrawForm>): void {
  Object.assign(state.withdrawForm, patch);
}

export function setMaxAmount(): void {
  const status = state.status;
  if (!status) return;
  const { asset, otherToken } = state.withdrawForm;
  if (asset === 'native') {
    state.withdrawForm.amount = formatUnits(status.nativeBalance, 18);
    renderer();
    return;
  }
  const address = asset === 'other' ? otherToken : asset;
  const token = status.tokens.find((t) => t.token.toLowerCase() === address.toLowerCase());
  if (token?.balance !== undefined && token.decimals !== undefined) {
    state.withdrawForm.amount = formatUnits(token.balance, token.decimals);
    renderer();
  } else {
    void step('Reading the token…', async () => {
      const token = parseAddressInput(address, 'The token contract address');
      const info = await readErc20(publicClient(), token, status.wallet);
      state.withdrawForm.amount = formatUnits(info.balance, info.decimals);
    });
  }
}

async function buildWithdrawAction(): Promise<WithdrawAction> {
  const status = requireStatus();
  const { asset, otherToken, amount, to } = state.withdrawForm;
  const destination = parseAddressInput(to, 'The destination address');
  if (!amount) throw new RecoveryError('Enter an amount.');
  if (asset === 'native') {
    return { kind: 'native', to: destination, amount: parseTokenAmount(amount, 18) };
  }
  const tokenAddress = parseAddressInput(
    asset === 'other' ? otherToken : asset,
    'The token contract address',
  );
  const token = await readErc20(publicClient(), tokenAddress, status.wallet);
  return {
    kind: 'erc20',
    token: token.address,
    to: destination,
    amount: parseTokenAmount(amount, token.decimals),
  };
}

export function reviewWithdrawal(): Promise<void> {
  return step('Checking and simulating the withdrawal…', async () => {
    const status = requireStatus();
    const action = await buildWithdrawAction();
    state.withdrawal = await prepareWithdrawal(publicClient(), {
      status,
      signer: requireConnection().account,
      action,
    });
  });
}

export function signWithdrawal(): Promise<void> {
  return step('Waiting for your signature in your browser wallet…', async () => {
    const withdrawal = state.withdrawal;
    if (!withdrawal) throw new RecoveryError('Review the withdrawal first.');
    const signer = browserSigner();
    const signature = await signer.signRawMessage(withdrawal.userOpHash);
    state.withdrawalSigned = true;
    state.busy = 'Simulating the signed operation…';
    renderer();
    const tx = await finalizeWithdrawal(publicClient(), withdrawal, signature, signer.address);
    setPending('withdrawal', tx);
  });
}

// Pending transaction -------------------------------------------------------------------------------

async function preparePending(kind: PendingKind, plan: TransactionPlan): Promise<void> {
  setPending(kind, await prepareTransaction(publicClient(), requireConnection().account, plan));
}

/** Offers a transaction for approval, only on the network the wallet was checked on. */
function setPending(kind: PendingKind, tx: PreparedTransaction): void {
  if (tx.chainId !== requireStatus().chainId) {
    throw new RecoveryError('Your browser wallet switched network. Check your wallet again.');
  }
  state.pending = { kind, tx };
}

/** "Cancel" on the withdrawal review or on a transaction waiting for approval. */
export function discardPending(): void {
  state.notice = undefined;
  dropWithdrawal();
  renderer();
}

export function sendPending(): Promise<void> {
  return step('Confirm the transaction in your browser wallet…', async () => {
    const pending = state.pending;
    if (!pending) return;
    // The wallet this transaction belongs to, whatever the address field says by now.
    const { wallet } = requireStatus();
    const withdrawal = pending.kind === 'withdrawal' ? state.withdrawal : undefined;
    const receipt = await sendPreparedTransaction(publicClient(), browserSigner(), pending.tx, {
      // Recorded as soon as it is sent, and never offered again, even if confirmation is slow. A
      // withdrawal's nonce is used up once sent, so it is never offered for signing again either.
      onSent: (hash) => {
        state.sent.unshift({ title: pending.tx.title, hash, chainId: pending.tx.chainId });
        state.pending = undefined;
        state.withdrawal = undefined;
        if (pending.kind === 'withdrawal') {
          state.withdrawalSigned = false;
          state.withdrawForm.amount = '';
        }
        state.busy = 'Waiting for the transaction to be confirmed…';
        renderer();
      },
    });
    await afterSent(pending.kind, wallet, receipt, withdrawal);
  });
}

async function afterSent(
  kind: PendingKind,
  wallet: Address,
  receipt: TransactionReceipt,
  withdrawal: PreparedWithdrawal | undefined,
): Promise<void> {
  const client = publicClient();
  switch (kind) {
    case 'dependency': {
      const { account } = requireConnection();
      state.deployPlan = await planWalletDeployment(client, {
        wallet,
        source: { kind: 'signer', signer: account },
        expectedSigner: account,
      });
      state.notice = 'Contract deployed. Continue with the next step.';
      return;
    }
    case 'wallet': {
      if (state.deployPlan) await verifyWalletDeployment(client, state.deployPlan);
      state.notice = 'Your Magic Wallet is deployed on this network.';
      await refreshStatus(wallet);
      return;
    }
    case 'trigger':
      state.notice = 'The slow withdrawal has started.';
      await refreshStatus(wallet);
      return;
    case 'cancel':
      // Cancelling is what stops a signed withdrawal that was not submitted: no notice needed.
      state.withdrawalSigned = false;
      state.notice = 'The slow withdrawal is cancelled.';
      await refreshStatus(wallet);
      return;
    case 'withdrawal': {
      let failure: unknown;
      try {
        if (withdrawal) checkWithdrawalReceipt(receipt, withdrawal);
        state.notice = withdrawal ? `Done: ${withdrawal.title}.` : 'Withdrawal submitted.';
      } catch (error) {
        failure = error;
      }
      // The balances are read again whatever the outcome, without hiding it if that read fails.
      try {
        await refreshStatus(wallet);
      } catch (error) {
        failure ??= error;
      }
      if (failure !== undefined) throw failure;
      return;
    }
  }
}
