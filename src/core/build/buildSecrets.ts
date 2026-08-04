// Stores build-secret coordinates on disk while values remain in the OS secret store.

import { FileSystem, Path } from '@effect/platform';
import { Effect, Schema } from 'effect';
import { deleteSecret, getSecret, setSecret } from '../credentials/keychain.js';
import { type LaunchPathsService, resolveSecretsFilePath } from '../services/paths.js';

/** Non-secret coordinates for one app/profile environment secret. */
export type SecretRef = Readonly<{
  app: string;
  profile: string | null;
  name: string;
}>;

type SecretsIndex = Readonly<{ secrets: readonly SecretRef[] }>;

const SecretRefSchema = Schema.Struct({
  app: Schema.String,
  profile: Schema.NullOr(Schema.String),
  name: Schema.String,
});
const SecretsIndexSchema = Schema.Struct({ secrets: Schema.Array(SecretRefSchema) });

/** Resolve the secret-store account for one scoped build secret. */
const secretAccount = (secretReference: SecretRef): string => {
  let profile = '*';
  if (secretReference.profile !== null) profile = secretReference.profile;
  return `build-secret:${secretReference.app}:${profile}:${secretReference.name}`;
};

/** Compare two secret coordinates by their natural key. */
const sameSecret = (left: SecretRef, right: SecretRef): boolean =>
  left.app === right.app && left.profile === right.profile && left.name === right.name;

/** Read and decode the non-secret index, degrading missing or malformed files to an empty index. */
const readIndex = (): Effect.Effect<
  SecretsIndex,
  never,
  FileSystem.FileSystem | Path.Path | LaunchPathsService
> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const indexPath = yield* resolveSecretsFilePath();
    const encodedIndex = yield* fileSystem
      .readFileString(indexPath)
      .pipe(Effect.catchAll(() => Effect.succeed(null)));
    if (encodedIndex === null) return { secrets: [] };
    const decodedIndex = yield* Effect.try({
      try: () => JSON.parse(encodedIndex),
      catch: () => null,
    }).pipe(Effect.catchAll(() => Effect.succeed(null)));
    if (decodedIndex === null) return { secrets: [] };
    const schemaOutcome = Schema.decodeUnknownEither(SecretsIndexSchema)(decodedIndex);
    if (schemaOutcome._tag === 'Left') return { secrets: [] };
    return schemaOutcome.right;
  });

/** Persist the non-secret index, creating its parent directory first. */
const writeIndex = (secretIndex: SecretsIndex) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const indexPath = yield* resolveSecretsFilePath();
    yield* fileSystem.makeDirectory(pathService.dirname(indexPath), { recursive: true });
    yield* fileSystem.writeFileString(indexPath, JSON.stringify(secretIndex, null, 2));
  });

/** List recorded secret coordinates, optionally restricted to one app. */
export const listSecretRefs = (appName?: string) =>
  readIndex().pipe(
    Effect.map((secretIndex) => {
      if (appName === undefined) return secretIndex.secrets;
      return secretIndex.secrets.filter((secretReference) => secretReference.app === appName);
    }),
  );

/** Store a secret value and add its coordinates to the index once. */
export const setBuildSecret = (secretReference: SecretRef, secretValue: string) =>
  Effect.gen(function* () {
    yield* setSecret(secretAccount(secretReference), secretValue);
    const secretIndex = yield* readIndex();
    if (
      secretIndex.secrets.some((existingReference) =>
        sameSecret(existingReference, secretReference),
      )
    ) {
      return;
    }
    yield* writeIndex({ secrets: [...secretIndex.secrets, secretReference] });
  });

/** Delete a secret value and remove its coordinates from the index. */
export const removeBuildSecret = (secretReference: SecretRef) =>
  Effect.gen(function* () {
    yield* deleteSecret(secretAccount(secretReference));
    const secretIndex = yield* readIndex();
    const remainingReferences = secretIndex.secrets.filter(
      (existingReference) => !sameSecret(existingReference, secretReference),
    );
    const existed = remainingReferences.length !== secretIndex.secrets.length;
    if (existed) yield* writeIndex({ secrets: remainingReferences });
    return existed;
  });

/** Select app-wide secrets first and profile-specific overrides second. */
export const effectiveRefs = (
  secretReferences: readonly SecretRef[],
  appName: string,
  profileName: string,
): readonly SecretRef[] => {
  const appReferences = secretReferences.filter(
    (secretReference) => secretReference.app === appName,
  );
  return [
    ...appReferences.filter((secretReference) => secretReference.profile === null),
    ...appReferences.filter((secretReference) => secretReference.profile === profileName),
  ];
};

/** Resolve keychain values for one build, with profile-specific values overriding app-wide values. */
export const resolveBuildSecrets = (appName: string, profileName: string) =>
  Effect.gen(function* () {
    const secretReferences = yield* listSecretRefs();
    const environmentValues: Record<string, string> = {};
    yield* Effect.forEach(
      effectiveRefs(secretReferences, appName, profileName),
      (secretReference) =>
        getSecret(secretAccount(secretReference)).pipe(
          Effect.tap((secretValue) => {
            if (secretValue !== null) environmentValues[secretReference.name] = secretValue;
          }),
        ),
      { concurrency: 1, discard: true },
    );
    return environmentValues;
  });
