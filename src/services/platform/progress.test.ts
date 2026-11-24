import { describe, expect, it } from 'vitest';
import { isInteractiveTerminal } from './progress.ts';

function describeIsInteractiveTerminal() {
  function acceptsATerminalThatIsNotCi() {
    expect(isInteractiveTerminal(true, {})).toBe(true);
  }

  it('accepts a terminal that is not CI', acceptsATerminalThatIsNotCi);

  function refusesAPipe() {
    expect(isInteractiveTerminal(false, {})).toBe(false);
  }

  it('refuses a pipe', refusesAPipe);

  function refusesCi() {
    expect(isInteractiveTerminal(true, { CI: 'true' })).toBe(false);
  }

  it('refuses CI', refusesCi);
}

describe('isInteractiveTerminal', describeIsInteractiveTerminal);
