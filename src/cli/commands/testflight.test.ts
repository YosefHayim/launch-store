import { describe, expect, it } from 'vitest';
import {
  parseFeedbackType,
  parseTestersCsv,
  renderBetaAction,
  renderFeedback,
} from './testflight.js';

describe('parseTestersCsv', () => {
  it('parses email,firstName,lastName rows and trims whitespace', () => {
    expect(parseTestersCsv('a@x.com, Dana , Lee\nb@x.com,Sam,Ng')).toEqual([
      { email: 'a@x.com', firstName: 'Dana', lastName: 'Lee' },
      { email: 'b@x.com', firstName: 'Sam', lastName: 'Ng' },
    ]);
  });

  it("skips a header row whose first cell isn't an email, plus blank lines", () => {
    const csv = 'email,first,last\n\na@x.com,Dana\n\n';
    expect(parseTestersCsv(csv)).toEqual([{ email: 'a@x.com', firstName: 'Dana' }]);
  });

  it('accepts a bare email with no name columns', () => {
    expect(parseTestersCsv('solo@x.com')).toEqual([{ email: 'solo@x.com' }]);
  });

  it('tolerates CRLF line endings', () => {
    expect(parseTestersCsv('a@x.com,Dana\r\nb@x.com,Sam\r\n')).toEqual([
      { email: 'a@x.com', firstName: 'Dana' },
      { email: 'b@x.com', firstName: 'Sam' },
    ]);
  });

  it('ignores rows without an @ (junk or partial lines)', () => {
    expect(parseTestersCsv('not-an-email\na@x.com')).toEqual([{ email: 'a@x.com' }]);
  });
});

describe('renderBetaAction', () => {
  it('marks a change with +, a skip with •', () => {
    expect(
      renderBetaAction({
        description: 'set "What to Test" (en-US)',
        destructive: false,
        status: 'planned',
      }),
    ).toBe('+ set "What to Test" (en-US)');
    expect(
      renderBetaAction({
        description: 'submit for Beta App Review: build already submitted (in review)',
        destructive: false,
        status: 'skipped',
      }),
    ).toBe('• submit for Beta App Review: build already submitted (in review)');
  });

  it("renders a failed action with ✗ and Apple's error detail", () => {
    expect(
      renderBetaAction({
        description: 'submit for Beta App Review',
        destructive: false,
        status: 'failed',
        error: 'build is still processing',
      }),
    ).toBe('✗ submit for Beta App Review — build is still processing');
  });
});

describe('parseFeedbackType', () => {
  it('returns undefined (both kinds) when no --type is given', () => {
    expect(parseFeedbackType(undefined)).toBeUndefined();
  });

  it('accepts crash/screenshot case-insensitively', () => {
    expect(parseFeedbackType('crash')).toBe('crash');
    expect(parseFeedbackType('SCREENSHOT')).toBe('screenshot');
  });

  it('trims surrounding whitespace before validating', () => {
    expect(parseFeedbackType('  crash  ')).toBe('crash');
  });

  it('rejects an unknown kind with an actionable message', () => {
    expect(() => parseFeedbackType('video')).toThrow(/--type must be one of/);
  });
});

describe('renderFeedback', () => {
  it('renders a crash with its meta line and comment, no screenshot lines', () => {
    const block = renderFeedback({
      id: 'fb-crash-1',
      kind: 'crash',
      createdDate: '2026-06-20T10:30:00Z',
      comment: 'froze on launch',
      email: 'tester@x.com',
      deviceModel: 'iPhone 15 Pro',
      osVersion: '17.5.1',
      buildVersion: '42',
    });
    expect(block).toContain('fb-crash-1  ✗ crash');
    expect(block).toContain('build 42  iPhone 15 Pro · iOS 17.5.1  tester@x.com  2026-06-20');
    expect(block).toContain('"froze on launch"');
    expect(block).not.toContain('http');
  });

  it('renders a screenshot with its attachment URLs', () => {
    const block = renderFeedback({
      id: 'fb-shot-1',
      kind: 'screenshot',
      buildVersion: '42',
      screenshots: [{ url: 'https://apple.example/a.png' }, { url: 'https://apple.example/b.png' }],
    });
    expect(block).toContain('fb-shot-1  ▣ screenshot');
    expect(block).toContain('https://apple.example/a.png');
    expect(block).toContain('https://apple.example/b.png');
  });

  it('strips terminal control sequences from tester-controllable fields', () => {
    const esc = String.fromCharCode(27); // ESC — start of an ANSI escape a tester could inject
    const block = renderFeedback({
      id: 'fb-1',
      kind: 'crash',
      comment: `${esc}[31mowned${esc}[0m`,
      deviceModel: `iPhone${esc}[2J`,
      email: `t${esc}ester@x.com`,
    });
    expect(block).not.toContain(esc); // the raw escape byte is gone
    expect(block).toContain('"[31mowned[0m"'); // visible text survives, only the control byte is removed
    expect(block).toContain('iPhone[2J');
    expect(block).toContain('tester@x.com');
  });
});
