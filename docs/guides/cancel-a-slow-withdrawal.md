# Cancel a slow withdrawal

If you started a slow withdrawal by mistake, or changed your mind, you can cancel it. Cancelling
works during the waiting period and after it. Nothing leaves your wallet.

You need your signer key and a little of the network's native token in your signer account (see
[Before you start](before-you-start.md)).

## With the web page

1. Open the web page,
   [bleapapp.github.io/magic-wallet-recovery](https://bleapapp.github.io/magic-wallet-recovery/)
   (or [run it on your computer](before-you-start.md#run-the-tools-on-your-computer)).
   Connect MetaMask with your signer account and select the network.
2. Paste your Magic Wallet address and click **Check wallet**.
3. Click **Cancel slow withdrawal**, review the summary and confirm in MetaMask.

## With the command-line tool

```bash
npm run cli -- cancel --chain <chain> --wallet <wallet>
```

## Good to know

- A slow withdrawal applies to one network only. Cancel it on the network where you started it.
- If you start a new slow withdrawal later, the full waiting period starts again.
- On a network the Bleap app supports, cancelling stops the withdrawal but does not lift the
  suspension of your Bleap account. Contact Bleap support for your account (in the app or through
  [bleap.finance](https://bleap.finance)).
