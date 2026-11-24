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

function describeLoggerASCIIRendering() {
  function printsStableStatusPieceAndReceiptLinesThroughTheTestService() {
    const captured = captureHumanLogger(false);

    captured.logger.box('Synced', ['3 apps', '0 errors']);
    captured.logger.shipped(['sampleapp 1.0.0 (42)', 'download 47.2 MB - on disk 61.3 MB']);
    captured.logger.notice('Upload to TestFlight', 'sampleapp 1.0.0 (build 42)');

    expect(captured.lines.join('')).toBe(
      'Synced\n' +
        '  3 apps\n' +
        '  0 errors\n' +
        'Shipped\n' +
        '  sampleapp 1.0.0 (42)\n' +
        '  download 47.2 MB - on disk 61.3 MB\n' +
        'Upload to TestFlight\n' +
        '  sampleapp 1.0.0 (build 42)\n',
    );
  }

  it(
    'prints stable status text and receipt lines through the test service',
    printsStableStatusPieceAndReceiptLinesThroughTheTestService,
  );

  function writesLabelsVerbatimAndExpandsARequestedGlossaryTopic() {
    const captured = captureHumanLogger(true);

    captured.logger.step('native project', 'using existing ios/', 'bundle-id');
    captured.logger.step('com.example.sampleapp', 'already in sync');

    const transcript = captured.lines.join('');

    expect(transcript).toContain('native project - using existing ios/');
    expect(transcript).toContain('com.example.sampleapp - already in sync');
    expect(transcript).not.toContain('Bundle ID');
  }

  it(
    'writes labels verbatim and expands a requested glossary topic',
    writesLabelsVerbatimAndExpandsARequestedGlossaryTopic,
  );

  function keepsChipFormattingPureAndFreeOfTerminalEscapes() {
    const captured = captureHumanLogger(false);
    const chipText = captured.logger.chip('29.7 MB');

    expect(chipText).toBe('29.7 MB');
    expect(captured.lines).toEqual([]);
  }

  it(
    'keeps chip formatting pure and free of terminal escapes',
    keepsChipFormattingPureAndFreeOfTerminalEscapes,
  );
}

describe('logger ASCII rendering', describeLoggerASCIIRendering);

function describeLoggerProgressEvents() {
  function printsStartDoneAndFailAsStatusLinesForPeople() {
    const captured = captureHumanLogger(false);

    captured.logger.progressStart('Archiving');
    captured.logger.progressDone('Archiving', 72000);
    captured.logger.progressFail('Archiving', 'Archiving failed');

    expect(captured.lines.join('')).toBe('Archiving\nArchiving - 1m 12s\nArchiving failed\n');
  }

  it(
    'prints start, done and fail as status lines for people',
    printsStartDoneAndFailAsStatusLinesForPeople,
  );
}

describe('logger progress events', describeLoggerProgressEvents);

function describePieceLoggerNDJSONEvents() {
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

  function turnsStepWarnNoteAndTipIntoOneJSONObjectPerLine() {
    const captured = captureJsonLogger();
    const logger = createLogger(true);

    logger.step('config', 'sampleapp - production', 'bundle-id');
    logger.step('upload');
    logger.warn('low disk');
    logger.note('using cache');
    logger.tip('pass --clean');

    function parseEventLine(eventLine: string) {
      return JSON.parse(eventLine);
    }

    expect(captured.eventLines.map(parseEventLine)).toEqual([
      { event: 'step', step: 'config', detail: 'sampleapp - production' },
      { event: 'step', step: 'upload' },
      { event: 'warn', message: 'low disk' },
      { event: 'note', message: 'using cache' },
      { event: 'note', message: 'Tip: pass --clean' },
    ]);
    expect(captured.humanLines).toEqual([]);
  }

  it(
    'turns step, warn, note and tip into one JSON object per line',
    turnsStepWarnNoteAndTipIntoOneJSONObjectPerLine,
  );

  function turnsProgressIntoStartDoneAndFailEvents() {
    const captured = captureJsonLogger();
    const logger = createLogger(false);

    logger.progressStart('Archiving');
    logger.progressDone('Archiving', 1500);
    logger.progressFail('Exporting', 'Exporting failed. Last lines: boom');

    function parseEventLine(eventLine: string) {
      return JSON.parse(eventLine);
    }

    expect(captured.eventLines.map(parseEventLine)).toEqual([
      { event: 'progress', label: 'Archiving', status: 'start' },
      { event: 'progress', label: 'Archiving', status: 'done', elapsedMs: 1500 },
      { event: 'progress', label: 'Exporting', status: 'fail' },
    ]);
  }

  it('turns progress into start, done and fail events', turnsProgressIntoStartDoneAndFailEvents);

  function turnsABoxIntoOneEventAndKeepsOtherHumanPieceOffTheEventStream() {
    const captured = captureJsonLogger();
    const logger = createLogger(false);

    logger.box('Synced', ['3 apps']);
    logger.line('plain');

    function parseEventLine(eventLine: string) {
      return JSON.parse(eventLine);
    }

    expect(captured.eventLines.map(parseEventLine)).toEqual([
      { event: 'box', title: 'Synced', lines: ['3 apps'] },
    ]);
    expect(captured.humanLines.join('')).toBe('plain\n');
  }

  it(
    'turns a box into one event and keeps other human text off the event stream',
    turnsABoxIntoOneEventAndKeepsOtherHumanPieceOffTheEventStream,
  );
}

describe('json logger NDJSON events', describePieceLoggerNDJSONEvents);

function describeSecretRedaction() {
  function masksASecretAssignmentBeforeItReachesTheSink() {
    const captured = captureHumanLogger(false);

    captured.logger.warn('API_TOKEN=dummy-token-value');

    expect(captured.lines.join('')).toBe('API_TOKEN=***\n');
    expect(captured.lines.join('')).not.toContain('dummy-token-value');
  }

  it(
    'masks a secret assignment before it reaches the sink',
    masksASecretAssignmentBeforeItReachesTheSink,
  );
}

describe('logger redaction', describeSecretRedaction);
