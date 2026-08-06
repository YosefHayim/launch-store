import { NodeContext, NodeHttpClient } from '@effect/platform-node';
import { Effect } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AppleStoreClientService,
  type AppleStoreClientService as AppleStoreClientContract,
} from '../services/appleStoreClient.js';
import {
  GoogleStoreClientService,
  type GoogleStoreClientService as GoogleStoreClientContract,
} from '../services/googleStoreClient.js';
import { makeLaunchLoggerTest } from '../services/logger.js';
import { makeLaunchPathsTest } from '../services/paths.js';
import { makeLaunchSecretStoreTest } from '../services/secretStore.js';
import type { ProbeResult, ReadinessOutcome, ReadinessProbe } from '../types/readiness.js';
import { formatReadinessSummaryDetail, readinessStoreLabel } from './command.js';
import { READINESS_EXIT } from './orchestrator.js';

/**
 * The category passed to the last `selectReadinessProbes` call, captured so a test can assert that a
 * command's probe slice reaches the registry unchanged. Mutated by the mock below.
 */
let selectedCategory: string | undefined;
/** A fake probe that returns a fixed result with no network - same idiom as `orchestrator.test.ts`. */
const probe = (id: string, probeOutcome: ProbeResult): ReadinessProbe => {
  return {
    id,
    title: id,
    store: 'appstore',
    categories: ['submit'],
    check: () => Effect.succeed(probeOutcome),
  };
};
/** The probe slice the mocked registry hands back; swapped per test to drive the outcome. */
let probes: ReadinessProbe[] = [];
vi.mock('../config/config.js', () => ({
  loadConfig: () => Effect.succeed({ config: {}, apps: [] }),
}));
vi.mock('../store/storeClients.js', () => ({
  createAscClientResolver: () => () => Effect.succeed(null),
  createPlayClientResolver: () => () => Effect.succeed(null),
}));
vi.mock('./registry.js', () => ({
  registerBuiltinProbes: () => {},
  selectReadinessProbes: (category: string) => {
    selectedCategory = category;
    return probes;
  },
}));
const { readinessCommandProgram } = await import('./command.js');
const LABELS = { summary: 'Test readiness', empty: 'No checks ran.' };
const unavailableAppleClients: AppleStoreClientContract = {
  createClient: () => Effect.dieMessage('Unexpected Apple client construction.'),
  createEffectClient: () => Effect.dieMessage('Unexpected Apple client construction.'),
  createReleaseAttributesClient: () => Effect.dieMessage('Unexpected Apple client construction.'),
};
const unavailableGoogleClients: GoogleStoreClientContract = {
  createClient: () => Effect.dieMessage('Unexpected Google client construction.'),
  createEffectClient: () => Effect.dieMessage('Unexpected Google client construction.'),
};
const runReadinessCommand = (
  commandInput: Parameters<typeof readinessCommandProgram>[0],
  terminalWrites: string[] = [],
) =>
  Effect.runPromise(
    readinessCommandProgram(commandInput).pipe(
      Effect.provideService(AppleStoreClientService, unavailableAppleClients),
      Effect.provideService(GoogleStoreClientService, unavailableGoogleClients),
      Effect.provide(makeLaunchSecretStoreTest()),
      Effect.provide(makeLaunchPathsTest('/test-home', '/workspace')),
      Effect.provide(NodeHttpClient.layer),
      Effect.provide(NodeContext.layer),
      Effect.provide(makeLaunchLoggerTest(terminalWrites)),
      Effect.as(READINESS_EXIT.ok),
      Effect.catchTag('CommandExit', (commandExit) => Effect.succeed(commandExit.exitCode)),
    ),
  );

const emptyOutcome = (overrides: Partial<ReadinessOutcome> = {}): ReadinessOutcome => ({
  reports: [],
  okCount: 0,
  warnCount: 0,
  blockerCount: 0,
  errorCount: 0,
  skippedCount: 0,
  exitCode: READINESS_EXIT.ok,
  ...overrides,
});

describe('readinessStoreLabel', () => {
  it('names App Store and Google Play for section headers', () => {
    expect(readinessStoreLabel('appstore')).toBe('App Store');
    expect(readinessStoreLabel('play')).toBe('Google Play');
  });
});

describe('formatReadinessSummaryDetail', () => {
  it('returns all clear when every tally is zero', () => {
    expect(formatReadinessSummaryDetail(emptyOutcome())).toBe('all clear');
  });
  it('joins blocker, unreadable, warning, and skipped tallies in priority order', () => {
    expect(
      formatReadinessSummaryDetail(
        emptyOutcome({
          blockerCount: 2,
          errorCount: 1,
          warnCount: 3,
          skippedCount: 4,
          exitCode: READINESS_EXIT.error,
        }),
      ),
    ).toBe('2 blocker(s) - 1 unreadable - 3 warning(s) - 4 skipped');
  });
});

describe('readinessCommandProgram', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    probes = [];
    selectedCategory = undefined;
  });
  it('passes its category through to the probe selector', async () => {
    probes = [];
    await runReadinessCommand({ category: 'iap', labels: LABELS });
    expect(selectedCategory).toBe('iap');
  });
  it('sets exit code 0 when every probe is clear', async () => {
    probes = [
      probe('clear', {
        state: 'checked',
        apps: [{ app: 'x', identifier: 'com.x', status: 'ok', detail: 'ready' }],
      }),
    ];
    const exitCode = await runReadinessCommand({ category: 'submit', labels: LABELS });
    expect(exitCode).toBe(READINESS_EXIT.ok);
  });
  it('sets exit code 2 when a probe reports a blocker', async () => {
    probes = [
      probe('blocked', {
        state: 'checked',
        apps: [{ app: 'y', identifier: 'com.y', status: 'blocker', detail: 'missing' }],
      }),
    ];
    const exitCode = await runReadinessCommand({ category: 'account', labels: LABELS });
    expect(exitCode).toBe(READINESS_EXIT.blocker);
  });
  it('emits the raw outcome as JSON under --json', async () => {
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
    if (typeof printedText !== 'string') return;
    const printedOutcome: unknown = JSON.parse(printedText);
    expect(printedOutcome).toMatchObject({ exitCode: READINESS_EXIT.ok });
    expect(printedOutcome).toMatchObject({ reports: [expect.any(Object)] });
  });
  it('renders human summary with command labels when not in JSON mode', async () => {
    probes = [
      probe('clear', {
        state: 'checked',
        apps: [{ app: 'x', identifier: 'com.x', status: 'ok', detail: 'ready' }],
      }),
    ];
    const terminalWrites: string[] = [];
    await runReadinessCommand({ category: 'submit', labels: LABELS }, terminalWrites);
    expect(terminalWrites.some((line) => line.includes('Test readiness: all clear'))).toBe(true);
  });
});
