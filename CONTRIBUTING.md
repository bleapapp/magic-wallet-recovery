# Contributing

These tools are maintained by Bleap. Anyone can read, audit and fork the code, but only Bleap's
maintainers can open pull requests, and issues are turned off:

- To report a security problem, see [SECURITY.md](SECURITY.md).
- For help with your wallet or your funds, contact Bleap support, in the app or through
  [bleap.finance](https://bleap.finance). Never share your key or recovery phrase with anyone who
  offers help elsewhere.

The rest of this page is for maintainers.

## Setup

```bash
npm ci
npm run build
npm test
```

The end-to-end tests need [Foundry](https://getfoundry.sh) (`anvil`) and network access to read
public transactions on Ethereum mainnet. See [docs/testing.md](docs/testing.md).

## Layout

```
src/core/   Library shared by the CLI and the web page (no Node.js-only APIs)
src/cli/    Command-line tool
web/        Static web page (Vite, no framework), published on GitHub Pages
docs/       Guides and reference
test/unit/  Unit tests (no network)
test/e2e/   End-to-end tests on anvil
```

## Principles

- **Safety first.** Every transaction is simulated and summarized before it is approved. Keys never
  leave the user's machine and are never accepted as command-line arguments.
- **Few dependencies.** The only runtime dependency is [viem](https://viem.sh). Discuss any new
  dependency with the other maintainers before adding it.
- **No hidden network calls.** The tools only talk to the RPC endpoints of the networks involved.
  The web page has no backend and no analytics.
- **Plain language.** Guides and messages are written for people who are not developers.
- **Networks of the Bleap app.** When the app supports a new EVM network, set `bleapApp: true` for
  it in `src/core/chains.ts`, so the tools ask for an emergency confirmation there. Guides and
  messages never list these networks by name.

## Content guidelines

This repository is public. Contributions must not include API keys, private RPC endpoints, internal
service details, or personal data such as real wallet addresses of users. Examples and tests use
placeholders only.

## Pull requests

CI runs the linter, the type checker, the unit and end-to-end tests, and a secret scan. Run
`npm run format` before committing. Only people with write access can open pull requests, and
every pull request needs the approval of a maintainer other than its author.

Workflows may only use GitHub's own actions and `foundry-rs/foundry-toolchain`, pinned to a full
commit SHA (with the version as a comment).

## Releases

Maintainers publish the web page and the GitHub releases as described in
[docs/releasing.md](docs/releasing.md).
