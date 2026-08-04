import type { AppDescriptor } from '../types/app.js';
/** An app scoped to one store, with the relevant identifier guaranteed present. */
export type ScopedApp = {
  name: string;
  identifier: string;
};
export const iosApps = (apps: AppDescriptor[]): ScopedApp[] => {
  return apps.flatMap((app) => {
    if (app.bundleId) return [{ name: app.name, identifier: app.bundleId }];
    return [];
  });
};
export const androidApps = (apps: AppDescriptor[]): ScopedApp[] => {
  return apps.flatMap((app) => {
    if (app.packageName) return [{ name: app.name, identifier: app.packageName }];
    return [];
  });
};
