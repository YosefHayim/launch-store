import { FileSystem, Path } from '@effect/platform';
import { Effect } from 'effect';
import type { Platform } from '@core/types/app.js';
import type { SizeReportEntry } from '@core/types/artifacts.js';
import type { ResolvedBuildContext } from '@core/types/config.js';
import type { BuildCredentials, SigningAssets } from '@core/types/credentials.js';
import { makeProviderInputFailure, type BuildEngine } from '@core/types/providers.js';
import {
  assertDeviceArtifact,
  exportOptionsPlist,
  parseThinningReport,
} from '@core/services/appleArtifact.js';
import { runWithProgress, xcodeProgressStep } from '@core/services/progress.js';
import { checkCommandExists, provideNodeCommandServices } from '@core/services/exec.js';
import { readHostResources } from '@core/services/os.js';
import {
  assembleGymArguments,
  computeParallelJobLimit,
  estimateFor,
  gatherIosFingerprint,
  readBuildState,
  resolveCcacheEnvironment,
  resolveClean,
  updateEstimate,
  writeBuildState,
  writeManualSigningToProject,
} from '@core/services/buildEngineSupport.js';
import {
  appleArtifactExtension,
  gymDestination,
  isApplePlatform,
  nativeProjectDirName,
  platformLabel,
} from '@core/services/platform.js';
/**
 * Resolve an app's native Xcode project directory to an ABSOLUTE path, for the given Apple platform
 * ({@link nativeProjectDirName} - `ios` for iOS/tvOS, `macos`, `visionos`).
 *
 * The application directory is relative whenever `launch.config.ts` uses relative `appRoots` - the monorepo
 * case, e.g. `apps/sampleapp`. gym is run with its `cwd` at the app dir, and it re-resolves a
 * *relative* `--workspace` against that cwd, doubling the subpath to
 * `apps/sampleapp/apps/sampleapp/ios/...` and failing with "Workspace file not found". Resolving the
 * dir to absolute here means the workspace path gym receives (and the `pod install` cwd) is one no
 * cwd can double, in both single-app and monorepo layouts.
 */
export const resolveNativeDir = (appDir: string, platform: Platform) =>
  Effect.gen(function* () {
    const pathService = yield* Path.Path;
    const nativeDirectoryName = yield* nativeProjectDirName(platform);
    return pathService.resolve(appDir, nativeDirectoryName);
  });
/** Locate the generated Xcode workspace in a native project directory and derive its scheme from the workspace name. */
const findWorkspace = (
  nativeDir: string,
): Effect.Effect<
  { workspace: string; scheme: string },
  unknown,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const nativeDirectoryExists = yield* fileSystem.exists(nativeDir);
    if (!nativeDirectoryExists) {
      return yield* Effect.fail(
        makeProviderInputFailure({
          provider: 'fastlane',
          message: `No native project directory at ${nativeDir} - did prebuild run?`,
        }),
      );
    }
    const workspaceName = (yield* fileSystem.readDirectory(nativeDir)).find((entryName) =>
      entryName.endsWith('.xcworkspace'),
    );
    if (workspaceName === undefined) {
      return yield* Effect.fail(
        makeProviderInputFailure({
          provider: 'fastlane',
          message: `No .xcworkspace found in ${nativeDir}.`,
        }),
      );
    }
    return {
      workspace: pathService.join(nativeDir, workspaceName),
      scheme: workspaceName.replace(/\.xcworkspace$/, ''),
    };
  });
/**
 * Stamp each signed target's own provisioning profile into the project's Release configs before the
 * archive - see {@link writeManualSigningToProject}. Launch never passes `PROVISIONING_PROFILE_SPECIFIER`
 * as a global `gym --xcargs`: a command-line specifier applies to the whole workspace, so it would leak
 * the app's profile onto every Pods library target and fail the Xcode 26 archive with "... does not support
 * provisioning profiles" (issue #301), and it would clobber an extension's own bundle (issue #262). Each
 * signed target therefore carries its profile in the pbxproj instead. `pod install` /
 * `@bacons/apple-targets` reset the project to Automatic signing, so this runs AFTER Pods are
 * (re)installed and before the archive - otherwise `xcodebuild` dies at exit 65 with "requires a
 * provisioning profile ... Select a provisioning profile" (issue #289).
 *
 * The map is the main app plus any embedded extensions, so a single-target app stamps just the main app.
 * The Pods library targets live in the separate `Pods.xcodeproj` (never in the app's pbxproj), so they
 * are left with their default signing and no profile is ever forced on them.
 */
const stampManualSigning = (nativeDir: string, signing: SigningAssets) =>
  writeManualSigningToProject(nativeDir, {
    teamId: signing.teamId,
    profileByBundleId: {
      [signing.bundleId]: signing.profileName,
      ...signing.extensionProfiles,
    },
  }).pipe(
    Effect.mapError((cause) =>
      makeProviderInputFailure({
        provider: 'fastlane',
        message: `Could not configure manual signing in ${nativeDir}: ${String(cause)}`,
      }),
    ),
  );
/**
 * Assemble the environment for the `gym` subprocess, layered by precedence (later spreads win).
 *
 * The resolved build environment goes in first (`--env` › secrets › `profile env:`
 * › `.env.<profile>` › `.env` ladder), and it's what `xcodebuild`'s "Bundle React Native code"
 * phase reads to inline `EXPO_PUBLIC_*` into the shipped bundle. The ccache compiler wrappers and the
 * App Store Connect API key are layered over it so those build-critical/auth vars still win over any
 * same-named user variable. Gradle, EAS, and submit already forward it; local iOS was the lone gap that
 * silently dropped every layer above the app's own `.env` (issue #109).
 */
export const gymEnv = (
  buildEnvironment: Record<string, string>,
  ccacheVars: Record<string, string>,
  ascKey: {
    keyId: string;
    issuerId: string;
  },
): Record<string, string> => {
  return {
    ...buildEnvironment,
    ...ccacheVars,
    APP_STORE_CONNECT_API_KEY_KEY_ID: ascKey.keyId,
    APP_STORE_CONNECT_API_KEY_ISSUER_ID: ascKey.issuerId,
  };
};
export const fastlaneBuildEngine = {
  name: 'fastlane',
  buildArtifact(buildContext: ResolvedBuildContext, buildCredentials: BuildCredentials) {
    return Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const pathService = yield* Path.Path;
      if (buildContext.dryRun) {
        return {
          artifactPath: '(dry-run, not built)',
          sizeReport: { artifactBytes: 0, entries: [] },
          cleanBuilt: false,
        };
      }
      // `creds.platform` is the credential *shape* (always `ios` for Apple builds - resolveIos returns it
      // for every Apple platform), not the build platform; this guard rejects Android credentials reaching
      // the Apple engine. The build context selects the actual Apple platform.
      if (buildCredentials.platform !== 'ios')
        return yield* Effect.fail(
          makeProviderInputFailure({
            provider: 'fastlane',
            message: 'The fastlane build engine builds Apple platforms only.',
          }),
        );
      if (!isApplePlatform(buildContext.platform))
        return yield* Effect.fail(
          makeProviderInputFailure({
            provider: 'fastlane',
            message: `The fastlane build engine cannot build ${buildContext.platform}.`,
          }),
        );
      const signing = buildCredentials.signing;
      if (!signing)
        return yield* Effect.fail(
          makeProviderInputFailure({
            provider: 'fastlane',
            message: 'No signing assets resolved - run `launch creds setup` first.',
          }),
        );
      const nativeDir = yield* resolveNativeDir(buildContext.app.dir, buildContext.platform);
      const { workspace, scheme } = yield* findWorkspace(nativeDir);
      // Decide clean-vs-incremental from the native-graph fingerprint (or a forced `--clean`).
      const fingerprint = yield* gatherIosFingerprint(nativeDir, buildContext.app.configPath);
      const stored = yield* readBuildState(buildContext.app.name, buildContext.platform);
      const decision = resolveClean(buildContext.forceClean, stored, fingerprint);
      // A clean and an incremental build take wildly different times, so the ETA is keyed on the verdict.
      let kind: 'clean' | 'incremental' = 'incremental';
      if (decision.clean) kind = 'clean';
      const estimate = estimateFor(stored, kind);
      // ccache wires in only when it's installed; otherwise the build runs uncached (doctor recommends it).
      const hasCcache = yield* provideNodeCommandServices(checkCommandExists('ccache'));
      let ccacheVars: Record<string, string> = {};
      if (hasCcache) {
        ccacheVars = yield* resolveCcacheEnvironment(buildContext.ccache === false);
      }
      if (decision.nativeChanged) {
        yield* runWithProgress('pod', ['install'], {
          label: 'Pods',
          cwd: nativeDir,
          env: { ...buildContext.env, ...ccacheVars, RCT_IGNORE_PODS_DEPRECATION: '1' },
        });
      } else if (!(yield* fileSystem.exists(pathService.join(nativeDir, 'Pods')))) {
        yield* runWithProgress('pod', ['install'], {
          label: 'Pods',
          cwd: nativeDir,
          env: { ...buildContext.env, ...ccacheVars, RCT_IGNORE_PODS_DEPRECATION: '1' },
        });
      }
      // Every signed target needs its own profile in the app's pbxproj before the archive (the main app,
      // plus any embedded extensions), because Launch never pins a profile in the global gym xcargs where
      // it would leak onto the Pods targets (issue #301). Runs right after `pod install` regenerates the
      // project (see {@link stampManualSigning}).
      yield* stampManualSigning(nativeDir, signing);
      const { cores, memoryBytes } = yield* readHostResources;
      const parallelJobLimit = yield* computeParallelJobLimit(cores, memoryBytes);
      const outputDir = yield* fileSystem.makeTempDirectory({ prefix: 'launch-build-' });
      const plistPath = pathService.join(outputDir, 'ExportOptions.plist');
      // Internal distribution exports an ad-hoc archive (installs on the profile's registered devices);
      // everything else exports for the store. Same manual-signing inputs either way.
      let exportMethod: 'app-store' | 'ad-hoc' = 'app-store';
      if (buildContext.distribution === 'internal') exportMethod = 'ad-hoc';
      yield* fileSystem.writeFileString(plistPath, exportOptionsPlist(signing, exportMethod));
      // gym argv is built by the shared buildFlags Effect: identical to the iOS command of old, plus a
      // `--destination` only for the non-iOS Apple platforms (iOS omits it -> xcodebuild default). The output keeps each
      // platform's archive extension (`.ipa` for iOS-family, `.pkg` for macOS).
      const archiveExtension = yield* appleArtifactExtension(buildContext.platform);
      const buildDestination = yield* gymDestination(buildContext.platform);
      const gymArguments = yield* assembleGymArguments({
        workspace,
        scheme,
        outputDir,
        outputName: `${buildContext.app.name}.${archiveExtension}`,
        exportOptionsPath: plistPath,
        signing,
        parallelJobLimit,
        shouldCleanBuild: decision.clean,
        buildDestination,
      });
      const progressOptions = {
        label: `Building ${platformLabel(buildContext.platform)} - ${buildContext.app.name}`,
        parseStep: xcodeProgressStep,
        cwd: buildContext.app.dir,
        env: gymEnv(buildContext.env, ccacheVars, buildCredentials.ascKey),
      };
      let buildProgram = runWithProgress('fastlane', gymArguments, progressOptions);
      if (estimate !== undefined) {
        buildProgram = runWithProgress('fastlane', gymArguments, {
          ...progressOptions,
          estimate,
        });
      }
      const buildRun = yield* buildProgram;
      const archive = (yield* fileSystem.readDirectory(outputDir)).find((entryName) =>
        entryName.endsWith(`.${archiveExtension}`),
      );
      if (!archive)
        return yield* Effect.fail(
          makeProviderInputFailure({
            provider: 'fastlane',
            message: `gym finished but produced no .${archiveExtension} in ${outputDir}.`,
          }),
        );
      const artifactPath = pathService.join(outputDir, archive);
      const archiveBytes = Number((yield* fileSystem.stat(artifactPath)).size);
      yield* assertDeviceArtifact(artifactPath, archiveBytes, buildContext.platform);
      // Record the fingerprint so the next build can validate (or invalidate) these now-warm caches, plus
      // this build's duration/step-count folded into the kind's EMA so the next build's ETA learns. In
      // stream mode steps come back 0 (output unparsed), so carry the prior step total forward.
      const prior = stored?.estimates?.[kind];
      let priorStepCount = 0;
      if (prior?.steps !== undefined) priorStepCount = prior.steps;
      let recordedStepCount = priorStepCount;
      if (buildRun.steps > 0) recordedStepCount = buildRun.steps;
      const sample = {
        ms: buildRun.elapsedMs,
        steps: recordedStepCount,
      };
      let priorEstimates = {};
      if (stored?.estimates !== undefined) priorEstimates = stored.estimates;
      yield* writeBuildState(buildContext.app.name, buildContext.platform, {
        fingerprint,
        builtAt: new Date().toISOString(),
        cleanBuilt: decision.clean,
        estimates: {
          ...priorEstimates,
          [kind]: updateEstimate(prior, sample),
        },
      });
      const reportPath = pathService.join(outputDir, 'App Thinning Size Report.txt');
      let entries: SizeReportEntry[] = [];
      if (yield* fileSystem.exists(reportPath)) {
        entries = parseThinningReport(yield* fileSystem.readFileString(reportPath));
      }
      return {
        artifactPath,
        sizeReport: { artifactBytes: archiveBytes, entries },
        cleanBuilt: decision.clean,
      };
    });
  },
};

type FastlaneBuildRequirements = Effect.Effect.Context<
  ReturnType<(typeof fastlaneBuildEngine)['buildArtifact']>
>;

/** Acquire the build services once and return a requirement-free fastlane engine. */
export const makeFastlaneBuildEngine = () =>
  Effect.gen(function* () {
    const buildServices = yield* Effect.context<FastlaneBuildRequirements>();
    return {
      name: fastlaneBuildEngine.name,
      buildArtifact: (buildContext: ResolvedBuildContext, buildCredentials: BuildCredentials) =>
        fastlaneBuildEngine
          .buildArtifact(buildContext, buildCredentials)
          .pipe(Effect.provide(buildServices)),
    } satisfies BuildEngine;
  });
