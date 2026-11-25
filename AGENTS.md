# AGENTS.md

Working rules for AI agents editing Launch. Usage is in [README.md](./README.md). Branch names are `feat|fix|refactor|chore|docs/<domain>/<slug>`. Do not commit to `main`.

## Layout

```text
src/cli.ts                 # the words you typed
src/commands/              # one file per command
src/config/                # launch.config.ts
src/credentials/keychain.ts
src/apple/app-store-connect.ts
src/google/google-play.ts
src/build/                 # BuildPipeline, xcodebuild, gradle
src/plan/plan-store.ts     # desired config versus the live store
```

A command reads the flags and calls one method. `AppStoreConnect` and `GooglePlay` hold the key and make the HTTP calls. `Keychain`, `BuildPipeline`, and those two classes are the classes. A command or a pure step stays a function.

Add a store action by adding one method, then one command that calls it. Do not add it before a person runs that command.

Same-folder imports stay `./file.js`. Anything else is `@/`.

## Secrets

The Apple key and the Play service account live in the OS keychain under the service name `launch`. Do not write them into the repo or into `~/.launch`. Do not log them.

## Checks

```bash
pnpm typecheck && pnpm lint && pnpm docs:check && pnpm test && pnpm build
```

`pnpm check` runs those in that order. A new worktree needs its own `pnpm install`.
