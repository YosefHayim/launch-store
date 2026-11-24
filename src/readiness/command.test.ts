import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetLogger, useLoggerSink } from '../services/platform/logger.ts';
import { resetLaunchDirectories, useLaunchDirectories } from '../services/platform/paths.ts';
import { isCommandExit } from '../terminal/command-exit.ts';
import type { ProbeResult, ReadinessOutcome, ReadinessProbe } from '../types/readiness.ts';
import { formatReadinessSummaryDetail, readinessStoreLabel } from './command.ts';
import { READINESS_EXIT } from './orchestrator.ts';

/** The category passed to the last `selectReadinessProbes` call */
let selectedCategory: string | undefined;

/** A fake probe that returns a fixed result with no network - same idiom as `orchestrator.test.ts`. */
function probe(id: string, probeOutcome: ProbeResult): ReadinessProbe {
  return {
    id,
    title: id,
    store: 'appstore',
    categories: ['submit'],
    check() {
      return Promise.resolve(probeOutcome);
    },
  };
}
/** The probe slice the mocked registry hands back; swapped per test to drive the outcome. */
let probes: ReadinessProbe[] = [];
vi.mock('../config/config.ts', function mockPiece() {
  return {
    loadConfig: () => Promise.resolve({ config: {}, apps: [] }),
  };
});
vi.mock('../store/shared/store-clients.ts', function mockStoreClients() {
  return {
    createAscClientReader: () => async () => null,
    createPlayClientReader: () => async () => null,
  };
});
vi.mock('./registry.ts', function mockRegistry() {
  return {
    registerBuiltinProbes: () => {},
    selectReadinessProbes: (category: string) => {
      selectedCategory = category;
      return probes;
    },
  };
});
const { readinessCommandProgram } = await import('./command.ts');
const LABELS = { summary: 'Test readiness', empty: 'No checks ran.' };

async function runReadinessCommand(
  commandInput: Parameters<typeof readinessCommandProgram>[0],
  terminalWrites: string[] = [],
): Promise<number> {
  useLaunchDirectories({ homeDirectory: '/test-home', workingDirectory: '/workspace' });

  function writeLine(text: string): void {
    terminalWrites.push(text);
  }

  useLoggerSink(writeLine);

  try {
    await readinessCommandProgram(commandInput);

    return READINESS_EXIT.ok;
  } catch (cause) {
    if (isCommandExit(cause)) {
      return cause.exitCode;
    }

    throw cause;
  } finally {
    resetLogger();
    resetLaunchDirectories();
  }
}

function emptyOutcome(overrides: Partial<ReadinessOutcome> = {}): ReadinessOutcome {
  return {
    reports: [],
    okCount: 0,
    warnCount: 0,
    blockerCount: 0,
    errorCount: 0,
    skippedCount: 0,
    exitCode: READINESS_EXIT.ok,
    ...overrides,
  };
}

function describeReadinessStoreLabel() {
  function namesAppStoreAndGooglePlayForSectionHeaders() {
    expect(readinessStoreLabel('appstore')).toBe('App Store');
    expect(readinessStoreLabel('play')).toBe('Google Play');
  }

  it(
    'names App Store and Google Play for section headers',
    namesAppStoreAndGooglePlayForSectionHeaders,
  );
}

describe('readinessStoreLabel', describeReadinessStoreLabel);

function describeFormatReadinessSummaryDetail() {
  function returnsAllClearWhenEveryTallyIsZero() {
    const empty = emptyOutcome();
    const readinessSummaryDetail = formatReadinessSummaryDetail(empty);
    expect(readinessSummaryDetail).toBe('all clear');
  }

  it('returns all clear when every tally is zero', returnsAllClearWhenEveryTallyIsZero);

  function joinsBlockerUnreadableWarningAndSkippedTalliesInPriorityOrder() {
    const empty = emptyOutcome({
      blockerCount: 2,
      errorCount: 1,
      warnCount: 3,
      skippedCount: 4,
      exitCode: READINESS_EXIT.error,
    });
    const readinessSummaryDetail = formatReadinessSummaryDetail(empty);

    expect(readinessSummaryDetail).toBe('2 blocker(s) - 1 unreadable - 3 warning(s) - 4 skipped');
  }

  it(
    'joins blocker, unreadable, warning, and skipped tallies in priority order',
    joinsBlockerUnreadableWarningAndSkippedTalliesInPriorityOrder,
  );
}

describe('formatReadinessSummaryDetail', describeFormatReadinessSummaryDetail);

function describeReadinessCommandProgram() {
  function cleanupReadinessCommandProgram() {
    vi.restoreAllMocks();
    probes = [];
    selectedCategory = undefined;
  }

  afterEach(cleanupReadinessCommandProgram);

  async function passesItsCategoryThroughToTheProbeSelector() {
    probes = [];
    await runReadinessCommand({ category: 'iap', labels: LABELS });
    expect(selectedCategory).toBe('iap');
  }

  it(
    'passes its category through to the probe selector',
    passesItsCategoryThroughToTheProbeSelector,
  );

  async function setsExitCode0WhenEveryProbeIsClear() {
    probes = [
      probe('clear', {
        state: 'checked',
        apps: [{ app: 'x', identifier: 'com.x', status: 'ok', detail: 'ready' }],
      }),
    ];

    const exitCode = await runReadinessCommand({ category: 'submit', labels: LABELS });

    expect(exitCode).toBe(READINESS_EXIT.ok);
  }

  it('sets exit code 0 when every probe is clear', setsExitCode0WhenEveryProbeIsClear);

  async function setsExitCode2WhenAProbeReportsABlocker() {
    probes = [
      probe('blocked', {
        state: 'checked',
        apps: [{ app: 'y', identifier: 'com.y', status: 'blocker', detail: 'missing' }],
      }),
    ];

    const exitCode = await runReadinessCommand({ category: 'account', labels: LABELS });

    expect(exitCode).toBe(READINESS_EXIT.blocker);
  }

  it('sets exit code 2 when a probe reports a blocker', setsExitCode2WhenAProbeReportsABlocker);

  async function emitsThePiecePieceAsJSONUnderPiece() {
    probes = [
      probe('clear', {
        state: 'checked',
        apps: [{ app: 'x', identifier: 'com.x', status: 'ok', detail: 'ready' }],
      }),
    ];

    const terminalWrites: string[] = [];

    await runReadinessCommand({ category: 'submit', labels: LABELS, json: true }, terminalWrites);
    expect(terminalWrites).toHaveLength(1);

    const printedText = terminalWrites[0];

    expect(printedText).toEqual(expect.any(String));

    if (typeof printedText != 'string') return;

    const printedOutcome: unknown = JSON.parse(printedText);

    expect(printedOutcome).toMatchObject({ exitCode: READINESS_EXIT.ok });
    expect(printedOutcome).toMatchObject({ reports: [expect.any(Object)] });
  }

  it('emits the raw outcome as JSON under --json', emitsThePiecePieceAsJSONUnderPiece);

  async function rendersHumanSummaryWithCommandLabelsWhenNotInJSONMode() {
    probes = [
      probe('clear', {
        state: 'checked',
        apps: [{ app: 'x', identifier: 'com.x', status: 'ok', detail: 'ready' }],
      }),
    ];

    const terminalWrites: string[] = [];

    await runReadinessCommand({ category: 'submit', labels: LABELS }, terminalWrites);

    function includesAllClearLine(line: string) {
      return line.includes('Test readiness: all clear');
    }

    expect(terminalWrites.some(includesAllClearLine)).toBe(true);
  }

  it(
    'renders human summary with command labels when not in JSON mode',
    rendersHumanSummaryWithCommandLabelsWhenNotInJSONMode,
  );
}

describe('readinessCommandProgram', describeReadinessCommandProgram);
