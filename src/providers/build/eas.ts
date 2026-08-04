import { FileSystem, HttpClient, HttpClientResponse, Path } from '@effect/platform';
import { NodeContext, NodeHttpClient } from '@effect/platform-node';
import { Effect, Schema } from 'effect';
import type { SubmitTarget } from '@core/types/app.js';
import type { SizeReport } from '@core/types/artifacts.js';
import type { ResolvedBuildContext } from '@core/types/config.js';
import { makeProviderInputFailure, type HostedBuildProvider } from '@core/types/providers.js';
import {
  captureCommandOutput,
  checkCommandExists,
  executeCommand,
  provideNodeCommandServices,
} from '@core/services/exec.js';
/** Where the `eas` binary comes from: the global install if present, else `npx eas-cli`. */
const easCommand = (): Effect.Effect<{
  cmd: string;
  prefix: string[];
}> =>
  Effect.gen(function* () {
    const hasGlobalEas = yield* provideNodeCommandServices(checkCommandExists('eas'));
    if (hasGlobalEas) return { cmd: 'eas', prefix: [] };
    return { cmd: 'npx', prefix: ['--yes', 'eas-cli'] };
  });
/** Human label of how `eas` will be invoked, for the run header. Also surfaces a missing toolchain early. */
export const detectEasCli = (): Effect.Effect<string> =>
  easCommand().pipe(
    Effect.map(({ cmd }) => {
      if (cmd === 'eas') return 'eas (global install)';
      return 'npx eas-cli (not globally installed)';
    }),
  );
/** Ensure an Expo login, prompting `eas login` interactively if needed. Launch stores no Expo credentials. */
export const ensureExpoSession = (): Effect.Effect<string, unknown> =>
  Effect.gen(function* () {
    const { cmd, prefix } = yield* easCommand();
    const currentUser = provideNodeCommandServices(
      captureCommandOutput(cmd, [...prefix, 'whoami']),
    );
    return yield* currentUser.pipe(
      Effect.catchAll(() =>
        Effect.gen(function* () {
          yield* provideNodeCommandServices(executeCommand(cmd, [...prefix, 'login']));
          return yield* provideNodeCommandServices(
            captureCommandOutput(cmd, [...prefix, 'whoami']),
          );
        }),
      ),
    );
  });
/** The slice of an `eas build --json` entry Launch reads. */
const EasBuildEntrySchema = Schema.Struct({
  artifacts: Schema.optional(
    Schema.Struct({
      applicationArchiveUrl: Schema.optional(Schema.String),
      buildUrl: Schema.optional(Schema.String),
    }),
  ),
  appBuildVersion: Schema.optional(Schema.Union(Schema.String, Schema.Number)),
  buildNumber: Schema.optional(Schema.Union(Schema.String, Schema.Number)),
});
type EasBuildEntry = Schema.Schema.Type<typeof EasBuildEntrySchema>;
/** Extract the downloadable artifact URL from `eas build --json` output (tolerant of leading log lines). */
export const parseArtifactUrl = (jsonText: string): string | null => {
  const buildEntry = firstBuildEntry(jsonText);
  const applicationArchiveUrl = buildEntry?.artifacts?.applicationArchiveUrl;
  if (applicationArchiveUrl !== undefined) return applicationArchiveUrl;
  const buildUrl = buildEntry?.artifacts?.buildUrl;
  if (buildUrl !== undefined) return buildUrl;
  return null;
};
/** Best-effort build number from `eas build --json` (EAS manages it); 0 when not reported. */
export const parseBuildNumber = (jsonText: string): number => {
  const buildEntry = firstBuildEntry(jsonText);
  let reportedBuildNumber = buildEntry?.appBuildVersion;
  if (reportedBuildNumber === undefined) reportedBuildNumber = buildEntry?.buildNumber;
  if (reportedBuildNumber === undefined) return 0;
  if (typeof reportedBuildNumber === 'number') return reportedBuildNumber;
  const parsedBuildNumber = Number.parseInt(reportedBuildNumber, 10);
  if (Number.isNaN(parsedBuildNumber)) return 0;
  return parsedBuildNumber;
};
/** Parse the first build object out of `eas build --json` (an array, possibly after progress log lines). */
const firstBuildEntry = (jsonText: string): EasBuildEntry | null => {
  const start = jsonText.indexOf('[');
  const end = jsonText.lastIndexOf(']');
  if (start === -1) return null;
  if (end === -1) return null;
  if (end < start) return null;
  try {
    const decodedBuilds: unknown = JSON.parse(jsonText.slice(start, end + 1));
    if (!Array.isArray(decodedBuilds)) return null;
    const firstBuild = decodedBuilds[0];
    if (firstBuild === undefined) return null;
    const decodedEntry = Schema.decodeUnknownEither(EasBuildEntrySchema)(firstBuild);
    if (decodedEntry._tag === 'Left') return null;
    return decodedEntry.right;
  } catch {
    return null;
  }
};
/** Run an EAS cloud build for iOS and download the `.ipa` locally. No per-device thinning report is available. */
export const easBuildToIpa = (
  buildContext: ResolvedBuildContext,
  profileName: string,
): Effect.Effect<
  {
    ipaPath: string;
    sizeReport: SizeReport;
    buildNumber: number;
  },
  unknown
> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const { cmd, prefix } = yield* easCommand();
    const buildJson = yield* provideNodeCommandServices(
      captureCommandOutput(
        cmd,
        [
          ...prefix,
          'build',
          '--platform',
          'ios',
          '--profile',
          profileName,
          '--non-interactive',
          '--json',
          '--wait',
        ],
        { workingDirectory: buildContext.app.dir, environmentOverrides: buildContext.env },
      ),
    );
    const artifactUrl = parseArtifactUrl(buildJson);
    if (artifactUrl === null) {
      return yield* Effect.fail(
        makeProviderInputFailure({
          provider: 'eas',
          message:
            "No artifact URL in `eas build --json` output - Expo's CLI shape may have changed (see providers/build/eas.ts).",
        }),
      );
    }
    const temporaryDirectory = yield* fileSystem.makeTempDirectory({ prefix: 'launch-eas-' });
    const ipaPath = pathService.join(temporaryDirectory, `${buildContext.app.name}.ipa`);
    yield* downloadFile(artifactUrl, ipaPath);
    return {
      ipaPath,
      sizeReport: { artifactBytes: Number((yield* fileSystem.stat(ipaPath)).size), entries: [] },
      buildNumber: parseBuildNumber(buildJson),
    };
  }).pipe(Effect.provide(NodeContext.layer), Effect.provide(NodeHttpClient.layer));
/** Submit an already-built `.ipa` to App Store Connect via `eas submit`. */
export const easSubmit = (
  buildContext: ResolvedBuildContext,
  ipaPath: string,
  profileName: string,
): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    const { cmd, prefix } = yield* easCommand();
    yield* provideNodeCommandServices(
      executeCommand(
        cmd,
        [
          ...prefix,
          'submit',
          '--platform',
          'ios',
          '--path',
          ipaPath,
          '--profile',
          profileName,
          '--non-interactive',
        ],
        { workingDirectory: buildContext.app.dir },
      ),
    );
  });
/** Download a URL to a local file. */
const downloadFile = (artifactUrl: string, destinationPath: string): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const httpClient = yield* HttpClient.HttpClient;
    const artifactDownload = yield* httpClient.get(artifactUrl).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.mapError((cause) =>
        makeProviderInputFailure({
          provider: 'eas',
          message: `Could not download the EAS artifact: ${String(cause)}`,
        }),
      ),
    );
    const artifactBytes = yield* artifactDownload.arrayBuffer.pipe(
      Effect.mapError((cause) =>
        makeProviderInputFailure({
          provider: 'eas',
          message: `Could not read the EAS artifact: ${String(cause)}`,
        }),
      ),
    );
    yield* fileSystem.writeFile(destinationPath, new Uint8Array(artifactBytes));
  }).pipe(Effect.provide(NodeContext.layer), Effect.provide(NodeHttpClient.layer));
/** `--target` is accepted for parity with the local submitter; EAS routes to TestFlight/Store via its own config. */
export type EasSubmitTarget = SubmitTarget;

/** Expo EAS implementation of the core hosted-build boundary. */
export const easHostedBuildProvider: HostedBuildProvider = {
  name: 'eas',
  describeCli: detectEasCli,
  authenticate: ensureExpoSession,
  build: (buildContext, profileName) =>
    easBuildToIpa(buildContext, profileName).pipe(
      Effect.map(({ ipaPath, sizeReport, buildNumber }) => ({
        artifactPath: ipaPath,
        sizeReport,
        buildNumber,
      })),
    ),
  submit: easSubmit,
};
