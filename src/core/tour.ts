/**
 * The first-run walkthrough — a safe, simulated tour of the build pipeline.
 *
 * Goal: someone who just `npm i`-ed Launch can watch the whole `build → sign → submit` flow happen,
 * step by step, *before* they have any config, credentials, or Apple/Google account. So this narrates
 * the pipeline rather than running it: nothing is built, no network call is made, no account changes.
 *
 * It reuses the real teaching machinery instead of re-describing it: each step is rendered with the
 * same {@link createLogger}(`explain: true`) the live `--explain` flow uses, so the plain-English block
 * under each step comes straight from {@link glossary} — one source of truth, zero drift. The step list
 * is keyed to {@link PIPELINE_PHASES}, and a test asserts the two stay in lockstep.
 *
 * Entry points: the no-args `launch` front door auto-plays it once (see `firstRun.ts` + the wizard),
 * and `launch demo [platform]` replays it on demand.
 */

import type { GlossaryTopic } from './glossary.js';
import { createLogger } from './logger.js';
import type { PipelinePhase } from './phases.js';
import { isApplePlatform, platformLabel } from './platform.js';
import type { Platform } from './types.js';

/** Color helpers for the tour's own chrome (step counter, key prompt); the step bodies use the logger. */
const dim = (t: string): string => (process.stdout.isTTY ? `\x1b[2m${t}\x1b[0m` : t);

/**
 * The fixed sample app the tour narrates. Deterministic on purpose — identical for every user, so the
 * output is stable for docs/screenshots and easy to assert in tests. It is never read from disk and
 * never built; it only supplies names for the "what this step would do" lines.
 */
const SAMPLE = { name: 'DemoApp', bundleId: 'com.example.demo', version: '1.0.0' } as const;

/**
 * One narrated step of the tour.
 *
 * `phase` ties the step to the canonical pipeline spine (so coverage is testable). `detail` is the canned
 * "what this would do" line, keyed by **build track** — every Apple platform (iOS/tvOS/macOS/visionOS)
 * shares the Xcode/App Store journey, so the Apple line is a function of the chosen platform (it names the
 * platform where it matters); Android has its own. `topic`, when present, is the glossary term whose
 * teaching block prints under the step — omitted for phases the live pipeline also prints without one
 * (e.g. `store`), so the tour mirrors a real `--explain` run.
 */
interface TourStep {
  phase: PipelinePhase;
  title: string;
  detail: { apple: (platform: Platform) => string; android: string };
  topic?: { apple: GlossaryTopic; android: GlossaryTopic };
}

/** The narration, one entry per {@link PIPELINE_PHASES} phase, in pipeline order. */
const TOUR_STEPS: readonly TourStep[] = [
  {
    phase: 'resolve',
    title: 'Resolve app, profile & env',
    detail: {
      apple: (platform) =>
        `${SAMPLE.name} ${SAMPLE.version} · production · ${platform} — .env validated`,
      android: `${SAMPLE.name} ${SAMPLE.version} · production · android — .env validated`,
    },
    topic: { apple: 'app-config', android: 'app-config' },
  },
  {
    phase: 'prebuild',
    title: 'Prebuild the native project',
    detail: {
      apple: (platform) => `would run \`expo prebuild --platform ${platform}\` → ${platform}/`,
      android: 'would run `expo prebuild --platform android` → android/',
    },
    topic: { apple: 'prebuild', android: 'prebuild' },
  },
  {
    phase: 'credentials',
    title: 'Resolve signing credentials',
    detail: {
      apple: () => 'ASC API key from the Keychain · reuse distribution cert + provisioning profile',
      android: 'service account + upload keystore from the OS secret store',
    },
    topic: { apple: 'provisioning-profile', android: 'upload-key' },
  },
  {
    phase: 'build',
    title: 'Build & sign',
    detail: {
      apple: () => `fastlane gym → signed ${SAMPLE.name}.ipa (caches warm — incremental)`,
      android: `gradle :app:bundleRelease → signed ${SAMPLE.name}.aab`,
    },
    topic: { apple: 'fastlane', android: 'gradle' },
  },
  {
    phase: 'size',
    title: 'Real download-size check',
    detail: {
      apple: () => 'App Thinning Size Report → per-device download · gated by sizeBudgetMB',
      android: 'bundletool → per-device download · gated by sizeBudgetMB',
    },
    topic: { apple: 'app-thinning', android: 'bundletool' },
  },
  {
    phase: 'store',
    title: 'Store the artifact',
    detail: {
      apple: () => `${SAMPLE.name}.ipa → ~/.launch/artifacts (newest-first index)`,
      android: `${SAMPLE.name}.aab → ~/.launch/artifacts (newest-first index)`,
    },
  },
  {
    phase: 'submit',
    title: 'Submit to the testing track',
    detail: {
      apple: () => 'upload to TestFlight — the safe default (public release is `launch release`)',
      android: 'upload to the Play internal track',
    },
    topic: { apple: 'testflight', android: 'play-track' },
  },
];

/** The glossary topics the tour relies on — exported so a test can assert they're all real terms. */
export function tourTopics(): GlossaryTopic[] {
  const topics: GlossaryTopic[] = [];
  for (const step of TOUR_STEPS) {
    if (step.topic) topics.push(step.topic.apple, step.topic.android);
  }
  return topics;
}

/** The pipeline phases the tour covers, in order — exported for the drift-guard test. */
export function tourPhases(): PipelinePhase[] {
  return TOUR_STEPS.map((step) => step.phase);
}

/**
 * Read one keypress in raw mode and report whether the user wants to continue or skip the rest of the
 * tour. Only ever called on an interactive TTY. Ctrl-C exits cleanly (raw mode would otherwise swallow
 * it). Restores the prior stdin state before resolving, so the wizard's prompts that follow behave
 * normally.
 */
function readContinueOrSkip(): Promise<'continue' | 'skip'> {
  return new Promise((resolve) => {
    const { stdin } = process;
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.once('data', (data: Buffer) => {
      const key = data.toString('utf8');
      stdin.setRawMode(wasRaw);
      stdin.pause();
      if (key === '\x03') {
        // Ctrl-C: leave a clean line and bail like any other cancel.
        process.stdout.write('\n');
        process.exit(0);
      }
      process.stdout.write('\n');
      resolve(key.toLowerCase() === 's' ? 'skip' : 'continue');
    });
  });
}

/**
 * Play the walkthrough for one platform.
 *
 * @param platform which leg to narrate (iOS or Android).
 * @param interactive when true, pause for ↵ between steps (and let `s` skip the rest); when false
 *   (CI, piped, non-TTY), print every step straight through with no pauses.
 */
export async function runTour(platform: Platform, interactive: boolean): Promise<void> {
  const log = createLogger(true);
  log.gap();
  log.notice(
    `Launch tour — how an ${platformLabel(platform)} app ships, end to end`,
    'Simulated: no build, no network, no account changes. Press s to skip.',
  );
  log.gap();

  const apple = isApplePlatform(platform);
  const total = TOUR_STEPS.length;
  for (const [i, step] of TOUR_STEPS.entries()) {
    log.line(dim(`Step ${i + 1}/${total}`));
    const detail = apple ? step.detail.apple(platform) : step.detail.android;
    const topic = step.topic ? (apple ? step.topic.apple : step.topic.android) : undefined;
    log.step(step.title, detail, topic);

    if (interactive && i < total - 1) {
      process.stdout.write(dim(`  [↵] continue   [s] skip            (${i + 1}/${total})`));
      if ((await readContinueOrSkip()) === 'skip') break;
    }
  }

  log.gap();
  log.info("That's the whole flow — every step above was a simulation. Now do it for real:");
}
