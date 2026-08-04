import { FileSystem, Path } from '@effect/platform';
import { Data, Effect } from 'effect';

const AUTH_KEY_FILENAME = /^AuthKey_([A-Z0-9]{8,})\.p8$/i;

export type KeyIdentityFailure = Readonly<{
  readonly _tag: 'KeyIdentityFailure';
  readonly message: string;
}>;

export const makeKeyIdentityFailure = Data.tagged<KeyIdentityFailure>('KeyIdentityFailure');

/** Read an uppercase Apple Key ID from an `AuthKey_<KEYID>.p8` filename. */
export const extractKeyId = (p8Path: string): Effect.Effect<string | null, never, Path.Path> =>
  Effect.gen(function* () {
    const pathService = yield* Path.Path;
    const capturedKeyId = AUTH_KEY_FILENAME.exec(pathService.basename(p8Path))?.[1];
    if (capturedKeyId === undefined) return null;
    return capturedKeyId.toUpperCase();
  });

/** List matching Apple key files in one directory, returning an empty list when unavailable. */
export const findAuthKeyFiles = (
  directoryPath: string,
): Effect.Effect<readonly string[], never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const directoryEntries = yield* fileSystem
      .readDirectory(directoryPath)
      .pipe(Effect.orElseSucceed((): string[] => []));
    return directoryEntries
      .filter((entryName) => AUTH_KEY_FILENAME.test(entryName))
      .sort()
      .reverse()
      .map((entryName) => pathService.join(directoryPath, entryName));
  });

/** Reconcile a flag or environment Key ID with the ID carried by Apple's filename. */
export const reconcileKeyId = (
  explicitKeyId: string | undefined,
  filenameKeyId: string | null,
): Effect.Effect<string | undefined, KeyIdentityFailure> => {
  let normalizedKeyId: string | undefined;
  if (explicitKeyId !== undefined) normalizedKeyId = explicitKeyId.trim().toUpperCase();
  if (
    normalizedKeyId !== undefined &&
    filenameKeyId !== null &&
    normalizedKeyId !== filenameKeyId
  ) {
    return Effect.fail(
      makeKeyIdentityFailure({
        message: `Key ID ${normalizedKeyId} does not match AuthKey_${filenameKeyId}.p8.`,
      }),
    );
  }
  if (normalizedKeyId !== undefined) return Effect.succeed(normalizedKeyId);
  if (filenameKeyId !== null) return Effect.succeed(filenameKeyId);
  return Effect.succeed(undefined);
};
