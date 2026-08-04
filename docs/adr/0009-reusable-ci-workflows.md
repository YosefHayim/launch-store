# ADR 0009 - Reusable single-purpose CI workflows + report-failure

- **Status:** Accepted - direction set in a `/grill-me-code-style-with-docs` session. - 2026-07-02
- **Context:** CI was one monolithic `check` job (typecheck -> lint -> docs -> test -> build -> smoke) across
  a Node matrix. It works, but a red run doesn't say _which_ check failed without opening the Actions log,
  there is no single aggregated required check for branch protection, and a red `main` is silent. This
  ADR records restructuring CI into the reusable single-purpose-workflow pattern (mirrored from
  dufflebag/skills-bag's CI design), translated pnpm->npm.

## Context

The pieces launch-store's old `ci.yml` lacked, that a "professional" gate wants:

- **Named legs.** A monolithic job surfaces "CI failed" - not "lint failed." Splitting each check into
  its own job names the failure at a glance.
- **One required check.** Branch protection had to pin every matrix leg by name, and adding a leg meant
  updating protection. An aggregated gate fixes this.
- **A loud `main`.** A push that reddens `main` produced no artifact a maintainer would see without
  watching Actions.

## Decision

- **Single-purpose reusable workflows** - `lint.yml`, `typecheck.yml`, `docs.yml`, `test.yml`,
  `build.yml`, `e2e.yml`, each `on: workflow_call`, composed by an orchestrator `ci.yml`.
- **One SSOT for install** - a composite action `.github/actions/setup-node-cached` does setup-node +
  the `node_modules` cache (keyed on OS + Node major + exact `pnpm-lock.yaml` hash, **no**
  `restore-keys`) + `pnpm install --frozen-lockfile` on a miss. The cache rule lives in one place instead
  of being copy-pasted into each leg.
- **Matrix only where it earns its cost** - deterministic checks (`lint`/`typecheck`/`docs`) run
  single-leg (ubuntu, Node 22); environment-sensitive checks (`test`/`build`) run the Node 20/22 matrix,
  where cross-environment bugs actually surface (`engines: node >=20`).
- **`CI Gate`** (`needs: [every leg]`, `if: always()`, asserts each `result == success`) is the single
  status check to require in branch protection - a red leg fails the gate without pinning protection to
  each leg's name.
- **`report-failure`** opens (or comments on) a `ci-failure` issue with the failing job's captured log
  tail when **`main`** goes red - never for PRs (a red PR is the author's to fix). The exact error reads
  straight from the issue.
- `publish.yml` (OIDC trusted publishing) and `schema-drift.yml` (live, scheduled) are **unchanged** -
  they aren't part of the per-PR gate.

## Consequences

- **+** A red run names the failing check; one aggregated check governs branch protection; a red `main`
  files a readable issue.
- **+** The install/cache rule is defined once (the composite action), so it can't drift between legs.
- **-** Each leg re-checks-out and re-installs (isolated jobs) -> more CI minutes than one shared job.
  Bought for red-leg isolation, the aggregated gate, and the notification; the `node_modules` cache keeps
  an unchanged lockfile fast.
- **-** More workflow files to hold in mind; mitigated by each being tiny and single-purpose, with the
  shared install extracted to the composite action.

## Out of scope

- `publish.yml` and `schema-drift.yml` - unchanged; the former is OIDC-bound to its own filename, the
  latter runs on its own schedule with a live download.
- **macOS runners** - the unit tests mock the Mac-specific bits (openssl/security/fastlane) and run on
  Linux; a real iOS build needs a physical Mac and isn't attempted in CI (operator-verified).
- The e2e's rationale (built-CLI over MSW) - its own decision, [ADR 0010](./0010-e2e-built-cli-not-msw.md).
