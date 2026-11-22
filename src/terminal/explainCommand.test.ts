import { afterEach, describe, expect, it } from 'vitest';
import { resetLogger, useLoggerSink } from '../services/platform/logger.ts';
import { explainCommandProgram } from './explainCommand.ts';

afterEach(function resetExplainLogger() {
  resetLogger();
});

function captureExplainWrites(): string[] {
  const terminalWrites: string[] = [];
  useLoggerSink(function writeLine(text: string) {
    terminalWrites.push(text);
  });

  return terminalWrites;
}

describe('explainCommandProgram', () => {
  it('lists topics when none is requested', () => {
    const terminalWrites = captureExplainWrites();
    explainCommandProgram({});

    expect(terminalWrites.join('')).toContain('Topics:');
  });

  it('rejects an unknown topic with the known choices', () => {
    captureExplainWrites();
    let thrownCause: unknown = null;

    try {
      explainCommandProgram({ topic: 'magic' });
    } catch (cause) {
      thrownCause = cause;
    }

    expect(thrownCause).toMatchObject({
      _tag: 'ExplainCommandFailure',
      message: expect.stringMatching(/Unknown topic "magic"/),
    });
  });
});
