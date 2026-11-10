import { defineConfig } from 'vitest/config';

/**
 * End-to-end tests on a local anvil chain (Foundry must be installed). They read public creation
 * transactions from Ethereum mainnet: set E2E_REFERENCE_RPC_URL to use your own endpoint.
 */
export default defineConfig({
  test: {
    include: ['test/e2e/**/*.e2e.test.ts'],
    environment: 'node',
    testTimeout: 300_000,
    hookTimeout: 300_000,
    fileParallelism: false,
  },
});
