import { Data, Effect, Schema } from 'effect';
import { loadServiceAccount } from '../credentials/androidKeystore.js';
import { errorMessage } from '../services/errorMessage.js';
import {
  GoogleReportingClientService,
  type GoogleReportingClientService as GoogleReportingClientRequirements,
} from '../services/googleReportingClient.js';
import { createLogger, type Logger } from '../services/logger.js';
import type { LaunchSecretStoreService } from '../services/secretStore.js';
import type { PlayVitalsMetric, VitalsTimeline } from '../types/vitals.js';
import { selectStoreApp, type StoreAppSelectionRequirements } from './selectStoreApp.js';

/** Default Play vitals history window shown by the command. */
export const DEFAULT_VITALS_DAYS = 28;
/** Largest Play vitals history window accepted from the CLI. */
export const MAX_VITALS_DAYS = 365;

export const PlayReportsCommandInputSchema = Schema.Struct({
  app: Schema.optional(Schema.String),
  metric: Schema.optional(Schema.String),
  days: Schema.optional(Schema.String),
  json: Schema.Boolean,
});

export type PlayReportsCommandInput = Schema.Schema.Type<typeof PlayReportsCommandInputSchema>;

export type PlayReportsCommandFailure = Readonly<{
  readonly _tag: 'PlayReportsCommandFailure';
  readonly message: string;
  readonly cause?: unknown;
}>;

export const makePlayReportsCommandFailure = Data.tagged<PlayReportsCommandFailure>(
  'PlayReportsCommandFailure',
);

type PlayReportsCommandRequirements =
  | GoogleReportingClientRequirements
  | LaunchSecretStoreService
  | Logger
  | StoreAppSelectionRequirements;

const METRIC_LABEL: Record<PlayVitalsMetric, string> = {
  crash: 'Crash rate',
  anr: 'ANR rate',
};

export const parseVitalsMetrics = (
  metricFlag: string | undefined,
): Effect.Effect<PlayVitalsMetric[], PlayReportsCommandFailure> => {
  if (metricFlag === undefined) return Effect.succeed(['crash', 'anr']);
  const metricName = metricFlag.trim().toLowerCase();
  if (metricName === 'crash') return Effect.succeed(['crash']);
  if (metricName === 'anr') return Effect.succeed(['anr']);
  return Effect.fail(
    makePlayReportsCommandFailure({
      message: `--metric must be "crash" or "anr" (got "${metricFlag}").`,
    }),
  );
};

export const parseVitalsDays = (
  daysFlag: string | undefined,
): Effect.Effect<number, PlayReportsCommandFailure> => {
  if (daysFlag === undefined) return Effect.succeed(DEFAULT_VITALS_DAYS);
  const trimmedDays = daysFlag.trim();
  if (!/^\d+$/.test(trimmedDays)) {
    return Effect.fail(
      makePlayReportsCommandFailure({
        message: `--days must be a positive whole number (got "${daysFlag}").`,
      }),
    );
  }
  const historyDays = Number(trimmedDays);
  if (historyDays < 1) {
    return Effect.fail(
      makePlayReportsCommandFailure({
        message: `--days must be a positive whole number (got "${daysFlag}").`,
      }),
    );
  }
  if (historyDays > MAX_VITALS_DAYS) {
    return Effect.fail(
      makePlayReportsCommandFailure({
        message: `--days cannot exceed ${MAX_VITALS_DAYS} (got "${daysFlag}").`,
      }),
    );
  }
  return Effect.succeed(historyDays);
};

const percentage = (rate: number | undefined): string => {
  if (rate === undefined) return '-';
  return `${(rate * 100).toFixed(2)}%`;
};

export const renderVitalsTimeline = (timeline: VitalsTimeline): string => {
  const header = `\n${METRIC_LABEL[timeline.metric]}  (${timeline.window.startDate} -> ${timeline.window.endDate}, DAILY)`;
  if (timeline.rows.length === 0) {
    return `${header}\n  (no data - the app may be new, or below Play's reporting threshold)`;
  }
  const timelineLines = timeline.rows.map((vitalsEntry) => {
    let usersText = '';
    if (vitalsEntry.distinctUsers !== undefined) {
      usersText = `  ${vitalsEntry.distinctUsers} users`;
    }
    return `  ${vitalsEntry.date}  ${percentage(vitalsEntry.rate).padStart(7)}  (user-perceived ${percentage(vitalsEntry.userPerceivedRate)})${usersText}`;
  });
  return [header, ...timelineLines].join('\n');
};

export const playReportsCommandProgram = (
  rawCommandInput: unknown,
): Effect.Effect<void, PlayReportsCommandFailure, PlayReportsCommandRequirements> =>
  Effect.gen(function* () {
    const commandInput = yield* Schema.decodeUnknown(PlayReportsCommandInputSchema)(
      rawCommandInput,
    );
    const metrics = yield* parseVitalsMetrics(commandInput.metric);
    const historyDays = yield* parseVitalsDays(commandInput.days);
    const selectedApp = yield* selectStoreApp(commandInput.app);
    if (selectedApp.packageName === undefined) {
      return yield* Effect.fail(
        makePlayReportsCommandFailure({
          message: `No Android application id for ${selectedApp.name} (set android.package in app.json).`,
        }),
      );
    }
    const packageName = selectedApp.packageName;
    const serviceAccountJson = yield* loadServiceAccount();
    if (serviceAccountJson === null) {
      return yield* Effect.fail(
        makePlayReportsCommandFailure({
          message: 'No Play service account. Run `launch creds set-key --platform android` first.',
        }),
      );
    }
    const reportingClients = yield* GoogleReportingClientService;
    const reportingClient = yield* reportingClients.createClient(serviceAccountJson);
    const timelines = yield* Effect.forEach(
      metrics,
      (metric) => reportingClient.vitalsTimeline(packageName, metric, historyDays),
      { concurrency: 'unbounded' },
    );
    const logger = yield* createLogger(false);
    if (commandInput.json) {
      yield* logger.line(
        JSON.stringify(
          timelines.flatMap((timeline) => timeline.rows),
          null,
          2,
        ),
      );
      return;
    }
    yield* logger.line(timelines.map(renderVitalsTimeline).join('\n'));
  }).pipe(
    Effect.mapError((cause) =>
      makePlayReportsCommandFailure({ message: errorMessage(cause), cause }),
    ),
  );
