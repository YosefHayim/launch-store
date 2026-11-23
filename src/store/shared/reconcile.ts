import { errorMessage } from '../../services/platform/error-message.ts';
import type { PlannedAction } from '../../types/reconcile.ts';
import type { MutableDeep } from '../../types/mutable.ts';

/** Mutable state for one reconciliation pass. */
export type ReconcileContext = {
  actions: MutableDeep<PlannedAction>[];
  dryRun: boolean;
};

/** Missing App Store Connect app record. */
type AppRecordFailure = Readonly<{
  readonly _tag: 'AppRecordFailure';
  readonly bundleId: string;
  readonly message: string;
}>;

export function makeAppRecordFailure(fields: {
  bundleId: string;
  message: string;
}): AppRecordFailure {
  return { _tag: 'AppRecordFailure', ...fields };
}

/** Record and optionally apply one non-destructive action. */
export async function act(
  reconcileContext: ReconcileContext,
  description: string,
  runAction: () => Promise<void>,
): Promise<void> {
  const plannedAction: MutableDeep<PlannedAction> = {
    description,
    destructive: false,
    status: 'planned',
  };

  reconcileContext.actions.push(plannedAction);

  if (reconcileContext.dryRun) {
    return;
  }

  try {
    await runAction();
    plannedAction.status = 'applied';
  } catch (actionFailure) {
    plannedAction.status = 'failed';
    plannedAction.error = errorMessage(actionFailure);
  }
}

/** Record a planned action and return its mutable status handle. */
export function plan(
  reconcileContext: ReconcileContext,
  description: string,
): MutableDeep<PlannedAction> {
  const plannedAction: MutableDeep<PlannedAction> = {
    description,
    destructive: false,
    status: 'planned',
  };

  reconcileContext.actions.push(plannedAction);

  return plannedAction;
}

/** Describe the missing app record for a write command. */
export function appRecordMissing(bundleId: string, commandName: string): AppRecordFailure {
  return makeAppRecordFailure({
    bundleId,
    message:
      `No App Store Connect app record for ${bundleId}. Create the app once in App Store Connect ` +
      `(Apple has no API to create the app record), then re-run \`launch-store ${commandName}\`.`,
  });
}

/** Describe the missing app record for a read command. */
export function appRecordNotFound(bundleId: string): AppRecordFailure {
  return makeAppRecordFailure({
    bundleId,
    message:
      `No App Store Connect app record for ${bundleId}. Confirm the bundle id and that this account ` +
      `can access the app (Apple has no API to create an app record - it's created once in App Store Connect).`,
  });
}

/** Record a sub-area that cannot be reconciled yet. */
export function skip(reconcileContext: ReconcileContext, description: string): void {
  reconcileContext.actions.push({ description, destructive: false, status: 'skipped' });
}

/** Tally a reconcile report's action statuses for the run-summary footer (applied / failed / skipped). */
export function summarize(actions: readonly PlannedAction[]): {
  applied: number;
  failed: number;
  skipped: number;
} {
  let applied = 0;
  let failed = 0;
  let skipped = 0;

  for (const action of actions) {
    if (action.status == 'applied') {
      applied += 1;
      continue;
    }

    if (action.status == 'failed') {
      failed += 1;
      continue;
    }

    if (action.status == 'skipped') {
      skipped += 1;
    }
  }

  return { applied, failed, skipped };
}
