import { expect, mock, test } from 'claude-code/testing';
import type { Engine } from 'claude-code/testing';
import type { CommandRunInput, On } from 'claude-code';
import { eventLines, parseEvent, splitLines } from '../hooks/launch-events';
import { buildWords, planWords, releaseWords } from '../hooks/launch-tools';

const APP = '/home/me/app';
const BUILD_TOOL = 'mcp__launch-store__build';
const RELEASE_TOOL = 'mcp__launch-store__release';
const STATUS_TOOL = 'mcp__launch-store__status';
const EXPO_MANIFEST = JSON.stringify({
  dependencies: { expo: '54.0.0', 'react-native': '0.81.0' },
});

type Run = Readonly<{ stdout: string; stderr?: string; code?: number; gate?: Promise<void> }>;

type Setup = Readonly<{
  files?: string[];
  manifest?: string;
  answer?: string;
  runFor?: (argv: string) => Run;
}>;

const ndjson = (...events: object[]) =>
  events.map((event) => `${JSON.stringify(event)}\n`).join('');
const FINISHED: Run = { stdout: ndjson({ event: 'result', ok: true }) };

const session = (on: On, setup: Setup) => {
  const seen = {
    tools: [] as string[],
    commands: [] as string[],
    descriptions: [] as string[],
    spawned: [] as string[],
    statuses: [] as Array<string | undefined>,
    toasts: [] as string[],
    questions: [] as string[],
    logs: [] as string[],
  };
  const { files = [], runFor = () => FINISHED, answer = 'Cancel' } = setup;
  const logged = { wait: Promise.resolve(''), done: (_text: string) => {} };
  logged.wait = new Promise((resolve) => {
    logged.done = resolve;
  });
  on('fs.list', () => ({
    value: files.map((name) => ({
      name,
      kind: 'file' as const,
      size: 1,
      mtimeMs: 0,
      isLink: false,
    })),
  }));
  on('fs.read', () => {
    if (setup.manifest === undefined) return { deny: 'ENOENT' };
    return { value: setup.manifest };
  });
  on('tool.register', (_api, e) => {
    seen.tools.push(e.name);
    return { value: { tool: `mcp__launch-store__${e.name}` } };
  });
  on('command.register', (_api, e) => {
    seen.commands.push(e.name);
    seen.descriptions.push(e.description);
    return { value: { command: e.name } };
  });
  on('session.start', (_api, e) => ({ cwd: e.cwd }));
  on('process.spawn', async function* (_api, e) {
    const argv = e.argv.join(' ');
    seen.spawned.push(argv);
    const { stdout, stderr, code = 0, gate } = runFor(argv);
    await gate;
    if (stdout !== '') yield { stream: 'stdout' as const, text: stdout };
    if (stderr !== undefined) yield { stream: 'stderr' as const, text: stderr };
    return { value: { code, signal: null } };
  });
  on('ui.status', (_api, e) => {
    seen.statuses.push(e.text);
    return { value: undefined };
  });
  on('ui.toast', (_api, e) => {
    seen.toasts.push(e.text);
    return { value: undefined };
  });
  on('ui.log', (_api, e) => {
    seen.logs.push(e.text);
    logged.done(e.text);
    return { value: undefined };
  });
  on('tool.call', { tool: 'AskUserQuestion' }, (_api, e) => {
    const [question = ''] = e.questions.map((asked) => asked.question);
    seen.questions.push(question);
    return { result: { questions: e.questions, answers: { [question]: answer } } };
  });
  return { seen, logged };
};

const start = ($: Engine) =>
  $.session.start({ cwd: APP, surface: 'terminal', isInteractive: true });

const command = (args: string, origin: CommandRunInput['origin']): CommandRunInput => ({
  command: 'launch',
  args,
  origin,
  presentation: { isFullscreen: false, columns: 100 },
});

test('a folder with no mobile project gets no tools and no /launch', async ($, on) => {
  const { seen } = session(on, { files: ['README.md'] });
  await start($);

  expect(seen.tools).toEqual([]);
  expect(seen.commands).toEqual([]);
});

test('an Expo app gets the five tools and /launch', async ($, on) => {
  const { seen } = session(on, { files: ['app.json', 'package.json'], manifest: EXPO_MANIFEST });
  await start($);

  expect(seen.tools).toEqual(['build', 'release', 'status', 'plan', 'doctor']);
  expect(seen.commands).toEqual(['launch']);
});

test('a package.json of null still finds the native folders', async ($, on) => {
  const { seen } = session(on, { files: ['ios'], manifest: 'null' });
  await start($);

  expect(seen.descriptions).toEqual([
    'Build, release and check this app with launch-store (swift)',
  ]);
});

test('Swift, Kotlin and launch-store folders are mobile projects too', async ($, on) => {
  const { seen } = session(on, {
    files: ['Hello.xcodeproj', 'settings.gradle.kts', 'launch.config.ts', 'notes.txt'],
  });
  await start($);

  expect(seen.descriptions).toEqual([
    'Build, release and check this app with launch-store (launch-store, swift, kotlin)',
  ]);
});

test('tool inputs become launch words', () => {
  expect(buildWords({ platform: 'ios', profile: 'beta', dryRun: true, submit: false })).toEqual([
    'build',
    'ios',
    '--profile',
    'beta',
    '--dry-run',
    '--no-submit',
  ]);
  expect(releaseWords({ platform: 'android', app: 'shop', rollout: 0.25 })).toEqual([
    'release',
    'android',
    '--app',
    'shop',
    '--rollout',
    '0.25',
  ]);
  expect(planWords({ surface: 'iap' })).toEqual(['plan', 'iap']);
});

test('NDJSON lines are split across pieces and read as events', () => {
  const first = splitLines('', '{"event":"step","step":"con');
  const second = splitLines(first.rest, 'fig"}\n{"event":"note"');

  expect(first.complete).toEqual([]);
  expect(second.complete).toEqual(['{"event":"step","step":"config"}']);
  expect(second.rest).toBe('{"event":"note"');
  expect(parseEvent('  "surfaces": [')).toBe(undefined);
  expect(parseEvent('{"plain":true}')).toBe(undefined);
  expect(eventLines({ event: 'box', title: 'Release plan', lines: ['1.2.0 (42)'] })).toEqual([
    'Release plan',
    '  1.2.0 (42)',
  ]);
});

test('a dry-run build shows each step in the status line and returns them', async ($, on) => {
  const { seen } = session(on, {
    manifest: EXPO_MANIFEST,
    runFor: () => ({
      stdout: ndjson(
        { event: 'step', step: 'config', detail: 'hello' },
        { event: 'progress', label: 'Archiving', status: 'start' },
        { event: 'progress', label: 'Archiving', status: 'done', elapsedMs: 72000 },
        { event: 'result', ok: true, command: 'build' },
      ),
    }),
  });
  await start($);

  const built = await $.tool.call({ tool: BUILD_TOOL, platform: 'ios', dryRun: true });

  expect(built.result).toBe(
    'launch build ios --dry-run finished.\nconfig - hello\nArchiving done in 72s',
  );
  expect(seen.spawned).toEqual(['launch build ios --dry-run --json']);
  expect(seen.statuses).toEqual([
    'launch build ios --dry-run: starting',
    'launch build ios --dry-run: config',
    'launch build ios --dry-run: Archiving',
    undefined,
  ]);
  expect(seen.questions).toEqual([]);
  expect(seen.toasts).toEqual(['launch build ios --dry-run finished']);
});

test('a build that uploads asks first, and Cancel builds nothing', async ($, on) => {
  const { seen } = session(on, { manifest: EXPO_MANIFEST, answer: 'Cancel' });
  await start($);

  const built = await $.tool.call({ tool: BUILD_TOOL, platform: 'android' });

  expect(seen.questions).toEqual(['Build android and upload it for testers?']);
  expect(built.result).toBe('launch build android cancelled.\nNothing was built or submitted.');
  expect(seen.spawned).toEqual([]);
});

test('a release shows its plan and runs with --yes only after the yes', async ($, on) => {
  const { seen } = session(on, {
    manifest: EXPO_MANIFEST,
    answer: 'Release',
    runFor: (argv) => {
      if (!argv.includes('--dry-run'))
        return { stdout: ndjson({ event: 'step', step: 'submitted' }) };
      return { stdout: ndjson({ event: 'box', title: 'Release plan', lines: ['1.2.0 (42)'] }) };
    },
  });
  await start($);

  const released = await $.tool.call({ tool: RELEASE_TOOL, platform: 'ios' });

  expect(seen.questions).toEqual(['Release plan\n  1.2.0 (42)\n\nRelease ios now?']);
  expect(seen.spawned).toEqual([
    'launch release ios --dry-run --json',
    'launch release ios --yes --json',
  ]);
  expect(released.result).toBe('launch release ios finished.\nsubmitted');
});

test('a failed run is denied with its reason and the last error lines', async ($, on) => {
  session(on, {
    manifest: EXPO_MANIFEST,
    runFor: () => ({
      stdout: ndjson({ event: 'result', ok: false, message: 'No App Store Connect app record.' }),
      stderr: '[ERROR] Archiving failed\n',
      code: 1,
    }),
  });
  await start($);

  const status = await $.tool.call({ tool: STATUS_TOOL });

  expect(status.deny).toBe(
    'launch status failed.\nNo App Store Connect app record.\n[ERROR] Archiving failed',
  );
});

test('a missing launch CLI says how to install it', async ($, on) => {
  session(on, {
    manifest: EXPO_MANIFEST,
    runFor: () => {
      throw new Error('spawn launch ENOENT');
    },
  });
  await start($);

  const status = await $.tool.call({ tool: STATUS_TOOL });

  expect(status.deny).toContain('launch status failed.\nCould not start launch:');
  expect(status.deny).toContain('pnpm add -g launch-store');
});

test('/launch runs in the background and logs the report on one line when it ends', async ($, on) => {
  const { seen, logged } = session(on, {
    manifest: EXPO_MANIFEST,
    runFor: () => ({
      stdout: ndjson(
        { event: 'step', step: 'config', detail: 'hello' },
        { event: 'note', message: 'Done.' },
        { event: 'result', ok: true },
      ),
    }),
  });
  await start($);

  const started = await $.command.run(command('status', { kind: 'composer' }));
  const report = await logged.wait;

  expect(started.text).toBe('Started launch status. Progress shows in the status line.');
  expect(report).toBe('launch status finished. config - hello · Done.');
  expect(seen.spawned).toEqual(['launch status --json']);
});

test('/launch from no person, with unknown words or a plugin --yes starts nothing', async ($, on) => {
  const { seen } = session(on, { manifest: EXPO_MANIFEST });
  await start($);

  const fromSdk = await $.command.run(command('status', { kind: 'sdk' }));
  const unknown = await $.command.run(command('deploy ios', { kind: 'composer' }));
  const skipped = await $.command.run(command('release ios --yes', { kind: 'plugin', name: 'x' }));

  expect(fromSdk.text).toBe('Only the person at this session can start /launch.');
  expect(unknown.text).toContain('Usage: /launch');
  expect(skipped.text).toBe('A plugin cannot skip the question. Run it without --yes.');
  expect(seen.spawned).toEqual([]);
});

test('one launch runs at a time', async ($, on) => {
  const opened = { open: () => {} };
  const gate = new Promise<void>((resolve) => {
    opened.open = resolve;
  });
  const clock = mock.clock(on);
  session(on, {
    manifest: EXPO_MANIFEST,
    runFor: () => ({ stdout: ndjson({ event: 'result', ok: true }), gate }),
  });
  await start($);

  const firstBuild = $.tool.call({ tool: BUILD_TOOL, platform: 'ios', dryRun: true });
  await clock.settle();
  const busy = await $.tool.call({ tool: STATUS_TOOL });
  opened.open();
  const built = await firstBuild;
  const status = await $.tool.call({ tool: STATUS_TOOL });

  expect(busy.deny).toBe(
    'launch status failed.\nlaunch build ios --dry-run is still running. Wait for it to finish first.',
  );
  expect(built.result).toBe('launch build ios --dry-run finished.');
  expect(status.result).toBe('launch status finished.');
});

test('two launches asked for at once run one at a time', async ($, on) => {
  const { seen } = session(on, { manifest: EXPO_MANIFEST });
  await start($);

  const [first, second] = await Promise.all([
    $.tool.call({ tool: STATUS_TOOL }),
    $.tool.call({ tool: STATUS_TOOL }),
  ]);

  expect(seen.spawned).toEqual(['launch status --json']);
  expect(first.result).toBe('launch status finished.');
  expect(second.deny).toBe(
    'launch status failed.\nlaunch status is still running. Wait for it to finish first.',
  );
});
