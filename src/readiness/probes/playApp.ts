import type {
  AppReadiness,
  PlayReadinessApi,
  ProbeResult,
  ReadinessContext,
  ReadinessProbe,
} from '../../types/readiness.ts';
import { errorMessage } from '../../services/platform/errorMessage.ts';
import { androidApps } from '../appScopes.ts';
import { OMITTED_PROBE, SKIPPED_NO_PLAY_ACCOUNT } from './credentialsSkip.ts';

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

async function readPlayApp(api: PlayReadinessApi, app: ScopedApp): Promise<AppReadiness> {
  try {
    await api.assertAppExists(app.identifier);

    return {
      app: app.name,
      identifier: app.identifier,
      status: 'ok',
      detail: 'app reachable; service account authorized',
    };
  } catch (apiFailure) {
    return {
      app: app.name,
      identifier: app.identifier,
      status: 'blocker',
      detail: errorMessage(apiFailure),
      hint: 'create the app in Play Console and grant the service account access to it',
    };
  }
}

/** The Google Play app-exists / service-account-access readiness probe - an account and a submit blocker. */
export const playAppProbe = {
  id: 'play-app-access',
  title: 'Play app exists & service account authorized',
  store: 'play',
  categories: ['account', 'submit'],
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

    function readAccess(app: ScopedApp, index: number): Promise<AppReadiness> {
      const api = appClients[index];

      if (isPlayClientMissing(api)) {
        return Promise.resolve({
          app: app.name,
          identifier: app.identifier,
          status: 'blocker',
          detail: 'No Play service account for this package.',
        });
      }

      return readPlayApp(api, app);
    }

    const findings = await Promise.all(apps.map(readAccess));

    return { state: 'checked', apps: findings };
  },
} satisfies ReadinessProbe;
