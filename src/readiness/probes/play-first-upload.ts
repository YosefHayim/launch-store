import type {
  AppReadiness,
  PlayReadinessApi,
  ProbeResult,
  ReadinessContext,
  ReadinessProbe,
} from '@/types/readiness.js';
import { errorMessage } from '@/services/platform/error-message.js';
import { androidApps } from '../app-scopes.ts';
import { OMITTED_PROBE, SKIPPED_NO_PLAY_ACCOUNT } from './credentials-skip.ts';

type ScopedApp = { name: string; identifier: string };

function isPlayClientMissing(api: PlayReadinessApi | null | undefined): api is null | undefined {
  return api == null;
}

async function readPlayClients(
  readinessContext: ReadinessContext,
  apps: readonly ScopedApp[],
): Promise<(PlayReadinessApi | null)[]> {
  const clients: (PlayReadinessApi | null)[] = [];

  for (const app of apps) {
    const client = await readinessContext.resolvePlayApi(app.identifier);
    clients.push(client);
  }

  return clients;
}

async function readFirstUpload(api: PlayReadinessApi, app: ScopedApp): Promise<AppReadiness> {
  try {
    const versionCode = await api.getLatestVersionCode(app.identifier);

    const hasUpload = versionCode > 0;

    if (hasUpload) {
      return {
        app: app.name,
        identifier: app.identifier,
        status: 'ok',
        detail: `latest uploaded versionCode ${versionCode}`,
      };
    }

    return {
      app: app.name,
      identifier: app.identifier,
      status: 'blocker',
      detail: 'no uploaded build - Play blocks API submission until the first build is uploaded',
      hint: 'upload the first build once in Play Console (a manual AAB upload satisfies this)',
    };
  } catch (apiFailure) {
    return {
      app: app.name,
      identifier: app.identifier,
      status: 'warn',
      detail: `could not read uploads: ${errorMessage(apiFailure)}`,
      hint: 'confirm the app exists and the service account has access (see the app-access check)',
    };
  }
}

/** The Google Play first-upload readiness probe. */
export const playFirstUploadProbe = {
  id: 'play-first-upload',
  title: 'First build uploaded to Play',
  store: 'play',
  categories: ['account'],
  async check(readinessContext: ReadinessContext): Promise<ProbeResult> {
    const apps = androidApps(readinessContext.apps);

    const isNothingSelected = apps.length == 0;

    if (isNothingSelected) {
      return OMITTED_PROBE;
    }

    const appClients = await readPlayClients(readinessContext, apps);

    const isEveryClientMissing = appClients.every(isPlayClientMissing);

    if (isEveryClientMissing) {
      return SKIPPED_NO_PLAY_ACCOUNT;
    }

    function readUpload(app: ScopedApp, index: number): Promise<AppReadiness> {
      const api = appClients[index];

      if (isPlayClientMissing(api)) {
        return Promise.resolve({
          app: app.name,
          identifier: app.identifier,
          status: 'blocker',
          detail: 'No Play service account for this package.',
        });
      }

      return readFirstUpload(api, app);
    }

    const findings = await Promise.all(apps.map(readUpload));

    return { state: 'checked', apps: findings };
  },
} satisfies ReadinessProbe;
