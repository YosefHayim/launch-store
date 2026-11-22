import type {
  AppReadiness,
  PlayReadinessApi,
  ProbeResult,
  ReadinessContext,
  ReadinessProbe,
} from '../../types/readiness.ts';
import { errorMessage } from '../../services/platform/error-message.ts';
import { androidApps } from '../app-scopes.ts';
import { OMITTED_PROBE, SKIPPED_NO_PLAY_ACCOUNT } from './credentials-skip.ts';

type ScopedApp = { name: string; identifier: string };

function isPlayClientMissing(api: PlayReadinessApi | null | undefined): api is null | undefined {
  return api == null;
}

function isInternalTrack(track: { track: string }): boolean {
  return track.track == 'internal';
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

async function readInternalTrack(api: PlayReadinessApi, app: ScopedApp): Promise<AppReadiness> {
  try {
    const tracks = await api.listTracks(app.identifier);
    const hasInternalTrack = tracks.some(isInternalTrack);

    if (hasInternalTrack) {
      return {
        app: app.name,
        identifier: app.identifier,
        status: 'ok',
        detail: 'internal track available',
      };
    }

    return {
      app: app.name,
      identifier: app.identifier,
      status: 'warn',
      detail: 'no internal testing track',
      hint: 'create an internal testing track in Play Console for the fastest tester rollout',
    };
  } catch (apiFailure) {
    return {
      app: app.name,
      identifier: app.identifier,
      status: 'warn',
      detail: `could not read tracks: ${errorMessage(apiFailure)}`,
      hint: 'confirm the app exists and the service account has access (see the app-access check)',
    };
  }
}

/** The Google Play internal-track readiness probe. */
export const playInternalTrackProbe = {
  id: 'play-internal-track',
  title: 'Internal testing track ready',
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

    function readTrack(app: ScopedApp, index: number): Promise<AppReadiness> {
      const api = appClients[index];

      if (isPlayClientMissing(api)) {
        return Promise.resolve({
          app: app.name,
          identifier: app.identifier,
          status: 'blocker',
          detail: 'No Play service account for this package.',
        });
      }

      return readInternalTrack(api, app);
    }

    const findings = await Promise.all(apps.map(readTrack));

    return { state: 'checked', apps: findings };
  },
} satisfies ReadinessProbe;
