import { Effect } from 'effect';
import type {
  AppReadiness,
  ProbeResult,
  ReadinessContext,
  ReadinessProbe,
} from '@core/types/readiness.js';
/** The iOS export-compliance declaration readiness probe (config-only). */
export const exportComplianceProbe = {
  id: 'apple-export-compliance',
  title: 'iOS export-compliance declared',
  store: 'appstore',
  categories: ['submit'],
  /**
   * Read local Expo export-compliance declarations for iOS apps.
   *
   * @param readinessContext - Loaded config and selected app scope for the readiness run.
   * @returns An Effect that succeeds with per-app export-compliance findings.
   */
  check(readinessContext: ReadinessContext): Effect.Effect<ProbeResult> {
    return Effect.sync(() => {
      const apps = readinessContext.apps.flatMap((app) => {
        if (app.bundleId) {
          return [
            { name: app.name, identifier: app.bundleId, declared: app.usesNonExemptEncryption },
          ];
        }
        return [];
      });
      if (apps.length === 0) return { state: 'omitted' };
      const results: AppReadiness[] = apps.map(({ name, identifier, declared }) => {
        if (declared === undefined) {
          return {
            app: name,
            identifier,
            status: 'warn',
            detail: 'export compliance not declared',
            hint: 'set `ios.config.usesNonExemptEncryption` in app.json so uploads skip the Missing-Compliance hold',
          };
        }
        return {
          app: name,
          identifier,
          status: 'ok',
          detail: `export compliance declared (usesNonExemptEncryption: ${declared})`,
        };
      });
      return { state: 'checked', apps: results };
    });
  },
} satisfies ReadinessProbe;
