/**
 * The Google Play submitter — Launch's Android upload path, twin of `submit/appStoreConnect.ts`.
 *
 * Uploads the signed `.aab` to a Play track with fastlane `supply`. `supply` owns the parts that are
 * genuinely hard to re-implement — the transactional multi-call edit, the resumable upload, and staged
 * rollout — which is why this milestone leans on it (decision 7) exactly as the iOS leg leans on
 * `pilot`/`deliver`. The track and rollout are resolved upstream onto {@link ResolvedBuildContext.android}
 * so this submitter reads one source of truth; the neutral {@link SubmitTarget} only decides the safe
 * default track. The service-account JSON is written to a temp file in supply's expected shape and
 * removed after. Implements {@link Submitter}.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  PlayTrack,
  ResolvedBuildContext,
  Submitter,
  SubmitTarget,
  BuildCredentials,
} from '../../core/types.js';
import { run } from '../../core/exec.js';

/** Metadata/asset uploads Launch never manages — supply must skip them or it errors on missing files. */
const SKIP_LISTING_FLAGS = [
  '--skip_upload_metadata',
  'true',
  '--skip_upload_images',
  'true',
  '--skip_upload_screenshots',
  'true',
  '--skip_upload_changelogs',
  'true',
];

/** Write the service-account JSON to a temp file for `supply --json_key`; returns the path. */
function writeServiceAccountFile(json: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'launch-play-'));
  const path = join(dir, 'play-service-account.json');
  writeFileSync(path, json);
  return path;
}

export const googlePlaySubmitter: Submitter = {
  name: 'google-play',

  async submit(
    artifactPath: string,
    target: SubmitTarget,
    creds: BuildCredentials,
    ctx: ResolvedBuildContext,
  ): Promise<void> {
    if (creds.platform !== 'android')
      throw new Error('The google-play submitter handles Android only.');
    const packageName = ctx.app.packageName;
    if (!packageName)
      throw new Error(
        `No Android application id for ${ctx.app.name}. Set android.package in app.json.`,
      );

    // Resolved upstream onto ctx.android; fall back to the safe default for the neutral target.
    const track: PlayTrack =
      ctx.android?.track ?? (target === 'production' ? 'production' : 'internal');
    const rollout = ctx.android?.rollout ?? 1.0;

    const jsonKeyPath = writeServiceAccountFile(creds.serviceAccountJson);
    try {
      const args = [
        'supply',
        '--aab',
        artifactPath,
        '--json_key',
        jsonKeyPath,
        '--package_name',
        packageName,
        '--track',
        track,
        ...SKIP_LISTING_FLAGS,
      ];
      // A partial rollout becomes a staged ("inProgress") release; a full one is left to complete.
      if (rollout < 1) args.push('--rollout', String(rollout));
      // Resolved env (profile env: / .env / keychain / --env) reaches fastlane as its process env.
      await run('fastlane', args, { env: ctx.env });
    } finally {
      rmSync(jsonKeyPath, { force: true });
    }
  },
};
