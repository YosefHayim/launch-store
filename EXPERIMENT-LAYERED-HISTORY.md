# Experimental domain-layered history

Synthetic rewrite of the **same product tree as `main`**, split into cumulative domain commits.

- **Ship from `main` only.** This branch is a test of domain-oriented history.
- Intermediate commits are organizational; imports cross layers, so they are not green gates.
- Product tip tree matches `main` (`3abd06d5bf72…`).
- Archive of full main: `archive/main-full-at-domain-experiment`.
- Layer tips: `experiment/layer/<layer-name>`.

## Layers

- `00-foundation` `28d286679c597cd7481016d05c6854d3673facdc` — 202 paths
- `01-config` `b6e8ab88931baa028ca5f9529d36c176ac464d24` — 43 paths
- `02-credentials` `feb10f259ef5886ac0858a3246cf036ca38a30aa` — 24 paths
- `03-build` `4a97aeaaae1ac3330f55152b533ed3d500229517` — 78 paths
- `04-apple` `17ce325a3c63aefeb4e234f071fbdab21e0bec74` — 7 paths
- `05-google` `1afa1f00cb9fed4ccf6db8f1dc23106949a93eee` — 4 paths
- `06-store` `fd03d34c6c45c1a6cc08393c459e27ef389c9dab` — 119 paths
- `07-release` `ee4161ca42995240fcb26ac2f4d02670d3ee2a0e` — 40 paths
- `08-readiness` `493334d0e4aa1001e4d9cb87b3cbb75a1795a426` — 123 paths
- `09-agents` `36c677c6f75e772fac0c3c8593e5a3a6a16f7913` — 25 paths
- `10-cli-surface` `0b64310be5e4595ee9ff58faeb356839afd1426e` — 120 paths

## Forward workflow on main

```text
git switch main && git pull
git switch -c feat/<domain>/<slug>
# implement → gate green → PR into main → delete branch
```

Domains: foundation, config, credentials, build, apple, google, store,
release (includes TestFlight), readiness, agents, cli.

