import { afterEach, describe, expect, it } from 'vitest';
import { resetLogger, useLoggerSink } from '../services/platform/logger.ts';
import { explainCommandProgram } from './explain-command.ts';

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

function describeExplainCommandProgram() {
  function listsTopicsWhenNoneIsRequested() {
    const terminalWrites = captureExplainWrites();
    explainCommandProgram({});

    expect(terminalWrites.join('')).toContain('Topics:');
  }

  it('lists topics when none is requested', listsTopicsWhenNoneIsRequested);

  function rejectsAnUnknownTopicWithTheKnownChoices() {
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
  }

  it('rejects an unknown topic with the known choices', rejectsAnUnknownTopicWithTheKnownChoices);
}

describe('explainCommandProgram', describeExplainCommandProgram);
