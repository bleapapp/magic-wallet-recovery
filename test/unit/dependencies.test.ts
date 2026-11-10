import {
  concat,
  encodeFunctionData,
  getAddress,
  getCreate2Address,
  type Hex,
  keccak256,
  parseAbi,
  size,
  toHex,
} from 'viem';
import { describe, expect, it, vi } from 'vitest';
import { ADDRESSES } from '../../src/core/constants.js';
import {
  DEPENDENCIES,
  type Dependency,
  dependencyAddress,
  extractCreationCode,
  fetchCreationCode,
  planDependencyDeployment,
  WALLET_DEPENDENCY_KEYS,
} from '../../src/core/dependencies.js';

describe('dependency registry', () => {
  it.each(Object.values(DEPENDENCIES))('$name deploys to its usual address', (dependency) => {
    expect(dependencyAddress(dependency)).toBe(getAddress(dependency.address));
    expect(dependency.sources.length).toBeGreaterThan(0);
  });

  it('lists what a wallet needs, in deployment order', () => {
    expect(WALLET_DEPENDENCY_KEYS).toEqual([
      'entryPoint',
      'kernelImplementation',
      'kernelFactory',
      'cosigningModuleV1',
    ]);
  });
});

// A made-up contract, so these tests need no network.
const code: Hex = concat(['0x6080604052', toHex(new Uint8Array(200).map((_, i) => i % 251))]);
const salt = keccak256(toHex('test salt'));
const fake: Dependency = {
  key: 'entryPoint',
  name: 'Test contract',
  address: getCreate2Address({ from: ADDRESSES.deterministicDeployer, salt, bytecode: code }),
  salt,
  initCodeHash: keccak256(code),
  initCodeSize: size(code),
  sources: [
    { chainId: 1, txHash: `0x${'01'.repeat(32)}` },
    { chainId: 42161, txHash: `0x${'02'.repeat(32)}` },
  ],
};

describe('extractCreationCode', () => {
  it('reads a direct call to the deterministic deployment proxy', () => {
    expect(extractCreationCode(concat([salt, code]), fake)).toBe(code);
  });

  it('reads a deployment made through a smart account', () => {
    const input = encodeFunctionData({
      abi: parseAbi(['function execute(address to, uint256 value, bytes data, uint8 operation)']),
      functionName: 'execute',
      args: [ADDRESSES.deterministicDeployer, 0n, concat([salt, code]), 0],
    });
    expect(extractCreationCode(input, fake)).toBe(code);
  });

  it('rejects code that does not have the expected hash', () => {
    const tampered = concat([code.slice(0, -2) as Hex, '0x00']);
    expect(extractCreationCode(concat([salt, tampered]), fake)).toBeUndefined();
    expect(extractCreationCode(concat([keccak256('0x01'), code]), fake)).toBeUndefined();
  });
});

describe('fetchCreationCode', () => {
  it('falls back to the next source when one fails', async () => {
    const reader = vi
      .fn()
      .mockRejectedValueOnce(new Error('rate limited'))
      .mockResolvedValueOnce(concat([salt, code]));
    await expect(fetchCreationCode(fake, reader)).resolves.toEqual({
      code,
      source: fake.sources[1],
    });
    expect(reader).toHaveBeenCalledTimes(2);
  });

  it('fails with every problem listed when no source works', async () => {
    const reader = vi.fn().mockResolvedValue('0x1234');
    await expect(fetchCreationCode(fake, reader)).rejects.toThrow(
      'Could not read the creation code',
    );
  });
});

describe('planDependencyDeployment', () => {
  it('sends salt and code to the deterministic deployment proxy', () => {
    const plan = planDependencyDeployment(
      fake,
      code,
      fake.sources[0] ?? { chainId: 1, txHash: '0x' },
    );
    expect(plan.to).toBe(ADDRESSES.deterministicDeployer);
    expect(plan.data).toBe(concat([salt, code]));
    expect(plan.value).toBe(0n);
  });

  it('refuses code with another hash', () => {
    expect(() => planDependencyDeployment(fake, '0x00', { chainId: 1, txHash: '0x' })).toThrow();
  });
});
