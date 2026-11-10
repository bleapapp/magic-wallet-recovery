# Testing

## Unit tests

```bash
npm test
```

They need no network. They cover the address derivation (checked against values read from the
Kernel factory), the dependency registry (each salt and hash give the contract's address), the
UserOperation encoding and signature handling, the withdrawal safety rules, the detection of
transactions cancelled or replaced in the wallet, error messages, amount parsing, command-line
input and key handling.

## End-to-end tests

```bash
npm run test:e2e
```

They start a fresh local [anvil](https://getfoundry.sh) chain that has none of the wallet's
contracts, which is exactly the situation of a network the app doesn't support. They then:

1. recreate EntryPoint v0.7, Kernel v3.1, its factory and Cosigning Module V1 from their public
   creation transactions on Ethereum mainnet (so the code under test is the production code);
2. deploy a V1 wallet from its rebuilt original setup;
3. start a slow withdrawal, check that the wallet rejects a withdrawal during the waiting period,
   move time forward, and withdraw the native token, an ERC-20 token and a custom call;
4. cancel the slow withdrawal;
5. do the same with a V2 wallet (recreating Cosigning Module V2), including the EntryPoint's refusal
   during the 72-hour waiting period;
6. switch a signer account to MetaMask's smart account contract (EIP-7702, its code copied from
   Ethereum mainnet), then deploy its wallet, start a slow withdrawal and withdraw to that signer
   account.

They need Foundry's `anvil` on the `PATH` and network access to an Ethereum mainnet endpoint:
`E2E_REFERENCE_RPC_URL` overrides the default public one.

## Manual run on a testnet

Before a release, run the full flow once on a real testnet with a fresh test key (never a real
key):

1. Create a test account (for example in MetaMask) and fund it with test ETH on **Sepolia**
   (11155111). Sepolia has EntryPoint v0.7 and Kernel v3.1 but no Cosigning Module, so the run also
   recreates the module, like on a network the app doesn't support.
2. Get the test wallet address with `npm run cli -- address --signer <test account>`, and send a
   little test ETH to it.
3. `npm run cli -- deploy --chain 11155111 --wallet <wallet> --key-file <test key file>`
4. `npm run cli -- trigger --chain 11155111 --wallet <wallet> --key-file <test key file>`
5. After 24 hours: `npm run cli -- withdraw --chain 11155111 --wallet <wallet> --asset native --amount max --key-file <test key file>`
6. Repeat steps 1 and 3 to 5 on the web page (`npm run web`) with MetaMask, on another fresh
   account.
7. Repeat step 6 once with smart accounts turned on in MetaMask, so that MetaMask switches the
   account to its smart account (EIP-7702) and sends the steps through it.

Record the transaction hashes in the release notes (see [Releasing](releasing.md)).
