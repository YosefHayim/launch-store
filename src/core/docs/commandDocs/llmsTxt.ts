/**
 * Renders `llms.txt`: the single AI-facing map of Launch — the summary blockquote, the EAS-parity
 * prose, the is/is-not disambiguation, the FAQ, the full command list, and the curated source links.
 * Reuses {@link renderFeaturesList} so the feature list can't drift from the README's.
 */

import { CANONICAL_SENTENCE, GENERATIVE_AI_FAQ, WHAT_LAUNCH_IS_BLOCK } from "./content.js";
import { renderFeaturesList } from "./readme.js";
import type { CommandSpec, DocStats } from "./types.js";

/** Curated prose describing the EAS-parity pipeline, lifted verbatim into both llms files. */
const PIPELINE_PROSE = `Launch runs the EAS pipeline locally: prebuild → resolve credentials → compile & sign → size-check → store → submit to the testing track (TestFlight / Play internal); \`launch release\` is the separate, confirmed public release. EAS → Launch mapping: \`eas build\` → \`launch build\`, \`eas submit\` → \`launch release\`, \`eas update\` → \`launch update\` (Expo Updates protocol, hosted on your own S3/R2/Supabase bucket, with \`launch updates rollback\`), \`eas metadata\` → \`launch metadata\` (iOS _and_ Android), \`eas credentials\` → \`launch creds\` (multi-account, keychain-stored, with an APNs push-key vault). Beyond parity it adds store config as code (\`launch sync\` reconciles IAPs, subscriptions, and capabilities onto App Store Connect), keychain-backed build secrets with a documented env-precedence ladder (\`launch secret\`), internal/ad-hoc distribution, build history and re-signing (\`launch builds\`, \`launch build:resign\`), native-failure diagnosis (\`launch diagnose\`), and no-Mac builds on your own AWS EC2 Mac or any Mac over SSH. Signing keys stay in the OS keychain (macOS Keychain, or the platform secret store elsewhere); storage, credentials, build engine, and submission are pluggable behind small interfaces. App facts come from each \`app.json\`, so nothing is duplicated. \`launch demo\` walks the whole flow as a zero-setup simulation.`;

/** Curated "Source" link list, shared by both llms files; every link is asserted to resolve on disk. */
const SOURCE_LINKS = `- [Domain types & provider interfaces](./src/core/types.ts): the single source of truth for Launch's vocabulary (incl. SecretStore, ComputeHost).
- [Pipeline](./src/core/pipeline.ts): the build → submit spine, the shared \`prepareBuild\` front half, and the \`--dry-run\` rehearsal.
- [Remote pipeline](./src/core/remotePipeline.ts): the C1–C7 host lifecycle for off-Mac builds; [EAS pipeline](./src/core/easPipeline.ts): the Expo handoff.
- [AWS EC2 Mac host](./src/providers/compute/awsEc2Mac.ts): allocate/status/teardown + golden-AMI + \`cloud doctor\`; [SSH transport](./src/core/ssh.ts) and [remote build ops](./src/core/remoteBuild.ts).
- [Glossary](./src/core/glossary.ts): plain-English term definitions shared by \`launch explain\` and the docs.
- [App Store Connect client](./src/apple/ascClient.ts): the Apple API integration (JWT auth, bundle ids, certs, profiles, builds).
- [ASC product sync](./src/core/ascSync.ts): the declarative reconciler behind \`launch sync\` (capabilities, IAPs, subscriptions, pricing).
- [Config preflight](./src/core/configCheck.ts): the app-config footgun validator run by \`launch doctor\` and at the head of \`launch build\`.
- [Build secrets](./src/core/buildSecrets.ts): keychain-backed \`launch secret\` storage, injected through the [env-precedence ladder](./src/core/env.ts) shared by \`build\`, \`release\`, and \`update\`.
- [Completion notifications](./src/core/notify.ts): the \`notify\` webhook + shell hook fired on build/submit completion.
- [Public API](./src/index.ts): what a user's \`launch.config.ts\` imports (\`defineConfig\`, the \`products\` catalog, the \`notify\` config).`;

/** Render one command as an `llms.txt` bullet (and its subcommands as nested bullets). */
function renderCommandBullet(command: CommandSpec, indent: string): string {
  const usage = command.args ? `launch ${command.path} ${command.args}` : `launch ${command.path}`;
  const lines = [`${indent}- \`${usage}\` — ${command.description}`];
  for (const sub of command.subcommands) lines.push(renderCommandBullet(sub, `${indent}  `));
  return lines.join("\n");
}

/**
 * Render `llms.txt`: the single AI-facing map of Launch — the llmstxt.org summary blockquote, the
 * EAS-parity prose, the {@link WHAT_LAUNCH_IS_BLOCK is/is-not} disambiguation, the {@link GENERATIVE_AI_FAQ FAQ}
 * AI engines lift to answer "EAS alternative" queries, the full command list (so one fetch ingests the
 * whole surface), and the curated doc/source links. Merged from the former `llms.txt` + `llms-full.txt`
 * into one file at the conventional `/llms.txt` endpoint that crawlers probe for.
 */
export function renderLlmsTxt(commands: CommandSpec[], stats: DocStats): string {
  const everyCommand = commands.map((command) => renderCommandBullet(command, "")).join("\n");
  return `# Launch

> ${CANONICAL_SENTENCE}

${PIPELINE_PROSE}

## What Launch is — and is not

${WHAT_LAUNCH_IS_BLOCK}

## Features

Everything Launch does, grouped and numbered:

${renderFeaturesList()}

## FAQ

${GENERATIVE_AI_FAQ}

## Commands

All ${stats.commands} \`launch\` commands (${stats.operations} store-API operations underneath, ${stats.tests} tests):

${everyCommand}

## Docs

- [README](./README.md): install, quick start, the command surface, configuration, and how credentials are handled.
- [CONTRIBUTING](./CONTRIBUTING.md): dev setup, the quality gate, adding a provider, tests, and CI.
- [AGENTS](./AGENTS.md): working rules for AI agents and contributors.

## Reference

- [Command reference](./docs/commands.md): all ${stats.commands} \`launch\` commands and every flag, generated from the CLI.

## Source

${SOURCE_LINKS}

## Optional

- [Example app](./examples/hello-world): a worked \`app.json\` + \`launch.config.ts\`.
- [LICENSE](./LICENSE): MIT.
`;
}
