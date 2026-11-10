# Check your wallet

You can check the state of a Magic Wallet on any EVM network, without any key and without sending
anything. It's the first thing to do before any recovery step, and it is also useful to answer
support questions. Checking is read-only: it is safe on every network, including the ones the
Bleap app supports.

## With the command-line tool

```bash
npm run cli -- inspect --chain <chain> --wallet <wallet>
```

Add `--token <address>` for other tokens (repeatable), `--signer <address>` to check the wallet
against a signer account, and `--json` for machine-readable output. Common tokens (stablecoins such as
USDC, USDT, EURC or EURe, wrapped ETH and BTC) are shown automatically on the main networks.

## With the web page

Open the web page,
[bleapapp.github.io/magic-wallet-recovery](https://bleapapp.github.io/magic-wallet-recovery/) (or
[run it on your computer](before-you-start.md#run-the-tools-on-your-computer)), connect MetaMask,
select the network (the page starts on Ethereum), paste the wallet address and click **Check
wallet**.

## What the result means

| Field            | Meaning                                                                                                                                                                  |
|------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Deployed         | Whether your wallet exists on this network. If not, funds at the address stay there until you deploy the wallet with the `deploy` step.                                  |
| Implementation   | The smart account code your wallet uses (Kernel v3.1).                                                                                                                   |
| Cosigning Module | V1 or V2. It defines the waiting period of the slow withdrawal.                                                                                                          |
| Signer           | The signer account registered for your wallet: the only account that can recover the funds.                                                                              |
| Waiting period   | How long a slow withdrawal waits on this network (24 or 72 hours).                                                                                                       |
| Slow withdrawal  | Not started, waiting (with the time left and when it ends), or ready.                                                                                                    |
| Balances         | Native coin and tokens held by the wallet on this network.                                                                                                               |
| Contracts needed | For a wallet that is not deployed: which contracts its deployment needs, and whether they are already on this network. Missing ones can be recreated by the deploy step. |
| Next step        | What to do next on this network.                                                                                                                                         |

The state is per network: a wallet can be deployed on one network and not on another, and a slow
withdrawal started on one network doesn't apply to the others.
