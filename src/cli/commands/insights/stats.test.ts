import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from '../../command.ts';
import { registerStatsCommand } from './stats.ts';

const programCalls = vi.hoisted(function hoistProgramCalls() {
  return {
    report: vi.fn(() => 'report-program'),
    sync: vi.fn(() => 'sync-program'),
  };
});

vi.mock('../../../stats/stats-command.ts', function mockStatsCommand() {
  return { statsReportProgram: programCalls.report };
});
vi.mock('../../../stats/stats-sync-command.ts', function mockStatsSyncCommand() {
  return { statsSyncProgram: programCalls.sync };
});
vi.mock('../../run-cli-program.ts', function mockRunCliProgram() {
  return { runCliProgram: vi.fn(async () => undefined) };
});

async function parseStats(cliArguments: readonly string[]) {
  const program = new Command();
  registerStatsCommand(program);
  await program.parseAsync(['node', 'launch-store', 'stats', ...cliArguments]);
}
function prepare() {
  vi.clearAllMocks();
}

beforeEach(prepare);
function describeRegisterStatsCommand() {
  async function passesAppDaysAndPieceThroughToStatsSync() {
    await parseStats(['sync', '--app', 'calfriend', '--days', '30', '--json']);

    expect(programCalls.sync).toHaveBeenCalledWith({
      app: 'calfriend',
      days: '30',
      isJson: true,
    });
    expect(programCalls.report).not.toHaveBeenCalled();
  }

  it('passes app, days and json through to stats sync', passesAppDaysAndPieceThroughToStatsSync);

  async function keepsStatsSyncInPieceModeWhenNoFlagsAreGiven() {
    await parseStats(['sync']);

    expect(programCalls.sync).toHaveBeenCalledWith({
      app: undefined,
      days: undefined,
      isJson: false,
    });
  }

  it(
    'keeps stats sync in text mode when no flags are given',
    keepsStatsSyncInPieceModeWhenNoFlagsAreGiven,
  );

  async function stillPassesAppAndPieceToTheStatsReport() {
    await parseStats(['--app', 'calfriend', '--json', '--owner', 'mine']);

    expect(programCalls.report).toHaveBeenCalledWith({
      platform: undefined,
      owner: 'mine',
      app: 'calfriend',
      days: undefined,
      json: true,
    });
    expect(programCalls.sync).not.toHaveBeenCalled();
  }

  it('still passes app and json to the stats report', stillPassesAppAndPieceToTheStatsReport);
}

describe('registerStatsCommand', describeRegisterStatsCommand);
