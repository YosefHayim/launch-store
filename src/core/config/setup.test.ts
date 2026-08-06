import { describe, expect, it } from 'vitest';
import {
  type SetupReadiness,
  formatPendingTodoLine,
  formatSetupBoard,
  mayInstallToolchain,
  pendingTodos,
  readinessMark,
  toolchainReadinessRows,
} from './setup.js';
import type { Tool } from './toolchain.js';
/** A three-tool slice covering every branch: a required guide tool, a required brew tool, a recommended one. */
const TOOLS: Tool[] = [
  {
    label: 'Xcode (xcodebuild)',
    command: 'xcodebuild',
    tier: 'required',
    install: { kind: 'guide', how: 'Install Xcode from the App Store.' },
  },
  {
    label: 'fastlane',
    command: 'fastlane',
    tier: 'required',
    install: { kind: 'brew', formula: 'fastlane' },
  },
  {
    label: 'ccache',
    command: 'ccache',
    tier: 'recommended',
    install: { kind: 'brew', formula: 'ccache' },
  },
];
describe('toolchainReadinessRows', () => {
  const readinessRows = toolchainReadinessRows(TOOLS, new Set(['fastlane']));
  it('marks a present tool ok with no fix hint', () => {
    expect(readinessRows.find((readinessRow) => readinessRow.label === 'fastlane')).toEqual({
      label: 'fastlane',
      status: 'ok',
    });
  });
  it('marks a missing required tool a todo carrying its install hint', () => {
    expect(readinessRows.find((readinessRow) => readinessRow.label.startsWith('Xcode'))).toEqual({
      label: 'Xcode (xcodebuild)',
      status: 'todo',
      detail: 'Install Xcode from the App Store.',
    });
  });
  it('marks a missing recommended tool advisory (info), never a gap', () => {
    const ccacheRow = readinessRows.find((readinessRow) => readinessRow.label === 'ccache');
    expect(ccacheRow?.status).toBe('info');
    expect(ccacheRow?.detail).toContain('brew install ccache');
  });
});
describe('readinessMark', () => {
  it('maps each readiness status to a stable ASCII marker', () => {
    expect(readinessMark('ok')).toBe('OK');
    expect(readinessMark('todo')).toBe('x');
    expect(readinessMark('info')).toBe('-');
  });
});
describe('formatPendingTodoLine', () => {
  it('joins label and detail when a detail is present', () => {
    expect(
      formatPendingTodoLine({ label: 'Xcode', status: 'todo', detail: 'Install Xcode.' }),
    ).toBe('Xcode - Install Xcode.');
  });
  it('returns the bare label when no detail is set', () => {
    expect(formatPendingTodoLine({ label: 'Apps', status: 'todo' })).toBe('Apps');
  });
});
describe('mayInstallToolchain', () => {
  it('allows installs on an interactive TTY without --yes', () => {
    expect(mayInstallToolchain(true, false)).toBe(true);
  });
  it('allows installs when --yes is set even without a TTY', () => {
    expect(mayInstallToolchain(false, true)).toBe(true);
  });
  it('blocks installs when non-interactive and --yes is absent', () => {
    expect(mayInstallToolchain(false, false)).toBe(false);
  });
});
describe('formatSetupBoard', () => {
  const readiness: SetupReadiness = {
    groups: [
      { title: 'Config', rows: [{ label: 'launch.config.ts', status: 'ok', detail: 'present' }] },
      {
        title: 'Toolchain',
        rows: [
          { label: 'fastlane', status: 'ok' },
          { label: 'Xcode', status: 'todo', detail: 'Install Xcode.' },
        ],
      },
    ],
  };
  const boardLines = formatSetupBoard(readiness);
  it('renders each group title with its checks indented under it', () => {
    expect(boardLines).toContain('Config');
    expect(boardLines).toContain('  OK launch.config.ts - present');
    expect(boardLines).toContain('Toolchain');
    expect(boardLines).toContain('  OK fastlane');
    expect(boardLines).toContain('  x Xcode - Install Xcode.');
  });
  it('separates groups with a blank line but never leads with one', () => {
    expect(boardLines[0]).toBe('Config');
    expect(boardLines).toContain('');
    expect(boardLines.indexOf('')).toBeGreaterThan(0);
  });
});
describe('pendingTodos', () => {
  it('flattens only the todo rows across every group, dropping ok and info', () => {
    const readiness: SetupReadiness = {
      groups: [
        { title: 'Config', rows: [{ label: 'launch.config.ts', status: 'ok' }] },
        {
          title: 'Toolchain',
          rows: [
            { label: 'ccache', status: 'info', detail: 'recommended' },
            { label: 'Xcode', status: 'todo', detail: 'Install Xcode.' },
          ],
        },
        {
          title: 'Apple account',
          rows: [{ label: 'Apple account', status: 'todo', detail: 'launch creds set-key' }],
        },
      ],
    };
    expect(pendingTodos(readiness)).toEqual([
      { label: 'Xcode', status: 'todo', detail: 'Install Xcode.' },
      { label: 'Apple account', status: 'todo', detail: 'launch creds set-key' },
    ]);
  });
});
