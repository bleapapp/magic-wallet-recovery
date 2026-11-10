# Move other assets

> [!CAUTION]
> **Emergency only on any EVM network the Bleap app officially supports.** Moving assets there
> yourself needs a slow withdrawal, which **automatically suspends your Bleap account**. If the app
> doesn't show some of your funds on one of these networks, contact Bleap support first (in the
> app or through [bleap.finance](https://bleap.finance)).

Your Magic Wallet can hold anything an EVM address can hold: tokens the app doesn't list (for
example from an airdrop), NFTs, or the native coin of any network. You can move all of them out
with a slow withdrawal.

The steps are the same as for any withdrawal, only the asset changes:

- on a network the app doesn't support, follow
  [Recover funds sent on another network](funds-on-another-network.md);
- on a network the app supports, in an emergency only, follow
  [Withdraw without the app](withdraw-without-the-app.md).

Read [Before you start](before-you-start.md) first.

## Tokens (ERC-20)

You need the token's contract address on that network (a block explorer shows it on your wallet's
page).

- **Web page:** in the withdrawal form, choose **Other ERC-20 token…** and paste the contract
  address. You can also use **Show balance** in the status section to check the balance first.
- **Command line:**

  ```bash
  npm run cli -- inspect  --chain <chain> --wallet <wallet> --token <token address>
  npm run cli -- withdraw --chain <chain> --wallet <wallet> --asset <token address> --amount max
  ```

## The native coin

- **Web page:** choose the network's native token (ETH, AVAX, POL, …) in the withdrawal form.
- **Command line:** `--asset native --amount <amount|max>`.

Because the withdrawal carries no fee, you can move the full native balance.

## NFTs (ERC-721 and ERC-1155)

With the command-line tool:

```bash
# ERC-721
npm run cli -- withdraw --chain <chain> --wallet <wallet> --nft <contract> --token-id <id>
# ERC-1155
npm run cli -- withdraw --chain <chain> --wallet <wallet> --erc1155 <contract> --token-id <id> --amount <n>
```

## Anything else: a custom call

For other cases (for example withdrawing from a protocol your wallet deposited into), the
command-line tool can make **any single call** from your wallet:

```bash
npm run cli -- withdraw --chain <chain> --wallet <wallet> \
  --call-target <contract> --call-data <0x-encoded call> [--call-value <amount in wei>]
```

Only use this if you know exactly what the call does: it is executed by your wallet and cannot be
reversed. The tool simulates it and shows a warning before you sign. Calls to the wallet itself and
to its Cosigning Module are refused: they could change your wallet's configuration or lock it for
good.
