import { afterEach, describe, expect, it } from 'vitest';
import { createLogger, resetLogger, useJsonHumanWriter, useLoggerSink } from './logger.ts';

afterEach(function resetLoggerSink() {
  resetLogger();
});

function captureHumanLogger(explain: boolean): {
  logger: ReturnType<typeof createLogger>;
  lines: string[];
} {
  const lines: string[] = [];
  useLoggerSink(function writeLine(text: string) {
    lines.push(text);
  });

  return { logger: createLogger(explain), lines };
}

describe('logger ASCII rendering', () => {
  it('prints stable status text and receipt lines through the test service', () => {
    const captured = captureHumanLogger(false);
    captured.logger.box('Synced', ['3 apps', '0 errors']);
    captured.logger.shipped(['sampleapp 1.0.0 (42)', 'download 47.2 MB - on disk 61.3 MB']);
    captured.logger.notice('Upload to TestFlight', 'sampleapp 1.0.0 (build 42)');

    expect(captured.lines.join('')).toBe(
      '[OK] Synced\n' +
        '  3 apps\n' +
        '  0 errors\n' +
        '[OK] Shipped\n' +
        '  sampleapp 1.0.0 (42)\n' +
        '  download 47.2 MB - on disk 61.3 MB\n' +
        '[RUN] Upload to TestFlight\n' +
        '  sampleapp 1.0.0 (build 42)\n',
    );
  });

  it('writes labels verbatim and expands a requested glossary topic', () => {
    const captured = captureHumanLogger(true);
    captured.logger.step('native project', 'using existing ios/', 'bundle-id');
    captured.logger.step('com.example.sampleapp', 'already in sync');

    const transcript = captured.lines.join('');
    expect(transcript).toContain('[RUN] native project - using existing ios/');
    expect(transcript).toContain('[RUN] com.example.sampleapp - already in sync');
    expect(transcript).toContain('Bundle ID');
  });

  it('keeps chip formatting pure and free of terminal escapes', () => {
    const captured = captureHumanLogger(false);
    const chipText = captured.logger.chip('29.7 MB');

    expect(chipText).toBe('29.7 MB');
    expect(captured.lines).toEqual([]);
  });
});

describe('logger progress events', () => {
  it('prints start, done and fail as status lines for people', () => {
    const captured = captureHumanLogger(false);
    captured.logger.progressStart('Archiving');
    captured.logger.progressDone('Archiving', 72000);
    captured.logger.progressFail('Archiving', 'Archiving failed');

    expect(captured.lines.join('')).toBe(
      '[RUN] Archiving\n[OK] Archiving - 1m 12s\n[ERROR] Archiving failed\n',
    );
  });
});

describe('json logger NDJSON events', () => {
  function captureJsonLogger(): { eventLines: string[]; humanLines: string[] } {
    const eventLines: string[] = [];
    const humanLines: string[] = [];
    useLoggerSink(function writeEvent(text: string) {
      eventLines.push(text);
    });
    useJsonHumanWriter(function writeHuman(text: string) {
      humanLines.push(text);
    });

    return { eventLines, humanLines };
  }

  it('turns step, warn, note and tip into one JSON object per line', () => {
    const captured = captureJsonLogger();
    const logger = createLogger(true);
    logger.step('config', 'sampleapp - production', 'bundle-id');
    logger.step('upload');
    logger.warn('low disk');
    logger.note('using cache');
    logger.tip('pass --clean');

    expect(captured.eventLines.map((eventLine) => JSON.parse(eventLine))).toEqual([
      { event: 'step', step: 'config', detail: 'sampleapp - production' },
      { event: 'step', step: 'upload' },
      { event: 'warn', message: 'low disk' },
      { event: 'note', message: 'using cache' },
      { event: 'note', message: 'Tip: pass --clean' },
    ]);
    expect(captured.humanLines).toEqual([]);
  });

  it('turns progress into start, done and fail events', () => {
    const captured = captureJsonLogger();
    const logger = createLogger(false);
    logger.progressStart('Archiving');
    logger.progressDone('Archiving', 1500);
    logger.progressFail('Exporting', 'Exporting failed. Last lines: boom');

    expect(captured.eventLines.map((eventLine) => JSON.parse(eventLine))).toEqual([
      { event: 'progress', label: 'Archiving', status: 'start' },
      { event: 'progress', label: 'Archiving', status: 'done', elapsedMs: 1500 },
      { event: 'progress', label: 'Exporting', status: 'fail' },
    ]);
  });

  it('turns a box into one event and keeps other human text off the event stream', () => {
    const captured = captureJsonLogger();
    const logger = createLogger(false);
    logger.box('Synced', ['3 apps']);
    logger.line('plain');

    expect(captured.eventLines.map((eventLine) => JSON.parse(eventLine))).toEqual([
      { event: 'box', title: 'Synced', lines: ['3 apps'] },
    ]);
    expect(captured.humanLines.join('')).toBe('plain\n');
  });
});
