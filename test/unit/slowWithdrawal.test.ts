import { decodeFunctionData, type Hex } from 'viem';
import { describe, expect, it } from 'vitest';
import { cosigningModuleV1Abi } from '../../src/core/abis.js';
import { isBleapAppNetwork } from '../../src/core/chains.js';
import { ADDRESSES } from '../../src/core/constants.js';
import {
  type AccountInfo,
  nextStep,
  type SlowWithdrawalState,
  slowWithdrawalStateV1,
  slowWithdrawalStateV2,
  type WalletStatus,
} from '../../src/core/inspect.js';
import {
  APP_NETWORK_CANCEL_NOTICE,
  APP_NETWORK_TRIGGER_NOTICE,
  planCancel,
  planTrigger,
  TRIGGER_REMINDER,
} from '../../src/core/slowWithdrawal.js';
import { assertCanWithdraw } from '../../src/core/withdraw.js';

const WALLET = '0x2222222222222222222222222222222222222222';
const SIGNER = '0x4444444444444444444444444444444444444444';
const OTHER = '0x5555555555555555555555555555555555555555';
const MODULE_ID: Hex = `0x3f26b6de${'00'.repeat(28)}`;

function walletStatus(
  slowWithdrawal: SlowWithdrawalState,
  overrides: Partial<AccountInfo> = {},
): WalletStatus {
  return {
    chainId: 1,
    wallet: WALLET,
    blockNumber: 100n,
    blockTimestamp: 1_000_000n,
    deployed: true,
    nativeBalance: 0n,
    tokens: [],
    account: {
      rootValidationId: '0x023f26b6de00000000000000000000000000000000',
      rootPermissionId: '0x3f26b6de',
      moduleSignerId: MODULE_ID,
      module: { version: 'V1', address: ADDRESSES.cosigningModuleV1 },
      policyCount: 0,
      hook: '0x0000000000000000000000000000000000000001',
      signer: SIGNER,
      timelockSeconds: 86_400n,
      slowWithdrawal,
      unsupported: [],
      warnings: [],
      ...overrides,
    },
  };
}

describe('slow-withdrawal timing', () => {
  it('V1 accepts the operation one second after the waiting period (strict comparison)', () => {
    expect(slowWithdrawalStateV1(0n, 86_400n, 5n)).toEqual({ status: 'not-triggered' });
    expect(slowWithdrawalStateV1(1_000n, 86_400n, 1_000n + 86_400n)).toMatchObject({
      status: 'waiting',
      remainingSeconds: 1n,
      withdrawableAt: 87_401n,
    });
    expect(slowWithdrawalStateV1(1_000n, 86_400n, 87_401n)).toMatchObject({
      status: 'ready',
      remainingSeconds: 0n,
    });
  });

  it('V2 accepts the operation from the stored deadline on', () => {
    expect(slowWithdrawalStateV2(0n, 0n, 5n)).toEqual({ status: 'not-triggered' });
    expect(slowWithdrawalStateV2(1_000n, 260_200n, 260_199n)).toMatchObject({
      status: 'waiting',
      remainingSeconds: 1n,
    });
    expect(slowWithdrawalStateV2(1_000n, 260_200n, 260_200n)).toMatchObject({ status: 'ready' });
  });
});

const notTriggered: SlowWithdrawalState = { status: 'not-triggered' };
const waiting = slowWithdrawalStateV1(999_000n, 86_400n, 1_000_000n);
const ready = slowWithdrawalStateV1(1n, 86_400n, 1_000_000n);

describe('trigger and cancel', () => {
  it('triggers through the Cosigning Module with the root permission ID', () => {
    const plan = planTrigger(walletStatus(notTriggered), SIGNER);
    expect(plan.to).toBe(ADDRESSES.cosigningModuleV1);
    const { functionName, args } = decodeFunctionData({
      abi: cosigningModuleV1Abi,
      data: plan.data,
    });
    expect(functionName).toBe('triggerSlowWithdraw');
    expect(args).toEqual([MODULE_ID, WALLET]);
  });

  it('refuses to trigger twice, or from another account', () => {
    expect(() => planTrigger(walletStatus(waiting), SIGNER)).toThrow('already in progress');
    expect(() => planTrigger(walletStatus(notTriggered), OTHER)).toThrow("This wallet's signer is");
  });

  it('cancels only a slow withdrawal in progress', () => {
    expect(() => planCancel(walletStatus(notTriggered), SIGNER)).toThrow('No slow withdrawal');
    const { functionName } = decodeFunctionData({
      abi: cosigningModuleV1Abi,
      data: planCancel(walletStatus(ready), SIGNER).data,
    });
    expect(functionName).toBe('unTriggerSlowWithdraw');
  });

  it('refuses wallets the tool does not support', () => {
    const status = walletStatus(notTriggered, {
      unsupported: ['The root permission has policies.'],
    });
    expect(() => planTrigger(status, SIGNER)).toThrow('policies');
  });
});

describe('networks the Bleap app supports', () => {
  const onAppNetwork = (state: SlowWithdrawalState): WalletStatus => ({
    ...walletStatus(state),
    chainId: 42161,
  });

  it('flags only mainnets of the app', () => {
    expect([56, 4663, 8453, 42161].every(isBleapAppNetwork)).toBe(true);
    expect(isBleapAppNetwork(1)).toBe(false);
    expect(isBleapAppNetwork(84532)).toBe(false);
  });

  it('refuses to start a slow withdrawal without an emergency confirmation', () => {
    expect(() => planTrigger(onAppNetwork(notTriggered), SIGNER)).toThrow(
      'The Bleap app supports Arbitrum One',
    );
  });

  it('starts it once confirmed, with the account notice first', () => {
    const plan = planTrigger(onAppNetwork(notTriggered), SIGNER, { emergency: true });
    expect(plan.warnings?.[0]).toBe(APP_NETWORK_TRIGGER_NOTICE);
  });

  it('shows a reminder instead on other networks, in case the app supports them too', () => {
    const warnings = planTrigger(walletStatus(notTriggered), SIGNER).warnings;
    expect(warnings?.[0]).toBe(TRIGGER_REMINDER);
    expect(warnings).not.toContain(APP_NETWORK_TRIGGER_NOTICE);
    expect(planCancel(walletStatus(ready), SIGNER).warnings).not.toContain(
      APP_NETWORK_CANCEL_NOTICE,
    );
  });

  it('says that cancelling does not lift the account suspension', () => {
    expect(planCancel(onAppNetwork(ready), SIGNER).warnings).toContain(APP_NETWORK_CANCEL_NOTICE);
  });

  it('points to the app as the next step', () => {
    expect(nextStep(onAppNetwork(notTriggered)).message).toContain('use the app');
  });
});

describe('assertCanWithdraw', () => {
  it('allows a ready wallet and its signer', () => {
    expect(assertCanWithdraw(walletStatus(ready), SIGNER).signer).toBe(SIGNER);
  });

  it.each([
    ['not triggered', walletStatus(notTriggered), SIGNER, 'No slow withdrawal'],
    ['still waiting', walletStatus(waiting), SIGNER, 'not over yet'],
    ['another signer', walletStatus(ready), OTHER, "This wallet's signer is"],
  ] as const)('refuses when %s', (_, status, signer, message) => {
    expect(() => assertCanWithdraw(status, signer)).toThrow(message);
  });

  it('refuses a wallet that is not deployed', () => {
    const status: WalletStatus = { ...walletStatus(ready), deployed: false, account: undefined };
    expect(() => assertCanWithdraw(status, SIGNER)).toThrow('not deployed');
  });
});

describe('nextStep', () => {
  it.each([
    [walletStatus(notTriggered), 'trigger'],
    [walletStatus(waiting), 'wait'],
    [walletStatus(ready), 'withdraw'],
    [{ ...walletStatus(ready), deployed: false, account: undefined }, 'deploy'],
    [
      {
        ...walletStatus(ready),
        deployed: false,
        account: undefined,
        rebuild: { signer: SIGNER, address: WALLET, matches: true },
      },
      'deploy',
    ],
  ] as const)('suggests the right step', (status, step) => {
    expect(nextStep(status).step).toBe(step);
  });

  it('never suggests deploying an address the signer does not rebuild', () => {
    const status: WalletStatus = {
      ...walletStatus(ready),
      deployed: false,
      account: undefined,
      rebuild: { signer: SIGNER, address: OTHER, matches: false },
    };
    const next = nextStep(status);
    expect(next.step).toBe('mismatch');
    expect(next.message).toContain(SIGNER);
    expect(next.message).toContain(OTHER);
  });
});
