import { describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import {
  createLogger,
  type Logger,
  makeLaunchLoggerJsonTest,
  makeLaunchLoggerTest,
} from './logger.js';

describe('logger ASCII rendering', () => {
  it('prints stable status text and receipt lines through the test service', async () => {
    const terminalWrites: string[] = [];
    const loggingProgram = Effect.gen(function* () {
      const logger = yield* createLogger(false);
      yield* logger.box('Synced', ['3 apps', '0 errors']);
      yield* logger.shipped(['sampleapp 1.0.0 (42)', 'download 47.2 MB - on disk 61.3 MB']);
      yield* logger.notice('Upload to TestFlight', 'sampleapp 1.0.0 (build 42)');
    }).pipe(Effect.provide(makeLaunchLoggerTest(terminalWrites)));

    await Effect.runPromise(loggingProgram);

    expect(terminalWrites.join('')).toBe(
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

  it('writes labels verbatim and expands a requested glossary topic', async () => {
    const terminalWrites: string[] = [];
    const loggingProgram = Effect.gen(function* () {
      const logger = yield* createLogger(true);
      yield* logger.step('native project', 'using existing ios/', 'bundle-id');
      yield* logger.step('com.example.sampleapp', 'already in sync');
    }).pipe(Effect.provide(makeLaunchLoggerTest(terminalWrites)));

    await Effect.runPromise(loggingProgram);

    const transcript = terminalWrites.join('');
    expect(transcript).toContain('[RUN] native project - using existing ios/');
    expect(transcript).toContain('[RUN] com.example.sampleapp - already in sync');
    expect(transcript).toContain('Bundle ID');
  });

  it('keeps chip formatting pure and free of terminal escapes', () => {
    const terminalWrites: string[] = [];
    const chipText = Effect.runSync(
      createLogger(false).pipe(
        Effect.map((logger) => logger.chip('29.7 MB')),
        Effect.provide(makeLaunchLoggerTest(terminalWrites)),
      ),
    );

    expect(chipText).toBe('29.7 MB');
    expect(terminalWrites).toEqual([]);
  });
});

describe('logger progress events', () => {
  it('prints start, done and fail as status lines for people', async () => {
    const terminalWrites: string[] = [];
    const loggingProgram = Effect.gen(function* () {
      const logger = yield* createLogger(false);
      yield* logger.progressStart('Archiving');
      yield* logger.progressDone('Archiving', 72000);
      yield* logger.progressFail('Archiving', 'Archiving failed');
    }).pipe(Effect.provide(makeLaunchLoggerTest(terminalWrites)));

    await Effect.runPromise(loggingProgram);

    expect(terminalWrites.join('')).toBe(
      '[RUN] Archiving\n[OK] Archiving - 1m 12s\n[ERROR] Archiving failed\n',
    );
  });
});

describe('json logger NDJSON events', () => {
  const runJsonLogging = async (loggingProgram: Effect.Effect<void, unknown, Logger>) => {
    const eventLines: string[] = [];
    const humanLines: string[] = [];
    await Effect.runPromise(
      loggingProgram.pipe(Effect.provide(makeLaunchLoggerJsonTest(eventLines, humanLines))),
    );
    return { eventLines, humanLines };
  };

  it('turns step, warn, note and tip into one JSON object per line', async () => {
    const { eventLines, humanLines } = await runJsonLogging(
      Effect.gen(function* () {
        const logger = yield* createLogger(true);
        yield* logger.step('config', 'sampleapp - production', 'bundle-id');
        yield* logger.step('upload');
        yield* logger.warn('low disk');
        yield* logger.note('using cache');
        yield* logger.tip('pass --clean');
      }),
    );

    expect(eventLines.map((eventLine) => JSON.parse(eventLine))).toEqual([
      { event: 'step', step: 'config', detail: 'sampleapp - production' },
      { event: 'step', step: 'upload' },
      { event: 'warn', message: 'low disk' },
      { event: 'note', message: 'using cache' },
      { event: 'note', message: 'Tip: pass --clean' },
    ]);
    expect(humanLines).toEqual([]);
  });

  it('turns progress into start, done and fail events', async () => {
    const { eventLines } = await runJsonLogging(
      Effect.gen(function* () {
        const logger = yield* createLogger(false);
        yield* logger.progressStart('Archiving');
        yield* logger.progressDone('Archiving', 1500);
        yield* logger.progressFail('Exporting', 'Exporting failed. Last lines: boom');
      }),
    );

    expect(eventLines.map((eventLine) => JSON.parse(eventLine))).toEqual([
      { event: 'progress', label: 'Archiving', status: 'start' },
      { event: 'progress', label: 'Archiving', status: 'done', elapsedMs: 1500 },
      { event: 'progress', label: 'Exporting', status: 'fail' },
    ]);
  });

  it('keeps receipts and other human text off the event stream', async () => {
    const { eventLines, humanLines } = await runJsonLogging(
      Effect.gen(function* () {
        const logger = yield* createLogger(false);
        yield* logger.box('Synced', ['3 apps']);
        yield* logger.line('plain');
      }),
    );

    expect(eventLines).toEqual([]);
    expect(humanLines.join('')).toBe('[OK] Synced\n  3 apps\nplain\n');
  });
});
