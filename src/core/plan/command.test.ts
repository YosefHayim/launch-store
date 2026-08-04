import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';
import type { PlannedAction } from '../types/reconcile.js';
import { additiveNote, PlanCommandInputSchema, planGlyph } from './command.js';

const plannedAction = (actionFields: Partial<PlannedAction> = {}): PlannedAction => ({
  description: 'create in-app purchase com.acme.coins',
  destructive: false,
  status: 'planned',
  ...actionFields,
});

describe('PlanCommandInputSchema', () => {
  it('decodes plan and drift inputs with exact optional selectors', () => {
    expect(
      Schema.decodeUnknownSync(PlanCommandInputSchema)({
        operation: 'plan',
        check: false,
        json: true,
      }),
    ).toEqual({ operation: 'plan', check: false, json: true });
    expect(() =>
      Schema.decodeUnknownSync(PlanCommandInputSchema)({
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
