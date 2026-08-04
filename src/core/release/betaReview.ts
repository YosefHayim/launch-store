import { FileSystem } from '@effect/platform';
import { Data, Effect, Schema } from 'effect';
import type {
  BetaAppReviewSubmissionResource,
  BetaBuildLocalizationResource,
  BetaReviewState,
  BuildResource,
} from '../types/appleCatalog.js';
import { errorMessage } from '../services/errorMessage.js';
import { plan, skip, type ReconcileContext } from '../store/reconcile.js';
import type { PlannedAction } from '../types/reconcile.js';

const BUILD_SCAN_LIMIT = 50;

const WhatToTestSchema = Schema.Record({
  key: Schema.String,
  value: Schema.String.pipe(Schema.minLength(1)),
}).pipe(
  Schema.filter((localizedNotes) => Object.keys(localizedNotes).length > 0, {
    message: () => 'whatToTest must declare at least one locale.',
  }),
);

export const BetaReviewConfigSchema = Schema.Struct({
  whatToTest: WhatToTestSchema,
});

export type BetaReviewConfig = Schema.Schema.Type<typeof BetaReviewConfigSchema>;

export type BetaReviewFailure = Readonly<{
  readonly _tag: 'BetaReviewFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
}>;

export const makeBetaReviewFailure = Data.tagged<BetaReviewFailure>('BetaReviewFailure');

export type AscBetaReviewApi = Readonly<{
  readonly listBuilds: (appId: string, limit?: number) => Effect.Effect<BuildResource[], unknown>;
  readonly listBetaBuildLocalizations: (
    buildId: string,
  ) => Effect.Effect<BetaBuildLocalizationResource[], unknown>;
  readonly createBetaBuildLocalization: (
    buildId: string,
    locale: string,
    whatsNew: string,
  ) => Effect.Effect<void, unknown>;
  readonly updateBetaBuildLocalization: (
    localizationId: string,
    whatsNew: string,
  ) => Effect.Effect<void, unknown>;
  readonly getBetaAppReviewSubmission: (
    buildId: string,
  ) => Effect.Effect<BetaAppReviewSubmissionResource | null, unknown>;
  readonly createBetaAppReviewSubmission: (buildId: string) => Effect.Effect<void, unknown>;
}>;

export type BetaReviewReconcileInput = Readonly<{
  readonly appId: string;
  readonly buildVersion?: string;
  readonly whatToTest: Record<string, string>;
  readonly submitForReview: boolean;
  readonly dryRun: boolean;
}>;

export type BetaReviewReport = Readonly<{
  readonly buildVersion: string;
  readonly actions: PlannedAction[];
}>;

/** Return human wording for Apple's Beta App Review state. */
const describeState = (state: BetaReviewState | undefined): string => {
  switch (state) {
    case 'WAITING_FOR_REVIEW':
      return 'waiting for review';
    case 'IN_REVIEW':
      return 'in review';
    case 'REJECTED':
      return 'rejected';
    case 'APPROVED':
      return 'approved';
    default:
      return 'submitted';
  }
};

/** Select the requested build or the newest valid, non-expired build. */
const selectBuild = (
  availableBuilds: BuildResource[],
  requestedVersion: string | undefined,
): Effect.Effect<BuildResource, BetaReviewFailure> => {
  if (requestedVersion !== undefined) {
    const matchedBuild = availableBuilds.find(
      (availableBuild) => availableBuild.version === requestedVersion,
    );
    if (matchedBuild === undefined) {
      return Effect.fail(
        makeBetaReviewFailure({
          operation: 'select TestFlight build',
          message: `No build ${requestedVersion} for this app. Upload it first, or omit --build to use the latest.`,
        }),
      );
    }
    if (matchedBuild.expired) {
      return Effect.fail(
        makeBetaReviewFailure({
          operation: 'select TestFlight build',
          message: `Build ${requestedVersion} has expired (TestFlight's 90-day limit) and cannot be submitted.`,
        }),
      );
    }
    return Effect.succeed(matchedBuild);
  }
  const latestBuild = availableBuilds.find(
    (availableBuild) =>
      availableBuild.processingState === 'VALID' && availableBuild.expired !== true,
  );
  if (latestBuild !== undefined) return Effect.succeed(latestBuild);
  return Effect.fail(
    makeBetaReviewFailure({
      operation: 'select TestFlight build',
      message:
        'No VALID, non-expired build to release. Upload a build and wait for processing to finish.',
    }),
  );
};

/** Apply one note write while retaining per-action failures in the reconciliation report. */
const applyNote = (
  action: PlannedAction,
  noteWrite: Effect.Effect<void, unknown>,
): Effect.Effect<void> =>
  noteWrite.pipe(
    Effect.match({
      onFailure: (cause) => {
        action.status = 'failed';
        action.error = errorMessage(cause);
      },
      onSuccess: () => {
        action.status = 'applied';
      },
    }),
  );

/** Reconcile localized What-to-Test notes serially for App Store rate limits. */
const reconcileNotes = (
  reconciliation: ReconcileContext,
  appleStore: AscBetaReviewApi,
  buildId: string,
  localizedNotes: Record<string, string>,
): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    const existingLocalizations = new Map(
      (yield* appleStore.listBetaBuildLocalizations(buildId)).map((localization) => [
        localization.locale,
        localization,
      ]),
    );
    for (const [locale, noteText] of Object.entries(localizedNotes)) {
      const currentLocalization = existingLocalizations.get(locale);
      let currentText = '';
      if (currentLocalization?.whatsNew !== undefined) {
        currentText = currentLocalization.whatsNew;
      }
      if (currentText === noteText) continue;
      let description = `set "What to Test" (${locale})`;
      if (currentLocalization !== undefined) description = `update "What to Test" (${locale})`;
      const action = plan(reconciliation, description);
      if (reconciliation.dryRun) continue;
      if (currentLocalization !== undefined) {
        yield* applyNote(
          action,
          appleStore.updateBetaBuildLocalization(currentLocalization.id, noteText),
        );
        continue;
      }
      yield* applyNote(action, appleStore.createBetaBuildLocalization(buildId, locale, noteText));
    }
  });

/** Reconcile the Beta App Review submission while retaining an API failure as an action failure. */
const reconcileSubmission = (
  reconciliation: ReconcileContext,
  appleStore: AscBetaReviewApi,
  buildId: string,
): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    const existingSubmission = yield* appleStore.getBetaAppReviewSubmission(buildId);
    if (existingSubmission !== null) {
      skip(
        reconciliation,
        `submit for Beta App Review: build already submitted (${describeState(existingSubmission.state)})`,
      );
      return;
    }
    const action = plan(reconciliation, 'submit for Beta App Review');
    if (reconciliation.dryRun) return;
    yield* appleStore.createBetaAppReviewSubmission(buildId).pipe(
      Effect.match({
        onFailure: (cause) => {
          action.status = 'failed';
          action.error = errorMessage(cause);
        },
        onSuccess: () => {
          action.status = 'applied';
        },
      }),
    );
  });

/** Reconcile one build's localized notes and optional Beta App Review submission. */
export const reconcileBetaReview = (
  appleStore: AscBetaReviewApi,
  reconciliationInput: BetaReviewReconcileInput,
): Effect.Effect<BetaReviewReport, unknown> =>
  Effect.gen(function* () {
    const reconciliation: ReconcileContext = {
      actions: [],
      dryRun: reconciliationInput.dryRun,
    };
    const availableBuilds = yield* appleStore.listBuilds(
      reconciliationInput.appId,
      BUILD_SCAN_LIMIT,
    );
    const selectedBuild = yield* selectBuild(availableBuilds, reconciliationInput.buildVersion);
    yield* reconcileNotes(
      reconciliation,
      appleStore,
      selectedBuild.id,
      reconciliationInput.whatToTest,
    );
    if (reconciliationInput.submitForReview) {
      yield* reconcileSubmission(reconciliation, appleStore, selectedBuild.id);
    }
    return { buildVersion: selectedBuild.version, actions: reconciliation.actions };
  });

/** Decode an unknown TestFlight configuration through the Effect Schema boundary. */
export const parseBetaReviewConfig = (
  rawConfiguration: unknown,
): Effect.Effect<BetaReviewConfig, BetaReviewFailure> =>
  Schema.decodeUnknown(BetaReviewConfigSchema)(rawConfiguration).pipe(
    Effect.mapError((cause) =>
      makeBetaReviewFailure({
        operation: 'decode TestFlight config',
        message: `Invalid testflight.config.json: ${errorMessage(cause)}`,
        cause,
      }),
    ),
  );

/** Read and decode a TestFlight configuration file. */
export const loadBetaReviewConfig = (
  configPath: string,
): Effect.Effect<BetaReviewConfig, BetaReviewFailure, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const configExists = yield* fileSystem.exists(configPath).pipe(
      Effect.mapError((cause) =>
        makeBetaReviewFailure({
          operation: 'inspect TestFlight config',
          message: `Could not inspect ${configPath}.`,
          cause,
        }),
      ),
    );
    if (!configExists) {
      return yield* Effect.fail(
        makeBetaReviewFailure({
          operation: 'read TestFlight config',
          message: `No TestFlight config at ${configPath}. Add a "whatToTest" map, or pass --whats-new <text>.`,
        }),
      );
    }
    const configurationText = yield* fileSystem.readFileString(configPath).pipe(
      Effect.mapError((cause) =>
        makeBetaReviewFailure({
          operation: 'read TestFlight config',
          message: `Could not read ${configPath}.`,
          cause,
        }),
      ),
    );
    const rawConfiguration = yield* Schema.decode(Schema.parseJson())(configurationText).pipe(
      Effect.mapError((cause) =>
        makeBetaReviewFailure({
          operation: 'parse TestFlight config',
          message: `Invalid JSON in ${configPath}.`,
          cause,
        }),
      ),
    );
    return yield* parseBetaReviewConfig(rawConfiguration);
  });

/** Count applied, failed, and skipped beta-review actions. */
export const summarizeBetaReview = (
  actions: PlannedAction[],
): Readonly<{ applied: number; failed: number; skipped: number }> => {
  let applied = 0;
  let failed = 0;
  let skipped = 0;
  for (const action of actions) {
    switch (action.status) {
      case 'applied':
        applied += 1;
        break;
      case 'failed':
        failed += 1;
        break;
      case 'skipped':
        skipped += 1;
        break;
      case 'planned':
        break;
    }
  }
  return { applied, failed, skipped };
};
