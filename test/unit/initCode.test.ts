import {
  type Address,
  concat,
  decodeAbiParameters,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  type Hex,
  pad,
  zeroAddress,
} from 'viem';
import { describe, expect, it } from 'vitest';
import { entryPoint07Abi, kernelAbi, metaFactoryAbi } from '../../src/core/abis.js';
import { ADDRESSES, NO_HOOK, WALLET_SALT } from '../../src/core/constants.js';
import {
  computeWalletAddress,
  decodeInitData,
  findDeploymentInCalldata,
  kernelInitData,
  moduleSignerId,
  permissionValidationId,
  rebuildOriginalDeployment,
  rootPermissionId,
  rootValidatorData,
  walletDeploymentCall,
} from '../../src/core/initCode.js';

// Placeholder signers, not real accounts. The expected addresses were checked against
// KernelFactory.getAddress(initData, 0) on Arbitrum One and Ethereum.
const CASES = [
  {
    signer: '0x1111111111111111111111111111111111111111',
    permissionId: '0x3f26b6de',
    wallet: '0x55EB3638Ab1F4add9F163BcC86fd4b036371d0dE',
  },
  {
    signer: '0x000000000000000000000000000000000000dEaD',
    permissionId: '0xa2b22f74',
    wallet: '0x00A1EB8A9d3dA1151DC89A5449f29Ff428c99230',
  },
] as const;

describe('original wallet setup', () => {
  it.each(CASES)('rebuilds the wallet of signer $signer', ({ signer, permissionId, wallet }) => {
    expect(rootPermissionId(signer, 'V1')).toBe(permissionId);
    const deployment = rebuildOriginalDeployment(signer);
    expect(deployment.address).toBe(wallet);
    expect(deployment.salt).toBe(WALLET_SALT);
    expect(computeWalletAddress(deployment.initData)).toBe(wallet);
  });

  it('encodes the root validation ID and the module signer ID', () => {
    expect(permissionValidationId('0x3f26b6de')).toBe(
      '0x023f26b6de00000000000000000000000000000000',
    );
    expect(moduleSignerId('0x3f26b6de')).toBe(`0x3f26b6de${'00'.repeat(28)}`);
  });

  it('uses Cosigning Module V1 with the signer as owner', () => {
    const signer = CASES[0].signer;
    expect(decodeInitData(rebuildOriginalDeployment(signer).initData)).toEqual({
      rootValidationId: permissionValidationId(CASES[0].permissionId),
      module: ADDRESSES.cosigningModuleV1,
      moduleVersion: 'V1',
      signer: getAddress(signer),
    });
  });

  it('gives a V2 root permission a different ID and address', () => {
    const signer = CASES[0].signer;
    expect(rootPermissionId(signer, 'V2')).not.toBe(rootPermissionId(signer, 'V1'));
    const v2 = kernelInitData(signer, 'V2');
    expect(decodeInitData(v2)?.moduleVersion).toBe('V2');
    expect(decodeInitData(v2)?.signer).toBe(getAddress(signer));
    expect(computeWalletAddress(v2)).not.toBe(CASES[0].wallet);
  });

  it('returns undefined for data that is not Kernel init data', () => {
    expect(decodeInitData('0x12345678')).toBeUndefined();
  });

  describe('refuses a setup that installs more than the root signer', () => {
    const signer = CASES[0].signer;
    const validationId = permissionValidationId(rootPermissionId(signer, 'V1'));
    const validatorData = rootValidatorData(signer, 'V1');
    const [signerEntry] = decodeAbiParameters([{ type: 'bytes[]' }], validatorData)[0];
    const policyEntry = concat(['0x0000', '0x3333333333333333333333333333333333333333']);
    const init = (
      hook: Address,
      validator: Hex,
      hookData: Hex = '0x',
      initConfig: readonly Hex[] = [],
    ) =>
      encodeFunctionData({
        abi: kernelAbi,
        functionName: 'initialize',
        args: [validationId, hook, validator, hookData, initConfig],
      });

    it('accepts the plain setup, with or without an explicit "no hook" value', () => {
      expect(decodeInitData(init(zeroAddress, validatorData))?.signer).toBe(getAddress(signer));
      expect(decodeInitData(init(NO_HOOK, validatorData))?.signer).toBe(getAddress(signer));
    });

    it.each<[string, Hex]>([
      ['a hook', init('0x3333333333333333333333333333333333333333', validatorData)],
      ['hook data', init(zeroAddress, validatorData, '0x01')],
      ['other modules', init(zeroAddress, validatorData, '0x', ['0x01'])],
      [
        'policies',
        init(
          zeroAddress,
          encodeAbiParameters([{ type: 'bytes[]' }], [[policyEntry, signerEntry ?? '0x']]),
        ),
      ],
    ])('refuses %s', (_, initData) => {
      expect(decodeInitData(initData)).toBeUndefined();
    });
  });
});

describe('findDeploymentInCalldata', () => {
  const deployment = rebuildOriginalDeployment(CASES[0].signer);
  const factoryData = encodeFunctionData({
    abi: metaFactoryAbi,
    functionName: 'deployWithFactory',
    args: [ADDRESSES.kernelFactory, deployment.initData, WALLET_SALT],
  });

  it('finds the setup in a direct factory call', () => {
    const input = walletDeploymentCall(deployment).data;
    expect(findDeploymentInCalldata(input, deployment.address)).toEqual(deployment);
  });

  it('finds the setup in a meta-factory call', () => {
    expect(findDeploymentInCalldata(factoryData, deployment.address)).toEqual(deployment);
  });

  it('finds the setup in an EntryPoint bundle', () => {
    const zero32 = pad('0x', { size: 32 });
    const input = encodeFunctionData({
      abi: entryPoint07Abi,
      functionName: 'handleOps',
      args: [
        [
          {
            sender: deployment.address,
            nonce: 0n,
            initCode: concat([ADDRESSES.metaFactory, factoryData]),
            callData: '0x',
            accountGasLimits: zero32,
            preVerificationGas: 0n,
            gasFees: zero32,
            paymasterAndData: '0x',
            signature: '0x',
          },
        ],
        '0x0000000000000000000000000000000000000001',
      ],
    });
    expect(findDeploymentInCalldata(input, deployment.address)).toEqual(deployment);
  });

  it('returns undefined when the transaction deployed another wallet', () => {
    expect(findDeploymentInCalldata(factoryData, CASES[1].wallet)).toBeUndefined();
    expect(findDeploymentInCalldata('0x', deployment.address)).toBeUndefined();
    expect(findDeploymentInCalldata(factoryData, zeroAddress)).toBeUndefined();
  });
});
