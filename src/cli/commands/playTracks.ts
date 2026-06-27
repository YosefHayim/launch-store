/**
 * `launch play-tracks status|promote|testers` — manage Google Play release tracks from the CLI, using the
 * Play service account alone (the local equivalent of the Play Console's "Releases" / "Testers" screens;
 * EAS Submit hands the build to Play but can't drive the track afterwards).
 *
 * - `status` — show each track's releases (versionCodes, status, staged-rollout %) plus its country
 *   availability (read-only — Play exposes no API to change country availability).
 * - `promote` — ship a build to a track at a chosen status / rollout fraction with per-language release
 *   notes, through the Play client's transactional edit. This is where **release notes** live (deferred
 *   from the listing/in-app slices, since notes are release-scoped).
 * - `testers` — read or set the Google Groups allowed to test a track.
 *
 * Thin glue over `core/playTracks.ts` (which validates and assembles the release payload) and the Play
 * client (which owns the edit lifecycle). The two outward-facing writes — promoting a release and
 * changing testers — are guarded by a confirmation.
 */

import { readFileSync } from 'node:fs';
import { cancel, confirm, isCancel } from '@clack/prompts';
import type { Command } from 'commander';
import type { PlayRelease } from '../../google/playClient.js';
import { GooglePlayClient, parseServiceAccount } from '../../google/playClient.js';
import { loadServiceAccount } from '../../google/credentials.js';
import { loadConfig } from '../../core/config.js';
import { selectApp } from '../../core/pipeline.js';
import { createLogger } from '../../core/logger.js';
import {
  buildRelease,
  isReleaseStatus,
  parseReleaseNotes,
  parseRollout,
  RELEASE_STATUSES,
} from '../../core/playTracks.js';

/** Options for `play-tracks status`. */
interface StatusOptions {
  app?: string;
  json?: boolean;
}

/** Options for `play-tracks promote`. */
interface PromoteOptions {
  app?: string;
  track: string;
  version?: string;
  status?: string;
  rollout?: string;
  notes?: string;
  name?: string;
  yes?: boolean;
}

/** Options for `play-tracks testers`. */
interface TestersOptions {
  app?: string;
  track: string;
  groups?: string;
  yes?: boolean;
}

/** Build a Play client bound to the stored service account, or fail with the onboarding hint. */
async function activeClient(): Promise<GooglePlayClient> {
  const json = await loadServiceAccount();
  if (!json)
    throw new Error(
      'No Play service account. Run `launch creds set-key --platform android` first.',
    );
  return new GooglePlayClient(parseServiceAccount(json));
}

/** Resolve the selected app's Play package name, erroring when the app has none. */
async function resolvePackageName(appSelector: string | undefined): Promise<string> {
  const { apps } = await loadConfig();
  const app = await selectApp(apps, appSelector);
  if (!app.packageName) {
    throw new Error(`No Android application id for ${app.name} (set android.package in app.json).`);
  }
  return app.packageName;
}

/** Resolve the release status from `--status`, inferring `inProgress` when only `--rollout` is given. */
function resolveStatus(options: PromoteOptions): 'draft' | 'inProgress' | 'halted' | 'completed' {
  const status = options.status ?? (options.rollout !== undefined ? 'inProgress' : 'completed');
  if (!isReleaseStatus(status)) {
    throw new Error(`--status must be one of ${RELEASE_STATUSES.join(', ')} (got "${status}").`);
  }
  return status;
}

/** One-line summary of a track's release for `status` output. */
function describeRelease(release: PlayRelease): string {
  const parts = [
    release.status ?? 'unknown',
    release.versionCodes?.length ? `v${release.versionCodes.join(', v')}` : 'no builds',
  ];
  if (release.userFraction !== undefined)
    parts.push(`${Math.round(release.userFraction * 100)}% rollout`);
  if (release.releaseNotes?.length) parts.push(`${release.releaseNotes.length} note(s)`);
  return parts.join('  ');
}

/** Confirm an outward-facing write, refusing in CI unless `--yes` was passed. */
async function confirmWrite(message: string, yes: boolean | undefined): Promise<boolean> {
  if (yes) return true;
  if (!process.stdout.isTTY) {
    throw new Error('Refusing to write without confirmation. Re-run with --yes (non-interactive).');
  }
  const proceed = await confirm({ message });
  if (isCancel(proceed) || !proceed) {
    cancel('Aborted — no changes made.');
    return false;
  }
  return true;
}

/** Attach the `play-tracks` command (with `status` / `promote` / `testers` subcommands) to the program. */
export function registerPlayTracksCommand(program: Command): void {
  const tracks = program
    .command('play-tracks')
    .description('manage Google Play release tracks from the CLI');

  tracks
    .command('status')
    .description("show each track's releases and country availability")
    .option('-a, --app <name>', "app handle (auto-selected if there's only one)")
    .option('--json', 'output machine-readable JSON', false)
    .action(async (options: StatusOptions) => {
      const packageName = await resolvePackageName(options.app);
      const client = await activeClient();
      const trackInfos = await client.listTracks(packageName);
      const withCountries = await Promise.all(
        trackInfos.map(async (info) => ({
          ...info,
          countryAvailability: await client
            .getCountryAvailability(packageName, info.track)
            .catch(() => null),
        })),
      );

      if (options.json) {
        console.log(JSON.stringify(withCountries, null, 2));
        return;
      }
      if (withCountries.length === 0) {
        console.log(
          'No tracks yet. Upload a build (`launch submit --platform android`) to populate a track.',
        );
        return;
      }
      for (const info of withCountries) {
        console.log(`\n${info.track}`);
        if (info.releases.length === 0) console.log('  (no releases)');
        for (const release of info.releases) console.log(`  • ${describeRelease(release)}`);
        const countries = info.countryAvailability?.countries.map((c) => c.countryCode) ?? [];
        const scope = info.countryAvailability?.restOfWorld
          ? 'rest of world'
          : `${countries.length} countr(ies)`;
        console.log(`  countries: ${countries.length ? scope : '—'}`);
      }
    });

  tracks
    .command('promote')
    .description('ship a build to a track at a chosen status / rollout, with release notes')
    .requiredOption(
      '--track <track>',
      'target track (internal, alpha, beta, production, or a custom track)',
    )
    .option('-a, --app <name>', "app handle (auto-selected if there's only one)")
    .option('--version <code>', 'version code to ship (defaults to the latest uploaded)')
    .option(
      '--status <status>',
      `release status: ${RELEASE_STATUSES.join(', ')} (default: completed, or inProgress with --rollout)`,
    )
    .option('--rollout <fraction>', 'staged-rollout fraction 0–1 (implies --status inProgress)')
    .option('--notes <path>', 'path to a JSON file mapping language codes to release-note text')
    .option('--name <name>', 'release name (Play derives one from the version when omitted)')
    .option('-y, --yes', 'skip the confirmation prompt (for CI)', false)
    .action(async (options: PromoteOptions) => {
      const log = createLogger(false);
      const packageName = await resolvePackageName(options.app);
      const client = await activeClient();

      let versionCode = options.version;
      if (!versionCode) {
        const latest = await client.getLatestVersionCode(packageName);
        if (latest === 0) {
          throw new Error(
            'No uploaded build to promote. Run `launch submit --platform android` first, or pass --version.',
          );
        }
        versionCode = String(latest);
      }

      const status = resolveStatus(options);
      const release = buildRelease({
        versionCodes: [versionCode],
        status,
        ...(options.rollout !== undefined ? { userFraction: parseRollout(options.rollout) } : {}),
        ...(options.name ? { name: options.name } : {}),
        ...(options.notes
          ? { releaseNotes: parseReleaseNotes(JSON.parse(readFileSync(options.notes, 'utf8'))) }
          : {}),
      });

      const rollout =
        release.userFraction !== undefined ? ` at ${Math.round(release.userFraction * 100)}%` : '';
      if (
        !(await confirmWrite(
          `Promote v${versionCode} to "${options.track}" as ${status}${rollout}?`,
          options.yes,
        ))
      ) {
        return;
      }
      await client.setTrackReleases(packageName, options.track, [release]);
      log.step('promoted', `v${versionCode} → ${options.track} (${status}${rollout})`);
    });

  tracks
    .command('testers')
    .description('read or set the Google Groups allowed to test a track')
    .requiredOption('--track <track>', 'the testing track (e.g. internal, alpha, beta)')
    .option('-a, --app <name>', "app handle (auto-selected if there's only one)")
    .option('--groups <emails>', 'comma-separated Google Group emails to set (omit to just read)')
    .option('-y, --yes', 'skip the confirmation prompt (for CI)', false)
    .action(async (options: TestersOptions) => {
      const log = createLogger(false);
      const packageName = await resolvePackageName(options.app);
      const client = await activeClient();

      if (options.groups === undefined) {
        const current = await client.getTesters(packageName, options.track);
        console.log(
          current.length
            ? current.map((group) => `• ${group}`).join('\n')
            : 'No tester groups set.',
        );
        return;
      }

      const groups = options.groups
        .split(',')
        .map((group) => group.trim())
        .filter(Boolean);
      if (
        !(await confirmWrite(
          `Set ${groups.length} tester group(s) on "${options.track}"?`,
          options.yes,
        ))
      )
        return;
      await client.setTesters(packageName, options.track, groups);
      log.step('testers set', `${groups.length} group(s) on ${options.track}`);
    });
}
