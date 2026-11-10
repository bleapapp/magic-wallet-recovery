import { type Chain, defineChain } from 'viem';

/** What the tool needs to know about a network. */
export interface ChainInfo {
  id: number;
  name: string;
  nativeSymbol: string;
  /** Keyless public JSON-RPC endpoints, in order of preference. You can always use your own. */
  rpcUrls: readonly string[];
  explorerUrl?: string;
  testnet?: boolean;
  /**
   * The Bleap app supports this network. There, the app is the way to use the wallet, and a slow
   * withdrawal is for emergencies only: starting one suspends the person's Bleap account.
   *
   * Set it for every network the app adds: it drives the extra emergency confirmation. Messages
   * never list these networks, so they stay correct even if this flag lags behind the app.
   */
  bleapApp?: boolean;
}

/**
 * Networks with known public endpoints. Any other EVM network works too: pass its chain ID and an
 * RPC URL (CLI) or select it in your browser wallet (web page).
 */
export const KNOWN_CHAINS: readonly ChainInfo[] = [
  {
    id: 1,
    name: 'Ethereum',
    nativeSymbol: 'ETH',
    rpcUrls: [
      'https://ethereum-rpc.publicnode.com',
      'https://cloudflare-eth.com',
      'https://1rpc.io/eth',
    ],
    explorerUrl: 'https://etherscan.io',
  },
  {
    id: 10,
    name: 'OP Mainnet',
    nativeSymbol: 'ETH',
    rpcUrls: ['https://mainnet.optimism.io', 'https://optimism-rpc.publicnode.com'],
    explorerUrl: 'https://optimistic.etherscan.io',
  },
  {
    id: 25,
    name: 'Cronos',
    nativeSymbol: 'CRO',
    rpcUrls: ['https://evm.cronos.org'],
    explorerUrl: 'https://explorer.cronos.org',
  },
  {
    id: 56,
    name: 'BNB Chain',
    nativeSymbol: 'BNB',
    rpcUrls: ['https://bsc-dataseed.bnbchain.org', 'https://bsc-rpc.publicnode.com'],
    explorerUrl: 'https://bscscan.com',
    bleapApp: true,
  },
  {
    id: 100,
    name: 'Gnosis',
    nativeSymbol: 'XDAI',
    rpcUrls: ['https://rpc.gnosischain.com', 'https://gnosis-rpc.publicnode.com'],
    explorerUrl: 'https://gnosisscan.io',
  },
  {
    id: 137,
    name: 'Polygon',
    nativeSymbol: 'POL',
    rpcUrls: ['https://polygon-bor-rpc.publicnode.com'],
    explorerUrl: 'https://polygonscan.com',
  },
  {
    id: 999,
    name: 'HyperEVM',
    nativeSymbol: 'HYPE',
    rpcUrls: ['https://rpc.hyperliquid.xyz/evm'],
    explorerUrl: 'https://hyperevmscan.io',
  },
  {
    id: 4663,
    name: 'Robinhood Chain',
    nativeSymbol: 'ETH',
    rpcUrls: ['https://rpc.mainnet.chain.robinhood.com'],
    explorerUrl: 'https://robin.etherscan.io',
    bleapApp: true,
  },
  {
    id: 8453,
    name: 'Base',
    nativeSymbol: 'ETH',
    rpcUrls: ['https://mainnet.base.org', 'https://base-rpc.publicnode.com'],
    explorerUrl: 'https://basescan.org',
    bleapApp: true,
  },
  {
    id: 42161,
    name: 'Arbitrum One',
    nativeSymbol: 'ETH',
    rpcUrls: ['https://arb1.arbitrum.io/rpc', 'https://arbitrum-one-rpc.publicnode.com'],
    explorerUrl: 'https://arbiscan.io',
    bleapApp: true,
  },
  {
    id: 42220,
    name: 'Celo',
    nativeSymbol: 'CELO',
    rpcUrls: ['https://forno.celo.org'],
    explorerUrl: 'https://celoscan.io',
  },
  {
    id: 43114,
    name: 'Avalanche C-Chain',
    nativeSymbol: 'AVAX',
    rpcUrls: [
      'https://api.avax.network/ext/bc/C/rpc',
      'https://avalanche-c-chain-rpc.publicnode.com',
    ],
    explorerUrl: 'https://snowtrace.io',
  },
  {
    id: 59144,
    name: 'Linea',
    nativeSymbol: 'ETH',
    rpcUrls: ['https://rpc.linea.build'],
    explorerUrl: 'https://lineascan.build',
  },
  {
    id: 81457,
    name: 'Blast',
    nativeSymbol: 'ETH',
    rpcUrls: ['https://rpc.blast.io'],
    explorerUrl: 'https://blastscan.io',
  },
  // Testnets
  {
    id: 97,
    name: 'BNB Chain Testnet',
    nativeSymbol: 'tBNB',
    rpcUrls: ['https://bsc-testnet-rpc.publicnode.com'],
    explorerUrl: 'https://testnet.bscscan.com',
    testnet: true,
  },
  {
    id: 46630,
    name: 'Robinhood Chain Testnet',
    nativeSymbol: 'ETH',
    rpcUrls: ['https://rpc.testnet.chain.robinhood.com'],
    explorerUrl: 'https://explorer.testnet.chain.robinhood.com',
    testnet: true,
  },
  {
    id: 84532,
    name: 'Base Sepolia',
    nativeSymbol: 'ETH',
    rpcUrls: ['https://sepolia.base.org'],
    explorerUrl: 'https://sepolia.basescan.org',
    testnet: true,
  },
  {
    id: 421614,
    name: 'Arbitrum Sepolia',
    nativeSymbol: 'ETH',
    rpcUrls: ['https://sepolia-rollup.arbitrum.io/rpc'],
    explorerUrl: 'https://sepolia.arbiscan.io',
    testnet: true,
  },
  {
    id: 11155111,
    name: 'Sepolia',
    nativeSymbol: 'ETH',
    rpcUrls: ['https://ethereum-sepolia-rpc.publicnode.com'],
    explorerUrl: 'https://sepolia.etherscan.io',
    testnet: true,
  },
  {
    id: 11155420,
    name: 'OP Sepolia',
    nativeSymbol: 'ETH',
    rpcUrls: ['https://sepolia.optimism.io'],
    explorerUrl: 'https://sepolia-optimism.etherscan.io',
    testnet: true,
  },
];

/** Returns what the tool knows about a network, or a generic description for any other chain ID. */
export function getChainInfo(chainId: number): ChainInfo {
  const known = KNOWN_CHAINS.find((chain) => chain.id === chainId);
  return (
    known ?? { id: chainId, name: `Chain ${chainId}`, nativeSymbol: 'native token', rpcUrls: [] }
  );
}

/** Whether the Bleap app supports this network (see {@link ChainInfo.bleapApp}). */
export function isBleapAppNetwork(chainId: number): boolean {
  return getChainInfo(chainId).bleapApp === true;
}

export function isKnownChain(chainId: number): boolean {
  return KNOWN_CHAINS.some((chain) => chain.id === chainId);
}

/** Builds a viem chain definition. Passing it to clients makes viem check the wallet's chain ID. */
export function toViemChain(info: ChainInfo, rpcUrl?: string): Chain {
  const urls = rpcUrl ? [rpcUrl] : [...info.rpcUrls];
  return defineChain({
    id: info.id,
    name: info.name,
    nativeCurrency: { name: info.nativeSymbol, symbol: info.nativeSymbol, decimals: 18 },
    rpcUrls: { default: { http: urls } },
    ...(info.explorerUrl
      ? { blockExplorers: { default: { name: 'Explorer', url: info.explorerUrl } } }
      : {}),
    testnet: info.testnet ?? false,
  });
}

export function explorerAddressUrl(chainId: number, address: string): string | undefined {
  const { explorerUrl } = getChainInfo(chainId);
  return explorerUrl ? `${explorerUrl}/address/${address}` : undefined;
}

export function explorerTxUrl(chainId: number, hash: string): string | undefined {
  const { explorerUrl } = getChainInfo(chainId);
  return explorerUrl ? `${explorerUrl}/tx/${hash}` : undefined;
}
