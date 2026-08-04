import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import type { PlannedAction } from '../types/reconcile.js';
import {
  act,
  appRecordMissing,
  appRecordNotFound,
  plan,
  type ReconcileContext,
  skip,
  summarize,
} from './reconcile.js';
/** A fresh apply-mode context (dryRun off) for each test. */
const applyContext = (): ReconcileContext => {
  return { actions: [], dryRun: false };
};
describe('act', () => {
  it('records the action and runs it, marking it applied on success', async () => {
    const reconcileContext = applyContext();
    const runAction = vi.fn(() => Effect.void);
    await Effect.runPromise(act(reconcileContext, 'create thing', runAction));
    expect(runAction).toHaveBeenCalledOnce();
    expect(reconcileContext.actions).toEqual([
      { description: 'create thing', destructive: false, status: 'applied' },
    ]);
  });
  it('records a planned action and performs no work in a dry-run', async () => {
    const reconcileContext: ReconcileContext = { actions: [], dryRun: true };
    const runAction = vi.fn(() => Effect.void);
    await Effect.runPromise(act(reconcileContext, 'create thing', runAction));
    expect(runAction).not.toHaveBeenCalled();
    expect(reconcileContext.actions).toEqual([
      { description: 'create thing', destructive: false, status: 'planned' },
    ]);
  });
  it('captures a thrown error on the action instead of propagating it', async () => {
    const reconcileContext = applyContext();
    await Effect.runPromise(
      act(reconcileContext, 'create thing', () => Effect.fail(new Error('boom'))),
    );
    expect(reconcileContext.actions[0]).toEqual({
      description: 'create thing',
      destructive: false,
      status: 'failed',
      error: 'boom',
    });
  });
});
describe('plan', () => {
  it('appends a planned action and returns its handle so the caller can update its status', () => {
    const reconcileContext = applyContext();
    const action = plan(reconcileContext, 'create thing');
    expect(reconcileContext.actions).toEqual([
      { description: 'create thing', destructive: false, status: 'planned' },
    ]);
    // The returned handle is the same object that was pushed - mutating it updates the recorded plan.
    expect(reconcileContext.actions[0]).toBe(action);
    action.status = 'applied';
    expect(reconcileContext.actions[0]?.status).toBe('applied');
  });
});
describe('appRecordMissing', () => {
  it('names the bundle id and the exact command to re-run after creating the app', () => {
    expect(appRecordMissing('com.acme.app', 'accessibility').message).toBe(
      'No App Store Connect app record for com.acme.app. Create the app once in App Store Connect ' +
        '(Apple has no API to create the app record), then re-run `launch accessibility`.',
    );
  });
});
describe('appRecordNotFound', () => {
  it('asks the read-path caller to confirm the bundle id and access, with no create-then-retry remedy', () => {
    expect(appRecordNotFound('com.acme.app').message).toBe(
      'No App Store Connect app record for com.acme.app. Confirm the bundle id and that this account ' +
        "can access the app (Apple has no API to create an app record - it's created once in App Store Connect).",
    );
  });
});
describe('skip', () => {
  it('appends a skipped action with the given reason', () => {
    const reconcileContext = applyContext();
    skip(reconcileContext, 'no editable version');
    expect(reconcileContext.actions).toEqual([
      { description: 'no editable version', destructive: false, status: 'skipped' },
    ]);
  });
});
describe('summarize', () => {
  it('tallies actions by status', () => {
    const actions: PlannedAction[] = [
      { description: 'a', destructive: false, status: 'applied' },
      { description: 'b', destructive: false, status: 'applied' },
      { description: 'c', destructive: false, status: 'failed' },
      { description: 'd', destructive: false, status: 'skipped' },
      { description: 'e', destructive: false, status: 'planned' },
    ];
    expect(summarize(actions)).toEqual({ applied: 2, failed: 1, skipped: 1 });
  });
  it('returns zeros for an empty report', () => {
    expect(summarize([])).toEqual({ applied: 0, failed: 0, skipped: 0 });
  });
});
