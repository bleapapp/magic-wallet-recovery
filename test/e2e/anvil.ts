import { type ChildProcess, spawn } from 'node:child_process';
import { createServer } from 'node:net';

export interface Anvil {
  url: string;
  stop: () => Promise<void>;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function waitForRpc(url: string, child: ChildProcess, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`anvil exited with code ${child.exitCode}`);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
      });
      if (response.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('anvil did not start in time');
}

/** Starts a fresh local chain (no fork). Requires Foundry's `anvil` on the PATH. */
export async function startAnvil(chainId: number): Promise<Anvil> {
  const port = await freePort();
  const child = spawn(
    'anvil',
    ['--port', String(port), '--chain-id', String(chainId), '--silent'],
    {
      stdio: 'ignore',
    },
  );
  const failedToStart = new Promise<never>((_, reject) =>
    child.once('error', (error) =>
      reject(
        new Error(
          `Could not start anvil (install Foundry: https://getfoundry.sh): ${error.message}`,
        ),
      ),
    ),
  );
  const url = `http://127.0.0.1:${port}`;
  await Promise.race([waitForRpc(url, child), failedToStart]);
  return {
    url,
    stop: () =>
      new Promise((resolve) => {
        if (child.exitCode !== null) return resolve();
        child.once('exit', () => resolve());
        child.kill('SIGTERM');
      }),
  };
}
