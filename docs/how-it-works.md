# How it works

This page describes what the tools do on-chain. All addresses are in the [reference](reference.md).

## The wallet

A Magic Wallet is a [ZeroDev Kernel v3.1](https://github.com/zerodevapp/kernel) smart account
(ERC-4337 / ERC-7579) used through EntryPoint v0.7. Each wallet is an ERC-1967 proxy deployed by
the Kernel v3.1 factory with CREATE2.

Its root (sudo) validator is a Kernel **permission** whose signer contract is the Bleap
**Cosigning Module**, with no policies and no hook. The module stores the owner's address (the
signer account) for the wallet and accepts two kinds of signatures:

- 130 bytes: the owner's signature followed by Bleap's co-signature, used by the app;
- 65 bytes: the owner's signature alone, accepted only for a **slow withdrawal**.

## The address

The wallet address only depends on its init data:

```
permissionId = bytes4(keccak256(abi.encode(bytes[] [
                 abi.encode(bytes[] []),                         // no policies
                 0x0000,                                         // permission flag
                 abi.encode(bytes(cosigningModule ‖ signerData)) // signer
               ])))
rootValidator = 0x02 ‖ permissionId ‖ 16 zero bytes             // bytes21
validatorData = abi.encode(bytes[] [0x0000 ‖ cosigningModule ‖ signerData])
initData      = Kernel.initialize(rootValidator, address(0), validatorData, 0x, [])
address       = CREATE2(KernelFactory, keccak256(initData ‖ bytes32(0)), ERC-1967 proxy of Kernel v3.1)
```

Every Magic Wallet is created with Cosigning Module V1 as its root signer contract, where
`signerData` is the signer address (20 bytes). So the original setup, and therefore the address, is
rebuilt from the signer address alone. The tools compute the address offline, then check it with
`KernelFactory.getAddress` on the network itself, before sending anything.

On the networks the Bleap app supports, wallets later move their root permission to Cosigning
Module V2 (where `signerData` is the ABI-encoded address). That change is made on each of those
networks; elsewhere, the wallet keeps its original setup. The tools read the module version from
the wallet on each network and never assume it.

## Slow withdrawal

**Start (trigger).** The signer account calls `triggerSlowWithdraw(id, wallet)` on the wallet's
Cosigning Module, where `id` is the root permission ID left-aligned in a `bytes32`. Cancelling is
`unTriggerSlowWithdraw(id, wallet)`. Both are plain transactions from the signer account.

**Waiting period.**

- V1 stores the start time and accepts the withdrawal once `now - start > timelock`, where
  `timelock` is the module's current setting (24 hours by default).
- V2 stores the deadline (`readyAt = start + timelock`, 72 hours by default) when the withdrawal is
  started. It returns it to the EntryPoint as `validAfter`, and the EntryPoint accepts the
  operation from that time on.

**Withdrawal.** Once the waiting period is over, each withdrawal is one ERC-4337 UserOperation:

| Field                                  | Value                                                                        |
|----------------------------------------|------------------------------------------------------------------------------|
| `sender`                               | the wallet                                                                   |
| `nonce`                                | `EntryPoint.getNonce(wallet, 0)`: key 0 selects the root validator           |
| `callData`                             | `Kernel.execute(0x00…00, target ‖ value ‖ data)`: one call (CALLTYPE_SINGLE) |
| `initCode`, `paymasterAndData`         | empty                                                                        |
| `maxFeePerGas`, `maxPriorityFeePerGas` | 0                                                                            |
| `signature`                            | `0xff ‖ ownerSignature`                                                      |

`ownerSignature` is the signer's 65-byte EIP-191 (`personal_sign`) signature over the
UserOperation hash, which is why MetaMask can produce it. The leading `0xff` is the separator Kernel
expects in front of the signer's signature for a permission without policies.

The module only accepts a single call whose target is not the wallet itself. That alone doesn't
protect the wallet: a call from the wallet to the module could remove the wallet's signer, after
which no operation of the wallet is ever valid again. The tools also refuse calls to both versions
of the Cosigning Module, so a slow withdrawal made with them can move assets out but can't change
the wallet's configuration.

**Submission.** The signer account calls `EntryPoint.handleOps([userOp], signerAccount)` itself:
no bundler or paymaster is involved. With both fee fields at 0, the EntryPoint requires no prefund,
so neither the wallet nor its EntryPoint deposit needs any native token. The signer account pays
the gas of the `handleOps` transaction. The tool then reads the `UserOperationEvent` to confirm
that the wallet's call succeeded.

## Deploying on another network

To deploy the wallet where it doesn't exist yet, the tools:

1. rebuild the original init data from the signer address, or read it from the transaction that
   first deployed the wallet on another network, and check that it gives the wallet address;
2. check which contracts the wallet needs on the network: EntryPoint v0.7, Kernel v3.1, the Kernel
   factory and the Cosigning Module;
3. recreate any missing one through the deterministic deployment proxy, with its original creation
   code. The code is read from a public creation transaction (see the
   [reference](reference.md)) and accepted only if its hash matches, which also fixes its address;
4. call `KernelFactory.createAccount(initData, 0)`, after checking with `KernelFactory.getAddress`
   that the network places the wallet at its usual address, and finally check the deployed wallet's
   signer.

The meta-factory used by the app is not needed: calling the Kernel factory directly gives the same
address.

## Safety checks

- Every transaction is simulated (gas estimation against the latest state) before approval, and
  the withdrawal is simulated twice: the wallet's call before signing, and the full `handleOps`
  after signing.
- Every approval is preceded by a summary: network and chain ID, asset, amount, destination, fee.
- The signature is checked against the registered signer before submission. Once signed, a
  withdrawal can be submitted by anyone who has it (`handleOps` accepts any sender), so the tools
  treat signing as the approval that counts, and say so when a signed withdrawal is not submitted.
- An ERC-20 transfer is first run from the wallet and refused if the token answers `false`: the
  wallet ignores return values, so such a transfer would otherwise look successful. After the
  withdrawal, the receipt must also contain the token's `Transfer` event to the destination, so a
  token that refuses the transfer at that point is not reported as done.
- A transaction cancelled or replaced in the wallet (rather than only repriced) is reported as not
  executed.
- The tools refuse calls to the wallet itself or to its Cosigning Module, the zero address and the
  token contract as destinations, amounts above the balance, and wallets with a configuration they
  don't know (other modules, policies or hooks on the root permission).
- The chain ID of the endpoint is checked before anything is sent.
