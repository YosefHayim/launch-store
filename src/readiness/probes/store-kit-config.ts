import { relative } from 'node:path';
import type { AppDescriptor } from '../../types/app.ts';
import type {
  AppReadiness,
  ProbeResult,
  ReadinessContext,
  ReadinessProbe,
} from '../../types/readiness.ts';
import { walkAppSource } from '../source-scan.ts';
import { declaredAppleProductIds } from './iap-readiness.ts';
import { OMITTED_PROBE } from './credentials-skip.ts';

type ScopedApp = { name: string; identifier: string; directory: string };

function hasBundleId(app: AppDescriptor): app is AppDescriptor & { bundleId: string } {
  return app.bundleId != null;
}

function scopedProductApp(
  readinessContext: ReadinessContext,
  app: AppDescriptor & { bundleId: string },
): ScopedApp | null {
  const declaresProducts =
    declaredAppleProductIds(readinessContext.config.products?.[app.bundleId]).length > 0;

  if (declaresProducts == false) {
    return null;
  }

  return { name: app.name, identifier: app.bundleId, directory: app.dir };
}

function readScopedApp(readinessContext: ReadinessContext, app: AppDescriptor): ScopedApp | null {
  if (hasBundleId(app)) {
    return scopedProductApp(readinessContext, app);
  }

  return null;
}

async function findStoreKitConfig(appDirectory: string): Promise<string | null> {
  let matchedConfigPath: string | null = null;

  async function inspectStoreKitFile(filePath: string, fileExtension: string): Promise<boolean> {
    const isStoreKit = fileExtension == '.storekit';

    if (isStoreKit == false) {
      return false;
    }

    matchedConfigPath = relative(appDirectory, filePath);

    return true;
  }

  await walkAppSource(appDirectory, inspectStoreKitFile);

  return matchedConfigPath;
}

function isConfigMissing(configPath: string | null): configPath is null {
  return configPath == null;
}

async function readStoreKitConfig(app: ScopedApp): Promise<AppReadiness> {
  const configPath = await findStoreKitConfig(app.directory);

  if (isConfigMissing(configPath)) {
    return {
      app: app.name,
      identifier: app.identifier,
      status: 'warn',
      detail: 'no .storekit configuration file found',
      hint: 'add a StoreKit configuration file in Xcode to test purchases on the simulator before submitting',
    };
  }

  return {
    app: app.name,
    identifier: app.identifier,
    status: 'ok',
    detail: `StoreKit config present (${configPath})`,
  };
}

/** Check that product-selling iOS apps include a StoreKit test configuration. */
export const storeKitConfigProbe = {
  id: 'apple-storekit-config',
  title: 'StoreKit config file present',
  store: 'appstore',
  categories: ['iap'],
  async check(readinessContext: ReadinessContext): Promise<ProbeResult> {
    const scopedApps: ScopedApp[] = [];

    for (const configuredApp of readinessContext.apps) {
      const scopedApp = readScopedApp(readinessContext, configuredApp);
      const isOutsideScope = scopedApp == null;

      if (isOutsideScope) {
        continue;
      }

      scopedApps.push(scopedApp);
    }

    const isNothingSelected = scopedApps.length == 0;

    if (isNothingSelected) {
      return OMITTED_PROBE;
    }

    const findings = await Promise.all(scopedApps.map(readStoreKitConfig));

    return { state: 'checked', apps: findings };
  },
} satisfies ReadinessProbe;
