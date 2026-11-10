# Security policy

## Reporting a vulnerability

Please report security issues privately, through GitHub's
[private vulnerability reporting](https://github.com/bleapapp/magic-wallet-recovery/security/advisories/new)
(the "Report a vulnerability" button in the Security tab of this repository). Please don't report
a security problem publicly.

Please include what you found, how to reproduce it, and its impact as you understand it. We will
acknowledge your report, keep you informed, and credit you if you wish once a fix is released.

When researching, please only use your own wallets and test networks, and do not attempt to
access other people's funds or data.

## Scope

- The code in this repository: the core library, the command-line tool and the web page.
- The published web page,
  [bleapapp.github.io/magic-wallet-recovery](https://bleapapp.github.io/magic-wallet-recovery/),
  and the workflow that publishes it.

The smart contracts the tools interact with are deployed and public. Issues with them can be
reported through the same channel.

## Staying safe as a user

- Only trust the official Bleap app, the official repository of these tools,
  [github.com/bleapapp/magic-wallet-recovery](https://github.com/bleapapp/magic-wallet-recovery),
  and the web page published from it,
  [bleapapp.github.io/magic-wallet-recovery](https://bleapapp.github.io/magic-wallet-recovery/).
  Any other website that offers these tools is not official.
- The Bleap app may ask for your recovery phrase, for example when you sign in again: only enter it
  there. Nobody from Bleap will ever ask you for your recovery phrase or your private key. Anyone
  who asks for them elsewhere is trying to steal your funds.
- The tools never need your recovery phrase, and the web page never needs your private key: you
  sign in your own browser wallet. A page that asks for either is fake.
- Use the Bleap app on every EVM network it officially supports: starting a slow withdrawal on one
  of them suspends your Bleap account.
