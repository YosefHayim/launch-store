import type { AppDescriptor } from '../types/app.ts';

/** An app scoped to one store, with the relevant identifier guaranteed present. */
type ScopedApp = {
  name: string;
  identifier: string;
};
export const iosApps = (apps: readonly AppDescriptor[]): ScopedApp[] => {
  return apps.flatMap((app) => {
    if (app.bundleId) return [{ name: app.name, identifier: app.bundleId }];

    return [];
  });
};
export const androidApps = (apps: readonly AppDescriptor[]): ScopedApp[] => {
  return apps.flatMap((app) => {
    if (app.packageName) return [{ name: app.name, identifier: app.packageName }];

    return [];
  });
};
