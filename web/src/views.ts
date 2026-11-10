import { formatEther } from 'viem';
import {
  explorerAddressUrl,
  explorerTxUrl,
  getChainInfo,
  isBleapAppNetwork,
  isKnownChain,
  KNOWN_CHAINS,
} from '../../src/core/chains.js';
import {
  formatAmount,
  formatDuration,
  formatTimestamp,
  type SummaryItem,
} from '../../src/core/format.js';
import {
  getSupportedAccount,
  type NextStep,
  nextStep,
  type WalletStatus,
} from '../../src/core/inspect.js';
import { APP_NETWORK_TRIGGER_NOTICE } from '../../src/core/slowWithdrawal.js';
import { knownTokens } from '../../src/core/tokens.js';
import type { PreparedTransaction } from '../../src/core/transactions.js';
import { SIGNING_NOTICE } from '../../src/core/withdraw.js';
import {
  addToken,
  changeNetwork,
  checkWallet,
  connect,
  discardPending,
  planDeployment,
  prepareCancelTx,
  prepareNextDeployment,
  prepareTriggerTx,
  reviewWithdrawal,
  type State,
  sendPending,
  setEmergencyConfirmed,
  setMaxAmount,
  setWalletInput,
  signWithdrawal,
  updateWithdrawForm,
  withdrawableTokens,
} from './app.js';
import { type Child, h, inputValue } from './dom.js';
import { METAMASK_RDNS } from './wallets.js';

const REPOSITORY_URL = 'https://github.com/bleapapp/magic-wallet-recovery';

export function viewApp(state: State): Child[] {
  return [
    viewHeader(),
    viewMessages(state),
    viewConnect(state),
    state.connection ? viewWalletInput(state) : null,
    state.status ? viewStatus(state, state.status) : null,
    state.pending ? viewPending(state, state.pending.tx) : null,
    state.withdrawal && !state.pending ? viewWithdrawalReview(state) : null,
    state.sent.length > 0 ? viewSent(state) : null,
    viewFooter(),
  ];
}

function viewHeader(): Child {
  return h(
    'header',
    {},
    h('h1', {}, 'Magic Wallet recovery'),
    h(
      'p',
      { class: 'lead' },
      'Your Magic Wallet is non-custodial: you can always move your funds yourself.',
    ),
    h(
      'div',
      { class: 'safety', role: 'note' },
      h(
        'p',
        {},
        h('strong', {}, 'Use the Bleap app where you can. '),
        'Use the Bleap app on every EVM network it officially supports. ',
        "This page is for funds on networks the app doesn't support, and for emergencies: starting a slow withdrawal on a network the app supports automatically suspends your Bleap account. ",
        'If funds are missing or not credited in the app, contact Bleap support instead.',
      ),
      h(
        'p',
        {},
        h('strong', {}, 'Stay safe. '),
        'Only trust the official Bleap app, and the official repository of this page, github.com/bleapapp/magic-wallet-recovery. ',
        'Online, this page is only published at bleapapp.github.io/magic-wallet-recovery: check the address bar. You can also run it on your own computer. ',
        'Nobody from Bleap will ever ask you for your private key or recovery phrase, and this page never asks for either: you sign in your own browser wallet. A page that asks for them is fake. ',
        'The page has no backend and no analytics.',
      ),
    ),
  );
}

function viewMessages(state: State): Child {
  return h(
    'div',
    { class: 'messages', 'aria-live': 'polite' },
    state.busy ? h('p', { class: 'busy' }, state.busy) : null,
    state.error ? h('pre', { class: 'error', role: 'alert' }, state.error) : null,
    state.notice ? h('p', { class: 'notice' }, state.notice) : null,
  );
}

function card(title: string, ...children: Child[]): HTMLElement {
  return h('section', { class: 'card' }, h('h2', {}, title), ...children);
}

function button(
  label: string,
  onClick: () => void,
  options: { secondary?: boolean; disabled?: boolean } = {},
) {
  return h(
    'button',
    {
      type: 'button',
      class: options.secondary ? 'secondary' : 'primary',
      disabled: options.disabled,
      onClick: () => onClick(),
    },
    label,
  );
}

function summaryList(items: readonly SummaryItem[]): HTMLElement {
  return h(
    'dl',
    { class: 'summary' },
    items.map((item) => [h('dt', {}, item.label), h('dd', {}, item.value)]),
  );
}

function warningList(warnings: readonly string[] | undefined): Child {
  if (!warnings || warnings.length === 0) return null;
  return h(
    'ul',
    { class: 'warnings' },
    warnings.map((warning) => h('li', {}, warning)),
  );
}

// Step 1 ------------------------------------------------------------------------------------------

function viewConnect(state: State): Child {
  const busy = Boolean(state.busy);
  if (!state.connection) {
    const metamask = state.wallets.filter((wallet) => wallet.rdns === METAMASK_RDNS);
    const others = state.wallets.filter((wallet) => wallet.rdns !== METAMASK_RDNS);
    return card(
      '1. Connect your signer account',
      h(
        'p',
        {},
        'Import the private key you exported from the Bleap app into MetaMask (Account menu → Add account → Import account), then connect that account here. Never paste your key into a website.',
      ),
      h(
        'div',
        { class: 'actions' },
        metamask.map((wallet) =>
          button('Connect MetaMask', () => void connect(wallet), { disabled: busy }),
        ),
        others.map((wallet) =>
          button(`Connect ${wallet.name} (not tested)`, () => void connect(wallet), {
            secondary: true,
            disabled: busy,
          }),
        ),
      ),
      state.walletsSearched && state.wallets.length === 0
        ? h(
            'p',
            { class: 'hint' },
            'No browser wallet found. Install MetaMask, then reload this page.',
          )
        : null,
    );
  }
  const { account, chainId, wallet } = state.connection;
  const chains = KNOWN_CHAINS.filter((chain) => !chain.testnet).concat(
    KNOWN_CHAINS.filter((chain) => chain.testnet),
  );
  return card(
    '1. Signer account',
    summaryList([
      { label: 'Connected account', value: `${account} (${wallet.name})` },
      { label: 'Network', value: `${getChainInfo(chainId).name} (chain ID ${chainId})` },
    ]),
    h('label', { for: 'network' }, 'Network where your funds are'),
    h(
      'select',
      {
        id: 'network',
        disabled: busy,
        onChange: (event) => void changeNetwork(Number(inputValue(event))),
      },
      isKnownChain(chainId)
        ? null
        : h('option', { value: String(chainId), selected: true }, `Chain ${chainId}`),
      chains.map((chain) =>
        h(
          'option',
          { value: String(chain.id), selected: chain.id === chainId },
          `${chain.name}${chain.testnet ? ' (testnet)' : ''}`,
        ),
      ),
    ),
    h('p', { class: 'hint' }, 'Other EVM networks work too: select them in your browser wallet.'),
  );
}

// Step 2 ------------------------------------------------------------------------------------------

function viewWalletInput(state: State): Child {
  return card(
    '2. Your Magic Wallet',
    h(
      'label',
      { for: 'wallet' },
      'Magic Wallet address (the address the Bleap app shows to receive funds)',
    ),
    h('input', {
      id: 'wallet',
      type: 'text',
      value: state.walletInput,
      placeholder: '0x…',
      autocomplete: 'off',
      spellcheck: false,
      onInput: (event) => setWalletInput(inputValue(event)),
    }),
    h(
      'div',
      { class: 'actions' },
      button('Check wallet', () => void checkWallet(), { disabled: Boolean(state.busy) }),
    ),
  );
}

// Step 3 ------------------------------------------------------------------------------------------

function viewStatus(state: State, status: WalletStatus): Child {
  const chain = getChainInfo(status.chainId);
  const rows: SummaryItem[] = [
    { label: 'Wallet', value: status.wallet },
    { label: 'Deployed on this network', value: status.deployed ? 'yes' : 'not yet' },
  ];
  const account = status.account;
  if (account?.module) {
    rows.push({ label: 'Cosigning Module', value: account.module.version ?? 'unknown' });
  }
  if (account?.signer) {
    rows.push({
      label: 'Registered signer',
      value: `${account.signer}${status.signerMatches ? ' (your connected account)' : ' (NOT your connected account)'}`,
    });
  }
  if (account?.timelockSeconds !== undefined) {
    rows.push({ label: 'Waiting period', value: formatDuration(account.timelockSeconds) });
  }
  const sw = account?.slowWithdrawal;
  if (sw) {
    rows.push({
      label: 'Slow withdrawal',
      value:
        sw.status === 'not-triggered'
          ? 'not started'
          : sw.status === 'waiting'
            ? `waiting: ${formatDuration(sw.remainingSeconds)} left (ready ${formatTimestamp(sw.withdrawableAt)})`
            : 'ready: you can withdraw',
    });
  }

  const balances: SummaryItem[] = [
    { label: chain.nativeSymbol, value: formatAmount(status.nativeBalance, 18) },
    ...status.tokens.map((token) => ({
      label: token.symbol ?? token.token,
      value:
        token.balance === undefined || token.decimals === undefined
          ? (token.error ?? 'unavailable')
          : formatAmount(token.balance, token.decimals),
    })),
  ];

  const supported = status.deployed ? getSupportedAccount(status) : undefined;
  const next = nextStep(status);
  const explorer = explorerAddressUrl(status.chainId, status.wallet);
  return card(
    `3. Status on ${chain.name}`,
    summaryList(rows),
    explorer ? h('p', {}, h('a', { href: explorer }, 'View the wallet on a block explorer')) : null,
    h('h3', {}, 'Balances'),
    summaryList(balances),
    viewAddToken(state),
    supported && 'problems' in supported
      ? h(
          'ul',
          { class: 'problems' },
          supported.problems.map((problem) => h('li', {}, problem)),
        )
      : null,
    account?.warnings.length ? warningList(account.warnings) : null,
    next.step === 'mismatch'
      ? h('ul', { class: 'problems' }, h('li', {}, next.message))
      : h('p', { class: 'next' }, h('strong', {}, 'Next step: '), next.message),
    viewNextAction(state, status, next),
  );
}

/** On a network the Bleap app supports, a slow withdrawal needs an explicit confirmation. */
function viewEmergencyConfirmation(state: State): Child {
  return h(
    'div',
    {},
    h('ul', { class: 'warnings' }, h('li', {}, APP_NETWORK_TRIGGER_NOTICE)),
    h(
      'label',
      { class: 'confirm' },
      h('input', {
        type: 'checkbox',
        checked: state.emergencyConfirmed,
        onChange: (event) => setEmergencyConfirmed((event.target as HTMLInputElement).checked),
      }),
      'This is an emergency. I understand that starting a slow withdrawal suspends my Bleap account.',
    ),
  );
}

function viewAddToken(state: State): Child {
  let value = '';
  return h(
    'div',
    { class: 'inline' },
    h('input', {
      type: 'text',
      placeholder: 'Other token contract address (0x…)',
      'aria-label': 'Other token contract address',
      autocomplete: 'off',
      spellcheck: false,
      onInput: (event) => {
        value = inputValue(event);
      },
    }),
    button('Show balance', () => void addToken(value), {
      secondary: true,
      disabled: Boolean(state.busy),
    }),
  );
}

function viewNextAction(state: State, status: WalletStatus, next: NextStep): Child {
  const busy = Boolean(state.busy) || Boolean(state.pending);
  if (!status.deployed) return next.step === 'deploy' ? viewDeploy(state, busy) : null;
  const account = getSupportedAccount(status);
  if ('problems' in account) return null;
  const sw = account.slowWithdrawal;
  if (sw.status === 'not-triggered') {
    const appNetwork = isBleapAppNetwork(status.chainId);
    return h(
      'div',
      {},
      h(
        'p',
        {},
        `Starting a slow withdrawal begins a waiting period of ${formatDuration(account.timelockSeconds)}. Nothing leaves your wallet until you withdraw, and you can cancel it at any time.`,
      ),
      appNetwork ? viewEmergencyConfirmation(state) : null,
      h(
        'div',
        { class: 'actions' },
        button('Start slow withdrawal', () => void prepareTriggerTx(), {
          disabled: busy || (appNetwork && !state.emergencyConfirmed),
        }),
      ),
    );
  }
  if (sw.status === 'waiting') {
    return h(
      'div',
      {},
      h(
        'p',
        {},
        `You can withdraw from ${formatTimestamp(sw.withdrawableAt)}. Come back then and check your wallet again.`,
      ),
      h(
        'div',
        { class: 'actions' },
        button('Refresh', () => void checkWallet(), { disabled: busy }),
        button('Cancel slow withdrawal', () => void prepareCancelTx(), {
          secondary: true,
          disabled: busy,
        }),
      ),
    );
  }
  return h(
    'div',
    {},
    viewWithdrawForm(state, status, busy || Boolean(state.withdrawal)),
    h(
      'div',
      { class: 'actions' },
      button('Cancel slow withdrawal', () => void prepareCancelTx(), {
        secondary: true,
        disabled: busy,
      }),
    ),
  );
}

function viewDeploy(state: State, busy: boolean): Child {
  const plan = state.deployPlan;
  if (!plan) {
    return h(
      'div',
      {},
      h(
        'p',
        {},
        'Your wallet will be deployed at the same address as on your other networks, from its original setup. The tool checks the address before sending anything. Your connected account pays the network fees.',
      ),
      h(
        'div',
        { class: 'actions' },
        button('Prepare deployment', () => void planDeployment(), { disabled: busy }),
      ),
    );
  }
  return h(
    'div',
    {},
    h('h3', {}, 'Deployment'),
    summaryList([
      { label: 'Address check', value: 'your original setup deploys to exactly this address' },
      ...plan.dependencies.map(({ dependency, deployed }) => ({
        label: dependency.name,
        value: deployed ? 'present' : 'missing: will be recreated first',
      })),
    ]),
    h(
      'p',
      { class: 'hint' },
      plan.missing.length > 0
        ? 'Each missing contract is recreated from its public original, one transaction at a time.'
        : 'Everything is in place: the next transaction deploys your wallet.',
    ),
    h(
      'div',
      { class: 'actions' },
      button('Prepare next transaction', () => void prepareNextDeployment(), { disabled: busy }),
    ),
  );
}

function viewWithdrawForm(state: State, status: WalletStatus, disabled: boolean): Child {
  const chain = getChainInfo(status.chainId);
  const form = state.withdrawForm;
  const tokenOptions = withdrawableTokens(status);
  const listed = new Set(knownTokens(status.chainId).map((token) => token.address.toLowerCase()));
  return h(
    'form',
    {
      class: 'withdraw',
      onSubmit: (event) => {
        event.preventDefault();
        void reviewWithdrawal();
      },
    },
    h('h3', {}, 'Withdraw'),
    h('label', { for: 'asset' }, 'Asset'),
    h(
      'select',
      {
        id: 'asset',
        disabled,
        onChange: (event) => {
          updateWithdrawForm({ asset: inputValue(event), amount: '' });
          document
            .getElementById('other-token-row')
            ?.toggleAttribute('hidden', inputValue(event) !== 'other');
        },
      },
      h(
        'option',
        { value: 'native', selected: form.asset === 'native' },
        `${chain.nativeSymbol} (native token)`,
      ),
      tokenOptions.map((token) =>
        h(
          'option',
          { value: token.token, selected: form.asset === token.token },
          `${token.symbol ?? 'Token'} ${listed.has(token.token.toLowerCase()) ? '' : `(${token.token})`}`.trim(),
        ),
      ),
      h('option', { value: 'other', selected: form.asset === 'other' }, 'Other ERC-20 token…'),
    ),
    h(
      'div',
      { id: 'other-token-row', class: 'field', hidden: form.asset !== 'other' },
      h('label', { for: 'other-token' }, 'Token contract address'),
      h('input', {
        id: 'other-token',
        type: 'text',
        value: form.otherToken,
        placeholder: '0x…',
        autocomplete: 'off',
        spellcheck: false,
        disabled,
        onInput: (event) => updateWithdrawForm({ otherToken: inputValue(event).trim() }),
      }),
    ),
    h('label', { for: 'amount' }, 'Amount'),
    h(
      'div',
      { class: 'inline' },
      h('input', {
        id: 'amount',
        type: 'text',
        inputmode: 'decimal',
        value: form.amount,
        placeholder: '0.0',
        autocomplete: 'off',
        disabled,
        onInput: (event) => updateWithdrawForm({ amount: inputValue(event).trim() }),
      }),
      button('Max', () => setMaxAmount(), { secondary: true, disabled }),
    ),
    h('label', { for: 'destination' }, 'Destination (defaults to your connected account)'),
    h('input', {
      id: 'destination',
      type: 'text',
      value: form.to,
      autocomplete: 'off',
      spellcheck: false,
      disabled,
      onInput: (event) => updateWithdrawForm({ to: inputValue(event).trim() }),
    }),
    h(
      'div',
      { class: 'actions' },
      h('button', { type: 'submit', class: 'primary', disabled }, 'Review withdrawal'),
    ),
  );
}

// Review and confirmation ----------------------------------------------------------------------------

function viewWithdrawalReview(state: State): Child {
  const withdrawal = state.withdrawal;
  if (!withdrawal) return null;
  const busy = Boolean(state.busy);
  return h(
    'section',
    { class: 'card emphasis' },
    h('h2', {}, `Review: ${withdrawal.title}`),
    summaryList(withdrawal.summary),
    warningList([...withdrawal.warnings, SIGNING_NOTICE]),
    h(
      'p',
      {},
      'Your browser wallet will now ask you to sign a 32-byte fingerprint of this withdrawal. It only shows this fingerprint, not the details above: check that it shows exactly ',
      h('code', {}, withdrawal.userOpHash),
    ),
    h(
      'div',
      { class: 'actions' },
      button('Sign in browser wallet', () => void signWithdrawal(), { disabled: busy }),
      button('Cancel', () => discardPending(), { secondary: true, disabled: busy }),
    ),
  );
}

function viewPending(state: State, tx: PreparedTransaction): Child {
  const chain = getChainInfo(tx.chainId);
  const busy = Boolean(state.busy);
  const fee =
    tx.estimatedFee === undefined
      ? 'unknown'
      : `about ${formatEther(tx.estimatedFee)} ${chain.nativeSymbol}`;
  return h(
    'section',
    { class: 'card emphasis' },
    h('h2', {}, `Review: ${tx.title}`),
    summaryList([
      ...tx.summary,
      { label: 'Sent from', value: `${tx.from} (pays the network fee)` },
      { label: 'Estimated network fee', value: fee },
    ]),
    warningList(tx.warnings),
    h(
      'p',
      { class: 'hint' },
      'This transaction was simulated successfully against the latest state of the network. Your browser wallet sets the final network fee.',
    ),
    h(
      'div',
      { class: 'actions' },
      button('Confirm in browser wallet', () => void sendPending(), { disabled: busy }),
      button('Cancel', () => discardPending(), { secondary: true, disabled: busy }),
    ),
  );
}

function viewSent(state: State): Child {
  return card(
    'Transactions sent',
    h(
      'ul',
      { class: 'sent' },
      state.sent.map((entry) => {
        const url = explorerTxUrl(entry.chainId, entry.hash);
        return h(
          'li',
          {},
          `${entry.title}: `,
          url ? h('a', { href: url }, entry.hash) : h('code', {}, entry.hash),
        );
      }),
    ),
  );
}

function viewFooter(): Child {
  return h(
    'footer',
    {},
    h(
      'p',
      {},
      'Open-source tool. Guides, command-line version and source code: ',
      h('a', { href: REPOSITORY_URL }, REPOSITORY_URL),
    ),
    h(
      'p',
      { class: 'hint' },
      'Provided as is, without warranty of any kind. Every transaction is simulated and summarized before you approve it in your browser wallet.',
    ),
    viewVersion(),
  );
}

/** Which code is served: a published page links the commit it was built from. */
function viewVersion(): Child {
  const commit = __APP_COMMIT__;
  const source = commit
    ? [
        ', built from commit ',
        h('a', { href: `${REPOSITORY_URL}/commit/${commit}` }, commit.slice(0, 12)),
      ]
    : null;
  return h('p', { class: 'hint' }, `Version ${__APP_VERSION__}`, source, '.');
}
