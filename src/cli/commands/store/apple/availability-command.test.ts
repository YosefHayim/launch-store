import { describe, expect, it } from 'vitest';
import {
  availabilityConfirmationMessage,
  AvailabilityCommandInputSchema,
  renderAvailabilityAction,
} from './availability-command.ts';
function describeAvailabilityCommandPieceSchema() {
  function decodesRequiredDefaultsAndRejectsExplicitUndefinedSelectors() {
    const availabilityCommandSchema = AvailabilityCommandInputSchema({
      config: 'availability.config.json',
      dryRun: true,
      yes: false,
    });

    expect(availabilityCommandSchema).toEqual({
      config: 'availability.config.json',
      dryRun: true,
      yes: false,
    });

    function callAvailabilityCommandPieceSchema() {
      return AvailabilityCommandInputSchema({
        app: undefined,
        config: 'availability.config.json',
        dryRun: false,
        yes: true,
      });
    }

    expect(callAvailabilityCommandPieceSchema).toThrow();
  }

  it(
    'decodes required defaults and rejects explicit undefined selectors',
    decodesRequiredDefaultsAndRejectsExplicitUndefinedSelectors,
  );
}

describe('AvailabilityCommandInputSchema', describeAvailabilityCommandPieceSchema);
function describeAvailabilityRendering() {
  function usesASCIIMarkersForAdditiveDestructiveAndFailedActions() {
    const availabilityAction = renderAvailabilityAction({
      description: 'set store availability -> 3 territories',
      destructive: false,
      status: 'planned',
    });

    expect(availabilityAction).toBe('+ set store availability -> 3 territories');
    expect(
      renderAvailabilityAction({
        description: 'set store availability -> 2 territories - -1 (FRA)',
        destructive: true,
        status: 'planned',
      }),
    ).toBe('! set store availability -> 2 territories - -1 (FRA)');
    expect(
      renderAvailabilityAction({
        description: 'set store availability -> 3 territories',
        destructive: false,
        status: 'failed',
        error: 'territory XYZ not eligible',
      }),
    ).toBe('x set store availability -> 3 territories - territory XYZ not eligible');
  }

  it(
    'uses ASCII markers for additive, destructive, and failed actions',
    usesASCIIMarkersForAdditiveDestructiveAndFailedActions,
  );

  function warnsExplicitlyBeforeRemovingTerritories() {
    expect(
      availabilityConfirmationMessage({
        description: 'remove FRA',
        destructive: true,
        status: 'planned',
      }),
    ).toMatch(/removes the app from sale/);
    expect(availabilityConfirmationMessage(undefined)).toBe('Apply the new store availability?');
  }

  it('warns explicitly before removing territories', warnsExplicitlyBeforeRemovingTerritories);
}

describe('availability rendering', describeAvailabilityRendering);
