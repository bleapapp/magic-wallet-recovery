import { type Address, getAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import { getChainInfo, KNOWN_CHAINS, toViemChain } from '../../src/core/chains.js';
import { findKnownToken, KNOWN_TOKENS, tokensToRead } from '../../src/core/tokens.js';

describe('known chains', () => {
  it('have unique IDs and HTTPS endpoints', () => {
    const ids = KNOWN_CHAINS.map((chain) => chain.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const chain of KNOWN_CHAINS) {
      expect(chain.rpcUrls.length).toBeGreaterThan(0);
      for (const url of chain.rpcUrls) expect(url).toMatch(/^https:\/\//);
      if (chain.explorerUrl) expect(chain.explorerUrl).toMatch(/^https:\/\/[^/]+$/);
    }
  });

  it('describes unknown networks generically', () => {
    expect(getChainInfo(123_456_789)).toMatchObject({ id: 123_456_789, rpcUrls: [] });
  });

  it('builds viem chains with a single endpoint override', () => {
    const chain = toViemChain(getChainInfo(1), 'https://rpc.example');
    expect(chain.id).toBe(1);
    expect(chain.rpcUrls.default.http).toEqual(['https://rpc.example']);
  });
});

describe('known tokens', () => {
  it('use checksummed addresses on known networks, without duplicates', () => {
    for (const [chainId, tokens] of Object.entries(KNOWN_TOKENS)) {
      expect(KNOWN_CHAINS.some((chain) => chain.id === Number(chainId))).toBe(true);
      const addresses = tokens.map((token) => token.address);
      expect(new Set(addresses).size).toBe(addresses.length);
      for (const token of tokens) expect(getAddress(token.address)).toBe(token.address);
    }
  });

  it('give each token of a network its own label', () => {
    for (const tokens of Object.values(KNOWN_TOKENS)) {
      const labels = tokens.map((token) => token.symbol);
      expect(new Set(labels).size).toBe(labels.length);
    }
  });

  it('are found by address, whatever its case', () => {
    expect(findKnownToken(42161, '0xff970a61a04b1ca14834a43f5de4533ebddb5cc8')?.symbol).toBe(
      'USDC.e',
    );
    expect(findKnownToken(42161, '0x0000000000000000000000000000000000000001')).toBeUndefined();
    expect(findKnownToken(7_000_001, '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8')).toBeUndefined();
  });

  it('are read once each, followed by extra tokens', () => {
    const listed = (KNOWN_TOKENS[42161] ?? []).map((token) => token.address);
    // Listed tokens added again, in another case, are not read twice.
    const again = listed.map((address) => address.toLowerCase() as Address);
    const extra: Address = '0x0000000000000000000000000000000000000001';
    expect(tokensToRead(42161, [...again, extra, extra])).toEqual([...listed, extra]);
  });
});
