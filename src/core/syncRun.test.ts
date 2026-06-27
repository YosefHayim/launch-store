import { describe, expect, it } from 'vitest';
import type { PlannedAction, ReconcileReport } from './ascSync.js';
import type { SyncJob } from './syncJobs.js';
import { mergeOutcomes, summarizeRun, type JobOutcome } from './syncRun.js';

/** A minimal valid {@link SyncJob} for one app — enough to carry an outcome through the pure projections. */
function makeJob(name: string, bundleId: string): SyncJob {
  return {
    app: { name, dir: `/tmp/${name}`, configPath: `/tmp/${name}/app.json`, bundleId },
    bundleId,
    capabilities: [],
    products: {},
    screenshots: [],
    previews: [],
    subscriptionReviewScreenshots: [],
    unmapped: [],
  };
}

/** A one-action report at a given lifecycle status, for tallying tests. */
function report(bundleId: string, status: PlannedAction['status']): ReconcileReport {
  return { bundleId, actions: [{ description: `${status} action`, destructive: false, status }] };
}

describe('summarizeRun', () => {
  it('tallies per-app statuses and rolls them up across apps', () => {
    const a = makeJob('alpha', 'com.acme.alpha');
    const b = makeJob('beta', 'com.acme.beta');
    const outcomes: JobOutcome[] = [
      { job: a, report: report('com.acme.alpha', 'applied') },
      { job: b, report: report('com.acme.beta', 'failed') },
    ];

    const run = summarizeRun(outcomes);

    expect(run.summary).toEqual({ apps: 2, applied: 1, failed: 1, skipped: 0, planErrors: 0 });
    expect(run.apps[0]).toMatchObject({
      app: 'alpha',
      bundleId: 'com.acme.alpha',
      summary: { applied: 1, failed: 0, skipped: 0 },
    });
    expect(run.apps[1]).toMatchObject({
      app: 'beta',
      bundleId: 'com.acme.beta',
      summary: { applied: 0, failed: 1, skipped: 0 },
    });
  });

  it('counts a plan failure as a planError and omits actions/summary for that app', () => {
    const job = makeJob('alpha', 'com.acme.alpha');
    const run = summarizeRun([{ job, error: 'no ASC app record' }]);

    expect(run.summary).toEqual({ apps: 1, applied: 0, failed: 0, skipped: 0, planErrors: 1 });
    expect(run.apps[0]).toEqual({
      app: 'alpha',
      bundleId: 'com.acme.alpha',
      error: 'no ASC app record',
    });
    expect(run.apps[0]?.actions).toBeUndefined();
    expect(run.apps[0]?.summary).toBeUndefined();
  });

  it('reports an already-in-sync app with an empty action list and a zero summary', () => {
    const job = makeJob('alpha', 'com.acme.alpha');
    const run = summarizeRun([{ job, report: { bundleId: 'com.acme.alpha', actions: [] } }]);

    expect(run.summary).toEqual({ apps: 1, applied: 0, failed: 0, skipped: 0, planErrors: 0 });
    expect(run.apps[0]).toEqual({
      app: 'alpha',
      bundleId: 'com.acme.alpha',
      actions: [],
      summary: { applied: 0, failed: 0, skipped: 0 },
    });
  });
});

describe('mergeOutcomes', () => {
  it('overlays each plan with its apply-pass result, matched by job reference', () => {
    const a = makeJob('alpha', 'com.acme.alpha');
    const b = makeJob('beta', 'com.acme.beta');
    const plans: JobOutcome[] = [
      { job: a, report: report('com.acme.alpha', 'planned') },
      { job: b, report: report('com.acme.beta', 'planned') },
    ];
    const applied: JobOutcome[] = [{ job: a, report: report('com.acme.alpha', 'applied') }];

    const merged = mergeOutcomes(plans, applied);

    expect(merged[0]).toBe(applied[0]);
    expect(merged[1]).toBe(plans[1]);
  });

  it('keeps the plan outcome for an already-in-sync app with no apply entry', () => {
    const job = makeJob('alpha', 'com.acme.alpha');
    const plan: JobOutcome = { job, report: { bundleId: 'com.acme.alpha', actions: [] } };

    expect(mergeOutcomes([plan], [])).toEqual([plan]);
  });
});
