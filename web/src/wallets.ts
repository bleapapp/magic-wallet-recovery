import { type Address, type EIP1193Provider, getAddress, toHex } from 'viem';
import { getChainInfo, isKnownChain } from '../../src/core/chains.js';
import { RecoveryError } from '../../src/core/errors.js';

/** A browser wallet announced through EIP-6963. */
export interface BrowserWallet {
  id: string;
  name: string;
  rdns: string;
  provider: EIP1193Provider;
}

interface Eip6963AnnounceEvent extends Event {
  detail: {
    info: { uuid: string; name: string; rdns: string };
    provider: EIP1193Provider;
  };
}

declare global {
  interface Window {
    ethereum?: EIP1193Provider & { isMetaMask?: boolean };
  }
}

export const METAMASK_RDNS = 'io.metamask';

/** Collects the browser wallets installed in this browser (EIP-6963, then `window.ethereum`). */
export function discoverWallets(onChange: (wallets: BrowserWallet[]) => void): void {
  const wallets = new Map<string, BrowserWallet>();
  window.addEventListener('eip6963:announceProvider', (event) => {
    const { info, provider } = (event as Eip6963AnnounceEvent).detail;
    if (!info?.uuid || !provider) return;
    wallets.set(info.uuid, { id: info.uuid, name: info.name, rdns: info.rdns, provider });
    onChange(sortWallets([...wallets.values()]));
  });
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  setTimeout(() => {
    if (wallets.size === 0 && window.ethereum) {
      const isMetaMask = Boolean(window.ethereum.isMetaMask);
      wallets.set('injected', {
        id: 'injected',
        name: isMetaMask ? 'MetaMask' : 'Browser wallet',
        rdns: isMetaMask ? METAMASK_RDNS : 'injected',
        provider: window.ethereum,
      });
      onChange([...wallets.values()]);
    }
  }, 500);
}

function sortWallets(wallets: BrowserWallet[]): BrowserWallet[] {
  return wallets.sort(
    (a, b) => Number(b.rdns === METAMASK_RDNS) - Number(a.rdns === METAMASK_RDNS),
  );
}

export async function requestAccount(provider: EIP1193Provider): Promise<Address> {
  const accounts = await provider.request({ method: 'eth_requestAccounts' });
  const account = accounts[0];
  if (!account) throw new RecoveryError('The wallet did not share any account.');
  return getAddress(account);
}

export async function readChainId(provider: EIP1193Provider): Promise<number> {
  return Number(await provider.request({ method: 'eth_chainId' }));
}

/** Asks the browser wallet to switch network, adding it first if the wallet doesn't know it. */
export async function switchNetwork(provider: EIP1193Provider, chainId: number): Promise<void> {
  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: toHex(chainId) }],
    });
  } catch (error) {
    const code = (error as { code?: number }).code;
    if (code !== 4902 || !isKnownChain(chainId)) throw error;
    const chain = getChainInfo(chainId);
    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [
        {
          chainId: toHex(chainId),
          chainName: chain.name,
          nativeCurrency: { name: chain.nativeSymbol, symbol: chain.nativeSymbol, decimals: 18 },
          rpcUrls: [...chain.rpcUrls],
          blockExplorerUrls: chain.explorerUrl ? [chain.explorerUrl] : undefined,
        },
      ],
    });
  }
}
