# Branching and domain workflow

How Launch keeps **`main` shippable** while work is reviewed by **domain**.

This is process only. The full product lives on `main`. Do not rewrite `main` history to invent a
greenfield bootstrap. An optional lab history that narrates the same tree as domain layers lives on
`experiment/layered-history` (see that branch’s `EXPERIMENT-LAYERED-HISTORY.md`); it is not a
release line.

## Rules

1. **Never commit directly to `main`.** Open a PR. CI Gate must pass before merge.
2. **One intent per branch / PR.** Split mixed work (style vs feature vs docs) the way review PRs are split.
3. **Name branches by type and domain:**

   ```text
   feat/<domain>/<short-slug>
   fix/<domain>/<short-slug>
   refactor/<domain>/<short-slug>
   chore/<domain>/<short-slug>
   docs/<domain>/<short-slug>
   test/<domain>/<short-slug>
   ci/<domain>/<short-slug>
   ```

4. **Label every PR** with the matching `domain:*` label (and a second domain label if the change truly spans two).
5. **Delete the branch after merge.** Domains are labels and ownership, not long-lived product branches.
6. **Gate green before you call it done** (local + CI):

   ```bash
   pnpm typecheck && pnpm lint && pnpm lint:style && pnpm docs:check && pnpm test && pnpm build
   ```

## Daily flow

```text
git switch main && git pull
git switch -c feat/<domain>/<slug>
# implement
# gate green
git push -u origin HEAD
gh pr create --base main
# add domain:* label, review, merge, delete branch
```

## Domains

Use these names in branch paths and as GitHub labels (`domain:<name>`).

| Domain | Label | Typical paths / commands |
| --- | --- | --- |
| foundation | `domain:foundation` | Root tooling, CI, CODE-STYLE, `src/core/services`, `src/core/types`, shared CLI helpers |
| config | `domain:config` | `src/core/config/`, `schema/`, `launch.config*` |
| credentials | `domain:credentials` | `src/core/credentials/`, `src/providers/credentials/` |
| build | `domain:build` | `src/core/build/`, `src/core/distribution/`, build/compute/storage providers |
| apple | `domain:apple` | `src/apple/`, Apple-only signing and ASC transport |
| google | `domain:google` | `src/google/`, Play client and reporting |
| store | `domain:store` | `src/core/store/`, listing, privacy, submit providers |
| release | `domain:release` | `src/core/release/`, `releaseTrain/` (includes TestFlight) |
| testflight | `domain:testflight` | TestFlight-focused changes under release/CLI when that is the whole PR |
| readiness | `domain:readiness` | plan, doctor, snapshot, adopt, migrate, readiness probes |
| agents | `domain:agents` | agents, mcp, insights, dashboard |
| cli | `domain:cli` | `src/cli/commands/*` registration and thin wiring only |
| docs | `domain:docs` | README, CONTRIBUTING, BRANCHING, ADR-only docs with no code |

Cross-domain work: pick the **primary** domain for the branch name; add a second `domain:*` label.
If the PR is no longer reviewable as one intent, split it.

## Epics (optional, temporary)

Large migrations may use a short-lived integration branch:

```text
epic/<slug>          # temporary; many feat/<domain>/* PRs may target it
```

When the epic is done, open one PR from `epic/<slug>` into `main`, then **delete** the epic branch.
Do not keep permanent `apple` / `google` / `testflight` product branches.

## Experimental layered history

| Ref | Purpose |
| --- | --- |
| `archive/main-full-at-domain-experiment` | Frozen full `main` at the experiment baseline |
| `experiment/layered-history` | Synthetic domain-layer commits; tip ≈ main + map doc |
| `experiment/layer/<name>` | Browse one cumulative layer tip |

**Do not merge** `experiment/layered-history` into `main` (unrelated histories). Use it only to
review how domains partition the tree.

## Related docs

- [AGENTS.md](./AGENTS.md) — module ownership and validation gate
- [CONTRIBUTING.md](./CONTRIBUTING.md) — setup and quality gate
- [CODE-STYLE.md](./CODE-STYLE.md) — how code is written
- [CONTEXT.md](./CONTEXT.md) — architecture map
