import { FileSystem, Path } from '@effect/platform';
import type { CommandExecutor } from '@effect/platform/CommandExecutor';
import { Effect, Schema } from 'effect';
import { captureCommandOutput } from '../services/exec.js';
import type { LaunchEnvironmentService } from '../services/environment.js';
import { checkIsMacOperatingSystem } from '../services/os.js';
import type { EntitlementValue } from '../types/adopt.js';

const EntitlementValueSchema: Schema.Schema<EntitlementValue> = Schema.suspend(() =>
  Schema.Union(
    Schema.String,
    Schema.Number,
    Schema.Boolean,
    Schema.Null,
    Schema.mutable(Schema.Array(EntitlementValueSchema)),
    Schema.mutable(Schema.Record({ key: Schema.String, value: EntitlementValueSchema })),
  ),
);

const ProfileEntitlementsSchema = Schema.mutable(
  Schema.Record({
    key: Schema.String,
    value: EntitlementValueSchema,
  }),
);

export type ProfileEntitlementRequirements =
  | CommandExecutor
  | FileSystem.FileSystem
  | LaunchEnvironmentService
  | Path.Path;

/** Decode entitlement values from a provisioning profile on macOS. */
export const extractProfileEntitlements = (
  profileContent: string,
): Effect.Effect<
  Record<string, EntitlementValue> | null,
  never,
  ProfileEntitlementRequirements
> => {
  return Effect.gen(function* () {
    const runningOnMac = yield* checkIsMacOperatingSystem;
    if (!runningOnMac) return null;
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const pathService = yield* Path.Path;
        const workspacePath = yield* fileSystem.makeTempDirectoryScoped({
          prefix: 'launch-adopt-',
        });
        const profilePath = pathService.join(workspacePath, 'profile.mobileprovision');
        yield* fileSystem.writeFile(profilePath, Buffer.from(profileContent, 'base64'));
        const decodedPlist = yield* captureCommandOutput('security', [
          'cms',
          '-D',
          '-i',
          profilePath,
        ]);
        const plistPath = pathService.join(workspacePath, 'decoded.plist');
        yield* fileSystem.writeFileString(plistPath, decodedPlist);
        const entitlementsPlistPath = pathService.join(workspacePath, 'entitlements.plist');
        yield* captureCommandOutput('plutil', [
          '-extract',
          'Entitlements',
          'xml1',
          '-o',
          entitlementsPlistPath,
          plistPath,
        ]);
        const entitlementsJson = yield* captureCommandOutput('plutil', [
          '-convert',
          'json',
          '-o',
          '-',
          entitlementsPlistPath,
        ]);
        return yield* Effect.try(() => JSON.parse(entitlementsJson)).pipe(
          Effect.flatMap(Schema.decodeUnknown(ProfileEntitlementsSchema)),
        );
      }).pipe(Effect.catchAll(() => Effect.succeed(null))),
    );
  });
};
