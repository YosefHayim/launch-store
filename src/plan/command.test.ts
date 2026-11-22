import { describe, expect, it } from 'vitest';
import type { PlannedAction } from '../types/reconcile.js';
import type { SurfacePlanner } from '../types/plan.js';
import {
  additiveNote,
  decodePlanCommandInput,
  isPlanCommandFailure,
  planGlyph,
  selectPlanPlanners,
} from './command.js';

const plannedAction = (actionFields: Partial<PlannedAction> = {}): PlannedAction => ({
  description: 'create in-app purchase com.acme.coins',
  destructive: false,
  status: 'planned',
  ...actionFields,
});

const fakePlanner = (surfaceId: string): SurfacePlanner => ({
  id: surfaceId,
  store: 'appstore',
  plan: () =>
    Promise.resolve({
      surface: surfaceId,
      store: 'appstore',
      state: 'omitted',
    }),
});

describe('decodePlanCommandInput', () => {
  it('decodes plan and drift inputs with exact optional selectors', () => {
    expect(
      decodePlanCommandInput({
        operation: 'plan',
        check: false,
        json: true,
      }),
    ).toEqual({ operation: 'plan', check: false, json: true });
    expect(() =>
      decodePlanCommandInput({
        operation: 'drift',
        surface: undefined,
        check: true,
        json: false,
      }),
    ).toThrow();
  });
});

describe('planGlyph', () => {
  it('uses ASCII markers for additions, updates, removals, and skips', () => {
    expect(planGlyph(plannedAction())).toBe('+');
    expect(planGlyph(plannedAction({ description: 'update listing name none->Acme' }))).toBe('~');
    expect(planGlyph(plannedAction({ destructive: true }))).toBe('-');
    expect(planGlyph(plannedAction({ status: 'skipped' }))).toBe('-');
  });
});

describe('additiveNote', () => {
  it('names the surface and states the one-way caveat', () => {
    const note = additiveNote('wallet');
    expect(note).toContain('wallet');
    expect(note).toMatch(/additive/);
    expect(note).toMatch(/portal-side/);
  });
});

describe('selectPlanPlanners', () => {
  it('returns every registered planner when no surface is selected', async () => {
    const registered = [fakePlanner('catalog'), fakePlanner('listing')];
    const selected = selectPlanPlanners(registered, undefined);
    expect(selected.map((planner) => planner.id)).toEqual(['catalog', 'listing']);
  });

  it('narrows to one planner by surface id', async () => {
    const registered = [fakePlanner('catalog'), fakePlanner('listing')];
    const selected = selectPlanPlanners(registered, 'listing');
    expect(selected.map((planner) => planner.id)).toEqual(['listing']);
  });

  it('fails with available surfaces when the id is unknown', async () => {
    const registered = [fakePlanner('catalog')];
    let failure: unknown = null;

    try {
      selectPlanPlanners(registered, 'wallet');
    } catch (cause) {
      failure = cause;
    }

    if (isPlanCommandFailure(failure)) {
      expect(failure._tag).toBe('PlanCommandFailure');
      expect(failure.operation).toBe('select plan surface');
      expect(failure.message).toContain('wallet');
      expect(failure.message).toContain('catalog');
      return;
    }

    throw new Error('expected a plan command failure');
  });
});
