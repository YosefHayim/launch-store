import { describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { createLogger, makeLaunchLoggerTest } from './logger.js';

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
