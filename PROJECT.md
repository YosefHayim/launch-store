# PROJECT.md — launch-store

Purpose and direction. Read this to understand *why* the project exists and where
it's going; read `CONTEXT.md` for how it's shaped, `LANGUAGE.md` for the words,
and `CODE-STYLE.md` for how code is written.


Purpose and direction for **Launch** - the internal compass for contributors and agents.

## What it is

An open-source CLI (`launch`, published as `launch-store`) that **builds, signs, configures stores, and
ships Expo / React Native apps to the App Store & Google Play** from a single typed `launch.config.ts` -
on your own machine, with your own keys. A self-hosted Expo EAS replacement.

## Who it's for

1. **Solo / small-team mobile devs** who ship iOS + Android and want one workflow, not five dashboards.
2. **Teams migrating off EAS** who want $0 compute, local keys, and declarative store config.
3. **AI agents** that drive the release via `launch agents init` skills under plan -> confirm -> apply guardrails.

## The product goal

A "boring, traceable" path from source to store that one developer can run and understand - with
`--explain` that teaches the why and `launch demo` that simulates the pipeline with no setup.

## What success looks like

- One command builds, signs, size-checks, and uploads to the testing track.
- Store config (IAPs, subscriptions, capabilities, listing) is code, not clicks.
- The public release is a separate, deliberate command. Accidental publish is impossible.
- Keys never leave the OS keychain. No per-build bill. No lock-in.

## Non-goals

- **Not a general CI system** - Launch builds the app, it doesn't run your test suite or deploy your backend.
- **Not a React Native framework** - Launch consumes Expo config, it doesn't replace it.
- **Not a hosted service** - there is no Launch cloud. Artifacts and updates live in your infrastructure.
- **Not an ASC SDK / MCP server** - those wrap a slice of Apple's API; Launch drives the entire release.

## Current state (v0.32)

- 211 App Store Connect + Google Play API operations covered.
- 63 commands, with more than 2,000 test cases tracked by the generated docs gate.
- Build engine: fastlane (local Mac), remote SSH, AWS EC2 Mac, EAS handoff.
- Storage: local, S3, R2, Supabase.
- OTA updates via Expo Updates protocol on your own bucket.
- Store-config-as-code for both stores (products, subscriptions, capabilities, listing, Game Center, Wallet, App Clips, events, experiments, accessibility, EU distribution).
- Agent skills for Claude, Cursor, Codex, Windsurf, Copilot, Kiro, Cline, Amazon Q.

## Direction

1. **Full Effect migration** - rewrite the codebase in Effect (typed errors, services/layers, structured concurrency). See [CODE-STYLE.md](./CODE-STYLE.md) for the target style.
2. **Deepen the purpose-grouped core** - keep new work in the existing `src/core/<job>/` folders and move touched legacy seams toward their owning group.
3. **Finish declared migrations** - Effect Schema config, Effect services/layers, typed errors, and testkit centralization.
4. **Expand Apple coverage** - after cleanup, add new ASC endpoints (Analytics, Marketplace/DMA).
5. **Integration test layer** - real commands against fixture repos.
