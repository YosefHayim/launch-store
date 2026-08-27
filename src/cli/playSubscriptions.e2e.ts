import { Effect } from 'effect';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { captureCommandOutput, provideNodeCommandServices } from '../core/services/exec.js';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist', 'cli', 'index.js');
const PLAY_SUBSCRIPTIONS = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'dist',
  'core',
  'store',
  'playSubscriptions.js',
);

const launch = (...commandArguments: string[]): Promise<string> =>
  Effect.runPromise(
    provideNodeCommandServices(captureCommandOutput('node', [CLI, ...commandArguments])),
  );

const renderBuiltDiagnostics = (): Promise<string> => {
  const playSubscriptionsUrl = pathToFileURL(PLAY_SUBSCRIPTIONS).href;
  const diagnosticScript = `
    import { describePlaySubscriptionWriteFailure } from ${JSON.stringify(playSubscriptionsUrl)};
    const permission = describePlaySubscriptionWriteFailure(
      'The caller does not have permission',
      'com.acme.app',
      'launch-catalog@proj.iam.gserviceaccount.com',
    );
    const payments = describePlaySubscriptionWriteFailure(
      'Cannot create a subscription without first registering a payments profile for the developer account.',
      'com.acme.app',
      'launch-catalog@proj.iam.gserviceaccount.com',
    );
    process.stdout.write(JSON.stringify({ permission, payments }));
  `;
  return Effect.runPromise(
    provideNodeCommandServices(
      captureCommandOutput('node', ['--input-type=module', '--eval', diagnosticScript]),
    ),
  );
};

beforeAll(() => {
  if (!existsSync(CLI)) throw new Error('Build dist before running the built-CLI e2e suite.');
  if (!existsSync(PLAY_SUBSCRIPTIONS)) {
    throw new Error('The built Play subscriptions program is missing from dist.');
  }
});

describe('launch play-subscriptions setup guidance - compiled dist', () => {
  it('ships the distinct catalog permission and payments-profile fixes', async () => {
    expect(await launch('play-subscriptions', '--help')).toContain('play-subscriptions');
    const diagnosticText = await renderBuiltDiagnostics();
    expect(diagnosticText).toContain('launch-catalog@proj.iam.gserviceaccount.com');
    expect(diagnosticText).toContain('Manage store presence');
    expect(diagnosticText).toContain('Admin (all permissions)');
    expect(diagnosticText).toContain('View financial data');
    expect(diagnosticText).toContain('Manage orders and subscriptions');
    expect(diagnosticText).toContain(
      'https://play.google.com/console/developers/users-and-permissions',
    );
    expect(diagnosticText).toContain('Setup > Payments profile');
    expect(diagnosticText).toContain('https://play.google.com/console/developers/paymentssettings');
  });
});
