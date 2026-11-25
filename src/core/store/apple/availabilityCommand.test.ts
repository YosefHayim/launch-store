import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';
import {
  availabilityConfirmationMessage,
  AvailabilityCommandInputSchema,
  renderAvailabilityAction,
} from './availabilityCommand.js';

describe('AvailabilityCommandInputSchema', () => {
  it('decodes required defaults and rejects explicit undefined selectors', () => {
    expect(
      Schema.decodeUnknownSync(AvailabilityCommandInputSchema)({
        config: 'availability.config.json',
        dryRun: true,
        yes: false,
      }),
    ).toEqual({ config: 'availability.config.json', dryRun: true, yes: false });
    expect(() =>
      Schema.decodeUnknownSync(AvailabilityCommandInputSchema)({
        app: undefined,
        config: 'availability.config.json',
        dryRun: false,
        yes: true,
      }),
    ).toThrow();
  });
});

describe('availability rendering', () => {
  it('uses ASCII markers for additive, destructive, and failed actions', () => {
    expect(
      renderAvailabilityAction({
        description: 'set store availability -> 3 territories',
        destructive: false,
        status: 'planned',
      }),
    ).toBe('+ set store availability -> 3 territories');
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
  });

  it('warns explicitly before removing territories', () => {
    expect(
      availabilityConfirmationMessage({
        description: 'remove FRA',
        destructive: true,
        status: 'planned',
      }),
    ).toMatch(/removes the app from sale/);
    expect(availabilityConfirmationMessage(undefined)).toBe('Apply the new store availability?');
  });
});
