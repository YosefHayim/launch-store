import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';
import { DoctorCommandInputSchema, renderDoctorCheckLines } from './command.js';

describe('DoctorCommandInputSchema', () => {
  it('decodes the Commander boundary with omitted selectors', () => {
    expect(
      Schema.decodeUnknownSync(DoctorCommandInputSchema)({
        fix: false,
        yes: false,
        json: true,
      }),
    ).toEqual({ fix: false, yes: false, json: true });
  });

  it('rejects explicit undefined exact optionals', () => {
    expect(() =>
      Schema.decodeUnknownSync(DoctorCommandInputSchema)({
        platform: undefined,
        fix: false,
        yes: false,
        json: false,
      }),
    ).toThrow();
  });
});

describe('renderDoctorCheckLines', () => {
  it('renders a failed check, hint, and detail with ASCII markers', () => {
    expect(
      renderDoctorCheckLines({
        status: 'fail',
        title: 'Xcode',
        hint: 'Install Xcode.',
        detail: 'missing xcodebuild\n  already indented',
      }),
    ).toEqual(['x Xcode  - Install Xcode.', '  missing xcodebuild', '  already indented']);
  });
});
