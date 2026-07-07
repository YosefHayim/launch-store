# CODE-STYLE.md

How code is written in **Launch**. Prescriptive: this is the desired migrated state, not a census of the current tree. The rules digest is mirrored into `AGENTS.md`; this file is the source of truth. When an existing module is touched, move it toward this guide instead of preserving old async/Promise-era style.

## Stack & Framework Practices

Launch is a TypeScript / Node ESM CLI. The runtime backbone is **Effect**: Effect programs, typed errors, services via `Context.Tag`, live/test `Layer` implementations, and Effect Schema for config and external boundary schemas.

Use these repo skills instead of restating their whole playbooks here:

- CLI journey and interactive/non-interactive behavior -> `interactive-cli-reviewer`
- Per-diff readability cleanup -> `deslop`
- Code-style review gates -> `grill-me-code-style-with-docs`

This file covers only Launch-specific decisions on top of TypeScript, Node, Commander, Clack, Effect, Vitest, and Biome.

## Rules

Each rule records the pick from the code-style grill. `[lint: ...]` means Biome or `npm run lint:style` should catch the migrated slice; `[taste]` means reviewer/deslop judgment still matters.

### Desired State, Not Current Census · [taste]

Write new and touched production code in the target style even while old modules still contain async, Promise, throw, or other pre-Effect structure.

```ts
// chosen (target style)
export const prepareBuild = (buildOptions: BuildRunOptions) =>
  Effect.gen(function* () {
    const launchConfig = yield* loadLaunchConfig;
    const selectedApp = yield* selectConfiguredApp(launchConfig.apps, buildOptions.appName);
    return yield* prepareSelectedAppBuild(buildOptions, selectedApp);
  });

// not this (src/core/build/pipeline.ts:prepareBuild incumbent)
export async function prepareBuild(options: BuildRunOptions): Promise<PreparedBuild> {
  const { config, apps } = await loadConfig();
  const app = await selectApp(apps, options.appName);
}
```

_Why:_ Mixed style is migration debt; this guide describes the destination so agents do not copy the debt.

### Effect Everywhere In Production · [lint: launch/no-production-promise-style]

Every exported production behavior returns `Effect`. Pure logic uses `Effect.sync`; I/O and sequential work use `Effect.gen(function* () { ... })`. `async/await` is allowed only in tests, scripts, generated fixtures, tiny process entrypoints, and temporary vendor adapter shims.

```ts
// chosen (src/core/build/asyncPool.ts:runPooledWorkers target style)
export const runPooledWorkers = <TItem, TValue, TError>(
  itemsToProcess: readonly TItem[],
  concurrencyLimit: number,
  processItem: (currentItem: TItem) => Effect.Effect<TValue, TError>,
): Effect.Effect<readonly WorkerResult<TValue>[]> =>
  Effect.forEach(itemsToProcess, processItem, { concurrency: concurrencyLimit });

// not this (src/core/build/pipeline.ts:runBuild incumbent)
export async function runBuild(options: BuildRunOptions): Promise<void> {
  const prepared = await prepareBuild(options);
  await dispatchBuild(prepared, options);
}
```

_Why:_ Effects make errors, dependency injection, cancellation, retries, cleanup, and test layers explicit.

### Typed Errors Only · [lint: launch/no-raw-throw]

Expected failures are `Data.TaggedError` classes. Vendor/unknown thrown errors are converted to tagged errors at the boundary. Callers recover with `Effect.catchTag` / `Effect.catchTags`.

```ts
// chosen
export class UnknownPlatformError extends Data.TaggedError('UnknownPlatformError')<{
  readonly receivedPlatform: string;
  readonly allowedPlatforms: readonly Platform[];
}> {}

export const parsePlatform = (rawPlatform: string) =>
  Effect.gen(function* () {
    const matchingPlatform = PLATFORMS.find((platform) => platform === rawPlatform);
    if (!matchingPlatform) {
      return yield* Effect.fail(
        new UnknownPlatformError({ receivedPlatform: rawPlatform, allowedPlatforms: PLATFORMS }),
      );
    }
    return matchingPlatform;
  });

// not this (src/core/platform.ts:parsePlatform incumbent)
if (!match) throw new Error(`Unknown platform "${value}". Use one of: ${PLATFORMS.join(', ')}.`);
```

_Why:_ Error tags are part of the API contract; string errors are not.

### Services And Providers Are Effect Contracts · [taste]

Infrastructure is modeled as `Context.Tag` services with `Live` and `Test` layers. The five provider roles stay, but provider methods return `Effect`; registry lookup is itself a service, not global mutable maps.

```ts
// chosen
export interface CredentialsProvider {
  readonly name: string;
  readonly resolveCredentials: (
    buildContext: ResolvedBuildContext,
  ) => Effect.Effect<BuildCredentials, MissingCredentialsError | KeychainError>;
  readonly describeCredentialStatus: Effect.Effect<string, CredentialStatusError>;
}

export class ProviderRegistry extends Context.Tag('ProviderRegistry')<
  ProviderRegistry,
  {
    readonly getCredentialsProvider: (
      providerName: string,
    ) => Effect.Effect<CredentialsProvider, UnknownProviderError>;
  }
>() {}

// not this (src/core/registry.ts incumbent)
const credentialsProviders = new Map<string, CredentialsProvider>();
export const getCredentialsProvider = (name: string): CredentialsProvider =>
  lookup('credentials provider', name, credentialsProviders);
```

_Why:_ Tests can provide `ProviderRegistryTest` without mutating process-global state.

### CLI Files Are Commander Wiring Only · [taste]

`src/cli/commands/*` owns command names, arguments, flags, help text, and `runCliProgram(...)`. Parsing into domain inputs, confirmation policy, rendering decisions, and orchestration live in `src/core/<domain>/...` Effect programs.

```ts
// chosen
export const registerBuildCommand = (program: Command): void => {
  program
    .command('build')
    .argument('<platform>')
    .option('--profile <name>', 'build profile', 'production')
    .option('--yes')
    .action((platformArgument, commandOptions) =>
      runCliProgram(buildCommandProgram(platformArgument, commandOptions)),
    );
};

// not this (src/cli/commands/build.ts incumbent)
addEnvFlags(command).action(async (platformArg, options) => {
  const platform = parsePlatform(platformArg);
  const rollout = parseRollout(options.rollout);
  await runBuild({ platform, rollout });
});
```

_Why:_ The CLI and any future MCP/agent surface should call the same domain program.

### Prompting Is A Service · [lint: launch/no-clack-in-core]

Clack is only the live implementation of `PromptService`. Core may depend on `PromptService`; it must not import `@clack/prompts` directly. TTY flows may prompt; flags/non-TTY never hang.

```ts
// chosen
const prompt = yield* PromptService;
yield* prompt.confirmOrFail({ message: buildPlan.confirmationMessage });

// not this
import { confirm } from '@clack/prompts';
const accepted = await confirm({ message: 'Upload this build?' });
```

_Why:_ Scriptability, tests, and agent runs need one non-hanging prompt boundary.

### Core Is Grouped By Job · [taste]

`src/core` is organized by purpose/job, not by generic utilities and not by platform. API mirror clients stay top-level in `src/apple` and `src/google`.

```text
// chosen target
src/core/
  adopt/ agents/ asc/ build/ config/ credentials/ dashboard/ distribution/
  docs/ doctor/ insights/ listing/ mcp/ migrate/ plan/ privacy/
  readiness/ release/ releaseTrain/ services/ snapshot/ store/ terminal/ types/

// not this
src/core/pipeline.ts
src/core/buildFlags.ts
src/core/buildFingerprint.ts
src/core/buildLog.ts
src/core/buildPreview.ts
```

_Why:_ A reader should know where a feature lives by the job it performs.

### Imports Follow Ownership Direction · [lint: launch/import-boundaries]

```text
// chosen
src/cli       -> src/core only
src/providers -> src/core/types + src/core/services only, plus vendor SDKs
src/core      -> src/apple and src/google through service adapters only
src/apple     -> src/core/types only, never src/core logic
src/google    -> src/core/types only, never src/core logic

// not this (scan found drift)
cli -> apple/google/providers
core -> providers outside composition/registry wiring
apple/google -> core logic
```

_Why:_ Directional imports keep the CLI thin, providers swappable, and vendor clients boring.

### `index.ts` Is The Barrel; `types.ts` Holds Types · [lint: launch/index-barrels]

Wildcard barrels are named `index.ts`. A file named `types.ts` contains actual type declarations, not wildcard re-exports.

```ts
// chosen target (src/core/types/index.ts)
export type * from './app.js';
export type * from './config.js';
export type * from './providers.js';

// not this
export type * from './types/app.js';
export type * from './types/config.js';
export type * from './types/providers.js';
```

_Why:_ `index.ts` means import surface; `types.ts` means declarations live here.

### Effect Schema Owns Config And Boundary Schemas · [taste]

`launch.config.ts`, imported JSON, and external payload boundaries use Effect Schema. Zod is migration debt; ADR 0008 is superseded.

```ts
// chosen
export const LaunchConfigSchema = Schema.Struct({
  apps: Schema.Array(AppConfigSchema),
  profiles: Schema.Record({ key: Schema.String, value: ProfileConfigSchema }),
});
export type LaunchConfig = Schema.Schema.Type<typeof LaunchConfigSchema>;

export const parseLaunchConfig = (unknownConfig: unknown) =>
  Schema.decodeUnknown(LaunchConfigSchema)(unknownConfig).pipe(
    Effect.mapError((parseError) => new ConfigParseError({ parseError })),
  );

// not this (target no longer uses zod)
import { z } from 'zod';
```

_Why:_ Config parsing should compose with the same error and Effect runtime as the rest of Launch.

### Vendor Wire Types Stay In Resource Files · [taste]

`src/apple/ascResources.ts` and `src/google/playResources.ts` hold vendor resource/query DTOs. Clients transport requests and may re-export resource files for compatibility. Domain-normalized shapes stay in `src/core/types/*`.

```ts
// chosen
// src/google/playResources.ts
export interface PlayTrackResource {
  readonly track: string;
}

// src/google/playClient.ts
export type * from './playResources.js';

// not this
// hundreds of vendor DTOs mixed into playClient transport methods
```

_Why:_ API mirrors can be large, but transport and wire shape ownership are separate jobs.

### File Size Is Tiered By Job · [taste]

```text
// chosen
- Linear orchestration spines may be long when top-to-bottom flow is clearer.
- Vendor API mirrors may be long and repetitive when one endpoint maps to one method/resource.
- Normal domain logic aims around 200 LOC and splits when the smaller job has a real name.

// not this
Split or merge files only to satisfy a flat line count.
```

_Why:_ Depth comes from coherent purpose, not arbitrary file length.

### Concurrency Is Effect Concurrency · [lint: launch/no-promise-all]

```ts
// chosen
const importedSubscriptions = yield* Effect.forEach(
  subscriptions,
  (subscription) => importSubscription(subscription),
  { concurrency: 8 },
);

// not this (src/core/adopt/products.ts incumbent)
const imported = (
  await Promise.all(subscriptions.map((subscription) => importSubscription(asc, subscription)))
).filter(Boolean);
```

_Why:_ Effect concurrency preserves typed errors, interruption, backpressure, and testability.

### Cleanup Uses Scopes · [lint: launch/no-try-finally-cleanup]

```ts
// chosen
const withMetadataWorkspace = Effect.acquireRelease(
  createMetadataWorkspace,
  (metadataWorkspace) => removeDirectory(metadataWorkspace.path, { recursive: true, force: true }),
);

export const pullMetadata = Effect.scoped(
  Effect.gen(function* () {
    const metadataWorkspace = yield* withMetadataWorkspace;
    yield* writeStoreConfig(metadataWorkspace.configPath);
  }),
);

// not this (src/cli/commands/metadata.ts incumbent)
try {
  writeFileSync(configPath, serializeStoreConfig(merged));
} finally {
  rmSync(apiKeyPath, { force: true });
  rmSync(workDir, { recursive: true, force: true });
}
```

_Why:_ Resource lifetime belongs in the Effect graph, not hidden in imperative cleanup.

### I/O Goes Through Services · [lint: launch/io-boundaries]

Direct `fs`, `fetch`, `spawn`, `process.env`, `console.*`, keychain, time, random, and prompts are allowed only in live service layers, tiny process entrypoints, tests, scripts, and generated fixtures.

```ts
// chosen
const fileSystem = yield* FileSystem;
const commandExecutor = yield* CommandExecutor;
yield* commandExecutor.streamCommand('xcodebuild', ['-scheme', scheme, 'archive']);

// not this
const child = spawn(command, args, { shell: false });
const response = await fetch(objectEndpoint(key));
console.log(renderedReport);
```

_Why:_ I/O is where cancellation, retries, redaction, tests, and operator output need a contract.

### Prose Naming Is Strict · [lint: launch/prose-names]

Ban single-letter variables and ritual abbreviations: `ctx`, `cfg`, `res`, `req`, `opts`, `acc`, `curr`. Generic names like `data`, `result`, `info`, `item`, `value` are allowed only when the domain is genuinely generic.

```ts
// chosen
const availabilityZonesResponse = yield* ec2Client.send(describeAvailabilityZonesCommand);
const firstAvailableZoneName = (availabilityZonesResponse.AvailabilityZones ?? []).find(
  (availabilityZone) => availabilityZone.ZoneName,
)?.ZoneName;

// not this (src/providers/compute/awsEc2Mac.ts:firstAvailableAz incumbent)
const res = await client.send(...);
const zone = (res.AvailabilityZones ?? []).find((z) => z.ZoneName)?.ZoneName;
```

_Why:_ The sentence test is the fastest way to spot code an agent wrote without understanding it.

### Control Flow Is Boring And Named · [lint: launch/no-nested-ternary]

No nested ternaries. Use guard clauses for one or two branches. Use `switch` for three or more repeated alternatives over the same discriminant. Named lookup tables are allowed only for pure static mappings.

```ts
// chosen
switch (releaseState) {
  case 'waiting_for_review':
    return 'review';
  case 'ready_for_sale':
    return 'live';
  case 'developer_rejected':
    return 'blocked';
  default:
    return 'unknown';
}

// not this (src/cli/commands/status.ts:rank incumbent)
const rank = (code: number): number => (code === 1 ? 3 : code === 2 ? 2 : code === 3 ? 1 : 0);
```

_Why:_ Replacing a nested ternary with an unlabeled object literal is still unreadable.

### Domain Data Is Explicit And Immutable · [taste]

Use discriminated unions over boolean flag clusters. Exported shapes use `readonly` fields and readonly arrays. Use `Option` for absence inside domain flows; reserve `undefined` for optional object fields and option bags. Normalize external `null` at decode boundaries.

```ts
// chosen
type ReadinessFinding =
  | { readonly state: 'passing'; readonly message: string }
  | { readonly state: 'warning'; readonly message: string; readonly fix: string }
  | { readonly state: 'blocking'; readonly message: string; readonly fix: string };

// not this
interface ReadinessFinding {
  readonly isPassing: boolean;
  readonly isWarning: boolean;
  readonly isBlocking: boolean;
}
```

_Why:_ The type should make invalid states unrepresentable.

### Functions Carry Complete TSDoc · [lint: launch/function-tsdoc]

Every module-scope function, exported function value, provider method, and service method gets TSDoc. It must include a purpose sentence, one `@param` for every runtime parameter, and `@returns` for the returned value or returned `Effect`. Add `@example` when the call shape is not obvious from the signature. Tiny inline callbacks and short local lambdas are exempt; if a local helper needs explanation, promote it or give it the same TSDoc.

```ts
// chosen
/**
 * Builds the release plan for one configured app without mutating store state.
 *
 * @param launchConfig - Parsed Launch config from {@link parseLaunchConfig}.
 * @param appName - Optional app selector from the CLI.
 * @returns An Effect that succeeds with a read-only release plan or fails with a typed planning error.
 *
 * @example
 * ```ts
 * const releasePlan = yield* buildReleasePlan(launchConfig, 'ios-app');
 * ```
 */
export const buildReleasePlan = (launchConfig: LaunchConfig, appName?: string) => undefined;

// not this
/** Validate `--distribution`, defaulting to `store`. */
function parseDistribution(distribution: string | undefined): Distribution { return 'store'; }
```

_Why:_ Function docs are the contract agents and contributors read before opening implementation; `@param` and `@returns` keep the contract searchable and mechanically checkable.

### Tests Use Effects And Test Layers · [taste]

Tests are colocated Vitest files. No snapshots. Use hand fakes over broad module mocks. Shared fakes live in `src/testkit/*.testkit.ts`. Effect services get `*Test` layers.

```ts
// chosen
const AppStoreConnectTest = Layer.succeed(AppStoreConnect, {
  getAppId: () => Effect.succeed('app1'),
  findBundleId: () => Effect.succeed(Option.none()),
});

// not this (src/testkit/ascApiFake.testkit.ts incumbent style to migrate)
export function makeAscApiFake(overrides: Partial<AscSurfacesApi> = {}): AscSurfacesApi {
  return { getAppId: vi.fn().mockResolvedValue('app1'), ...overrides };
}
```

_Why:_ Test layers exercise the same dependency shape production uses.

### Generated And Vendor-Mirror Code Is Boring · [taste]

Do not hand-deslop generated files. Vendor API mirrors may keep vendor names and repetitive one-endpoint methods. If generated output is bad, fix the generator or wrap it in a service.

```text
// chosen
src/core/asc/schema.ts is generated; fix scripts/gen-asc-types.ts or add a wrapper.

// not this
Manually rename generated vendor fields because they offend prose naming.
```

_Why:_ The taste rules apply to authored Launch code, not machine-owned API snapshots.

## Canonical Example

The canonical target slice is `launch build <platform>` input parsing. It shows thin CLI wiring, Effect Schema boundary parsing, typed errors, service-ready Effect programs, and colocated tests. Illustrative documentation, not a claim that these files already exist.

```ts
// src/cli/commands/build.ts
export const registerBuildCommand = (program: Command): void => {
  program
    .command('build')
    .description('run the full pipeline and upload to the testing track')
    .argument('<platform>', 'ios, android, tvos, macos, or visionos')
    .option('-p, --profile <name>', 'build profile', 'production')
    .option('-a, --app <name>', 'app handle')
    .option('--track <track>', 'Android Play track')
    .option('--rollout <fraction>', 'Android production rollout fraction')
    .option('--size-budget <MB>', 'soft size budget override')
    .option('--budget <MB>', 'alias of --size-budget')
    .option('-y, --yes', 'confirm non-interactively', false)
    .action((platformArgument, commandOptions) =>
      runCliProgram(buildCommandProgram(platformArgument, commandOptions)),
    );
};

// src/core/build/buildCommandInput.ts
export class InvalidBuildCommandInputError extends Data.TaggedError('InvalidBuildCommandInputError')<{
  readonly reason: string;
}> {}

export const BuildCommandOptionsSchema = Schema.Struct({
  profile: Schema.optionalWith(Schema.String, { default: () => 'production' }),
  app: Schema.optional(Schema.String),
  track: Schema.optional(Schema.Literal('internal', 'closed', 'open', 'production')),
  rollout: Schema.optional(Schema.NumberFromString.pipe(Schema.between(0, 1))),
  sizeBudget: Schema.optional(Schema.NumberFromString.pipe(Schema.positive())),
  budget: Schema.optional(Schema.NumberFromString.pipe(Schema.positive())),
  yes: Schema.optionalWith(Schema.Boolean, { default: () => false }),
});

export const parseBuildCommandInput = (platformArgument: string, rawCommandOptions: unknown) =>
  Effect.gen(function* () {
    const platform = yield* parsePlatform(platformArgument);
    const commandOptions = yield* Schema.decodeUnknown(BuildCommandOptionsSchema)(rawCommandOptions).pipe(
      Effect.mapError((parseError) => new InvalidBuildCommandInputError({ reason: String(parseError) })),
    );

    return {
      platform,
      profileName: commandOptions.profile,
      appName: Option.fromNullable(commandOptions.app),
      target: 'testing' as const,
      yes: commandOptions.yes,
      sizeBudgetMB: Option.fromNullable(commandOptions.sizeBudget ?? commandOptions.budget),
      playTrack: Option.fromNullable(commandOptions.track),
      rollout: Option.fromNullable(commandOptions.rollout),
    } satisfies BuildCommandInput;
  });

// src/core/build/buildCommandProgram.ts
export const buildCommandProgram = (platformArgument: string, rawCommandOptions: unknown) =>
  Effect.gen(function* () {
    const buildCommandInput = yield* parseBuildCommandInput(platformArgument, rawCommandOptions);
    const prompt = yield* PromptService;

    if (!buildCommandInput.yes) {
      yield* prompt.confirmOrFail({
        message: 'Build and upload this app to the testing track?',
        nonInteractiveExitCode: 3,
      });
    }

    return yield* runBuild(buildCommandInput);
  });
```

## Recipes

### Add a CLI command

1. Add thin Commander wiring in `src/cli/commands/<name>.ts`.
2. Put parsing/orchestration in `src/core/<domain>/<name>CommandProgram.ts`.
3. Decode command input with Effect Schema and fail with tagged errors.
4. Use `PromptService` for confirmations and non-TTY behavior.
5. Add complete TSDoc to every new module-scope function and service/provider method.
6. Add colocated tests for parser/program plus a command registration test.

### Add a provider backend

1. Implement the relevant provider interface with Effect-returning methods.
2. Register it through the ProviderRegistry live layer.
3. Keep heavy SDK imports lazy inside the live layer.
4. Add TSDoc to each provider method, including `@param` and `@returns`.
5. Provide a `*Test` layer or testkit fake for behavior tests.

### Add a domain feature

1. Choose the job folder under `src/core/<domain>/`.
2. Add exported shapes to `src/core/types/<domain>.ts` and export them from `src/core/types/index.ts`.
3. Keep service interfaces beside their `Context.Tag` in `src/core/services/`.
4. Return structured domain results; render in CLI/renderer code.
5. Document every module-scope function with purpose, `@param`, and `@returns`.

### Migrate an old module on contact

1. Move it to the accepted purpose folder if the structure capstone approved that move.
2. Convert exported behavior to Effect.
3. Replace raw throws with tagged errors.
4. Replace raw I/O with services or isolate the I/O in a live layer.
5. Add complete TSDoc to migrated module-scope functions and service/provider methods.
6. Add/update colocated tests with test layers.

## Exemplars

Current positive exemplar:

- `src/core/services/exec.ts` — closest existing service/layer boundary for child processes.

Finding: there is not yet a complete golden file that demonstrates the full target style. Until the first migration slice lands, the canonical example above is the target exemplar for `deslop`.

## Never

The repo-specific AI-slop fingerprint. Killed tells become lint/style-check targets as migrated slices land.

- `asRecord` / `isObject` micro-parser helpers — use Effect Schema at boundaries · `src/core/accessibility.ts:asRecord`, `src/core/json.ts:asRecord` · [lint: launch/no-micro-parsers]
- Defensive over-guards in typed domain code — trust decoded domain types · `src/core/snapshot/sources/appleListing.ts`, `src/core/storeConfig.ts:strArray` · [lint: launch/no-defensive-overguards]
- Nested ternaries or clever replacement tables without domain names · `src/core/rocketScene.ts`, `src/cli/commands/status.ts:rank` · [lint: launch/no-nested-ternary]
- Mechanical one-use wrappers — inline unless the name carries a domain step or boundary · `src/cli/options.ts:collectEnv`, `src/cli/commands/doctor.ts:renderDoctorReport` · [taste]
- Repeated CLI boilerplate such as `activeClient`, `renderAction`, `resolveBundleId` — move into core programs/services · `src/cli/commands/accessibility.ts`, `src/cli/commands/appClips.ts` · [taste]
- Generic names and abbreviations: `ctx`, `cfg`, `res`, `req`, `opts`, `data`, `result`, `info`, `item`, `value` unless genuinely generic · `src/core/appClips.ts:reconcileClip`, `src/providers/compute/awsEc2Mac.ts:firstAvailableAz` · [lint: launch/prose-names]
- Single-letter callback params · `src/cli/commands/creds.ts:askRequired`, `src/core/agents/render.ts` · [lint: launch/prose-names]
- Raw production `throw new Error`, `Promise.all`, `try/finally`, direct `@clack/prompts` in core, direct I/O APIs outside live layers · [lint: launch/effect-boundaries]
- `export default`, non-null `!`, raw `console.*`, snapshot tests, and logic in any `index.ts` barrel · [lint: biome/custom]
