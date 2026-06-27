import { describe, expect, it } from 'vitest';
import { Command } from 'commander';
import { registerSnapshotCommand } from './snapshot.js';

/** Find the `snapshot` group's named subcommand, asserting the group exists. */
function subcommand(name: string) {
  const program = new Command();
  registerSnapshotCommand(program);
  const snapshot = program.commands.find((command) => command.name() === 'snapshot');
  expect(snapshot).toBeDefined();
  return snapshot?.commands.find((command) => command.name() === name);
}

describe('registerSnapshotCommand', () => {
  it('attaches a `snapshot` group with create/list/diff/export/delete/prune/restore subcommands', () => {
    const program = new Command();
    registerSnapshotCommand(program);
    const snapshot = program.commands.find((command) => command.name() === 'snapshot');
    const names = snapshot?.commands.map((command) => command.name()).sort();
    expect(names).toEqual(['create', 'delete', 'diff', 'export', 'list', 'prune', 'restore']);
  });

  it('create takes --app and --json', () => {
    const options = subcommand('create')?.options.map((option) => option.long);
    expect(options).toContain('--app');
    expect(options).toContain('--json');
  });

  it('diff takes --app and --json', () => {
    const options = subcommand('diff')?.options.map((option) => option.long);
    expect(options).toContain('--app');
    expect(options).toContain('--json');
  });

  it('export takes --out', () => {
    const options = subcommand('export')?.options.map((option) => option.long);
    expect(options).toContain('--out');
  });

  it('delete takes --json', () => {
    const options = subcommand('delete')?.options.map((option) => option.long);
    expect(options).toContain('--json');
  });

  it('prune takes --keep, --older-than, --yes and --json', () => {
    const options = subcommand('prune')?.options.map((option) => option.long);
    expect(options).toEqual(expect.arrayContaining(['--keep', '--older-than', '--yes', '--json']));
  });

  it('restore takes --app, --source, --yes and --json', () => {
    const options = subcommand('restore')?.options.map((option) => option.long);
    expect(options).toEqual(expect.arrayContaining(['--app', '--source', '--yes', '--json']));
  });
});
