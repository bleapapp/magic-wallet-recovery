# Frequently asked questions

**Should I use these tools on the networks the Bleap app supports?**
Only in an emergency. On every EVM network the Bleap app officially supports (the app shows which
ones), use the app: starting a slow withdrawal there automatically suspends your Bleap account, and
cancelling it does not lift the suspension. The tools remind you of this before starting one.

**Funds are missing or not credited in the app.**
If they were sent on a network the app supports, contact Bleap support (in the app or through
bleap.finance) instead of using these tools. If they were sent on another network, see
[Recover funds sent on another network](guides/funds-on-another-network.md).

**Will Bleap ask for my recovery phrase?**
The Bleap app may ask for it, for example when you sign in again: only enter it there. Nobody from
Bleap will ever ask you for your recovery phrase or your private key, by email, chat, phone or any
other way. These tools never ask for your recovery phrase: they sign with the private key you
export from the app (see [Before you start](guides/before-you-start.md)).

**Are my funds safe while I can't see them in the app?**
They are at your Magic Wallet address. Only your wallet can ever be deployed at that address, and
only your signer key controls it. Nothing moves until you move it. (On the few networks that
calculate addresses differently, the wallet cannot be deployed at your address: see
[Recover funds sent on another network](guides/funds-on-another-network.md#if-something-doesnt-work).)

**Do I need Bleap's permission or help?**
No. Every step is a public on-chain action that only needs your signer key. The tools use public
network endpoints (or your own) and nothing else.

**Is it safe to use my key with these tools?**
The web page never sees your key: MetaMask holds it and signs. The command-line tool uses the key
only on your computer, to sign locally, and never sends it anywhere. Both are open source, so you
or someone you trust can check the code. Only trust the official Bleap app, the official
repository of these tools, [github.com/bleapapp/magic-wallet-recovery](https://github.com/bleapapp/magic-wallet-recovery),
and the web page published from it.

**Is there a website where I can use the tools?**
Yes, one:
[bleapapp.github.io/magic-wallet-recovery](https://bleapapp.github.io/magic-wallet-recovery/).
Any other website that offers these tools, or that asks for your key or recovery phrase, is not
official. If you prefer, you can also run the page on your own computer (see
[Before you start](guides/before-you-start.md#run-the-tools-on-your-computer)).

**How do I know the web page runs the code of the repository?**
Each version of the page is built and published by GitHub from a version of this repository, once
a second maintainer approves it. The page shows its version and the commit it was built from at
the bottom. Each [release](https://github.com/bleapapp/magic-wallet-recovery/releases) also
includes the same files, with a signed record of how they were built, so anyone can check them
(see [Releasing](releasing.md#checking-the-published-page)).

**Why is there a waiting period?**
It is part of your wallet's security design. Normal transactions need both your approval and
Bleap's co-signature. The slow withdrawal lets you act alone, after a waiting period during which
you can still cancel it.

**How long is it?**
24 hours on a wallet deployed with its original setup (for example when you deploy it yourself on
a new network), 72 hours on the networks the Bleap app supports. The tools show the exact time.

**Why do I need to pay gas from my signer account, and not from the wallet?**
Your signer account sends every transaction, so it pays the normal network fee. The withdrawal
itself carries no fee, which is why your Magic Wallet doesn't need any native token.

**Do I need a bundler, or an account with some service?**
No. A withdrawal is an ERC-4337 operation, which is usually sent through a bundler. Here, your
signer account submits it directly to the network's EntryPoint contract, in an ordinary
transaction. No bundler, paymaster or account with any service is needed: only a little of the
network's native token in your signer account.

**Can I withdraw everything at once?**
Each withdrawal moves one asset. Once the waiting period is over you can make as many withdrawals
as you need, one after the other, without waiting again.

**Which networks do the tools work on?**
Any EVM network where contracts are deployed at the usual addresses (standard CREATE2) and where
the common deterministic deployment proxy exists, which is the case for most of them. The tools
check this before sending anything and stop if your wallet can't be at its usual address. Non-EVM
networks such as Solana are not covered. On the networks the Bleap app supports, use the app
(see the first question).

**The tools say a contract is missing on my network. What does it mean?**
Your wallet relies on a few public contracts (listed in the [reference](reference.md)), among them
Bleap's Cosigning Module, without which the wallet can't work. If one is missing on a network, the deploy step recreates it at its usual address by replaying its public
original, before deploying your wallet. Anyone can do this, and it gives exactly the same contract.

**The public endpoint is slow or refuses my requests.**
Use your own: pass `--rpc <url>` to the command-line tool, or change the network's RPC endpoint in
MetaMask's network settings.

**Can I use a hardware wallet?**
The signer key is the key exported from the Bleap app, so it lives in MetaMask (web page) or in a
file or prompt (command line), not on a hardware wallet.

**I started a slow withdrawal by mistake.**
You can cancel it: see [Cancel a slow withdrawal](guides/cancel-a-slow-withdrawal.md).

**What about my Bleap account?**
Using these tools on a network the app doesn't support does not change your account. Starting a
slow withdrawal on a network the app supports suspends it. For any question about your account,
contact Bleap support through the app or bleap.finance.

**I don't have my signer key.**
These tools need it: without it, nobody can move the funds. That is what non-custodial means.
