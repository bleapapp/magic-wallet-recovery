import { formatEther } from 'viem';
import { type ChainInfo, explorerTxUrl } from '../core/chains.js';
import { formatAmount, formatDuration, formatTimestamp, type SummaryItem } from '../core/format.js';
import { getSupportedAccount, nextStep, type WalletStatus } from '../core/inspect.js';
import type { PreparedTransaction } from '../core/transactions.js';

const useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const paint = (code: string) => (text: string) =>
  useColor ? `\u001b[${code}m${text}\u001b[0m` : text;
export const bold = paint('1');
export const dim = paint('2');
export const green = paint('32');
export const yellow = paint('33');
export const red = paint('31');

export function print(message = ''): void {
  process.stdout.write(`${message}\n`);
}

/** Messages that are not the command's main output go to stderr, so `--json` stays clean. */
export function info(message: string): void {
  process.stderr.write(`${message}\n`);
}

export function printSummary(items: readonly SummaryItem[]): void {
  const width = Math.max(...items.map((item) => item.label.length));
  for (const item of items) print(`  ${dim(item.label.padEnd(width))}  ${item.value}`);
}

export function printWarnings(warnings: readonly string[] | undefined): void {
  for (const warning of warnings ?? []) print(yellow(`  ! ${warning}`));
}

export function printPreparedTransaction(tx: PreparedTransaction, chain: ChainInfo): void {
  print();
  print(bold(tx.title));
  printSummary([
    ...tx.summary,
    { label: 'Sent from', value: `${tx.from} (your signer account pays the network fee)` },
    {
      label: 'Estimated network fee',
      value:
        tx.estimatedFee === undefined
          ? 'unknown'
          : `about ${formatEther(tx.estimatedFee)} ${chain.nativeSymbol} (gas limit ${tx.gas})`,
    },
  ]);
  printWarnings(tx.warnings);
}

/** Printed as soon as a transaction is sent, so it can be followed even if confirmation is slow. */
export function printTransactionSent(hash: string, chain: ChainInfo): void {
  const url = explorerTxUrl(chain.id, hash);
  print(`  Sent: ${hash}`);
  if (url) print(dim(`    ${url}`));
}

export function printTransactionConfirmed(): void {
  print(green('  ✓ Confirmed'));
}

/** Prints the result of `inspect`. */
export function printStatus(status: WalletStatus, chain: ChainInfo): void {
  print(bold(`Magic Wallet ${status.wallet}`));
  print(dim(`${chain.name} (chain ID ${status.chainId}), block ${status.blockNumber}`));
  print();
  const rows: SummaryItem[] = [{ label: 'Deployed', value: status.deployed ? 'yes' : 'no' }];

  if (status.deployed && status.account) {
    const account = status.account;
    rows.push({ label: 'Implementation', value: account.implementation ?? 'unknown' });
    if (account.rootValidationId)
      rows.push({ label: 'Root validator', value: account.rootValidationId });
    if (account.module) {
      rows.push({
        label: 'Cosigning Module',
        value: `${account.module.version ?? 'unknown'} (${account.module.address})`,
      });
    }
    if (account.signer) rows.push({ label: 'Signer', value: account.signer });
    if (status.signerMatches !== undefined) {
      rows.push({ label: 'Matches your signer', value: status.signerMatches ? 'yes' : red('no') });
    }
    if (account.timelockSeconds !== undefined) {
      rows.push({ label: 'Waiting period', value: formatDuration(account.timelockSeconds) });
    }
    const state = account.slowWithdrawal;
    if (state) {
      rows.push({
        label: 'Slow withdrawal',
        value:
          state.status === 'not-triggered'
            ? 'not started'
            : state.status === 'waiting'
              ? `started ${formatTimestamp(state.triggeredAt)}, ${formatDuration(state.remainingSeconds)} left (until ${formatTimestamp(state.withdrawableAt)})`
              : `ready (since ${formatTimestamp(state.withdrawableAt)})`,
      });
    }
  }
  if (status.rebuild) {
    rows.push({
      label: 'Rebuilt from signer',
      value: status.rebuild.matches
        ? `yes (${status.rebuild.signer})`
        : red(`no (${status.rebuild.signer})`),
    });
  }
  printSummary(rows);

  print();
  print(bold('Balances'));
  const balances: SummaryItem[] = [
    { label: chain.nativeSymbol, value: formatAmount(status.nativeBalance, 18) },
    ...status.tokens.map((token) => ({
      label: token.symbol ?? token.token,
      value:
        token.balance === undefined || token.decimals === undefined
          ? dim(token.error ?? 'unavailable')
          : `${formatAmount(token.balance, token.decimals)} ${dim(token.token)}`,
    })),
  ];
  printSummary(balances);

  if (!status.deployed && status.dependencies) {
    print();
    print(bold('Contracts needed to deploy the wallet here'));
    printSummary(
      status.dependencies.map(({ dependency, deployed }) => ({
        label: dependency.name,
        value: deployed ? 'present' : yellow('missing (can be recreated by the deploy command)'),
      })),
    );
  }

  const account = status.deployed ? getSupportedAccount(status) : undefined;
  if (account && 'problems' in account) {
    print();
    for (const problem of account.problems) print(red(`  ✗ ${problem}`));
  }
  if (status.account?.warnings.length) {
    print();
    printWarnings(status.account.warnings);
  }
  print();
  print(`${bold('Next step:')} ${nextStep(status).message}`);
}

/** JSON-safe copy of a value (bigints become strings). */
export function toJson(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, item) => (typeof item === 'bigint' ? item.toString() : item),
    2,
  );
}
