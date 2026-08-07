import { Data, Effect } from 'effect';
import { errorMessage } from '../services/errorMessage.js';
import type { PlannedAction } from '../types/reconcile.js';
import type { MutableDeep } from '../types/mutable.js';

/** Mutable state for one reconciliation pass. */
export type ReconcileContext = {
  actions: MutableDeep<PlannedAction>[];
  dryRun: boolean;
};

/** Missing App Store Connect app record. */
export type AppRecordFailure = Readonly<{
  readonly _tag: 'AppRecordFailure';
  readonly bundleId: string;
  readonly message: string;
}>;

export const makeAppRecordFailure = Data.tagged<AppRecordFailure>('AppRecordFailure');

/** Record and optionally apply one non-destructive action. */
export const act = (
  reconcileContext: ReconcileContext,
  description: string,
  runAction: () => Effect.Effect<void, unknown>,
): Effect.Effect<void> => {
  const plannedAction: MutableDeep<PlannedAction> = {
    description,
    destructive: false,
    status: 'planned',
  };
  reconcileContext.actions.push(plannedAction);
  if (reconcileContext.dryRun) return Effect.void;
  return runAction().pipe(
    Effect.match({
      onSuccess: () => {
        plannedAction.status = 'applied';
      },
      onFailure: (actionFailure) => {
        plannedAction.status = 'failed';
        plannedAction.error = errorMessage(actionFailure);
      },
    }),
  );
};

/** Record a planned action and return its mutable status handle. */
export const plan = (
  reconcileContext: ReconcileContext,
  description: string,
): MutableDeep<PlannedAction> => {
  const plannedAction: MutableDeep<PlannedAction> = {
    description,
    destructive: false,
    status: 'planned',
  };
  reconcileContext.actions.push(plannedAction);
  return plannedAction;
};

/** Describe the missing app record for a write command. */
export const appRecordMissing = (bundleId: string, commandName: string): AppRecordFailure => {
  return makeAppRecordFailure({
    bundleId,
    message:
      `No App Store Connect app record for ${bundleId}. Create the app once in App Store Connect ` +
      `(Apple has no API to create the app record), then re-run \`launch ${commandName}\`.`,
  });
};

/** Describe the missing app record for a read command. */
export const appRecordNotFound = (bundleId: string): AppRecordFailure => {
  return makeAppRecordFailure({
    bundleId,
    message:
      `No App Store Connect app record for ${bundleId}. Confirm the bundle id and that this account ` +
      `can access the app (Apple has no API to create an app record - it's created once in App Store Connect).`,
  });
};

/** Record a sub-area that cannot be reconciled yet. */
export const skip = (reconcileContext: ReconcileContext, description: string): void => {
  reconcileContext.actions.push({ description, destructive: false, status: 'skipped' });
};
/** Tally a reconcile report's action statuses for the run-summary footer (applied / failed / skipped). */
export const summarize = (
  actions: readonly PlannedAction[],
): {
  applied: number;
  failed: number;
  skipped: number;
} => {
  let applied = 0;
  let failed = 0;
  let skipped = 0;
  for (const action of actions) {
    if (action.status === 'applied') applied++;
    else if (action.status === 'failed') failed++;
    else if (action.status === 'skipped') skipped++;
  }
  return { applied, failed, skipped };
};
