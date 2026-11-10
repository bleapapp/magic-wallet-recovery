# Recover funds sent on another network

You sent funds to your Magic Wallet address, but on an EVM network the Bleap app doesn't support.
This guide shows how to recover them yourself.

This guide is only for networks the app doesn't support (the app shows which ones it supports).
If funds are missing or not credited in the app on a network it supports, contact Bleap support
instead: using these tools there suspends your Bleap account.

## Your funds are at your address

Your Magic Wallet has the **same address on every EVM network**: the address is calculated from your
wallet's own setup, with the same formula everywhere. So the funds did arrive at your address.

What is missing is the wallet itself: on that network it has not been deployed yet, so there is no
contract at your address to move the funds. Only your wallet can ever be deployed at that address,
and only your key controls it. The funds stay exactly where they are until you move them.

A few networks are not fully EVM-equivalent and calculate addresses differently. There, your wallet
cannot be deployed at your address, and the tools stop before sending anything (see
[If something doesn't work](#if-something-doesnt-work)).

## Overview

1. **Deploy your wallet** on that network, at your address. If a contract your wallet relies on,
   such as Bleap's Cosigning Module, is missing there, it is recreated first, from its public
   original.
2. **Start a slow withdrawal.** Nothing moves yet: the waiting period begins.
3. **Withdraw** each asset once the waiting period is over (24 hours on a newly deployed wallet).

Every step is a transaction you send from your signer account, so you need a little of the
network's native token there. Read [Before you start](before-you-start.md) first.

## With the web page

1. Import your signer key into MetaMask, and send a little of the network's native token to that
   account on the network where your funds are.
2. Open the web page,
   [bleapapp.github.io/magic-wallet-recovery](https://bleapapp.github.io/magic-wallet-recovery/)
   (or [run it on your computer](before-you-start.md#run-the-tools-on-your-computer)), and click
   **Connect MetaMask**.
3. Select the network where your funds are. The page starts on Ethereum, so MetaMask may first ask
   you to switch to it.
4. Paste your Magic Wallet address and click **Check wallet**. The page shows your balances and
   says that the wallet is not deployed yet. If the address is not the Magic Wallet of the account
   connected in MetaMask, the page says so and shows that account's Magic Wallet address instead:
   check the address in the Bleap app and the key you imported.
5. Click **Prepare deployment**. The page rebuilds your wallet's original setup from your signer
   account and checks that it gives exactly your wallet address. Then click **Prepare next
   transaction** and confirm each transaction in MetaMask: first any missing contract, then your
   wallet.
6. Click **Start slow withdrawal** and confirm.
7. Come back when the waiting period is over, and click **Check wallet** again.
8. Choose the asset, the amount and the destination (your signer account by default), click
   **Review withdrawal**, sign in MetaMask, then confirm the final transaction. Repeat for each
   asset.

## With the command-line tool

Replace the placeholders: `<chain>` is the network's chain ID (1 for Ethereum) and `<wallet>` your
Magic Wallet address. The tool asks for your signer key at a hidden prompt (or see the
[CLI reference](../cli.md) for other options).

```bash
npm run cli -- inspect  --chain <chain> --wallet <wallet>
npm run cli -- deploy   --chain <chain> --wallet <wallet>
npm run cli -- trigger  --chain <chain> --wallet <wallet>
# after the waiting period:
npm run cli -- withdraw --chain <chain> --wallet <wallet> --asset <token address> --amount max
npm run cli -- withdraw --chain <chain> --wallet <wallet> --asset native --amount max
```

If your wallet is already deployed on that network, skip `deploy`. If the slow withdrawal is
already started, skip `trigger`: `inspect` tells you where you are.

## What this can and cannot do

| It can                                               | It cannot                                             |
|------------------------------------------------------|-------------------------------------------------------|
| Recover funds sent to your address on an EVM network | Recover funds sent on a non-EVM network (e.g. Solana) |
| Deploy your wallet at exactly your address           | Deploy it at any other address                        |
| Be done entirely by you, with your own key           | Work without your signer key and a little gas         |
| Send the funds to any address you choose             | Skip the waiting period                               |

The tools only deploy your wallet with its original setup and move assets out. They refuse any call
to the wallet itself or to its Cosigning Module, which could change how your wallet is configured.

## If something doesn't work

- **"Cannot be rebuilt from the signer"**: check that the address is your Magic Wallet address from
  the app, and that the key is the one exported from the same account.
- **A network that computes addresses differently** (some networks are not fully EVM-equivalent):
  the tools detect it and stop before sending anything, because the wallet could not be at your
  address there.
- See the [FAQ](../faq.md) for more.
