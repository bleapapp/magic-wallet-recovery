# Command-line reference

> [!IMPORTANT]
> Use the Bleap app on every EVM network it officially supports. Starting a slow withdrawal on one
> of them automatically suspends your Bleap account, so on the networks that `chains` marks as
> Bleap app networks, `trigger` refuses to run unless you add `--emergency`.

## Install

Requires [Node.js](https://nodejs.org) 22.12 or later and git.

```bash
git clone https://github.com/bleapapp/magic-wallet-recovery.git
cd magic-wallet-recovery
npm ci
npm run build
```

Then run commands with `npm run cli -- <command> [options]`. Help: `npm run cli -- --help` and
`npm run cli -- <command> --help`.

## Your signer key

Commands that send transactions (`deploy`, `trigger`, `cancel`, `withdraw`) need your signer key.
The tool looks for it, in this order:

1. `--key-file <path>`: a file containing only the key (restrict it: `chmod 600 <path>`);
2. the `SIGNER_PRIVATE_KEY` environment variable;
3. a hidden prompt: the simplest, nothing to set up.

The key is never accepted as a command-line argument (arguments end up in your shell history), and
it is only used to sign on your computer. The tool never asks for your recovery phrase, which is
only for the Bleap app.

If you use the environment variable, don't type `export SIGNER_PRIVATE_KEY=<key>`: your shell
history would keep the key. Set it without echoing it instead:

```bash
read -rs SIGNER_PRIVATE_KEY && export SIGNER_PRIVATE_KEY
```

Every transaction is simulated and summarized, and the tool asks for confirmation before signing
and before sending. `--yes` skips the confirmations; only use it once you know what the command
does.

For a withdrawal, signing is the decision that counts. Once signed, the withdrawal can be submitted
by anyone who has the signature, not only by the tool: the final check shares it with your RPC
endpoint. If it is then not submitted (you decline, or a later step fails), it stays valid until
you cancel the slow withdrawal (and becomes valid again at the end of a later waiting period, until
another withdrawal from the wallet is executed).

## Options common to every command

| Option               | Meaning                                                                              |
|----------------------|--------------------------------------------------------------------------------------|
| `--chain <id>`       | Chain ID of the network (required). `npm run cli -- chains` lists the built-in ones. |
| `--wallet <address>` | Your Magic Wallet address (required).                                                |
| `--rpc <url>`        | Your own RPC endpoint. Required for networks without a built-in endpoint.            |

## inspect

Shows the state of a wallet on a network. Read-only: no key needed.

```bash
npm run cli -- inspect --chain 1 --wallet <wallet>
npm run cli -- inspect --chain 1 --wallet <wallet> --token <token address> --json
```

`--token <address>` adds a token balance (repeatable), `--signer <address>` checks the wallet
against a signer account, `--json` prints JSON.

## deploy

Deploys the wallet where it doesn't exist yet, at its usual address, recreating missing contracts
first.

```bash
npm run cli -- deploy --chain 1 --wallet <wallet>
```

| Option                    | Meaning                                                                                                                                 |
|---------------------------|-----------------------------------------------------------------------------------------------------------------------------------------|
| `--deployment-tx <hash>`  | Advanced: read the wallet setup from the transaction that first deployed it on another network, instead of rebuilding it from your key. |
| `--deployment-chain <id>` | Chain ID of that transaction (required with `--deployment-tx`).                                                                         |
| `--deployment-rpc <url>`  | RPC endpoint for that network.                                                                                                          |
| `--source-rpc <id>=<url>` | RPC endpoint used to read public creation code on a network (repeatable).                                                               |

## trigger

Starts a slow withdrawal: the waiting period begins. Nothing leaves the wallet.

```bash
npm run cli -- trigger --chain 1 --wallet <wallet>
```

| Option        | Meaning                                                                                                                                       |
|---------------|-----------------------------------------------------------------------------------------------------------------------------------------------|
| `--emergency` | Required on a network the Bleap app supports. It confirms that this is an emergency and that you accept the suspension of your Bleap account. |

## cancel

Cancels the slow withdrawal on that network.

```bash
npm run cli -- cancel --chain 1 --wallet <wallet>
```

## withdraw

Moves one asset out once the waiting period is over. You review the withdrawal, sign it, review the
final transaction, then it is sent. The destination defaults to your signer account (`--to` to
change it).

```bash
# Native token (ETH on Ethereum)
npm run cli -- withdraw --chain 1 --wallet <wallet> --asset native --amount max
# To another address of yours instead of your signer account
npm run cli -- withdraw --chain 1 --wallet <wallet> --asset native --amount max --to <destination address>
# ERC-20 token
npm run cli -- withdraw --chain 1 --wallet <wallet> --asset <token address> --amount 100.5
# ERC-721 NFT
npm run cli -- withdraw --chain 1 --wallet <wallet> --nft <contract> --token-id 42
# ERC-1155
npm run cli -- withdraw --chain 1 --wallet <wallet> --erc1155 <contract> --token-id 7 --amount 3
# Any single call (advanced)
npm run cli -- withdraw --chain 1 --wallet <wallet> --call-target <contract> --call-data 0x... --call-value 0
```

Amounts are in token units with a dot for decimals (`100.5`), or `max` for the whole balance.

`--to <address>` works with every asset option except `--call-target`, where the call data alone
decides where anything goes. Check the destination carefully: the summary shows it before you sign,
and funds sent to a wrong address can't be recovered. The tool refuses obviously wrong
destinations, such as the zero address or the token contract itself.

For a custom call, the summary shows the call data in full: check it before you sign.

## address

Prints the Magic Wallet address that belongs to a signer account. Pure computation: no key and no
network needed.

```bash
npm run cli -- address --signer <signer account>
```

## chains

Lists the networks with built-in public endpoints, and marks the ones this version knows the Bleap
app supports. The app may support more: use it on every network it officially supports (the app
shows which ones).

```bash
npm run cli -- chains
```

## Exit codes

`0` success, `1` the operation failed or was cancelled, `2` invalid command-line input.
