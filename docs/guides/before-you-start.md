# Before you start

Every guide in this repository uses the same few things. This page explains each of them once.

## When to use these tools

These tools are made for two situations only:

- **Your funds are on a network the Bleap app doesn't support.** This is what the tools are for,
  and it doesn't affect your Bleap account.
- **An emergency on a network the Bleap app supports**, when you can't move your funds with the
  app. Starting a slow withdrawal there **automatically suspends your Bleap account**, and
  cancelling it does not lift the suspension.

In every other case, use the Bleap app, on any EVM network it officially supports (the app shows
which ones). If funds are missing or not credited in the app on one of them, contact Bleap support
(in the app or through [bleap.finance](https://bleap.finance)) instead of using these tools.

Checking your wallet is read-only and changes nothing, on any network.

## Your Magic Wallet address

This is the address that holds your funds. It is the address the Bleap app shows when you
**receive** funds on an EVM network. It is the same on every EVM
network: that is why funds sent to it on another network can usually be recovered (see
[Recover funds sent on another network](funds-on-another-network.md)).

Write it down: you will paste it into the tools.

## Your signer key

Your Magic Wallet is controlled by a key that only you hold: the **signer key**. To use the tools,
you export it from the Bleap app:

1. In the app, open **Settings → Account settings → Security → Export private key**.
2. Follow the steps. Among the keys shown, save the **MPC Wallet** private key: it is the key that
   signs for your Magic Wallet. (You don't need the Solana key for these tools.)
3. Store it somewhere safe and private. Anyone who has this key can move your funds.

> **Never share your key.** Nobody from Bleap will ever ask you for it. The web page never asks
> for it either: you sign in your own browser wallet.

## Your recovery phrase is not your key

The Bleap app may ask for your recovery phrase, for example when you sign in again: it lets the app
restore access to your wallet. It is not a private key, so these tools never ask for it. Only enter
it in the official Bleap app, and never share it.

What the tools need is the private key you export from the app (above):

- **The web page** never sees it. You import it into MetaMask once, and MetaMask signs each step.
  For a withdrawal, MetaMask only shows a 32-byte fingerprint (a long hexadecimal value), not what
  the withdrawal does: the page shows the same fingerprint next to the details of the withdrawal,
  so check that both match.
- **The command-line tool** reads it from a file, an environment variable or a hidden prompt (never
  as a command-line argument), signs on your computer, and never sends it anywhere.

## Your signer account

The signer key has its own address, different from your Magic Wallet address: the **signer
account**. It is the account that:

- signs every step,
- sends the transactions and pays their network fees,
- receives your funds by default when you withdraw.

You will see this address in MetaMask after importing your key (next section). If you paste it
where the tools ask for your Magic Wallet address, they tell you.

## Open the tools

- **The web page:** open
  [bleapapp.github.io/magic-wallet-recovery](https://bleapapp.github.io/magic-wallet-recovery/) in
  the browser where MetaMask is installed. This is its only official address: check it in the
  address bar. The page never asks for your private key or your recovery phrase. A website that
  asks for them, or that offers these tools at another address, is not official.
- **The command-line tool:** it runs on your own computer, see the next section.

## Run the tools on your computer

You don't need this to use the web page. It is for the command-line tool, or if you prefer to run
the web page yourself. Get the tools only from the official repository,
[github.com/bleapapp/magic-wallet-recovery](https://github.com/bleapapp/magic-wallet-recovery).

1. Install [Node.js](https://nodejs.org) 22.12 or later (the LTS version is fine).
2. Get the repository, either with git:

   ```bash
   git clone https://github.com/bleapapp/magic-wallet-recovery.git
   ```

   or from its GitHub page: **Code → Download ZIP**, then unzip it.
3. Open a terminal in the folder you got (`magic-wallet-recovery`, or `magic-wallet-recovery-main`
   from the ZIP) and install the tools:

   ```bash
   npm ci
   ```

Then start the one you want:

- **The web page:** run `npm run web`, then open the address it shows (usually
  http://localhost:4173) in the browser where MetaMask is installed. The page is only reachable
  from your computer. It runs until you press Ctrl+C in the terminal.
- **The command-line tool:** run `npm run build` once, then see the
  [command-line reference](../cli.md).

## MetaMask (for the web page)

The web page signs with [MetaMask](https://metamask.io), the browser wallet:

1. Install MetaMask in your browser, if needed.
2. In MetaMask, open the account menu, choose **Add account** (or **Add account or hardware
   wallet**) → **Import account**, and paste your signer key.
3. The new account is your signer account.

If you prefer a terminal, the [command-line tool](../cli.md) works without MetaMask.

### Keep your signer account safe

Once a slow withdrawal has reached the end of its waiting period, a single signature from your
signer key is enough to move funds out of your Magic Wallet. A signature doesn't expire: one made
today, even before any waiting period, can still be used when a later waiting period ends on that
network, until another withdrawal from the wallet is executed there. So:

- sign only on the official page. When MetaMask asks you to sign, check that its request comes from
  `bleapapp.github.io` (or `localhost`, if you run the page on your computer). The fingerprint the
  page asks you to compare only means something there: a copy of the page at another address can
  show any details next to the fingerprint of a withdrawal to its own address;
- use this MetaMask account only with this page, and don't connect it to other websites;
- never sign a message you don't recognize with it, especially a long hexadecimal value;
- when you are done, remove the imported account from MetaMask (your key stays in the Bleap app),
  and if you keep using the wallet on that network, cancel the slow withdrawal (see
  [Cancel a slow withdrawal](cancel-a-slow-withdrawal.md)).

## A little gas in your signer account

Each step is a normal transaction sent by your signer account, so it needs a small amount of the
network's native token (for example ETH on Ethereum, or AVAX on Avalanche) **on the network where
your funds are**. You can send it there from an exchange or another wallet.

Your Magic Wallet itself does not need any gas: the withdrawal carries no fee of its own.

## The waiting period

Moving funds without Bleap's co-signature is done with a **slow withdrawal**: you start it, wait,
and then move your assets. The waiting period is set by your wallet's Cosigning Module:

- **24 hours** for a wallet deployed with its original setup, which is the case when you deploy it
  yourself on a new network;
- **72 hours** on the networks the Bleap app supports.

The tools always show the exact time at which you can withdraw. Once it is reached, you can make as
many withdrawals as you need, one asset at a time.
