// Chooses the configured app a credentials command should change.

import { LaunchPrompt } from '../services/platform/prompt.ts';
import type { AppDescriptor } from '../types/app.ts';
import { failCommand } from './credentials-failure.ts';

async function findConfiguredApp(
  apps: readonly AppDescriptor[],
  requestedApp: string,
): Promise<AppDescriptor> {
  for (const configuredApp of apps) {
    const isRequestedApp = configuredApp.name == requestedApp;

    if (isRequestedApp) {
      return configuredApp;
    }
  }

  failCommand('select app', `No configured app named "${requestedApp}".`);
}

export async function selectConfiguredApp(
  apps: readonly AppDescriptor[],
  requestedApp: string | undefined,
  canPrompt: boolean,
): Promise<AppDescriptor> {
  if (requestedApp != null) {
    return findConfiguredApp(apps, requestedApp);
  }

  const onlyApp = apps[0];

  if (apps.length == 1) {
    if (onlyApp != null) {
      return onlyApp;
    }
  }

  if (canPrompt == false) {
    failCommand('select app', 'Pass --app <name>.');
  }

  if (apps.length == 0) {
    failCommand('select app', 'No applications were discovered.');
  }

  return new LaunchPrompt().select({
    message: 'Choose an app:',
    choices: apps.map(function appChoice(configuredApp: AppDescriptor) {
      return { selection: configuredApp, label: configuredApp.name };
    }),
  });
}
