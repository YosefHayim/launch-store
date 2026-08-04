import { Context, Effect, Layer, Redacted } from 'effect';
import { decodeLaunchEnvironment, type LaunchEnvironmentValues } from '../config/environment.js';

export type LaunchEnvironmentService = Readonly<{
  readonly values: LaunchEnvironmentValues;
  readonly rawVariables: Readonly<Record<string, string | undefined>>;
  readonly readSecret: (
    environmentVariableName: string,
  ) => Effect.Effect<Redacted.Redacted<string> | undefined>;
}>;

export const LaunchEnvironment = Context.GenericTag<LaunchEnvironmentService>(
  'launch-store/LaunchEnvironment',
);

/** Build an environment layer from an explicit variable map. */
export const makeLaunchEnvironmentLayer = (
  environmentVariables: Readonly<Record<string, string | undefined>>,
): Layer.Layer<LaunchEnvironmentService, unknown> => {
  return Layer.effect(
    LaunchEnvironment,
    decodeLaunchEnvironment(environmentVariables).pipe(
      Effect.map(
        (values): LaunchEnvironmentService => ({
          values,
          rawVariables: environmentVariables,
          readSecret: (environmentVariableName) =>
            Effect.sync(() => {
              const secretValue = environmentVariables[environmentVariableName];
              if (secretValue === undefined) return undefined;
              if (secretValue === '') return undefined;
              return Redacted.make(secretValue);
            }),
        }),
      ),
    ),
  );
};

export const LaunchEnvironmentLive = makeLaunchEnvironmentLayer(process.env);

export const LaunchEnvironmentTest = makeLaunchEnvironmentLayer({});

/** Build a deterministic environment layer from explicit test variables. */
export const makeLaunchEnvironmentTest = (
  environmentVariables: Readonly<Record<string, string | undefined>>,
): Layer.Layer<LaunchEnvironmentService, unknown> => {
  return makeLaunchEnvironmentLayer(environmentVariables);
};

/** Effect for entrypoints that intentionally resolve the production environment layer. */
export const readLiveLaunchEnvironment = LaunchEnvironment.pipe(
  Effect.provide(LaunchEnvironmentLive),
);
