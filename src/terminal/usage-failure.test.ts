import { afterEach, describe, expect, test } from 'vitest';
import { resetLogger, useLoggerSink } from '../services/platform/logger.ts';
import { endWithUsageFailure, makeUsageFailure } from './usage-failure.ts';

afterEach(function resetUsageLogger() {
  resetLogger();
});

function describeEndWithUsageFailure() {
  const usageFailure = makeUsageFailure({ message: '--days is wrong.' });

  function end(isJson: boolean): { commandExit: unknown; lines: string[] } {
    const lines: string[] = [];

    useLoggerSink(function writeLine(text: string) {
      lines.push(text);
    });

    try {
      endWithUsageFailure(usageFailure, isJson);
    } catch (cause) {
      return { commandExit: cause, lines };
    }
  }

  function printsOneJSONObjectAndExits2WithPiece() {
    const { commandExit, lines } = end(true);

    expect(commandExit).toMatchObject({ _tag: 'CommandExit', exitCode: 2 });
    expect(lines).toHaveLength(1);

    const parsed = JSON.parse(lines[0] ?? '');

    expect(parsed).toEqual({ ok: false, error: '--days is wrong.' });
  }

  test('prints one JSON object and exits 2 with --json', printsOneJSONObjectAndExits2WithPiece);

  function printsTheMessageAsAnErrorLineAndExits2WithoutPiece() {
    const { commandExit, lines } = end(false);

    expect(commandExit).toMatchObject({ exitCode: 2, message: '--days is wrong.' });
    expect(lines.join('\n')).toContain('--days is wrong.');
  }

  test(
    'prints the message as an error line and exits 2 without --json',
    printsTheMessageAsAnErrorLineAndExits2WithoutPiece,
  );
}

describe('endWithUsageFailure', describeEndWithUsageFailure);
