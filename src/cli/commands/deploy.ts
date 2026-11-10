import { parseArgs } from 'node:util';
import {
  fetchCreationCode,
  hasCode,
  planDependencyDeployment,
  publicTransactionReader,
} from '../../core/dependencies.js';
import {
  assertDependenciesDeployable,
  type DeploymentSource,
  planWalletDeployment,
  planWalletDeploymentTx,
  verifyWalletDeployment,
} from '../../core/deploy.js';
import { RecoveryError } from '../../core/errors.js';
import {
  COMMON_OPTIONS,
  connect,
  localSigner,
  parseAddress,
  parseChainId,
  parseHex,
  SIGNER_OPTIONS,
  UsageError,
} from '../context.js';
import { executeTransaction } from '../flow.js';
import { assertNotSignerKey, loadSignerAccount } from '../key.js';
import { bold, green, info, print, printSummary, yellow } from '../output.js';
import { isInteractive } from '../prompt.js';

export const deployHelp = `Usage: magic-wallet-recovery deploy --chain <id> --wallet <address> [options]

Deploys your Magic Wallet on a network where it does not exist yet, at the same address as on your
other networks. The wallet's original setup is rebuilt from your signer and checked against the
wallet address before anything is sent. Contracts the wallet needs that are missing on the network
are recreated first (one transaction each). Your signer account pays the network fees.

  --chain <id>               Chain ID of the network to deploy on
  --wallet <address>         Your Magic Wallet address, as shown in the Bleap app
  --rpc <url>                Your own RPC endpoint (default: a public endpoint, when known)
  --key-file <path>          File containing your signer private key (see "Signer key" in --help)
  --deployment-tx <hash>     Advanced: take the wallet setup from the transaction that first
                             deployed it on another network, instead of rebuilding it
  --deployment-chain <id>    Chain ID of that transaction (required with --deployment-tx)
  --deployment-rpc <url>     RPC endpoint for that network
  --source-rpc <id>=<url>    RPC endpoint used to read public creation code on a network (repeatable)
  --yes                      Do not ask for confirmation (not recommended)
`;

const options = {
  ...COMMON_OPTIONS,
  ...SIGNER_OPTIONS,
  'deployment-tx': { type: 'string' },
  'deployment-chain': { type: 'string' },
  'deployment-rpc': { type: 'string' },
  'source-rpc': { type: 'string', multiple: true },
} as const;

export async function runDeploy(args: string[]): Promise<void> {
  const { values } = parseArgs({ args, options, strict: true });
  if (values.help) {
    print(deployHelp);
    return;
  }
  const chainId = parseChainId(values.chain);
  const wallet = parseAddress(values.wallet, 'wallet');
  const sourceRpcs = parseSourceRpcs(values['source-rpc'] ?? []);

  const network = await connect(chainId, values.rpc);
  const account = await loadSignerAccount({
    keyFile: values['key-file'],
    interactive: isInteractive(),
    log: info,
  });
  const signer = localSigner(network, account);

  let source: DeploymentSource = { kind: 'signer', signer: account.address };
  if (values['deployment-tx']) {
    const hash = parseHex(values['deployment-tx'], 'deployment-tx');
    assertNotSignerKey(hash, account, 'deployment-tx');
    const homeChainId = parseChainId(values['deployment-chain']);
    const home = await connect(homeChainId, values['deployment-rpc']);
    const tx = await home.client.getTransaction({ hash });
    source = { kind: 'transaction', input: tx.input };
  }

  const plan = await planWalletDeployment(network.client, {
    wallet,
    source,
    expectedSigner: account.address,
  });
  print(
    bold(`Deploy Magic Wallet ${plan.wallet} on ${network.chain.name} (chain ID ${plan.chainId})`),
  );
  printSummary([
    { label: 'Signer', value: `${plan.signer} (matches your key)` },
    { label: 'Address check', value: 'the original setup deploys to exactly this address' },
    ...plan.dependencies.map(({ dependency, deployed }) => ({
      label: dependency.name,
      value: deployed ? 'present' : yellow('missing: will be recreated'),
    })),
  ]);

  if (plan.alreadyDeployed) {
    print(green('\nThe wallet is already deployed on this network. Nothing to do.'));
    return;
  }
  assertDependenciesDeployable(plan);

  for (const dependency of plan.missing) {
    print(`\nReading the creation code of ${dependency.name} from a public network…`);
    const { code, source: codeSource } = await fetchCreationCode(
      dependency,
      publicTransactionReader(sourceRpcs),
    );
    await executeTransaction(
      network,
      signer,
      planDependencyDeployment(dependency, code, codeSource),
      values.yes,
    );
    if (!(await hasCode(network.client, dependency.address))) {
      throw new RecoveryError(`${dependency.name} has no code after its deployment.`);
    }
  }

  const walletTx = await planWalletDeploymentTx(network.client, plan);
  await executeTransaction(network, signer, walletTx, values.yes);
  await verifyWalletDeployment(network.client, plan);
  print(
    green(
      '\nYour Magic Wallet is deployed. Next: start the slow withdrawal with the trigger command.',
    ),
  );
}

function parseSourceRpcs(entries: readonly string[]): Record<number, string[]> {
  const result: Record<number, string[]> = {};
  for (const entry of entries) {
    const match = /^(\d+)=(https?:\/\/\S+)$/.exec(entry);
    if (!match?.[1] || !match[2])
      throw new UsageError(`--source-rpc: expected <chainId>=<url>, got "${entry}".`);
    const id = Number(match[1]);
    result[id] = [...(result[id] ?? []), match[2]];
  }
  return result;
}
