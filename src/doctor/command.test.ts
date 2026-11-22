import { describe, expect, it } from 'vitest';
import { DoctorCommandInputSchema, renderDoctorCheckLines } from './command.ts';

describe('DoctorCommandInputSchema', function describeDoctorCommandInput() {
  it('decodes the Commander boundary with omitted selectors', function decodesOmittedSelectors() {
    const doctorCommandSchema = DoctorCommandInputSchema({
      fix: false,
      yes: false,
      json: true,
    });
    expect(doctorCommandSchema).toEqual({ fix: false, yes: false, json: true });
  });

  it('rejects explicit undefined exact optionals', function rejectsUndefinedPlatform() {
    expect(function readUndefinedPlatform() {
      DoctorCommandInputSchema({
        platform: undefined,
        fix: false,
        yes: false,
        json: false,
      });
    }).toThrow();
  });
});

describe('renderDoctorCheckLines', function describeRenderedDoctorChecks() {
  it('renders a failed check, hint, and detail with ASCII markers', function rendersFailedCheck() {
    const doctorCheckLines = renderDoctorCheckLines({
      status: 'fail',
      title: 'Xcode',
      hint: 'Install Xcode.',
      detail: 'missing xcodebuild\n  already indented',
    });
    expect(doctorCheckLines).toEqual([
      'x Xcode  - Install Xcode.',
      '  missing xcodebuild',
      '  already indented',
    ]);
  });
});
