import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from '@/cli/command.js';
import { registerStatsCommand } from './stats.js';

const programCalls = vi.hoisted(() => ({
  report: vi.fn(() => 'report-program'),
  sync: vi.fn(() => 'sync-program'),
}));

vi.mock('@/stats/statsCommand.js', () => ({ statsReportProgram: programCalls.report }));
vi.mock('@/stats/statsSyncCommand.js', () => ({ statsSyncProgram: programCalls.sync }));
vi.mock('@cli/runCliProgram.js', () => ({ runCliProgram: vi.fn(async () => undefined) }));

const parseStats = async (cliArguments: readonly string[]) => {
  const program = new Command();
  registerStatsCommand(program);
  await program.parseAsync(['node', 'launch', 'stats', ...cliArguments]);
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('registerStatsCommand', () => {
  it('passes app, days and json through to stats sync', async () => {
    await parseStats(['sync', '--app', 'calfriend', '--days', '30', '--json']);

    expect(programCalls.sync).toHaveBeenCalledWith({
      app: 'calfriend',
      days: '30',
      isJson: true,
    });
    expect(programCalls.report).not.toHaveBeenCalled();
  });

  it('keeps stats sync in text mode when no flags are given', async () => {
    await parseStats(['sync']);

    expect(programCalls.sync).toHaveBeenCalledWith({
      app: undefined,
      days: undefined,
      isJson: false,
    });
  });

  it('still passes app and json to the stats report', async () => {
    await parseStats(['--app', 'calfriend', '--json', '--owner', 'mine']);

    expect(programCalls.report).toHaveBeenCalledWith({
      platform: undefined,
      owner: 'mine',
      app: 'calfriend',
      days: undefined,
      json: true,
    });
    expect(programCalls.sync).not.toHaveBeenCalled();
  });
});
