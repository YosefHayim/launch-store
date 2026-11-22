import { afterEach, describe, expect, it, vi } from 'vitest';
import { completeCommand, makeCommandExit } from '../terminal/command-exit.ts';
import { makeBuildCommandExecutionError } from '../build/build-command-program.ts';
import { createLogger } from '../services/platform/logger.ts';
import { LaunchPrompt } from '../services/platform/prompt.ts';
import { setJsonOutput } from '../services/platform/json-output-mode.ts';
import { runJsonCliProgram } from './run-cli-program.ts';

const SUMMARY = { command: 'build', platform: 'ios', dryRun: true, profile: 'production' } as const;

const captureStdoutLines = () => {
  const writtenText: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk, ...writeArguments) => {
    const asString = String(chunk);
    writtenText.push(asString);
    const writeDone = writeArguments.find((writeArgument) => typeof writeArgument == 'function');
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
    async function sampleStep(): Promise<void> {
      const logger = createLogger(false);
      logger.step('config', 'sampleapp');
    }

    await runJsonCliProgram(SUMMARY, sampleStep);
    const events = readEvents();
    expect(events).toEqual([
      { event: 'step', step: 'config', detail: 'sampleapp' },
      { event: 'result', ok: true, ...SUMMARY },
    ]);
  });

  it('ends a tagged failure with its readable message and rejects for a non-zero exit', async () => {
    const readEvents = captureStdoutLines();
    async function failBuild(): Promise<void> {
      throw makeBuildCommandExecutionError({
        message: 'No build engine named "missing-engine".',
        cause: { _tag: 'Hidden' },
      });
    }

    const failedRun = runJsonCliProgram(SUMMARY, failBuild);
    await expect(failedRun).rejects.toThrow();
    const events = readEvents();
    expect(events).toEqual([
      {
        event: 'result',
        ok: false,
        ...SUMMARY,
        message: 'No build engine named "missing-engine".',
      },
    ]);
  });

  it('reports a requested exit code in the failure message', async () => {
    async function exitWithoutReason(): Promise<void> {
      throw makeCommandExit({ exitCode: 3 });
    }

    const readEvents = captureStdoutLines();
    const runCliProgram = runJsonCliProgram(SUMMARY, exitWithoutReason);
    await expect(runCliProgram).rejects.toThrow();
    const events = readEvents();
    expect(events).toEqual([
      { event: 'result', ok: false, ...SUMMARY, message: 'The command ended with exit code 3.' },
    ]);
  });

  it('reports the reason a command gave for its exit code', async () => {
    async function exitWithReason(): Promise<void> {
      completeCommand(1, 'No App Store Connect app record yet.');
    }

    const readEvents = captureStdoutLines();
    const runCliProgram = runJsonCliProgram(SUMMARY, exitWithReason);
    await expect(runCliProgram).rejects.toThrow();
    const events = readEvents();
    expect(events).toEqual([
      { event: 'result', ok: false, ...SUMMARY, message: 'No App Store Connect app record yet.' },
    ]);
  });

  it('turns a prompt into a failure that names the flag to pass', async () => {
    const readEvents = captureStdoutLines();
    async function confirmUpload(): Promise<boolean> {
      return LaunchPrompt.confirm('Upload?');
    }

    const runCliProgram = runJsonCliProgram(SUMMARY, confirmUpload);
    await expect(runCliProgram).rejects.toThrow();
    const [resultEvent] = readEvents();
    expect(resultEvent.ok).toBe(false);
    expect(resultEvent.message).toContain('--yes');
  });
});
