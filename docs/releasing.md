# Releasing

The web page is published on GitHub Pages, at
[bleapapp.github.io/magic-wallet-recovery](https://bleapapp.github.io/magic-wallet-recovery/), by
the [Release workflow](../.github/workflows/release.yml). Every release takes two maintainers: one
pushes the version tag, and another approves the deployment. The settings below enforce this, but a
repository admin or organization owner can change those settings: keep these roles to as few
accounts as possible, each protected with a passkey or a security key, and give the other
maintainers the **Maintain** role.

The workflow only runs once the repository is public: a Pages site would be public even while the
repository is private.

## Repository settings

A repository admin sets these up once, before the first release:

1. **Pages** (Settings → Pages): source **GitHub Actions**, and no custom domain. A
   `github.io` address has no DNS records or domain renewal to protect.
2. **`github-pages` environment** (Settings → Environments, created by the previous step):
   - **Required reviewers**: the maintainers, with **Prevent self-review** on.
   - **Deployment branches and tags**: selected branches and tags, with the single tag rule `v*`.
     Remove any branch rule: the page is only deployed from version tags.
   - **Allow administrators to bypass configured protection rules**: off. Otherwise the admin who
     pushes the tag can deploy without the other maintainer's approval. This must print `false`:

     ```bash
     gh api repos/bleapapp/magic-wallet-recovery/environments/github-pages --jq '.can_admins_bypass'
     ```

   - No environment secrets.
3. **Branch ruleset for `main`** (Settings → Rules → Rulesets), with no bypass: require a pull
   request with at least one approval, dismissal of approvals on new commits, approval of the most
   recent push, and the three CI checks from GitHub Actions ("Lint, types, unit tests, build",
   "End-to-end tests (anvil)", "Secret scan (gitleaks, full history)"); block force pushes and
   deletion.
4. **Tag rulesets for `v*`**: only repository admins may create these tags, and nobody may update
   or delete them, so a published version can't be moved to other code.
5. **Features** (Settings → General): pull requests limited to **Collaborators only** (people with
   write access); issues and wiki turned off; **release immutability** on, so a published release's
   ZIP can't be replaced. Users get help from Bleap support, and security reports come through
   private vulnerability reporting.
6. **Actions** (Settings → Actions → General):
   - only GitHub's own actions and `foundry-rs/foundry-toolchain` are allowed, and every action
     must be pinned to a full commit SHA;
   - workflow permissions **read-only** by default, and workflows can't approve pull requests;
   - approval required before workflows run for all outside contributors.
7. **Security** (Settings → Security): Dependabot alerts and security updates, secret scanning with
   push protection, and private vulnerability reporting (for [SECURITY.md](../SECURITY.md)).
8. **Organization**: two-factor authentication required for every member. The page shares the
   `bleapapp.github.io` origin with every other Pages site of the organization, and a script on any
   of them could take over this page. So members can't create Pages sites, no other public Pages
   site is published, and no repository named `bleapapp.github.io` exists. Check this again before
   each release.

## Publishing a release

1. In a pull request, set the new version in `package.json` and `package-lock.json`:

   ```bash
   npm version --no-git-tag-version 0.2.0
   ```

   Check that the networks marked `bleapApp: true` in [chains.ts](../src/core/chains.ts) are
   exactly the networks the Bleap app supports today. The tools only ask for an emergency
   confirmation on those networks, and a released version can't learn about new ones: when the app
   adds a network, publish a release.

2. Once it is merged, run the [manual testnet run](testing.md#manual-run-on-a-testnet) on `main`.
3. Tag the merge commit on `main` (a signed tag, if you sign commits) and push the tag:

   ```bash
   git tag -s v0.2.0 -m v0.2.0
   git push origin v0.2.0
   ```

4. The Release workflow checks that the tag is on `main` and matches the version in
   `package.json`, runs the linter, the type checker and the unit tests, and builds the page.
5. Another maintainer checks that the tagged commit is on `main`. The workflow's own check runs
   from the tagged commit, so a tag on another commit could carry a workflow without it:

   ```bash
   git fetch origin main --tags
   git merge-base --is-ancestor v0.2.0 origin/main && echo "on main"
   ```

   They review the changes since the previous release
   (`https://github.com/bleapapp/magic-wallet-recovery/compare/v0.1.0...v0.2.0`), with special
   care for `package-lock.json`, `.github/` and `web/`, then approve the deployment in the workflow
   run.
6. The approved job publishes the page and creates the GitHub release, with the built page as
   `magic-wallet-recovery-web-v0.2.0.zip` and a signed build provenance attestation of it.
7. Open the page and check that its footer shows the new version and the tagged commit. Add the
   testnet transaction hashes to the release notes.

## Checking the published page

Anyone can check that the published page is the released build. Download the ZIP from the
[release](https://github.com/bleapapp/magic-wallet-recovery/releases), then verify where it comes
from with the [GitHub CLI](https://cli.github.com):

```bash
gh attestation verify magic-wallet-recovery-web-v0.2.0.zip --repo bleapapp/magic-wallet-recovery \
  --signer-workflow bleapapp/magic-wallet-recovery/.github/workflows/release.yml \
  --source-ref refs/tags/v0.2.0 --deny-self-hosted-runners
```

This confirms that the Release workflow of this repository built it from the tagged commit, on a
runner hosted by GitHub. The
files in the ZIP are the files the page serves. Unzip it and compare any of them with the served
one, for example:

```bash
curl -s https://bleapapp.github.io/magic-wallet-recovery/index.html | diff - index.html
```

No output means the files are identical.

## If something goes wrong

- **A published page is wrong or compromised:** unpublish it at once (Settings → Pages →
  Unpublish site), warn users through the Bleap app and Bleap's channels, then fix the problem and
  publish a new version.
- **A maintainer account is compromised:** remove its access, then check the tags, releases,
  deployments and commits made since the compromise, and unpublish the page if needed.
