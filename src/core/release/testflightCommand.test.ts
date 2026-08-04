import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';
import {
  parseFeedbackType,
  parseTestersCsv,
  renderBetaAction,
  renderFeedback,
  TestflightCommandInputSchema,
} from './testflightCommand.js';

describe('parseTestersCsv', () => {
  it('parses and trims named tester rows', () => {
    expect(parseTestersCsv('a@x.com, Dana , Lee\nb@x.com,Sam,Ng')).toEqual([
      { email: 'a@x.com', firstName: 'Dana', lastName: 'Lee' },
      { email: 'b@x.com', firstName: 'Sam', lastName: 'Ng' },
    ]);
  });

  it('skips headers, blank lines, and malformed rows', () => {
    expect(parseTestersCsv('email,first,last\n\nnot-an-email\na@x.com,Dana\n')).toEqual([
      { email: 'a@x.com', firstName: 'Dana' },
    ]);
  });

  it('accepts bare emails and CRLF input', () => {
    expect(parseTestersCsv('a@x.com\r\nb@x.com,Sam\r\n')).toEqual([
      { email: 'a@x.com' },
      { email: 'b@x.com', firstName: 'Sam' },
    ]);
  });
});

describe('renderBetaAction', () => {
  it('uses ASCII markers for changes, skips, and failures', () => {
    expect(
      renderBetaAction({
        description: 'set "What to Test" (en-US)',
        destructive: false,
        status: 'planned',
      }),
    ).toBe('+ set "What to Test" (en-US)');
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
  });
});

describe('parseFeedbackType', () => {
  it('accepts an omitted or case-insensitive supported type', async () => {
    await expect(Effect.runPromise(parseFeedbackType(undefined))).resolves.toBeUndefined();
    await expect(Effect.runPromise(parseFeedbackType('  CRASH  '))).resolves.toBe('crash');
    await expect(Effect.runPromise(parseFeedbackType('SCREENSHOT'))).resolves.toBe('screenshot');
  });

  it('rejects an unknown feedback type', async () => {
    await expect(Effect.runPromise(parseFeedbackType('video'))).rejects.toThrow(
      /--type must be one of/,
    );
  });
});

describe('renderFeedback', () => {
  it('renders a crash with metadata and comment', () => {
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
  });

  it('renders screenshot attachment URLs with an ASCII label', () => {
    const renderedFeedback = renderFeedback({
      id: 'fb-shot-1',
      kind: 'screenshot',
      buildVersion: '42',
      screenshots: [{ url: 'https://apple.example/a.png' }, { url: 'https://apple.example/b.png' }],
    });
    expect(renderedFeedback).toContain('fb-shot-1  [SCREENSHOT]');
    expect(renderedFeedback).toContain('https://apple.example/a.png');
    expect(renderedFeedback).toContain('https://apple.example/b.png');
  });

  it('strips terminal control bytes from tester-authored fields', () => {
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
  });
});

describe('TestflightCommandInputSchema', () => {
  it('decodes a complete add-testers boundary', () => {
    expect(
      Schema.decodeUnknownSync(TestflightCommandInputSchema)({
        operation: 'add',
        emails: ['tester@example.com'],
        dryRun: true,
        yes: false,
      }),
    ).toEqual({
      operation: 'add',
      emails: ['tester@example.com'],
      dryRun: true,
      yes: false,
    });
  });

  it('rejects an unknown operation', () => {
    expect(() =>
      Schema.decodeUnknownSync(TestflightCommandInputSchema)({ operation: 'erase' }),
    ).toThrow();
  });
});
