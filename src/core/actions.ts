import {
  type Address,
  encodeFunctionData,
  getAddress,
  type Hex,
  hexToBigInt,
  isAddressEqual,
  type PublicClient,
  size,
  zeroAddress,
} from 'viem';
import { erc20Abi, erc721Abi, erc1155Abi } from './abis.js';
import { getChainInfo } from './chains.js';
import { MODULE_ADDRESSES } from './constants.js';
import { hasCode } from './dependencies.js';
import { RecoveryError, rethrowNetworkError, unlessNetworkError } from './errors.js';
import { formatAmount, type SummaryItem } from './format.js';
import { sanitizeLabel } from './text.js';
import { findKnownToken } from './tokens.js';
import type { WalletCall } from './userOp.js';

/** What to move out of the wallet. Each withdrawal operation performs exactly one of these. */
export type WithdrawAction =
  | { kind: 'native'; to: Address; amount: bigint }
  | { kind: 'erc20'; token: Address; to: Address; amount: bigint }
  | { kind: 'erc721'; token: Address; to: Address; tokenId: bigint }
  | { kind: 'erc1155'; token: Address; to: Address; tokenId: bigint; amount: bigint }
  | { kind: 'call'; target: Address; value: bigint; data: Hex };

/** The single call the wallet makes for an action. */
export function actionToCall(wallet: Address, action: WithdrawAction): WalletCall {
  switch (action.kind) {
    case 'native':
      return { target: action.to, value: action.amount, data: '0x' };
    case 'erc20':
      return {
        target: action.token,
        value: 0n,
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: 'transfer',
          args: [action.to, action.amount],
        }),
      };
    case 'erc721':
      return {
        target: action.token,
        value: 0n,
        data: encodeFunctionData({
          abi: erc721Abi,
          functionName: 'safeTransferFrom',
          args: [wallet, action.to, action.tokenId],
        }),
      };
    case 'erc1155':
      return {
        target: action.token,
        value: 0n,
        data: encodeFunctionData({
          abi: erc1155Abi,
          functionName: 'safeTransferFrom',
          args: [wallet, action.to, action.tokenId, action.amount, '0x'],
        }),
      };
    case 'call':
      return { target: action.target, value: action.value, data: action.data };
  }
}

export interface ActionDescription {
  title: string;
  summary: SummaryItem[];
  warnings: string[];
}

interface DescribeContext {
  chainId: number;
  wallet: Address;
  /** The wallet's signer: the default and expected destination. */
  signer: Address;
}

/**
 * Checks an action against the wallet's balances and the safety rules, and describes it for the
 * person approving it. Throws if the action can't or shouldn't be performed.
 */
export async function describeAction(
  client: PublicClient,
  context: DescribeContext,
  action: WithdrawAction,
): Promise<ActionDescription> {
  const { wallet, signer } = context;
  const chain = getChainInfo(context.chainId);
  const network = `${chain.name} (chain ID ${chain.id})`;
  const warnings: string[] = [];

  const target =
    action.kind === 'call' ? action.target : action.kind === 'native' ? action.to : action.token;
  if (isAddressEqual(target, wallet)) {
    throw new RecoveryError('A slow withdrawal cannot make the wallet call itself.', {
      hint: 'This protects the wallet configuration. Choose another destination or contract.',
    });
  }
  // The module keeps the wallet's signer under the caller's address: a call from the wallet could
  // remove it, after which no operation of the wallet would ever be valid again.
  if (Object.values(MODULE_ADDRESSES).some((module) => isAddressEqual(target, module))) {
    throw new RecoveryError('A slow withdrawal cannot make the wallet call its Cosigning Module.', {
      hint: 'Such a call could remove your signer and lock the wallet for good. Choose another destination or contract.',
    });
  }

  if (action.kind !== 'call') {
    assertNotTokenContract(action);
    await checkDestination(client, action.to, { wallet, signer, warnings });
  }

  switch (action.kind) {
    case 'native': {
      requirePositive(action.amount);
      const balance = await client.getBalance({ address: wallet });
      if (action.amount > balance) {
        throw new RecoveryError(
          `The wallet holds ${formatAmount(balance, 18, chain.nativeSymbol)}, less than the amount requested.`,
        );
      }
      const amount = formatAmount(action.amount, 18, chain.nativeSymbol);
      return {
        title: `Send ${amount}`,
        summary: [
          { label: 'Network', value: network },
          { label: 'From (your Magic Wallet)', value: wallet },
          { label: 'Asset', value: `${chain.nativeSymbol} (native token)` },
          { label: 'Amount', value: amount },
          { label: 'To', value: action.to },
        ],
        warnings,
      };
    }
    case 'erc20': {
      requirePositive(action.amount);
      const token = await readErc20(client, action.token, wallet);
      // A listed token shows its registry label: two tokens of a network can share a symbol.
      const symbol = findKnownToken(context.chainId, token.address)?.symbol ?? token.symbol;
      if (action.amount > token.balance) {
        throw new RecoveryError(
          `The wallet holds ${formatAmount(token.balance, token.decimals, symbol)}, less than the amount requested.`,
        );
      }
      await assertTransferAccepted(client, wallet, action);
      const amount = formatAmount(action.amount, token.decimals, symbol);
      return {
        title: `Send ${amount}`,
        summary: [
          { label: 'Network', value: network },
          { label: 'From (your Magic Wallet)', value: wallet },
          { label: 'Asset', value: `${symbol} (token contract ${action.token})` },
          { label: 'Amount', value: amount },
          { label: 'To', value: action.to },
        ],
        warnings,
      };
    }
    case 'erc721': {
      const owner = await client
        .readContract({
          address: action.token,
          abi: erc721Abi,
          functionName: 'ownerOf',
          args: [action.tokenId],
        })
        .catch(unlessNetworkError(undefined));
      if (!owner || !isAddressEqual(owner, wallet)) {
        throw new RecoveryError(
          `The wallet does not own token #${action.tokenId} of ${action.token}.`,
        );
      }
      return {
        title: `Send NFT #${action.tokenId}`,
        summary: [
          { label: 'Network', value: network },
          { label: 'From (your Magic Wallet)', value: wallet },
          { label: 'Asset', value: `NFT #${action.tokenId} (contract ${action.token})` },
          { label: 'To', value: action.to },
        ],
        warnings,
      };
    }
    case 'erc1155': {
      requirePositive(action.amount);
      const balance = await client
        .readContract({
          address: action.token,
          abi: erc1155Abi,
          functionName: 'balanceOf',
          args: [wallet, action.tokenId],
        })
        .catch(unlessNetworkError(0n));
      if (action.amount > balance) {
        throw new RecoveryError(
          `The wallet holds ${balance} of token #${action.tokenId}, less than requested.`,
        );
      }
      return {
        title: `Send ${action.amount} × token #${action.tokenId}`,
        summary: [
          { label: 'Network', value: network },
          { label: 'From (your Magic Wallet)', value: wallet },
          { label: 'Asset', value: `Token #${action.tokenId} (contract ${action.token})` },
          { label: 'Amount', value: action.amount.toString() },
          { label: 'To', value: action.to },
        ],
        warnings,
      };
    }
    case 'call': {
      // Odd-length hex would be padded with a 0 digit when encoded, shifting everything after the
      // missing digit: refuse it rather than sign something other than what was typed.
      if (action.data.length % 2 !== 0) {
        throw new RecoveryError(
          'The call data has an odd number of hexadecimal digits: part of it is missing. Copy it again.',
        );
      }
      warnings.push(
        'This is a custom call. Only continue if you know exactly what it does: it is executed by your wallet and cannot be reversed.',
      );
      return {
        title: 'Custom call from your wallet',
        summary: [
          { label: 'Network', value: network },
          { label: 'From (your Magic Wallet)', value: wallet },
          { label: 'Contract called', value: action.target },
          { label: 'Value sent', value: formatAmount(action.value, 18, chain.nativeSymbol) },
          {
            label: 'Call data',
            // In full: it is what the wallet executes, so every byte must be checkable.
            value: action.data === '0x' ? 'none' : `${action.data} (${size(action.data)} bytes)`,
          },
        ],
        warnings,
      };
    }
  }
}

async function checkDestination(
  client: PublicClient,
  destination: Address,
  context: { wallet: Address; signer: Address; warnings: string[] },
): Promise<void> {
  if (isAddressEqual(destination, zeroAddress)) {
    throw new RecoveryError('The destination is the zero address. Funds sent there are lost.');
  }
  if (isAddressEqual(destination, context.wallet)) {
    throw new RecoveryError('The destination is the wallet itself. Choose another address.');
  }
  if (!isAddressEqual(destination, context.signer)) {
    context.warnings.push(
      `The destination is not your signer account (${context.signer}). Double-check it: transfers cannot be reversed.`,
    );
  }
  if (await hasCode(client, destination)) {
    context.warnings.push(
      'The destination is a smart contract on this network. Make sure it can receive this asset here.',
    );
  }
}

/**
 * Some tokens return `false` instead of reverting when they refuse a transfer. The wallet ignores
 * the return value of its call, so such a withdrawal would be reported as successful while nothing
 * moves. The transfer is therefore run from the wallet first, and refused if it returns `false`.
 */
async function assertTransferAccepted(
  client: PublicClient,
  wallet: Address,
  action: Extract<WithdrawAction, { kind: 'erc20' }>,
): Promise<void> {
  const call = actionToCall(wallet, action);
  // A revert is ignored here: the simulation of the withdrawal reports it, with its reason.
  const result = await client
    .call({ account: wallet, to: call.target, data: call.data })
    .catch(unlessNetworkError(undefined));
  // `false` is one word of zeros. Other answers pass: `true`, or nothing at all, as USDT on
  // Ethereum does.
  const data = result?.data;
  if (data && size(data) === 32 && hexToBigInt(data) === 0n) {
    throw new RecoveryError(
      'The token refuses this transfer: it answered "false", so nothing would move.',
      { hint: 'The token may be paused, or may block this wallet or the destination.' },
    );
  }
}

function requirePositive(amount: bigint): void {
  if (amount <= 0n) throw new RecoveryError('The amount must be greater than zero.');
}

/** Rejects a destination equal to the token contract: tokens sent there are usually lost. */
export function assertNotTokenContract(action: WithdrawAction): void {
  if (action.kind === 'native' || action.kind === 'call') return;
  if (isAddressEqual(action.to, action.token)) {
    throw new RecoveryError(
      'The destination is the token contract itself. Tokens sent there are usually lost.',
    );
  }
}

export interface Erc20Info {
  address: Address;
  symbol: string;
  decimals: number;
  balance: bigint;
}

export async function readErc20(
  client: PublicClient,
  token: Address,
  owner: Address,
): Promise<Erc20Info> {
  const address = getAddress(token);
  try {
    const [balance, decimals, symbol] = await Promise.all([
      client.readContract({ address, abi: erc20Abi, functionName: 'balanceOf', args: [owner] }),
      client.readContract({ address, abi: erc20Abi, functionName: 'decimals' }),
      client
        .readContract({ address, abi: erc20Abi, functionName: 'symbol' })
        .then((value) => sanitizeLabel(value))
        .catch(() => 'tokens'),
    ]);
    return { address, symbol, decimals, balance };
  } catch (error) {
    rethrowNetworkError(error);
    throw new RecoveryError(`${address} does not look like an ERC-20 token on this network.`, {
      cause: error,
    });
  }
}
