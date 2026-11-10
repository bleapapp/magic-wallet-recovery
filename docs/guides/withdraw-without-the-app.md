# Withdraw without the app

> [!CAUTION]
> **Emergency only.** This guide is for when you can't move your funds with the Bleap app. On any
> EVM network the app officially supports, starting a slow withdrawal **automatically suspends your
> Bleap account**, and cancelling it does not lift the suspension. If funds are missing or not
> credited in the app, contact Bleap support instead (in the app or through
> [bleap.finance](https://bleap.finance)).

Your Magic Wallet is non-custodial: you can move your funds out without the Bleap app or any Bleap
service, with only your signer key. This works on every network where your wallet is deployed. For
funds on a network the app doesn't support, follow
[Recover funds sent on another network](funds-on-another-network.md) instead.

Read [Before you start](before-you-start.md) first: you need your signer key, your Magic Wallet
address, and a little of the network's native token in your signer account.

## How it works

1. **Start a slow withdrawal** on the network where your funds are. Nothing moves yet.
2. **Wait** for the waiting period: 72 hours on the networks the app supports. The tools show the
   exact time.
3. **Withdraw** each asset to the address of your choice (your signer account by default). You can
   make as many withdrawals as you need once the waiting period is over.

You can cancel a slow withdrawal at any time: see [Cancel a slow withdrawal](cancel-a-slow-withdrawal.md).

## With the web page

1. Open the web page,
   [bleapapp.github.io/magic-wallet-recovery](https://bleapapp.github.io/magic-wallet-recovery/)
   (or [run it on your computer](before-you-start.md#run-the-tools-on-your-computer)).
   Connect MetaMask with your signer account and select the network.
2. Paste your Magic Wallet address and click **Check wallet**.
3. Read the notice about your Bleap account. On a network the app supports, tick the box to
   confirm it is an emergency. Click **Start slow withdrawal**, review the summary and confirm in
   MetaMask.
4. When the waiting period is over, click **Check wallet** again, choose the asset and amount,
   click **Review withdrawal**, sign, then confirm the final transaction.

## With the command-line tool

```bash
npm run cli -- inspect  --chain <chain> --wallet <wallet>
npm run cli -- trigger  --chain <chain> --wallet <wallet> --emergency
# after the waiting period:
npm run cli -- withdraw --chain <chain> --wallet <wallet> --asset <token address> --amount <amount>
```

On a network the app supports, `trigger` refuses to run without `--emergency`, which confirms that
you accept the suspension of your Bleap account.

Run `npm run cli -- chains` to find the chain ID of your network.

## Good to know

- The slow withdrawal is part of your wallet's smart contracts. It only needs your key.
- Your signer account pays the network fee of each transaction. Your Magic Wallet needs no gas.
- Each withdrawal moves one asset. To empty the wallet, run one withdrawal per asset.
