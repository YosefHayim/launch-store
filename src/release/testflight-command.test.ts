import { describe, expect, it } from 'vitest';
import { parseTestersCsv } from './testflight-add-testers.ts';
import { TestflightCommandInputSchema } from './testflight-command.ts';
import { renderBetaAction } from './testflight-release.ts';
import { parseFeedbackType, renderFeedback } from './testflight-show-feedback.ts';
function describeParseTestersCsv() {
  function parsesAndTrimsNamedTesterRows() {
    const testersCsv = parseTestersCsv('a@x.com, Dana , Lee\nb@x.com,Sam,Ng');

    expect(testersCsv).toEqual([
      { email: 'a@x.com', firstName: 'Dana', lastName: 'Lee' },
      { email: 'b@x.com', firstName: 'Sam', lastName: 'Ng' },
    ]);
  }

  it('parses and trims named tester rows', parsesAndTrimsNamedTesterRows);

  function skipsHeadersBlankLinesAndMalformedRows() {
    const testersCsv = parseTestersCsv('email,first,last\n\nnot-an-email\na@x.com,Dana\n');
    expect(testersCsv).toEqual([{ email: 'a@x.com', firstName: 'Dana' }]);
  }

  it('skips headers, blank lines, and malformed rows', skipsHeadersBlankLinesAndMalformedRows);

  function acceptsBareEmailsAndCRLFPiece() {
    const testersCsv = parseTestersCsv('a@x.com\r\nb@x.com,Sam\r\n');
    expect(testersCsv).toEqual([{ email: 'a@x.com' }, { email: 'b@x.com', firstName: 'Sam' }]);
  }

  it('accepts bare emails and CRLF input', acceptsBareEmailsAndCRLFPiece);

  function keepsLastNameOnlyRowsAndDropsBlankNameCells() {
    const testersCsv = parseTestersCsv('a@x.com,,Ng\nb@x.com, ,Lee');

    expect(testersCsv).toEqual([
      { email: 'a@x.com', lastName: 'Ng' },
      { email: 'b@x.com', lastName: 'Lee' },
    ]);
  }

  it(
    'keeps last-name-only rows and drops blank name cells',
    keepsLastNameOnlyRowsAndDropsBlankNameCells,
  );
}

describe('parseTestersCsv', describeParseTestersCsv);
function describeRenderBetaAction() {
  function usesASCIIMarkersForPlannedAppliedSkippedAndFailedActions() {
    const betaAction = renderBetaAction({
      description: 'set "What to Test" (en-US)',
      destructive: false,
      status: 'planned',
    });

    expect(betaAction).toBe('+ set "What to Test" (en-US)');
    expect(
      renderBetaAction({
        description: 'set "What to Test" (en-US)',
        destructive: false,
        status: 'applied',
      }),
    ).toBe('[OK] set "What to Test" (en-US)');
    expect(
      renderBetaAction({
        description: 'already submitted',
        destructive: false,
        status: 'skipped',
      }),
    ).toBe('- already submitted');
    expect(
      renderBetaAction({
        description: 'submit for Beta App Review',
        destructive: false,
        status: 'failed',
        error: 'build is still processing',
      }),
    ).toBe('x submit for Beta App Review - build is still processing');
    expect(
      renderBetaAction({
        description: 'submit for Beta App Review',
        destructive: false,
        status: 'failed',
      }),
    ).toBe('x submit for Beta App Review - failed');
  }

  it(
    'uses ASCII markers for planned, applied, skipped, and failed actions',
    usesASCIIMarkersForPlannedAppliedSkippedAndFailedActions,
  );
}

describe('renderBetaAction', describeRenderBetaAction);
function describeParseFeedbackType() {
  async function acceptsAnOmittedOrCaseInsensitiveSupportedType() {
    const feedbackType = parseFeedbackType(undefined);
    await expect(feedbackType).resolves.toBeUndefined();
    await expect(parseFeedbackType('  CRASH  ')).resolves.toBe('crash');
    await expect(parseFeedbackType('SCREENSHOT')).resolves.toBe('screenshot');
  }

  it(
    'accepts an omitted or case-insensitive supported type',
    acceptsAnOmittedOrCaseInsensitiveSupportedType,
  );

  async function rejectsAnUnknownFeedbackType() {
    const feedbackType = parseFeedbackType('video');
    await expect(feedbackType).rejects.toMatchObject({
      message: expect.stringMatching(/--type must be one of/),
    });
  }

  it('rejects an unknown feedback type', rejectsAnUnknownFeedbackType);
}

describe('parseFeedbackType', describeParseFeedbackType);
function describeRenderFeedback() {
  function rendersACrashWithMetadataAndComment() {
    const renderedFeedback = renderFeedback({
      id: 'fb-crash-1',
      kind: 'crash',
      createdDate: '2026-06-20T10:30:00Z',
      comment: 'froze on launch',
      email: 'tester@x.com',
      deviceModel: 'iPhone 15 Pro',
      osVersion: '17.5.1',
      buildVersion: '42',
    });

    expect(renderedFeedback).toContain('fb-crash-1  [ERROR] crash');
    expect(renderedFeedback).toContain(
      'build 42  iPhone 15 Pro - iOS 17.5.1  tester@x.com  2026-06-20',
    );
    expect(renderedFeedback).toContain('"froze on launch"');
    expect(renderedFeedback).not.toContain('http');
  }

  it('renders a crash with metadata and comment', rendersACrashWithMetadataAndComment);

  function rendersScreenshotAttachmentURLsWithAnASCIILabel() {
    const renderedFeedback = renderFeedback({
      id: 'fb-shot-1',
      kind: 'screenshot',
      buildVersion: '42',
      screenshots: [{ url: 'https://apple.example/a.png' }, { url: 'https://apple.example/b.png' }],
    });

    expect(renderedFeedback).toContain('fb-shot-1  [SCREENSHOT]');
    expect(renderedFeedback).toContain('https://apple.example/a.png');
    expect(renderedFeedback).toContain('https://apple.example/b.png');
  }

  it(
    'renders screenshot attachment URLs with an ASCII label',
    rendersScreenshotAttachmentURLsWithAnASCIILabel,
  );

  function stripsTerminalControlBytesFromTesterAuthoredFields() {
    const escapeCharacter = String.fromCharCode(27);
    const renderedFeedback = renderFeedback({
      id: 'fb-1',
      kind: 'crash',
      comment: `${escapeCharacter}[31mowned${escapeCharacter}[0m`,
      deviceModel: `iPhone${escapeCharacter}[2J`,
      email: `t${escapeCharacter}ester@x.com`,
    });

    expect(renderedFeedback).not.toContain(escapeCharacter);
    expect(renderedFeedback).toContain('"[31mowned[0m"');
    expect(renderedFeedback).toContain('iPhone[2J');
    expect(renderedFeedback).toContain('tester@x.com');
  }

  it(
    'strips terminal control bytes from tester-authored fields',
    stripsTerminalControlBytesFromTesterAuthoredFields,
  );
}

describe('renderFeedback', describeRenderFeedback);
function describeTestflightCommandPieceSchema() {
  function decodesACompleteAddTestersBoundary() {
    const testflightCommandSchema = TestflightCommandInputSchema({
      operation: 'add',
      emails: ['tester@example.com'],
      dryRun: true,
      yes: false,
    });

    expect(testflightCommandSchema).toEqual({
      operation: 'add',
      emails: ['tester@example.com'],
      dryRun: true,
      yes: false,
    });
  }

  it('decodes a complete add-testers boundary', decodesACompleteAddTestersBoundary);

  function decodesReleaseRemoveAndFeedbackBoundaries() {
    const testflightCommandSchema = TestflightCommandInputSchema({
      operation: 'release',
      locale: 'en-US',
      config: 'testflight.config.json',
      review: true,
      dryRun: false,
      yes: true,
    });

    expect(testflightCommandSchema).toMatchObject({
      operation: 'release',
      review: true,
      yes: true,
    });
    expect(
      TestflightCommandInputSchema({
        operation: 'remove',
        emails: ['gone@example.com'],
        dryRun: false,
        yes: true,
      }),
    ).toMatchObject({ operation: 'remove', emails: ['gone@example.com'] });
    expect(
      TestflightCommandInputSchema({
        operation: 'feedback',
        json: true,
        type: 'crash',
      }),
    ).toMatchObject({ operation: 'feedback', json: true, type: 'crash' });
  }

  it('decodes release, remove, and feedback boundaries', decodesReleaseRemoveAndFeedbackBoundaries);

  function rejectsAnUnknownOperation() {
    expect(function decodeUnknownOperation() {
      TestflightCommandInputSchema({ operation: 'erase' });
    }).toThrow();
  }

  it('rejects an unknown operation', rejectsAnUnknownOperation);
}

describe('TestflightCommandInputSchema', describeTestflightCommandPieceSchema);
