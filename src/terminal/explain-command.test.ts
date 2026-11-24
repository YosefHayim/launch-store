import { afterEach, describe, expect, it } from 'vitest';
import { resetLogger, useLoggerSink } from '../services/platform/logger.ts';
import { TerminalCommands } from './terminal-commands.ts';

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
    new TerminalCommands().explain({});

    expect(terminalWrites.join('')).toContain('Topics:');
  }

  it('lists topics when none is requested', listsTopicsWhenNoneIsRequested);

  function rejectsAnUnknownTopicWithTheKnownChoices() {
    captureExplainWrites();

    let thrownCause: unknown = null;

    try {
      new TerminalCommands().explain({ topic: 'magic' });
    } catch (cause) {
      thrownCause = cause;
    }

    expect(thrownCause).toMatchObject({
      message: expect.stringMatching(/Unknown topic "magic"/),
    });
  }

  it('rejects an unknown topic with the known choices', rejectsAnUnknownTopicWithTheKnownChoices);
}

describe('TerminalCommands.explain', describeExplainCommandProgram);
