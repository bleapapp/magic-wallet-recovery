# Magic Wallet Recovery

Your Bleap Magic Wallet is non-custodial: you can always move your funds yourself. This repository
contains open-source tools and guides to do exactly that, on your own, with your own key, and
without depending on Bleap's services.

> [!IMPORTANT]
> **Use the Bleap app on every EVM network it officially supports** (the app shows which ones).
> These tools are made for two situations only:
>
> - your funds are on a network the Bleap app doesn't support;
> - an emergency on a network the Bleap app supports, when you can't move your funds with the app.
>   Starting a slow withdrawal there **automatically suspends your Bleap account**, and cancelling
>   it does not lift the suspension.
>
> If funds are missing or not credited in the app on a network it supports, contact Bleap support
> (in the app or through [bleap.finance](https://bleap.finance)) instead of using these tools.

> [!WARNING]
> **Stay safe.**
>
> - Only trust the official Bleap app, the official repository of these tools,
>   [github.com/bleapapp/magic-wallet-recovery](https://github.com/bleapapp/magic-wallet-recovery),
>   and the web page published from it,
>   [bleapapp.github.io/magic-wallet-recovery](https://bleapapp.github.io/magic-wallet-recovery/).
>   Any other website that offers these tools is not official.
> - The Bleap app may ask for your recovery phrase, for example when you sign in again. Only enter
>   it there. Nobody from Bleap will ever ask you for your recovery phrase or your private key, by
>   email, chat, phone or any other way.
> - These tools never ask for your recovery phrase: they sign with your private key (see
>   [Before you start](docs/guides/before-you-start.md)). Nobody can help you "faster" by taking
>   your key.

## What you can do

| Your situation                                                                   | Guide                                                                            |
|----------------------------------------------------------------------------------|----------------------------------------------------------------------------------|
| You sent funds to your wallet address on a network the Bleap app doesn't support | [Recover funds sent on another network](docs/guides/funds-on-another-network.md) |
| You want to check the state of your wallet on any network (read-only)            | [Check your wallet](docs/guides/check-your-wallet.md)                            |
| You started a slow withdrawal by mistake                                         | [Cancel a slow withdrawal](docs/guides/cancel-a-slow-withdrawal.md)              |

### Emergency only: on a network the Bleap app supports

Use these guides on a network the app supports only in an emergency, when you can't move your
funds with the Bleap app. **Your Bleap account is then automatically suspended.**

| Your situation                                                    | Guide                                                               |
|-------------------------------------------------------------------|---------------------------------------------------------------------|
| You can't use the Bleap app and need to move your funds yourself  | [Withdraw without the app](docs/guides/withdraw-without-the-app.md) |
| Your wallet holds tokens, NFTs or coins the app doesn't show      | [Move other assets](docs/guides/other-assets.md)                    |

On a network the app doesn't support, moving other assets is simply the last step of
[recovering funds sent on another network](docs/guides/funds-on-another-network.md).

Start with [Before you start](docs/guides/before-you-start.md): it explains how to get your key,
how it differs from your recovery phrase, and the difference between your wallet address and your
signer account. Questions? See the [FAQ](docs/faq.md).

## Two ways to use the tools

**The web page** is the easiest: open
[bleapapp.github.io/magic-wallet-recovery](https://bleapapp.github.io/magic-wallet-recovery/) in
the browser where MetaMask is installed. It has no backend and no analytics, and you sign
everything in MetaMask: your key never leaves your browser wallet. Each version is published from
this repository once a second maintainer approves it, and the page shows the commit it was built
from ([how releases work](docs/releasing.md)). You can also run the same page on your own computer
([step by step](docs/guides/before-you-start.md#run-the-tools-on-your-computer)).

**The command-line tool** does the same from a terminal, on your own computer. You need
[Node.js](https://nodejs.org) 22.12 or later:

```bash
git clone https://github.com/bleapapp/magic-wallet-recovery.git
cd magic-wallet-recovery
npm ci
npm run build
npm run cli -- inspect --chain 1 --wallet 0xYourMagicWalletAddress
```

Commands: `inspect`, `deploy`, `trigger`, `cancel` and `withdraw`. See the
[command-line reference](docs/cli.md).

## How it works, in short

- Your Magic Wallet is a smart account. Its address is the same on every EVM network.
- In the app, you approve each transaction and Bleap co-signs it. A **slow withdrawal** lets you act
  alone: you start it, wait for the waiting period (24 to 72 hours), and then move any asset out,
  as many times as you need.
- The tools build the withdrawal, you sign it with your key, and your signer account submits it
  directly to the network's EntryPoint contract. No bundler, paymaster or other service is
  involved, and you don't need an account anywhere. The withdrawal itself carries no fee, so your
  Magic Wallet doesn't need any gas: your signer account pays the normal network fee of each
  transaction.
- If your wallet doesn't exist yet on a network, the tools deploy it at its usual address from its
  original setup, after checking that this setup gives exactly your wallet address. Any contract
  the wallet needs that is missing there, such as Bleap's Cosigning Module, is recreated first, at
  its usual address.

The technical details are in [How it works](docs/how-it-works.md), with every contract address in
the [reference](docs/reference.md).

## Safety by design

- Every transaction is simulated before you approve it, and every approval is preceded by a
  plain-language summary: network, asset, amount and destination.
- The destination defaults to your own signer account.
- The tools refuse calls to the wallet itself or to its Cosigning Module, refuse obviously wrong
  destinations (the zero address, the token contract), and check the network's chain ID before
  sending anything.
- Before starting a slow withdrawal, the tools remind you that doing it on a network the Bleap app
  supports suspends your Bleap account. On the app's networks, they refuse to continue until you
  confirm that it is an emergency.
- The tools never ask for your recovery phrase, which is only for the Bleap app. They sign with your
  private key: the web page never sees it (your browser wallet holds it and signs), and the
  command-line tool reads it from a file, an environment variable or a hidden prompt, never as an
  argument, and never sends it anywhere.

## Development

```bash
npm ci
npm run lint        # Biome (format + lint)
npm run typecheck
npm test            # unit tests
npm run test:e2e    # end-to-end tests on a local anvil chain (needs Foundry)
npm run web:dev     # web page with live reload
npm run web:build   # static page in web/dist
npm run web         # build the page and serve it on localhost
```

See [CONTRIBUTING.md](CONTRIBUTING.md), [docs/testing.md](docs/testing.md) and
[docs/releasing.md](docs/releasing.md).

## License and disclaimer

[MIT](LICENSE). The tools are provided as is, without warranty of any kind. You are responsible for
the transactions you sign. Please report security issues as described in [SECURITY.md](SECURITY.md).
