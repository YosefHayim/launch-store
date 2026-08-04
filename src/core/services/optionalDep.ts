import { Data, Effect } from 'effect';

/** Matches the module-resolution errors Node/the loader throw when a package isn't installed. */
// Raw row example: "not installed"-like input should match.
const NOT_INSTALLED = /Cannot find (module|package)|ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND/;
export type OptionalDependencyMissing = Readonly<{
  readonly _tag: 'OptionalDependencyMissing';
  readonly feature: string;
  readonly installHint: string;
  readonly message: string;
}>;
export const makeOptionalDependencyMissing = Data.tagged<OptionalDependencyMissing>(
  'OptionalDependencyMissing',
);
export const requireOptional = <LoadedCapability, LoadFailure, LoadRequirements>(
  feature: string,
  installHint: string,
  load: () => Effect.Effect<LoadedCapability, LoadFailure, LoadRequirements>,
): Effect.Effect<LoadedCapability, LoadFailure | OptionalDependencyMissing, LoadRequirements> =>
  load().pipe(
    Effect.catchAll((cause): Effect.Effect<never, LoadFailure | OptionalDependencyMissing> => {
      let message = String(cause);
      if (cause instanceof Error) message = cause.message;
      if (!NOT_INSTALLED.test(message)) return Effect.fail(cause);
      return Effect.fail(
        makeOptionalDependencyMissing({
          feature,
          installHint,
          message: `${feature} needs an optional package that isn't installed. Install it with:\n  ${installHint}`,
        }),
      );
    }),
  );
