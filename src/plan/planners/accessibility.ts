// Compares App Store Connect accessibility declarations with the local config.

import { launchConfigForApp } from '../../config/config.ts';
import { reconcileAccessibility, type AccessibilityConfig } from '../../apple/accessibility.ts';
import { planAppStoreSurface } from './app-store-surface.ts';
import type { AppDescriptor } from '../../types/app.ts';
import type { AscSurfacesApi, SurfacePlanner } from '../../types/plan.ts';

/** Surface id - also the value users pass as `launch-store plan accessibility`. */
const SURFACE = 'accessibility';

export const accessibilityPlanner: SurfacePlanner = {
  id: SURFACE,
  store: 'appstore',
  plan(planContext) {
    async function readAccessibilitySection(
      bundleId: string,
    ): Promise<AccessibilityConfig | undefined> {
      function hasThisBundle(discoveredApp: AppDescriptor): boolean {
        return discoveredApp.bundleId == bundleId;
      }

      const discoveredApp = planContext.apps.find(hasThisBundle);
      const isAppMissing = discoveredApp == null;

      if (isAppMissing) {
        return planContext.config.accessibility?.[bundleId];
      }

      const launchFile = await launchConfigForApp(planContext.config, discoveredApp.dir);

      return launchFile.accessibility?.[bundleId];
    }

    function reconcileAccessibilitySection(
      api: AscSurfacesApi,
      bundleId: string,
      accessibilitySection: AccessibilityConfig,
    ) {
      return reconcileAccessibility(api, {
        bundleId,
        config: accessibilitySection,
        dryRun: true,
      });
    }

    return planAppStoreSurface(planContext, {
      surface: SURFACE,
      direction: 'additive',
      configFor: readAccessibilitySection,
      reconcile: reconcileAccessibilitySection,
    });
  },
};
