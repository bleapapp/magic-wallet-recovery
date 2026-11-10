#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { KNOWN_CHAINS } from '../core/chains.js';
import { explainError } from '../core/errors.js';
import { rebuildOriginalDeployment } from '../core/initCode.js';
import { runDeploy } from './commands/deploy.js';
import { runInspect } from './commands/inspect.js';
import { runCancel, runTrigger } from './commands/slowWithdrawal.js';
import { runWithdraw } from './commands/withdraw.js';
import { parseAddress, UsageError } from './context.js';
import { assertNoKeyInArguments, KEY_ENV_VAR } from './key.js';
import { print, red } from './output.js';

const HELP = `magic-wallet-recovery: check your Bleap Magic Wallet and move your funds yourself.

Your Magic Wallet is non-custodial: you can always move your funds yourself, with your own key.

Use the Bleap app on every EVM network it officially supports. This tool is for funds on networks
the app doesn't support, and for emergencies: starting a slow withdrawal on a network the app
supports automatically suspends your Bleap account. If funds are missing or not credited in the
app, contact Bleap support instead.

Stay safe: only trust the official Bleap app, the official repository of this tool,
github.com/bleapapp/magic-wallet-recovery, and its web page,
bleapapp.github.io/magic-wallet-recovery. Nobody from Bleap will ever ask you for your private key
or recovery phrase.
This tool never asks for your recovery phrase: it signs with your private key, on this computer.

Usage: magic-wallet-recovery <command> [options]

Commands:
  inspect    Show the state of your wallet on a network (read-only, no key needed)
  deploy     Deploy your wallet on a network where it does not exist yet
  trigger    Start a slow withdrawal (the waiting period begins)
  cancel     Cancel a slow withdrawal
  withdraw   Move an asset out of your wallet once the waiting period is over
  address    Print the Magic Wallet address of a signer (--signer <address>)
  chains     List the networks with built-in public endpoints

Run "magic-wallet-recovery <command> --help" for the options of a command.

Signer key (deploy, trigger, cancel, withdraw):
  The key is read from the file given with --key-file, or from the ${KEY_ENV_VAR}
  environment variable, or typed at a hidden prompt (the simplest). It is never accepted as a
  command-line argument, it is only used on this computer, and it is never sent anywhere.
  Don't type "export ${KEY_ENV_VAR}=<key>": your shell history would keep it. Use
  "read -rs ${KEY_ENV_VAR} && export ${KEY_ENV_VAR}" instead.

Every transaction is simulated and summarized before you approve it.
Provided as is, without warranty of any kind (MIT license).
`;

const ADDRESS_HELP = `Usage: magic-wallet-recovery address --signer <address>

Prints the Magic Wallet address that belongs to a signer account. Pure computation: no key and no
network needed.

  --signer <address>    Your signer account (the account of the key exported from the app)
`;

const CHAINS_HELP = `Usage: magic-wallet-recovery chains

Lists the networks with built-in public endpoints. Any other EVM network works too, with --rpc.
`;

const HELP_OPTION = { help: { type: 'boolean', short: 'h' } } as const;

const COMMANDS: Record<string, (args: string[]) => Promise<void>> = {
  inspect: runInspect,
  deploy: runDeploy,
  trigger: runTrigger,
  cancel: runCancel,
  withdraw: runWithdraw,
  address: async (args) => {
    const options = { ...HELP_OPTION, signer: { type: 'string' } } as const;
    const { values } = parseArgs({ args, options, strict: true });
    if (values.help) {
      print(ADDRESS_HELP);
      return;
    }
    const signer = parseAddress(values.signer, 'signer');
    print(rebuildOriginalDeployment(signer).address);
  },
  chains: async (args) => {
    const { values } = parseArgs({ args, options: HELP_OPTION, strict: true });
    if (values.help) {
      print(CHAINS_HELP);
      return;
    }
    for (const chain of KNOWN_CHAINS) {
      const note = chain.testnet
        ? ' (testnet)'
        : chain.bleapApp
          ? ' (Bleap app network: use the app)'
          : '';
      print(`${String(chain.id).padStart(9)}  ${chain.name}${note}`);
    }
    print(
      '\nThe Bleap app may support networks that are not marked here: use the app on every network\nit officially supports (the app shows which ones).',
    );
  },
};

async function main(argv: string[]): Promise<number> {
  const [command, ...args] = argv;
  try {
    // Every argument, the command included, is checked before anything is printed, so a key typed
    // in the wrong place is never echoed back.
    assertNoKeyInArguments(argv);
    if (!command || command === '--help' || command === '-h' || command === 'help') {
      print(HELP);
      return command ? 0 : 2;
    }
    const run = COMMANDS[command];
    if (!run) {
      print(red(`Unknown command "${command}".`));
      print(HELP);
      return 2;
    }
    await run(args);
    return 0;
  } catch (error) {
    if (error instanceof UsageError || isParseArgsError(error)) {
      print(red(`Error: ${(error as Error).message}`));
      print(`Run "magic-wallet-recovery ${command} --help" for usage.`);
      return 2;
    }
    print(red(`Error: ${explainError(error)}`));
    return 1;
  }
}

function isParseArgsError(error: unknown): boolean {
  const code = (error as { code?: unknown } | undefined)?.code;
  return typeof code === 'string' && code.startsWith('ERR_PARSE_ARGS');
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    print(red(`Error: ${explainError(error)}`));
    process.exitCode = 1;
  },
);
