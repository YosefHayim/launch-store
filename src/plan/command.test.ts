import { describe, expect, it } from 'vitest';
import type { PlannedAction } from '../types/reconcile.ts';
import type { SurfacePlanner } from '../types/plan.ts';
import {
  additiveNote,
  decodePlanCommandInput,
  isPlanCommandFailure,
  planGlyph,
  selectPlanPlanners,
} from './command.ts';

function plannedAction(actionFields: Partial<PlannedAction> = {}): PlannedAction {
  return {
    description: 'create in-app purchase com.acme.coins',
    destructive: false,
    status: 'planned',
    ...actionFields,
  };
}

function fakePlanner(surfaceId: string): SurfacePlanner {
  return {
    id: surfaceId,
    store: 'appstore',
    plan() {
      return Promise.resolve({
        surface: surfaceId,
        store: 'appstore',
        state: 'omitted',
      });
    },
  };
}
function describeDecodePlanCommandPiece() {
  function decodesPlanAndDriftInputsWithExactOptionalSelectors() {
    const decodePlanCommand = decodePlanCommandInput({
      operation: 'plan',
      check: false,
      json: true,
    });
    expect(decodePlanCommand).toEqual({ operation: 'plan', check: false, json: true });
    function callDecodePlanCommandPiece() {
      return decodePlanCommandInput({
        operation: 'drift',
        surface: undefined,
        check: true,
        json: false,
      });
    }

    expect(callDecodePlanCommandPiece).toThrow();
  }

  it(
    'decodes plan and drift inputs with exact optional selectors',
    decodesPlanAndDriftInputsWithExactOptionalSelectors,
  );
}

describe('decodePlanCommandInput', describeDecodePlanCommandPiece);
function describePlanGlyph() {
  function usesASCIIMarkersForAdditionsUpdatesRemovalsAndSkips() {
    const glyph = planGlyph(plannedAction());
    expect(glyph).toBe('+');
    expect(planGlyph(plannedAction({ description: 'update listing name none->Acme' }))).toBe('~');
    expect(planGlyph(plannedAction({ destructive: true }))).toBe('-');
    expect(planGlyph(plannedAction({ status: 'skipped' }))).toBe('-');
  }

  it(
    'uses ASCII markers for additions, updates, removals, and skips',
    usesASCIIMarkersForAdditionsUpdatesRemovalsAndSkips,
  );
}

describe('planGlyph', describePlanGlyph);
function describeAdditiveNote() {
  function namesTheSurfaceAndStatesTheOneWayCaveat() {
    const note = additiveNote('wallet');
    expect(note).toContain('wallet');
    expect(note).toMatch(/additive/);
    expect(note).toMatch(/portal-side/);
  }

  it('names the surface and states the one-way caveat', namesTheSurfaceAndStatesTheOneWayCaveat);
}

describe('additiveNote', describeAdditiveNote);

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
  async function failsWithAvailableSurfacesWhenTheIdIsUnknown() {
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
  }

  it(
    'fails with available surfaces when the id is unknown',
    failsWithAvailableSurfacesWhenTheIdIsUnknown,
  );
});
