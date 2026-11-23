import { describe, expect, it } from 'vitest';
import { registerBuildsCommand } from './builds.ts';

function describeRegisterBuildsCommand() {
  function isTheThinCommanderRegistrationPieceForBuildHistory() {
    expect(typeof registerBuildsCommand).toBe('function');
  }

  it(
    'is the thin Commander registration entry for build history',
    isTheThinCommanderRegistrationPieceForBuildHistory,
  );
}

describe('registerBuildsCommand', describeRegisterBuildsCommand);
