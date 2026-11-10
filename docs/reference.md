# Reference

## Contract addresses

These contracts are deployed with CREATE2, so each has the same address on every EVM network
where it exists.

| Contract                       | Address                                      |
|--------------------------------|----------------------------------------------|
| Bleap Cosigning Module V1      | `0x61576D9ef23514bfe6F080E22CcFFf473cf11A1A` |
| Bleap Cosigning Module V2      | `0x5B424D5133fAE2cE64ce739cec0796343E957131` |
| EntryPoint v0.7                | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` |
| Kernel v3.1 implementation     | `0xBAC849bB641841b44E965fB01A4Bf5F074f84b4D` |
| Kernel v3.1 factory            | `0xaac5D4240AF87249B3f71BC8E4A2cae074A3E419` |
| Meta-factory (FactoryStaker)   | `0xd703aaE79538628d27099B8c4f621bE4CCd142d5` |
| Deterministic deployment proxy | `0x4e59b44847b379578588920cA78FbF26c0B4956C` |

The meta-factory is listed for completeness: the tools deploy wallets through the Kernel factory
directly, which gives the same address.

## Creation code sources

When a contract is missing on a network, the tools recreate it through the deterministic
deployment proxy with its original creation code. The code is not stored in this repository: it is
read from a public transaction that deployed the contract, and accepted only if its keccak-256 hash
matches the expected one, which also fixes the address. The networks are tried in order: the next
one is only read if the previous one fails.

| Contract                   | Creation transactions read from (chain IDs), in this order      |
|----------------------------|-----------------------------------------------------------------|
| EntryPoint v0.7            | Ethereum (1), Arbitrum One (42161)                              |
| Kernel v3.1 implementation | Ethereum (1), Arbitrum One (42161)                              |
| Kernel v3.1 factory        | Ethereum (1), Arbitrum One (42161)                              |
| Cosigning Module V1        | Ethereum (1), Arbitrum One (42161), BNB Chain (56)              |
| Cosigning Module V2        | Ethereum (1), Arbitrum One (42161), Base (8453), BNB Chain (56) |

The salts, hashes and transaction hashes are in
[`src/core/dependencies.ts`](../src/core/dependencies.ts), where a unit test checks that each salt
and hash give the contract's address. On Ethereum, the Kernel contracts were deployed through a
smart account, so their creation code sits inside the transaction's input; the tools locate it there
and verify its hash.

## Networks

The tools work on any EVM network: pass its chain ID and, if it has no built-in endpoint, an RPC URL
(`--rpc`). These networks have built-in public endpoints:

| Network           | Chain ID |
|-------------------|----------|
| Ethereum          | 1        |
| OP Mainnet        | 10       |
| Cronos            | 25       |
| BNB Chain         | 56       |
| Gnosis            | 100      |
| Polygon           | 137      |
| HyperEVM          | 999      |
| Robinhood Chain   | 4663     |
| Base              | 8453     |
| Arbitrum One      | 42161    |
| Celo              | 42220    |
| Avalanche C-Chain | 43114    |
| Linea             | 59144    |
| Blast             | 81457    |

Testnets: BNB Chain Testnet (97), Robinhood Chain Testnet (46630), Base Sepolia (84532),
Arbitrum Sepolia (421614), Sepolia (11155111), OP Sepolia (11155420).

Some networks limit the gas of a single transaction. Recreating the larger contracts (EntryPoint,
Kernel) may not be possible on those; the tools show the estimate before you approve.

## Messages you may see

| Message                                                                | Meaning                                                                                                            |
|------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------|
| The waiting period is not over yet (AA22)                              | Wait until the time shown, then try again.                                                                         |
| The wallet did not accept the signature (AA24)                         | The waiting period is not over (V1), the slow withdrawal was cancelled, or the account is not the wallet's signer. |
| The operation is out of date (AA25)                                    | Another operation ran in the meantime: prepare the withdrawal again.                                               |
| The account you are using is not the signer registered for this wallet | Use the key exported from the account that owns the wallet.                                                        |
| A slow withdrawal is already in progress                               | It was already started on this network: wait, or cancel it.                                                        |
| This network computes contract addresses differently                   | The wallet can't be at its usual address on this network, so nothing is sent.                                      |
