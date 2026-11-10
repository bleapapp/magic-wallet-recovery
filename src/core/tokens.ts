import { type Address, isAddressEqual } from 'viem';

/** A widely used token, listed so its balance is shown without typing its address. */
export interface KnownToken {
  /**
   * Label shown for this token. It replaces the symbol read from the chain, because some networks
   * have several tokens with the same symbol (e.g. native USDC and bridged USDC.e).
   */
  symbol: string;
  address: Address;
  decimals: number;
}

/**
 * Common tokens per network: stablecoins first, then wrapped native tokens, ETH and BTC. Every
 * entry was checked on its network (symbol, decimals and supply). Balances of any other token can
 * be read by passing its contract address. Decimals are always read again from the chain.
 */
export const KNOWN_TOKENS: Record<number, readonly KnownToken[]> = {
  // Ethereum
  1: [
    { symbol: 'USDC', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
    { symbol: 'USDT', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
    { symbol: 'DAI', address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', decimals: 18 },
    { symbol: 'PYUSD', address: '0x6c3ea9036406852006290770BEdFcAbA0e23A0e8', decimals: 6 },
    { symbol: 'EURC', address: '0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c', decimals: 6 },
    { symbol: 'EURe', address: '0x39b8B6385416f4cA36a20319F70D28621895279D', decimals: 18 },
    { symbol: 'WETH', address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', decimals: 18 },
    { symbol: 'WBTC', address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', decimals: 8 },
    { symbol: 'cbBTC', address: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf', decimals: 8 },
  ],
  // OP Mainnet
  10: [
    { symbol: 'USDC', address: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', decimals: 6 },
    { symbol: 'USDC.e', address: '0x7F5c764cBc14f9669B88837ca1490cCa17c31607', decimals: 6 },
    { symbol: 'USDT', address: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58', decimals: 6 },
    { symbol: 'DAI', address: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1', decimals: 18 },
    { symbol: 'WETH', address: '0x4200000000000000000000000000000000000006', decimals: 18 },
    { symbol: 'WBTC', address: '0x68f180fcCe6836688e9084f035309E29Bf0A2095', decimals: 8 },
    { symbol: 'OP', address: '0x4200000000000000000000000000000000000042', decimals: 18 },
  ],
  // Cronos
  25: [
    { symbol: 'USDC', address: '0xc21223249CA28397B4B6541dfFaEcC539BfF0c59', decimals: 6 },
    { symbol: 'USDT', address: '0x66e428c3f67a68878562e79A0234c1F83c208770', decimals: 6 },
    { symbol: 'WCRO', address: '0x5C7F8A570d578ED84E63fdFA7b1eE72dEae1AE23', decimals: 18 },
    { symbol: 'WETH', address: '0xe44Fd7fCb2b1581822D0c862B68222998a0c299a', decimals: 18 },
  ],
  // BNB Chain
  56: [
    { symbol: 'USDC', address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', decimals: 18 },
    { symbol: 'USDT', address: '0x55d398326f99059fF775485246999027B3197955', decimals: 18 },
    { symbol: 'FDUSD', address: '0xc5f0f7b66764F6ec8C8Dff7BA683102295E16409', decimals: 18 },
    { symbol: 'DAI', address: '0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3', decimals: 18 },
    { symbol: 'WBNB', address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', decimals: 18 },
    { symbol: 'ETH', address: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8', decimals: 18 },
    { symbol: 'BTCB', address: '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c', decimals: 18 },
  ],
  // Gnosis
  100: [
    { symbol: 'USDC.e', address: '0x2a22f9c3b484c3629090FeED35F17Ff8F88f76F0', decimals: 6 },
    { symbol: 'USDC', address: '0xDDAfbb505ad214D7b80b1f830fcCc89B60fb7A83', decimals: 6 },
    { symbol: 'USDT', address: '0x4ECaBa5870353805a9F068101A40E0f32ed605C6', decimals: 6 },
    { symbol: 'EURe', address: '0x420CA0f9B9b604cE0fd9C18EF134C705e5Fa3430', decimals: 18 },
    { symbol: 'WXDAI', address: '0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d', decimals: 18 },
    { symbol: 'WETH', address: '0x6A023CCd1ff6F2045C3309768eAd9E68F978f6e1', decimals: 18 },
    { symbol: 'GNO', address: '0x9C58BAcC331c9aa871AFD802DB6379a98e80CEdb', decimals: 18 },
  ],
  // Polygon
  137: [
    { symbol: 'USDC', address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', decimals: 6 },
    { symbol: 'USDC.e', address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', decimals: 6 },
    { symbol: 'USDT0', address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', decimals: 6 },
    { symbol: 'DAI', address: '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063', decimals: 18 },
    { symbol: 'EURe', address: '0xE0aEa583266584DafBB3f9C3211d5588c73fEa8d', decimals: 18 },
    { symbol: 'WPOL', address: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', decimals: 18 },
    { symbol: 'WETH', address: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', decimals: 18 },
    { symbol: 'WBTC', address: '0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6', decimals: 8 },
  ],
  // HyperEVM
  999: [
    { symbol: 'USDC', address: '0xb88339CB7199b77E23DB6E890353E22632Ba630f', decimals: 6 },
    { symbol: 'USDT0', address: '0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb', decimals: 6 },
    { symbol: 'WHYPE', address: '0x5555555555555555555555555555555555555555', decimals: 18 },
  ],
  // Base
  8453: [
    { symbol: 'USDC', address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 },
    { symbol: 'USDbC', address: '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA', decimals: 6 },
    { symbol: 'USDT', address: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2', decimals: 6 },
    { symbol: 'DAI', address: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb', decimals: 18 },
    { symbol: 'EURC', address: '0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42', decimals: 6 },
    { symbol: 'WETH', address: '0x4200000000000000000000000000000000000006', decimals: 18 },
    { symbol: 'cbBTC', address: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf', decimals: 8 },
  ],
  // Arbitrum One
  42161: [
    { symbol: 'USDC', address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6 },
    { symbol: 'USDC.e', address: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8', decimals: 6 },
    { symbol: 'USDT0', address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', decimals: 6 },
    { symbol: 'DAI', address: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1', decimals: 18 },
    { symbol: 'EURe', address: '0x0c06cCF38114ddfc35e07427B9424adcca9F44F8', decimals: 18 },
    { symbol: 'WETH', address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', decimals: 18 },
    { symbol: 'WBTC', address: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f', decimals: 8 },
    { symbol: 'ARB', address: '0x912CE59144191C1204E64559FE8253a0e49E6548', decimals: 18 },
  ],
  // Celo
  42220: [
    { symbol: 'USDC', address: '0xcebA9300f2b948710d2653dD7B07f33A8B32118C', decimals: 6 },
    { symbol: 'USDT', address: '0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e', decimals: 6 },
    { symbol: 'USDm', address: '0x765DE816845861e75A25fCA122bb6898B8B1282a', decimals: 18 },
    { symbol: 'EURm', address: '0xD8763CBa276a3738E6DE85b4b3bF5FDed6D6cA73', decimals: 18 },
  ],
  // Avalanche C-Chain
  43114: [
    { symbol: 'USDC', address: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', decimals: 6 },
    { symbol: 'USDT', address: '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7', decimals: 6 },
    { symbol: 'DAI.e', address: '0xd586E7F844cEa2F87f50152665BCbc2C279D8d70', decimals: 18 },
    { symbol: 'EURC', address: '0xC891EB4cbdEFf6e073e859e987815Ed1505c2ACD', decimals: 6 },
    { symbol: 'WAVAX', address: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7', decimals: 18 },
    { symbol: 'WETH.e', address: '0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB', decimals: 18 },
    { symbol: 'BTC.b', address: '0x152b9d0FdC40C096757F570A51E494bd4b943E50', decimals: 8 },
  ],
  // Linea
  59144: [
    { symbol: 'USDC', address: '0x176211869cA2b568f2A7D4EE941E073a821EE1ff', decimals: 6 },
    { symbol: 'USDT', address: '0xA219439258ca9da29E9Cc4cE5596924745e12B93', decimals: 6 },
    { symbol: 'DAI', address: '0x4AF15ec2A0BD43Db75dd04E62FAA3B8EF36b00d5', decimals: 18 },
    { symbol: 'WETH', address: '0xe5D7C2a44FfDDf6b295A15c148167daaAf5Cf34f', decimals: 18 },
    { symbol: 'WBTC', address: '0x3aAB2285ddcDdaD8edf438C1bAB47e1a9D05a9b4', decimals: 8 },
  ],
  // Blast
  81457: [
    { symbol: 'USDB', address: '0x4300000000000000000000000000000000000003', decimals: 18 },
    { symbol: 'WETH', address: '0x4300000000000000000000000000000000000004', decimals: 18 },
  ],
  // Testnets: Circle's test USDC, for trying the tools without real funds.
  84532: [{ symbol: 'USDC', address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', decimals: 6 }],
  421614: [{ symbol: 'USDC', address: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d', decimals: 6 }],
  11155111: [
    { symbol: 'USDC', address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', decimals: 6 },
  ],
  11155420: [
    { symbol: 'USDC', address: '0x5fd84259d66Cd46123540766Be93DFE6D43130D7', decimals: 6 },
  ],
};

export function knownTokens(chainId: number): readonly KnownToken[] {
  return KNOWN_TOKENS[chainId] ?? [];
}

/** The tokens to read on a network: its listed tokens, then `extra` ones, without duplicates. */
export function tokensToRead(chainId: number, extra: readonly Address[] = []): Address[] {
  const seen = new Set<string>();
  return [...knownTokens(chainId).map((token) => token.address), ...extra].filter((address) => {
    const key = address.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The listed token at this address on this network, if any. */
export function findKnownToken(chainId: number, address: Address): KnownToken | undefined {
  return knownTokens(chainId).find((token) => isAddressEqual(token.address, address));
}
