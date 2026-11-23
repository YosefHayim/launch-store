import { describe, expect, it } from 'vitest';
import {
  type SetupReadiness,
  formatPendingTodoLine,
  formatSetupBoard,
  mayInstallToolchain,
  pendingTodos,
  readinessMark,
  toolchainReadinessRows,
} from './setup.ts';
import type { Tool } from './toolchain.ts';
/** A three-tool slice covering every branch: a required guide tool, a required brew tool, a recommended one. */
const tools: Tool[] = [
  {
    label: 'Xcode (xcodebuild)',
    command: 'xcodebuild',
    tier: 'required',
    install: { kind: 'guide', how: 'Install Xcode from the App Store.' },
  },
  {
    label: 'pod',
    command: 'pod',
    tier: 'required',
    install: { kind: 'brew', formula: 'pod' },
  },
  {
    label: 'ccache',
    command: 'ccache',
    tier: 'recommended',
    install: { kind: 'brew', formula: 'ccache' },
  },
];

function describeToolchainReadinessRows() {
  const readinessRows = toolchainReadinessRows(tools, new Set(['pod']));

  function marksAPresentToolOkWithNoFixHint() {
    function isPodRow(readinessRow: {
      readonly label: string;
      readonly status: 'todo' | 'ok' | 'info';
      readonly detail?: string;
    }) {
      return readinessRow.label == 'pod';
    }

    expect(readinessRows.find(isPodRow)).toEqual({
      label: 'pod',
      status: 'ok',
    });
  }

  it('marks a present tool ok with no fix hint', marksAPresentToolOkWithNoFixHint);

  function marksAMissingRequiredToolATodoCarryingItsInstallHint() {
    function isXcodeRow(readinessRow: {
      readonly label: string;
      readonly status: 'todo' | 'ok' | 'info';
      readonly detail?: string;
    }) {
      return readinessRow.label.startsWith('Xcode');
    }

    expect(readinessRows.find(isXcodeRow)).toEqual({
      label: 'Xcode (xcodebuild)',
      status: 'todo',
      detail: 'Install Xcode from the App Store.',
    });
  }

  it(
    'marks a missing required tool a todo carrying its install hint',
    marksAMissingRequiredToolATodoCarryingItsInstallHint,
  );

  function marksAMissingRecommendedToolAdvisoryPieceNeverAGap() {
    function isCcacheRow(readinessRow: {
      readonly label: string;
      readonly status: 'todo' | 'ok' | 'info';
      readonly detail?: string;
    }) {
      return readinessRow.label == 'ccache';
    }

    const ccacheRow = readinessRows.find(isCcacheRow);

    expect(ccacheRow?.status).toBe('info');
    expect(ccacheRow?.detail).toContain('brew install ccache');
  }

  it(
    'marks a missing recommended tool advisory (info), never a gap',
    marksAMissingRecommendedToolAdvisoryPieceNeverAGap,
  );
}

describe('toolchainReadinessRows', describeToolchainReadinessRows);

function describeReadinessMark() {
  function mapsEachReadinessStatusToAStableASCIIMarker() {
    expect(readinessMark('ok')).toBe('OK');
    expect(readinessMark('todo')).toBe('x');
    expect(readinessMark('info')).toBe('-');
  }

  it(
    'maps each readiness status to a stable ASCII marker',
    mapsEachReadinessStatusToAStableASCIIMarker,
  );
}

describe('readinessMark', describeReadinessMark);

function describeFormatPendingTodoLine() {
  function joinsLabelAndDetailWhenADetailIsPresent() {
    const pendingTodoLine = formatPendingTodoLine({
      label: 'Xcode',
      status: 'todo',
      detail: 'Install Xcode.',
    });

    expect(pendingTodoLine).toBe('Xcode - Install Xcode.');
  }

  it('joins label and detail when a detail is present', joinsLabelAndDetailWhenADetailIsPresent);

  function returnsTheBareLabelWhenNoDetailIsSet() {
    const pendingTodoLine = formatPendingTodoLine({ label: 'Apps', status: 'todo' });
    expect(pendingTodoLine).toBe('Apps');
  }

  it('returns the bare label when no detail is set', returnsTheBareLabelWhenNoDetailIsSet);
}

describe('formatPendingTodoLine', describeFormatPendingTodoLine);

function describeMayInstallToolchain() {
  function allowsInstallsOnAnInteractiveTTYWithoutYes() {
    expect(mayInstallToolchain(true, false)).toBe(true);
  }

  it(
    'allows installs on an interactive TTY without --yes',
    allowsInstallsOnAnInteractiveTTYWithoutYes,
  );

  function allowsInstallsWhenYesIsSetEvenWithoutATTY() {
    expect(mayInstallToolchain(false, true)).toBe(true);
  }

  it(
    'allows installs when --yes is set even without a TTY',
    allowsInstallsWhenYesIsSetEvenWithoutATTY,
  );

  function blocksInstallsWhenNonInteractiveAndYesIsAbsent() {
    expect(mayInstallToolchain(false, false)).toBe(false);
  }

  it(
    'blocks installs when non-interactive and --yes is absent',
    blocksInstallsWhenNonInteractiveAndYesIsAbsent,
  );
}

describe('mayInstallToolchain', describeMayInstallToolchain);

function describeFormatSetupBoard() {
  const readiness: SetupReadiness = {
    groups: [
      { title: 'Config', rows: [{ label: 'launch.config.ts', status: 'ok', detail: 'present' }] },
      {
        title: 'Toolchain',
        rows: [
          { label: 'pod', status: 'ok' },
          { label: 'Xcode', status: 'todo', detail: 'Install Xcode.' },
        ],
      },
    ],
  };
  const boardLines = formatSetupBoard(readiness);

  function rendersEachGroupTitleWithItsChecksIndentedUnderIt() {
    expect(boardLines).toContain('Config');
    expect(boardLines).toContain('  OK launch.config.ts - present');
    expect(boardLines).toContain('Toolchain');
    expect(boardLines).toContain('  OK pod');
    expect(boardLines).toContain('  x Xcode - Install Xcode.');
  }

  it(
    'renders each group title with its checks indented under it',
    rendersEachGroupTitleWithItsChecksIndentedUnderIt,
  );

  function separatesGroupsWithABlankLineButNeverLeadsWithOne() {
    expect(boardLines[0]).toBe('Config');
    expect(boardLines).toContain('');
    expect(boardLines.indexOf('')).toBeGreaterThan(0);
  }

  it(
    'separates groups with a blank line but never leads with one',
    separatesGroupsWithABlankLineButNeverLeadsWithOne,
  );
}

describe('formatSetupBoard', describeFormatSetupBoard);

function describePendingTodos() {
  function flattensOnlyTheTodoRowsAcrossEveryGroupDroppingOkAndPiece() {
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
          rows: [{ label: 'Apple account', status: 'todo', detail: 'launch-store creds set-key' }],
        },
      ],
    };

    expect(pendingTodos(readiness)).toEqual([
      { label: 'Xcode', status: 'todo', detail: 'Install Xcode.' },
      { label: 'Apple account', status: 'todo', detail: 'launch-store creds set-key' },
    ]);
  }

  it(
    'flattens only the todo rows across every group, dropping ok and info',
    flattensOnlyTheTodoRowsAcrossEveryGroupDroppingOkAndPiece,
  );
}

describe('pendingTodos', describePendingTodos);
