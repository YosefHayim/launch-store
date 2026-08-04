import { Path } from '@effect/platform';
import { Data, Effect, Schema } from 'effect';
import { errorMessage } from '../services/errorMessage.js';
import { createLogger, type Logger } from '../services/logger.js';
import { loadStoreAppContext } from '../store/selectStoreApp.js';
import type { Platform } from '../types/app.js';
import {
  type BuildState,
  type CleanDecision,
  gatherIosFingerprint,
  readBuildState,
  resolveClean,
} from './buildFingerprint.js';

/** Decoded input for `launch fingerprint`. */
export const FingerprintCommandInputSchema = Schema.Struct({
  app: Schema.optionalWith(Schema.String, { exact: true }),
  json: Schema.Boolean,
});

export type FingerprintCommandInput = Schema.Schema.Type<typeof FingerprintCommandInputSchema>;

/** Fingerprint calculation and the cache decision it produces. */
export type FingerprintReport = Readonly<{
  app: string;
  platform: Platform;
  current: string;
  stored: BuildState | null;
  decision: CleanDecision;
}>;

export const FingerprintCommandFailureSchema = Schema.Struct({
  _tag: Schema.Literal('FingerprintCommandFailure'),
  operation: Schema.String,
  message: Schema.String,
  cause: Schema.Unknown,
});

export type FingerprintCommandFailure = Schema.Schema.Type<typeof FingerprintCommandFailureSchema>;

export const makeFingerprintCommandFailure = Data.tagged<FingerprintCommandFailure>(
  'FingerprintCommandFailure',
);

/** Map one command failure into the fingerprint error channel. */
const fingerprintFailure = (operation: string, cause: unknown): FingerprintCommandFailure =>
  makeFingerprintCommandFailure({ operation, message: errorMessage(cause), cause });

/** Map one terminal write into the fingerprint error channel. */
const writeLog = (
  operation: string,
  logWrite: ReturnType<Logger['line']>,
): Effect.Effect<void, FingerprintCommandFailure> =>
  logWrite.pipe(Effect.mapError((cause) => fingerprintFailure(operation, cause)));

/** Shorten a hash for terminal comparison. */
const shortHash = (hash: string): string => hash.slice(0, 12);

/** Render a fingerprint report for a human terminal. */
export const formatFingerprintReport = (fingerprintReport: FingerprintReport): string => {
  let lastBuild = 'none on this host yet';
  if (fingerprintReport.stored !== null) {
    let buildKind = 'incremental';
    if (fingerprintReport.stored.cleanBuilt) buildKind = 'clean';
    lastBuild = `${shortHash(fingerprintReport.stored.fingerprint)}  (${fingerprintReport.stored.builtAt}, ${buildKind})`;
  }
  let verdict = 'incremental (reuses warm caches)';
  if (fingerprintReport.decision.clean) verdict = 'clean (from scratch)';
  return [
    `App:                 ${fingerprintReport.app} (${fingerprintReport.platform})`,
    `Current fingerprint: ${shortHash(fingerprintReport.current)}`,
    `Last build:          ${lastBuild}`,
    `Next build:          ${verdict} - ${fingerprintReport.decision.reason}`,
  ].join('\n');
};

/** Decode input and explain the selected app's next iOS cache decision. */
export const fingerprintCommandProgram = (rawCommandInput: unknown) =>
  Effect.gen(function* () {
    const commandInput = yield* Schema.decodeUnknown(FingerprintCommandInputSchema)(
      rawCommandInput,
    );
    const logger = yield* createLogger(false);
    const selectedContext = yield* loadStoreAppContext(commandInput.app);
    if (selectedContext.app.bundleId === undefined) {
      yield* writeLog(
        'render unsupported fingerprint app',
        logger.line(
          `${selectedContext.app.name} has no iOS bundle id - fingerprints are iOS-only (Gradle tracks Android build inputs itself).`,
        ),
      );
      return;
    }
    const pathService = yield* Path.Path;
    const currentFingerprint = yield* gatherIosFingerprint(
      pathService.join(selectedContext.app.dir, 'ios'),
      selectedContext.app.configPath,
    );
    const storedBuild = yield* readBuildState(selectedContext.app.name, 'ios');
    const fingerprintReport: FingerprintReport = {
      app: selectedContext.app.name,
      platform: 'ios',
      current: currentFingerprint,
      stored: storedBuild,
      decision: resolveClean(false, storedBuild, currentFingerprint),
    };
    let reportText = formatFingerprintReport(fingerprintReport);
    if (commandInput.json) reportText = JSON.stringify(fingerprintReport, null, 2);
    yield* writeLog('render fingerprint report', logger.line(reportText));
  }).pipe(
    Effect.mapError((cause) => {
      if (Schema.is(FingerprintCommandFailureSchema)(cause)) return cause;
      return fingerprintFailure('run fingerprint command', cause);
    }),
  );
