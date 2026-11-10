import { readFileSync, statSync } from 'node:fs';
import type { Hex } from 'viem';
import { type PrivateKeyAccount, privateKeyToAccount } from 'viem/accounts';
import { RecoveryError } from '../core/errors.js';
import { promptHidden } from './prompt.js';

/** Environment variable the signer key can be read from. */
export const KEY_ENV_VAR = 'SIGNER_PRIVATE_KEY';

const KEY_PATTERN = /^(0x)?[0-9a-fA-F]{64}$/;

/**
 * Options whose value is a transaction hash: 32 bytes of hex, like a key. (Call data of exactly 32
 * bytes is never a valid call, so `--call-data` is checked like any other argument.)
 */
const TX_HASH_OPTIONS = new Set(['--deployment-tx']);

/**
 * Refuses to run when something that looks like a private key was passed as an argument:
 * arguments end up in shell history and process listings.
 */
export function assertNoKeyInArguments(args: readonly string[]): void {
  for (let index = 0; index < args.length; index++) {
    const arg = args[index] ?? '';
    const [option, inlineValue] = arg.split('=', 2);
    if (inlineValue !== undefined && option && TX_HASH_OPTIONS.has(option)) continue;
    const previous = args[index - 1];
    if (previous && TX_HASH_OPTIONS.has(previous)) continue;
    if (KEY_PATTERN.test((inlineValue ?? arg).trim())) {
      throw new RecoveryError(
        'A private key seems to have been passed as a command-line argument.',
        {
          hint: `Keys are never accepted as arguments, because they end up in your shell history. Use --key-file <path>, the ${KEY_ENV_VAR} environment variable, or type it at the hidden prompt. If this key was real, consider clearing your shell history.`,
        },
      );
    }
  }
}

/**
 * Refuses a transaction hash that is in fact the signer's private key, pasted in the wrong place,
 * before it is sent to an RPC endpoint as a hash to look up.
 */
export function assertNotSignerKey(value: Hex, account: PrivateKeyAccount, option: string): void {
  if (!KEY_PATTERN.test(value)) return;
  let derived: string;
  try {
    derived = privateKeyToAccount(value).address;
  } catch {
    return; // Not a usable key, so not the signer's.
  }
  if (derived === account.address) {
    throw new RecoveryError(
      `--${option} contains your signer private key, not a transaction hash. Nothing was sent.`,
      { hint: 'If this key was real, consider clearing your shell history.' },
    );
  }
}

/** Validates and normalizes a private key typed or read from a file. */
export function parsePrivateKey(input: string): Hex {
  const value = input.trim();
  if (value.split(/\s+/).length >= 12) {
    throw new RecoveryError('This looks like a recovery phrase, not a private key.', {
      hint: 'This tool never needs your recovery phrase, which is only for the Bleap app. Use the private key exported from the app (Settings → Account settings → Security → Export private key).',
    });
  }
  if (!KEY_PATTERN.test(value)) {
    throw new RecoveryError(
      'The private key must be 64 hexadecimal characters (optionally starting with 0x).',
    );
  }
  return (value.startsWith('0x') ? value : `0x${value}`) as Hex;
}

/**
 * Loads the signer key from, in order: `--key-file`, the environment variable, a hidden prompt.
 * The key stays in this process: it is only used to sign locally.
 */
export async function loadSignerAccount(options: {
  keyFile?: string;
  interactive: boolean;
  log: (message: string) => void;
}): Promise<PrivateKeyAccount> {
  let raw: string;
  if (options.keyFile) {
    raw = readKeyFile(options.keyFile, options.log);
  } else if (process.env[KEY_ENV_VAR]) {
    raw = process.env[KEY_ENV_VAR] ?? '';
  } else if (options.interactive) {
    raw = await promptHidden('Signer private key (input hidden): ');
  } else {
    throw new RecoveryError('No signer key found.', {
      hint: `Pass --key-file <path>, set ${KEY_ENV_VAR}, or run the command in an interactive terminal.`,
    });
  }
  return privateKeyToAccount(parsePrivateKey(raw));
}

function readKeyFile(path: string, log: (message: string) => void): string {
  try {
    if (process.platform !== 'win32' && (statSync(path).mode & 0o077) !== 0) {
      log(
        `Note: ${path} can be read by other users of this computer. Consider: chmod 600 "${path}"`,
      );
    }
    return readFileSync(path, 'utf8');
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    throw new RecoveryError(`Could not read the key file ${path}.`, {
      hint: typeof code === 'string' ? (FILE_ERRORS[code] ?? `System error ${code}.`) : undefined,
      cause: error,
    });
  }
}

/** What a file system error code means for the person running the tool. */
const FILE_ERRORS: Record<string, string> = {
  ENOENT: 'There is no file at this path. Check the folder and the file name.',
  EACCES: 'Your user account is not allowed to read this file.',
  EPERM: 'Your user account is not allowed to read this file.',
  EISDIR: 'This path is a folder, not a file.',
};
