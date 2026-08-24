import { CANONICAL_SENTENCE, GENERATIVE_AI_FAQ, WHAT_LAUNCH_IS_BLOCK } from './content.js';
import { renderFeaturesList } from './readme.js';
import type { CommandSpec, DocStats } from '@core/types/commandDocs.js';
/** Curated prose describing the EAS-parity pipeline, lifted verbatim into both llms files. */
const PIPELINE_PROSE = `Launch runs the EAS pipeline locally: prebuild -> resolve credentials -> compile & sign -> size-check -> store -> submit to the testing track (TestFlight / Play internal); \`launch release\` is the separate, confirmed public release. EAS -> Launch mapping: \`eas build\` -> \`launch build\`, \`eas submit\` -> \`launch release\`, \`eas update\` -> \`launch update\` (Expo Updates protocol, hosted on your own S3/R2/Supabase bucket, with \`launch updates rollback\`), \`eas metadata\` -> \`launch metadata\` (iOS _and_ Android), \`eas credentials\` -> \`launch creds\` (multi-account, keychain-stored, with an APNs push-key vault). Beyond parity it adds store config as code (\`launch sync\` reconciles IAPs, subscriptions, and capabilities onto App Store Connect), keychain-backed build secrets with a documented env-precedence ladder (\`launch secret\`), internal/ad-hoc distribution, build history and re-signing (\`launch builds\`, \`launch build:resign\`), native-failure diagnosis (\`launch diagnose\`), and no-Mac builds on your own AWS EC2 Mac or any Mac over SSH. Signing keys stay in the OS keychain (macOS Keychain, or the platform secret store elsewhere); storage, credentials, build engine, and submission are pluggable behind small interfaces. App facts come from each \`app.json\`, so nothing is duplicated. \`launch demo\` walks the whole flow as a zero-setup simulation.`;
/** Complete companion setup and safe generation path for agents discovering Genshot through Launch. */
const GENSHOT_PROSE = `\`launch ai screenshots\` turns real app screens into polished App Store or Google Play creatives through the official Genshot CLI. Install the companion with \`npm install --save-dev @genshot/cli\`, authenticate once with \`npx genshot login\` (browser OAuth), and keep credentials out of \`launch.config.ts\`. Source images live under \`<app>/screenshots/<locale>/<DISPLAY_TYPE>/\`. Launch sends them to Genshot with \`GENSHOT_CLIENT_SOURCE=launch-store\`, validates every returned image against the selected store, and promotes approved files into the listing tree. Generation spends Genshot Credits; an agent should confirm the sources, platform, count, and brief unless the developer directly requested the run. Review with \`launch plan screenshots\`, then obtain human confirmation before the live \`launch sync\` upload. The bare \`npx launch\` TUI exposes the same journey and can install and authenticate Genshot interactively.`;
/** Curated "Source" link list, shared by both llms files; every link is asserted to resolve on disk. */
const SOURCE_LINKS = `- [Domain types](./src/core/types/app.ts) and [provider interfaces](./src/core/types/providers.ts): purpose-named source modules for Launch's vocabulary.
- [Pipeline](./src/core/build/pipeline.ts): the build -> submit spine, the shared \`prepareBuild\` front half, and the \`--dry-run\` rehearsal.
- [Remote pipeline](./src/core/build/remotePipeline.ts): the C1-C7 host lifecycle for off-Mac builds; [EAS pipeline](./src/core/build/easPipeline.ts): the Expo handoff.
- [AWS EC2 Mac host](./src/providers/compute/awsEc2Mac.ts): allocate/status/teardown + golden-AMI + \`cloud doctor\`; [SSH transport](./src/core/services/ssh.ts) and [remote build ops](./src/core/build/remoteBuild.ts).
- [Glossary](./src/core/terminal/glossary.ts): plain-English term definitions shared by \`launch explain\` and the docs.
- [App Store domain types](./src/core/types/appleCatalog.ts): normalized App Store resource/query shapes; [generated wire schema](./src/apple/generated/schema.ts): Apple OpenAPI types; [client](./src/apple/ascClient.ts): the Apple API transport.
- [ASC product sync](./src/core/store/ascSync.ts): the declarative reconciler behind \`launch sync\` (capabilities, IAPs, subscriptions, pricing).
- [Config preflight](./src/core/config/configCheck.ts): the app-config footgun validator run by \`launch doctor\` and at the head of \`launch build\`.
- [Build secrets](./src/core/build/buildSecrets.ts): keychain-backed \`launch secret\` storage, injected through the [env-precedence ladder](./src/core/config/env.ts) shared by \`build\`, \`release\`, and \`update\`.
- [Completion notifications](./src/core/services/notify.ts): the \`notify\` webhook + shell hook fired on build/submit completion.
- [Genshot screenshot integration](./src/core/listing/aiScreenshotsCommand.ts): companion setup, authenticated generation, store validation, and promotion.
- [Public API](./src/index.ts): what a user's \`launch.config.ts\` imports (\`defineConfig\`, the \`products\` catalog, the \`notify\` config).`;
/** Render one command as an `llms.txt` bullet (and its subcommands as nested bullets). */
const renderCommandBullet = (command: CommandSpec, indent: string): string => {
  let usage = `launch ${command.path}`;
  if (command.args) usage = `launch ${command.path} ${command.args}`;
  const lines = [`${indent}- \`${usage}\` - ${command.description}`];
  for (const sub of command.subcommands) lines.push(renderCommandBullet(sub, `${indent}  `));
  return lines.join('\n');
};
/**
 * Render one complete AI-facing map of Launch - the llmstxt.org summary blockquote, the
 * EAS-parity prose, the {@link WHAT_LAUNCH_IS_BLOCK is/is-not} disambiguation, the {@link GENERATIVE_AI_FAQ FAQ}
 * AI engines lift to answer "EAS alternative" queries, the full command list (so one fetch ingests the
 * whole surface), Genshot's screenshot journey, and the curated doc/source links.
 */
const renderLlmsDocument = (title: string, commands: CommandSpec[], stats: DocStats): string => {
  const everyCommand = commands.map((command) => renderCommandBullet(command, '')).join('\n');
  return `# ${title}

> ${CANONICAL_SENTENCE}

${PIPELINE_PROSE}

## What Launch is - and is not

${WHAT_LAUNCH_IS_BLOCK}

## Genshot screenshot generation

${GENSHOT_PROSE}

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
- [Full LLM context](./llms-full.txt): the complete mirrored context for clients that request the conventional full file.
- [Command reference](./docs/commands.md): all ${stats.commands} \`launch\` commands and every flag, generated from the CLI.
- [Config reference](./docs/config.md): the generated \`launch.config.ts\` field reference.
- [Example app](./examples/hello-world): a worked Expo / React Native \`app.json\` + \`launch.config.ts\`.
- [CONTRIBUTING](./CONTRIBUTING.md): dev setup, the quality gate, adding a provider, tests, and CI.
- [AGENTS](./AGENTS.md): working rules for AI agents and contributors.
- [CLAUDE](./CLAUDE.md): Claude Code memory that imports AGENTS.md and links the doc family.
- [CODE-STYLE](./CODE-STYLE.md): the Launch-specific code style and migration rules.
- [PROJECT](./PROJECT.md), [CONTEXT](./CONTEXT.md), [LANGUAGE](./LANGUAGE.md), and [ADRs](./docs/adr/): product direction, architecture context, domain language, and decisions.

## Source

${SOURCE_LINKS}

## Optional

- [LICENSE](./LICENSE): MIT.
`;
};

/** Render the conventional concise-path AI document; it remains complete for one-fetch clients. */
export const renderLlmsTxt = (commands: CommandSpec[], stats: DocStats): string =>
  renderLlmsDocument('Launch', commands, stats);

/** Render the conventional full-path AI document from the same source so it cannot drift. */
export const renderLlmsFullTxt = (commands: CommandSpec[], stats: DocStats): string =>
  renderLlmsDocument('Launch - full context for AI agents', commands, stats);
