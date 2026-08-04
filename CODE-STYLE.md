# CODE-STYLE.md

How code is written in **Launch**. This guide and [code-style.rules.json](./code-style.rules.json) are byte-mirrored sources of truth: the guide teaches each rule and the JSON tells automation how to verify it. Existing code is being migrated globally, so do not copy an incumbent pattern that conflicts with this file.

Launch is a TypeScript and Node ESM CLI built on Effect. Use the official Effect documentation for framework mechanics; this guide records only Launch-specific decisions.

## How to read a rule

| Slot | Meaning |
| --- | --- |
| Rule ID | Stable key shared with `code-style.rules.json` and diagnostics |
| Verify | Real command that proves the rule, or `judgment` when review is honest |
| Chosen example | The paved Launch shape |
| Rejected example | A concrete shape that must not return |

## Rules

### Arrow module functions
[rule:function.arrow-only] · verify: `pnpm lint:style`

Authored module functions are named arrow constants declared before first use.

```ts
// [GOOD] src/core/release/confirmation.ts
export const chooseReleaseMode = (releaseInput: ReleaseInput): ReleaseMode => {
  if (releaseInput.confirmed) return 'confirmed';
  return 'prompt';
};

// [AVOID] declaration form relies on hoisting
export function chooseReleaseMode(releaseInput: ReleaseInput): ReleaseMode {
  return 'prompt';
}
```

Why: One declaration shape makes ordering and automated review predictable.

### One function job
[rule:function.one-job] · verify: judgment

Each function performs one cohesive domain job that its name fully describes.

```ts
// [GOOD] src/core/store/playPricing.ts
const parsePriceMicros = (priceText: string): PriceMicros => decodePriceMicros(priceText);

// [AVOID] parses, authenticates, uploads, and renders
const handlePricing = (commandInput: PricingCommandInput) => runEverything(commandInput);
```

Why: A helper earns a name by representing a domain step rather than hiding length.

### Effect production behavior
[rule:effect.production] · verify: `pnpm lint:style`

Production behavior returns Effect while Promise syntax stays in tests, development scripts, generated code, the runtime entrypoint, Commander's callback contract, and Apple's HTTP/JWT transport boundary. The handwritten Apple client keeps the vendor-native Promise/fetch contract; src/core/services/appleStoreClient.ts converts it to typed Effects before any core program can use it.

```ts
// [GOOD] src/core/store/playPricing.ts
export const localizePlayPricing = (pricingInput: PlayPricingInput) =>
  Effect.gen(function* () {
    const playStore = yield* GooglePlayStore;
    return yield* playStore.localizePricing(pricingInput);
  });

// [AVOID] Promise behavior in a core module
export const localizePlayPricing = async (pricingInput: PlayPricingInput) =>
  playStore.localizePricing(pricingInput);
```

Why: One runtime model makes dependencies, failures, retries, cancellation, and tests explicit.

### Official platform services
[rule:effect.platform] · verify: judgment

Filesystem, path, process, command, and terminal work uses official Effect platform services from live layers.

```ts
// [GOOD] src/core/config/config.ts
const fileSystem = yield* FileSystem.FileSystem;
const configSource = yield* fileSystem.readFileString(configPath);

// [AVOID] repository wrapper around the same primitive
const fileSystem = yield* LaunchFileSystem;
const configSource = yield* fileSystem.readText(configPath);
```

Why: Launch services own Launch policy instead of duplicating Effect platform mechanics.

### Effect concurrency
[rule:effect.concurrency] · verify: `pnpm lint:style`

Effectful collections use Effect.forEach or Effect.all with explicit concurrency instead of Promise coordination.

```ts
// [GOOD] src/core/build/asyncPool.ts
const completedBuilds = yield* Effect.forEach(buildRequests, submitBuild, { concurrency: 3 });

// [AVOID] parallel Promise channel
const completedBuilds = await Promise.all(buildRequests.map(submitBuild));
```

Why: Effect owns interruption, failure aggregation, and resource safety.

### Tagged failure values
[rule:failure.tagged-data] · verify: `pnpm lint:style`

Expected production failures are readonly tagged data in the Effect error channel and never thrown Error instances or error classes.

```ts
// [GOOD] src/core/config/config.ts
type ConfigReadFailure = {
  readonly _tag: 'ConfigReadFailure';
  readonly configPath: string;
  readonly cause: unknown;
};
return yield* Effect.fail<ConfigReadFailure>({ _tag: 'ConfigReadFailure', configPath, cause });

// [AVOID] class and throw channel
class ConfigReadError extends Error {}
throw new ConfigReadError(configPath);
```

Why: Plain tagged values keep failure contracts inspectable without class ceremony.

### Boundary-owned schemas
[rule:schema.boundary] · verify: judgment

Each external input boundary decodes once through its owning Effect Schema and downstream code trusts the decoded type.

```ts
// [GOOD] src/core/adopt/orchestrator.ts
const importedConfig = yield* Schema.decodeUnknown(ImportedConfigSchema)(unknownConfig);
return adoptImportedConfig(importedConfig);

// [AVOID] generic record guard repeated downstream
if (!isRecord(unknownConfig)) return Effect.fail(invalidConfig);
```

Why: A named schema states what the boundary accepts and removes defensive checks from business logic.

### Environment source of truth
[rule:schema.environment] · verify: `pnpm lint:style`

LaunchEnvironmentSchema decodes process.env once and exposes secrets as Redacted values to live layers.

```ts
// [GOOD] src/core/config/environment.ts
const launchEnvironment = yield* Schema.decodeUnknown(LaunchEnvironmentSchema)(process.env);

// [AVOID] scattered environment access
const privateKey = process.env.APP_STORE_PRIVATE_KEY;
```

Why: Environment precedence, validation, and secret handling belong to one boundary.

### Type aliases
[rule:type.alias-only] · verify: `pnpm lint:style`

Authored declarations use type aliases while interfaces remain limited to required third-party declaration augmentation.

```ts
// [GOOD] src/core/types/config.ts
export type LaunchApp = { readonly appId: AppId; readonly platform: Platform };

// [AVOID] authored interface
export interface LaunchApp { appId: string }
```

Why: One declaration form avoids accidental merging and keeps domain shapes closed.

### Safe unknown input
[rule:type.safe] · verify: `pnpm lint:style`

Authored code uses unknown at trust boundaries and avoids any, unchecked assertions, non-null assertions, and suppression comments.

```ts
// [GOOD] src/core/config/config.ts
const decodedConfig = yield* Schema.decodeUnknown(LaunchConfigSchema)(unknownConfig);

// [AVOID] unchecked trust
const decodedConfig = JSON.parse(configSource) as any;
```

Why: Trust is earned at a decoder rather than asserted by the caller.

### Immutable boundaries
[rule:type.boundary-immutable] · verify: judgment

Exported and domain boundary shapes are readonly while mutation stays local to an owning implementation.

```ts
// [GOOD] src/core/types/storeSurface.ts
export type StoreListing = { readonly locales: ReadonlyMap<Locale, StoreLocale> };

// [AVOID] caller-owned domain mutation
listing.locales.set(locale, storeLocale);
```

Why: Public values describe facts while local accumulators remain an implementation choice.

### Domain prose names
[rule:name.domain-prose] · verify: `pnpm lint:style`

Launch-owned bindings use domain prose and contain none of the forbidden generic names recorded in code-style.rules.json.

```ts
// [GOOD] src/google/playClient.ts
const convertedRegionPrices = yield* playStore.localizePricing(pricingRequest);

// [AVOID] generic binding
const result = await client.convert(data);
```

Why: A reader should know the held value without reconstructing the previous call.

### Explicit control flow
[rule:control.explicit] · verify: `pnpm lint:style`

Authored code uses guard clauses, exhaustive switches, or named lookups and never uses ternary, nullish-coalescing, logical-or fallback operators, or immediately invoked functions that hide branches inside expressions.

```ts
// [GOOD] src/core/release/confirmation.ts
if (releaseInput.confirmed) return 'confirmed';
if (releaseInput.canPrompt) return 'prompt';
return 'blocked';

// [AVOID] compressed fallback and branching
return releaseInput.mode ?? (releaseInput.canPrompt ? 'prompt' : 'blocked');

// [AVOID] hiding the same branch in an immediately invoked function
const mode = (() => {
  if (releaseInput.mode !== undefined) return releaseInput.mode;
  return 'blocked';
})();
```

Why: Branches and absence remain visible instead of being compressed into expressions.

### Intentional iteration
[rule:collection.intent] · verify: judgment

Synchronous iteration uses native for-of and effectful iteration uses Effect.forEach without repository-owned loop wrappers.

```ts
// [GOOD] src/core/store/syncRun.ts
for (const storeLocale of storeLocales) reconcileLocale(storeLocale);
yield* Effect.forEach(uploadRequests, uploadAsset, { concurrency: 4 });

// [AVOID] custom loop abstraction
yield* runUnifiedLoop(uploadRequests, uploadAsset);
```

Why: The standard construct already communicates sequencing and concurrency.

### Ownership imports
[rule:import.ownership] · verify: `pnpm lint:style`

Imports follow the CLI, core, provider, Apple, and Google ownership directions documented in AGENTS.md.

```ts
// [GOOD] src/cli/commands/sync.ts
import { syncStoreProgram } from '@core/store/syncProgram.js';

// [AVOID] CLI bypasses core
import { AppStoreConnectClient } from '@apple/ascClient.js';
```

Why: Vendor transport and provider choices remain invisible to command wiring.

### Depth-based import spelling
[rule:import.alias-depth] · verify: `pnpm lint:style`

Same-directory and one-parent imports are relative while deeper internal imports use the approved at-sign aliases.

```ts
// [GOOD] src/cli/commands/playPricing.ts
import { pricingFlags } from './pricingFlags.js';
import { runCliProgram } from '../runCliProgram.js';
import { playPricingProgram } from '@core/store/playPricing.js';

// [AVOID] deep relative chain
import { playPricingProgram } from '../../core/store/playPricing.js';
```

Why: Local relationships stay obvious and cross-owner imports remain stable after moves.

### One public barrel
[rule:module.public-entrypoint] · verify: `pnpm lint:style`

src/index.ts is the only passive barrel and every internal module exports the capability it owns directly.

```ts
// [GOOD] src/index.ts
export { runLaunch } from './core/release/runLaunch.js';

// [AVOID] src/core/types/index.ts
export type * from './config.js';
```

Why: Internal import paths identify the owning module instead of hiding behind re-export layers.

### Earned modules
[rule:module.cohesion] · verify: judgment

A module exists only when it owns a domain concept, owns a side-effect boundary, or serves more than one caller.

```ts
// [GOOD] src/core/services/errorMessage.ts serves many boundaries
export const errorMessage = (unknownCause: unknown): string => describeUnknownCause(unknownCause);

// [AVOID] one-use pass-through module
export const callStore = (storeRequest: StoreRequest) => store.call(storeRequest);
```

Why: File count follows real concepts rather than ritual extraction or a line cap.

### Domain-only services directory
[rule:service.domain-only] · verify: judgment

src/core/services contains readonly Effect service types with Context.GenericTag and Layer values while domain logic lives in its purpose directory.

```ts
// [GOOD] src/core/services/logger.ts
export type LoggerService = { readonly note: (message: string) => Effect.Effect<void> };
export const Logger = Context.GenericTag<LoggerService>('launch-store/Logger');

// [AVOID] service class and misplaced screenshot domain table
export class Logger extends Context.Tag('Logger')<Logger, LoggerService>() {}
export const screenshotSpecification = () => screenshotTable;
```

Why: Services are injectable capabilities, not class ceremony or a utility drawer.

### Thin Commander wiring
[rule:cli.thin] · verify: judgment

Commander modules define names, flags, and help before calling one core Effect program shared with interactive flows.

```ts
// [GOOD] src/cli/commands/playPricing.ts
command.action((commandInput) => runCliProgram(localizePlayPricing(commandInput)));

// [AVOID] transport orchestration in Commander
command.action(async (commandInput) => new GooglePlayClient().convert(commandInput));
```

Why: CLI, wizard, MCP, and tests can call the same application behavior.

### Pipe-safe bare CLI
[rule:cli.non-tty] · verify: `pnpm test`

Bare TTY execution may open the wizard while non-TTY execution prints help and never prompts.

```ts
// [GOOD] src/cli/program.ts
if (!terminalIsInteractive) return showHelp(program);
return runWizard();

// [AVOID] unconditional prompt
return runWizard();
```

Why: CI and agents must never hang waiting for terminal input.

### ASCII Effect logging
[rule:presentation.ascii] · verify: `pnpm lint:style`

Production output uses Effect logging with ASCII status labels and keeps JSON output free of human presentation.

```ts
// [GOOD] src/core/services/logger.ts
const logger = yield* LaunchLogger;
yield* logger.ok('Store listing synchronized');

// [AVOID] decorative output
console.log('[OK] Store listing synchronized');
```

Why: One structured channel serves terminals, CI logs, and machine consumers cleanly.

### Hidden-intent comments
[rule:comment.hidden-intent] · verify: judgment

Comments explain only non-obvious intent, constraints, or vendor behavior that names and types cannot express.

```ts
// [GOOD] src/apple/generated/schema.ts
// Source: https://developer.apple.com/documentation/appstoreconnectapi

// [AVOID] narrated implementation history
// First parse the object, then loop through it because this used to be different.
```

Why: Names and structure teach the normal path while comments preserve external context.

### Reproducible vendor generation
[rule:generated.vendor-source] · verify: `pnpm docs:check`

Generated store API artifacts record their official source URL and reproduction command while adapters expose only Launch-owned domain fields.

```ts
// [GOOD] src/apple/generated/schema.ts
// Source: https://developer.apple.com/sample-code/app-store-connect/app-store-connect-openapi-specification.zip
// Regenerate: pnpm gen:asc

// [AVOID] unexplained generated mirror
export type VendorResource = unknown;
```

Why: Store schemas change outside the repository and must remain traceable.

### Screenshot registry
[rule:screenshot.registry] · verify: `pnpm test`

One Apple screenshot asset-target registry owns every screenshot key, label, display specification, and optional preview type.

```ts
// [GOOD] src/core/listing/screenshots/targets.ts
const APPLE_ASSET_TARGETS = { iphone67: { label: 'iPhone 6.7 inch', specification: iphone67 } };

// [AVOID] repeated key catalog
const screenshotLabels = { iphone67: 'iPhone 6.7 inch' };
const screenshotSpecifications = { iphone67 };
```

Why: A new Apple target is added once and every consumer observes the same metadata.

### Effect test layers
[rule:test.layers] · verify: judgment

Tests are colocated by behavior and use hand-written Effect Test layers plus shared testkit fakes for reusable boundaries.

```ts
// [GOOD] src/core/store/playPricing.test.ts
const GooglePlayStoreTest = Layer.succeed(GooglePlayStore, { localizePricing: () => Effect.succeed(prices) });

// [AVOID] broad mock ceremony
const client = { localizePricing: vi.fn() };
```

Why: Tests exercise the same dependency model as production and remain readable without snapshots.

### Script ownership
[rule:tooling.script-location] · verify: `pnpm lint:style`

Development generators and migration helpers live under scripts/dev while scripts/production contains only runtime operational tools.

```ts
// [GOOD] scripts/dev/generate-apple-types.ts
export const generateAppleTypes = () => Effect.gen(function* () {});

// [AVOID] flat development script
// scripts/dev/generate-apple-types.ts
```

Why: Script paths state whether a tool changes the repository or operates the product.

### Documentation in the same change
[rule:docs.same-change] · verify: `pnpm docs:check`

A behavior or architecture change updates its owning generated docs, TECH.md, LANGUAGE.md, CONTEXT.md, or ADR in the same change.

```ts
// [GOOD] command change plus generated command docs
// src/cli/commands/playPricing.ts + docs/commands.md

// [AVOID] stale user contract
// command flags changed without pnpm docs:gen
```

Why: Documentation is part of the implementation contract rather than follow-up work.

## Canonical example

`play-pricing localize` is the first paved vertical slice:

```text
src/google/playClient.ts
  official generated Google client stays inside the transport mirror
        |
        v
src/core/services/<store-adapter>.ts
  Context.GenericTag contract + Live adapter; vendor types stop here
        |
        v
src/core/store/playPricing.ts
  Effect Schema input -> core Effect program -> Launch domain output
        |
        v
src/core/store/playPricing.test.ts
  hand GooglePlayStoreTest layer
        |
        v
src/cli/commands/playPricing.ts
  Commander names and flags -> runCliProgram(...)
        |
        v
src/cli/program.ts -> docs/commands.md -> validation gate
```

Copy this separation when adding the next command: generated vendor types stop at the adapter, the core program owns policy, and the CLI owns presentation only.

## Golden path - adding a command

1. Define the Launch-owned input, output, IDs, and boundary Schema in the purpose directory under `src/core/<job>/`.
2. Add or extend the transport mirror under `src/apple/` or `src/google/`, then implement the
   core-facing `Context.GenericTag` Live adapter under `src/core/services/` without exporting vendor
   client types into core.
3. Implement one core Effect program beside its domain types and schemas.
4. Add colocated behavior tests with hand Test layers and move reusable fakes to `src/testkit/` only after a second consumer appears.
5. Register names, arguments, flags, and help in `src/cli/commands/<command>.ts`, then call the core program with `runCliProgram(...)`.
6. Import and register the command once in `src/cli/program.ts` without changing unrelated command names.
7. Run `pnpm docs:gen` and update `LANGUAGE.md`, `TECH.md`, `CONTEXT.md`, or a focused ADR only when their owned facts changed.
8. Run the full validation gate below and compare the slice with the [canonical example](#canonical-example).

Definition of done:

- [ ] The command and wizard or non-interactive path call the same core Effect program.
- [ ] External input is decoded once and secrets are Redacted.
- [ ] New bindings, operators, imports, comments, and files pass `pnpm lint:style`.
- [ ] Colocated tests cover success and each tagged failure.
- [ ] Generated API types and generated user docs are current.
- [ ] `pnpm typecheck && pnpm lint && pnpm lint:style && pnpm docs:check && pnpm test && pnpm build` passes.

## Exemplars

- `src/core/store/playPricing.ts` - canonical core Effect program after the current migration lands.
- `src/core/release/confirmation.ts` - guard-clause policy with explicit tagged failure output.
- `src/core/services/errorMessage.ts` - a small shared module that earns its file through many callers.
- `src/apple/generated/schema.ts` - generated vendor code isolated from authored style enforcement.

## Never

- Generic `isRecord`, `asRecord`, `data`, `response`, `result`, `body`, `payload`, `row`, `resolve`, or `toMap` ceremony instead of a boundary-owned Schema [rule:schema.boundary] [rule:name.domain-prose].
- `??`, `||`, ternaries, nested ternaries, or chained optional fallback logic that hides a domain branch [rule:control.explicit].
- Function declarations, redundant async wrappers, Promise compatibility twins, or repository-owned loop abstractions [rule:function.arrow-only] [rule:effect.production] [rule:collection.intent].
- One-use pass-through helpers, passive internal barrels, generic utility buckets, or files extracted only to satisfy a line count [rule:module.public-entrypoint] [rule:module.cohesion].
- Direct filesystem, process, fetch, spawn, prompt, or console access outside a live adapter, entrypoint, test, or development script [rule:effect.platform] [rule:cli.thin].
- Error classes, raw production throws, swallowed unknown failures, or user-facing sentences stored inside domain errors [rule:failure.tagged-data].
- Decorative Unicode, emoji, spinners, cursor animation, or human log prefixes in JSON output [rule:presentation.ascii].
- Narrated headers, change history, caller lists, section banners, or comments that merely restate the next line [rule:comment.hidden-intent].
- Full handwritten copies of Apple or Google wire schemas when an official specification or generated client owns them [rule:generated.vendor-source].

## Formatting and validation

Biome owns two-space indentation, single quotes, semicolons, 100-column lines, trailing commas, and organized imports. Custom AST and Grit checks own Launch-specific structure.

```bash
pnpm typecheck && pnpm lint && pnpm lint:style && pnpm docs:check && pnpm test && pnpm build
```
