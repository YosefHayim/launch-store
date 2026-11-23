// Compares App Store Connect version experiments with the local config.

import { join } from 'node:path';
import { launchConfigForApp } from '../../config/config.ts';
import {
  discoverTreatmentScreenshots,
  reconcileVersionExperiments,
  type VersionExperimentsConfig,
} from '../../release/version-experiments.ts';
import { planAppStoreSurface } from './app-store-surface.ts';
import type { LocalScreenshot } from '../../listing/screenshots/assets.ts';
import type { AppDescriptor } from '../../types/app.ts';
import type { LaunchConfig } from '../../types/config.ts';
import type { AscSurfacesApi, SurfacePlanner } from '../../types/plan.ts';

const SURFACE = 'experiments';

type ExperimentPlanTarget = {
  experimentsSection: VersionExperimentsConfig;
  treatmentScreenshots: ReadonlyMap<string, readonly LocalScreenshot[]>;
};

export const experimentsPlanner: SurfacePlanner = {
  id: SURFACE,
  store: 'appstore',
  plan(planContext) {
    function pickScreenshotDirectory(launchFile: LaunchConfig, appDirectory: string): string {
      const isAppLaunchFile = Object.is(launchFile, planContext.config) == false;

      if (isAppLaunchFile) {
        return appDirectory;
      }

      const walkedUpDirectory = planContext.configDirectory;
      const hasWalkedUpDirectory = walkedUpDirectory != null;

      if (hasWalkedUpDirectory) {
        return walkedUpDirectory;
      }

      return appDirectory;
    }

    async function loadExperimentScreenshots(
      screenshotDirectory: string,
      experimentsSection: VersionExperimentsConfig,
    ): Promise<ExperimentPlanTarget> {
      const launchFilePath = join(screenshotDirectory, 'launch.config.ts');
      const treatmentScreenshots = await discoverTreatmentScreenshots(
        launchFilePath,
        experimentsSection,
      );

      return { experimentsSection, treatmentScreenshots };
    }

    async function experimentsInDirectory(
      launchFile: LaunchConfig,
      screenshotDirectory: string,
      bundleId: string,
    ): Promise<ExperimentPlanTarget | undefined> {
      const experimentsSection = launchFile.experiments?.[bundleId];
      const isUndeclared = experimentsSection == null;

      if (isUndeclared) {
        return undefined;
      }

      return loadExperimentScreenshots(screenshotDirectory, experimentsSection);
    }

    async function experimentsFromWalkedUpFile(
      bundleId: string,
    ): Promise<ExperimentPlanTarget | undefined> {
      const experimentsSection = planContext.config.experiments?.[bundleId];
      const isUndeclared = experimentsSection == null;

      if (isUndeclared) {
        return undefined;
      }

      const walkedUpDirectory = planContext.configDirectory;
      const isDirectoryMissing = walkedUpDirectory == null;

      if (isDirectoryMissing) {
        throw new Error('No directory for experiment screenshots.');
      }

      return loadExperimentScreenshots(walkedUpDirectory, experimentsSection);
    }

    async function readExperimentsSection(
      bundleId: string,
    ): Promise<ExperimentPlanTarget | undefined> {
      function hasThisBundle(discoveredApp: AppDescriptor): boolean {
        return discoveredApp.bundleId == bundleId;
      }

      const discoveredApp = planContext.apps.find(hasThisBundle);
      const isAppMissing = discoveredApp == null;

      if (isAppMissing) {
        return experimentsFromWalkedUpFile(bundleId);
      }

      const launchFile = await launchConfigForApp(planContext.config, discoveredApp.dir);
      const screenshotDirectory = pickScreenshotDirectory(launchFile, discoveredApp.dir);

      return experimentsInDirectory(launchFile, screenshotDirectory, bundleId);
    }

    function reconcileExperiments(
      api: AscSurfacesApi,
      bundleId: string,
      experimentsTarget: ExperimentPlanTarget,
    ) {
      return reconcileVersionExperiments(api, {
        bundleId,
        config: experimentsTarget.experimentsSection,
        treatmentScreenshots: experimentsTarget.treatmentScreenshots,
        submit: false,
        start: false,
        dryRun: true,
      });
    }

    return planAppStoreSurface(planContext, {
      surface: SURFACE,
      direction: 'additive',
      configFor: readExperimentsSection,
      reconcile: reconcileExperiments,
    });
  },
};
