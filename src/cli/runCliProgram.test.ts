import { afterEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import { completeCommand, makeCommandExit } from '../core/terminal/commandExit.js';
import { makeBuildCommandExecutionError } from '../core/build/buildCommandProgram.js';
import { createLogger } from '../core/services/logger.js';
import { LaunchPrompt } from '../core/services/prompt.js';
import { setJsonOutput } from '../core/services/jsonOutputMode.js';
import { runJsonCliProgram } from './runCliProgram.js';

const SUMMARY = { command: 'build', platform: 'ios', dryRun: true, profile: 'production' } as const;

const captureStdoutLines = () => {
  const writtenText: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk, ...writeArguments) => {
    writtenText.push(String(chunk));
    const writeDone = writeArguments.find((writeArgument) => typeof writeArgument === 'function');
    writeDone?.();
    return true;
  });
  const readEvents = () =>
    writtenText
      .join('')
      .split('\n')
      .filter((outputLine) => outputLine.length > 0)
      .map((outputLine) => JSON.parse(outputLine));
  return readEvents;
};

afterEach(() => {
  vi.restoreAllMocks();
  setJsonOutput(false);
});

describe('runJsonCliProgram - the final result line', () => {
  it('streams events and ends with an ok result carrying the run summary', async () => {
    const readEvents = captureStdoutLines();
    await runJsonCliProgram(
      SUMMARY,
      Effect.gen(function* () {
        const logger = yield* createLogger(false);
        yield* logger.step('config', 'sampleapp');
      }),
    );
    expect(readEvents()).toEqual([
      { event: 'step', step: 'config', detail: 'sampleapp' },
      { event: 'result', ok: true, ...SUMMARY },
    ]);
  });

  it('ends a tagged failure with its readable message and rejects for a non-zero exit', async () => {
    const readEvents = captureStdoutLines();
    const failedRun = runJsonCliProgram(
      SUMMARY,
      Effect.fail(
        makeBuildCommandExecutionError({
          message: 'No build engine named "missing-engine".',
          cause: { _tag: 'Hidden' },
        }),
      ),
    );
    await expect(failedRun).rejects.toThrow();
    expect(readEvents()).toEqual([
      {
        event: 'result',
        ok: false,
        ...SUMMARY,
        message: 'No build engine named "missing-engine".',
      },
    ]);
  });

  it('reports a requested exit code in the failure message', async () => {
    const readEvents = captureStdoutLines();
    await expect(
      runJsonCliProgram(SUMMARY, Effect.fail(makeCommandExit({ exitCode: 3 }))),
    ).rejects.toThrow();
    expect(readEvents()).toEqual([
      { event: 'result', ok: false, ...SUMMARY, message: 'The command ended with exit code 3.' },
    ]);
  });

  it('reports the reason a command gave for its exit code', async () => {
    const readEvents = captureStdoutLines();
    await expect(
      runJsonCliProgram(SUMMARY, completeCommand(1, 'No App Store Connect app record yet.')),
    ).rejects.toThrow();
    expect(readEvents()).toEqual([
      { event: 'result', ok: false, ...SUMMARY, message: 'No App Store Connect app record yet.' },
    ]);
  });

  it('turns a prompt into a failure that names the flag to pass', async () => {
    const readEvents = captureStdoutLines();
    await expect(
      runJsonCliProgram(
        SUMMARY,
        Effect.gen(function* () {
          const launchPrompt = yield* LaunchPrompt;
          yield* launchPrompt.confirm('Upload?');
        }),
      ),
    ).rejects.toThrow();
    const [resultEvent] = readEvents();
    expect(resultEvent.ok).toBe(false);
    expect(resultEvent.message).toContain('--yes');
  });
});
