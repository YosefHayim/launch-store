// Checks that declared in-app purchase and subscription ids appear in the app source.

import type { Stats } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { errorMessage } from '@/services/platform/error-message.js';
import type { AppDescriptor } from '@/types/app.js';
import type {
  AppReadiness,
  ProbeResult,
  ReadinessContext,
  ReadinessProbe,
} from '@/types/readiness.js';
import { walkAppSource } from '../source-scan.ts';
import { declaredAppleProductIds } from './in-app-purchase-readiness.ts';
import { OMITTED_PROBE } from './credentials-skip.ts';

const scannableExtensions = new Set([
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.mjs',
  '.cjs',
  '.json',
  '.swift',
  '.m',
  '.mm',
  '.h',
  '.kt',
  '.java',
]);

type ScopedApp = {
  name: string;
  identifier: string;
  directory: string;
  productIds: string[];
};

function hasBundleId(app: AppDescriptor): app is AppDescriptor & { bundleId: string } {
  return app.bundleId != null;
}

function productLabel(productCount: number): string {
  const isSingle = productCount == 1;

  if (isSingle) {
    return 'product id';
  }

  return 'product ids';
}

function scopedProductApp(
  readinessContext: ReadinessContext,
  app: AppDescriptor & { bundleId: string },
): ScopedApp | null {
  const productIds = declaredAppleProductIds(readinessContext.config.products?.[app.bundleId]);

  const isUndeclared = productIds.length == 0;

  if (isUndeclared) {
    return null;
  }

  return {
    name: app.name,
    identifier: app.bundleId,
    directory: app.dir,
    productIds,
  };
}

function readScopedApp(readinessContext: ReadinessContext, app: AppDescriptor): ScopedApp | null {
  if (hasBundleId(app)) {
    return scopedProductApp(readinessContext, app);
  }

  return null;
}

async function findReferencedIds(
  appDirectory: string,
  productIds: readonly string[],
): Promise<Set<string>> {
  const maxFileBytes = 512 * 1024;
  const maxScanBytes = 8 * 1024 * 1024;
  const referencedIds = new Set<string>();
  const pendingIds = new Set(productIds);
  let bytesScanned = 0;

  async function inspectSourceFile(filePath: string, fileExtension: string): Promise<boolean> {
    const isScannable = scannableExtensions.has(fileExtension);

    if (isScannable == false) {
      return false;
    }

    let fileMetadata: Stats | null = null;

    try {
      fileMetadata = await stat(filePath);
    } catch (cause) {
      const isUnreadable = errorMessage(cause) != '';

      if (isUnreadable) {
        return false;
      }

      return false;
    }

    const isOversized = fileMetadata.size > maxFileBytes;

    if (isOversized) {
      return false;
    }

    const wouldExceedCap = bytesScanned + fileMetadata.size > maxScanBytes;

    if (wouldExceedCap) {
      return true;
    }

    let sourceText = '';

    try {
      sourceText = await readFile(filePath, 'utf8');
    } catch (cause) {
      const isUnreadable = errorMessage(cause) != '';

      if (isUnreadable) {
        sourceText = '';
      }
    }

    bytesScanned += fileMetadata.size;

    for (const productId of pendingIds) {
      const isReferenced = sourceText.includes(productId);

      if (isReferenced) {
        referencedIds.add(productId);
        pendingIds.delete(productId);
      }
    }

    return pendingIds.size == 0;
  }

  await walkAppSource(appDirectory, inspectSourceFile);

  return referencedIds;
}

async function readCodeReference(app: ScopedApp): Promise<AppReadiness> {
  const referencedIds = await findReferencedIds(app.directory, app.productIds);

  function isMissing(productId: string): boolean {
    return referencedIds.has(productId) == false;
  }

  const missingIds = app.productIds.filter(isMissing);

  const isComplete = missingIds.length == 0;

  if (isComplete) {
    return {
      app: app.name,
      identifier: app.identifier,
      status: 'ok',
      detail: `all ${app.productIds.length} declared ${productLabel(app.productIds.length)} referenced in source`,
    };
  }

  return {
    app: app.name,
    identifier: app.identifier,
    status: 'warn',
    detail: `${missingIds.length} declared ${productLabel(missingIds.length)} not found in source: ${missingIds.join(', ')}`,
    hint: 'check for a typo or an orphaned product in launch.config.ts (native/generated dirs are skipped)',
  };
}

/** Check whether declared App Store products appear in local app source. */
export const iapCodeReferenceProbe = {
  id: 'apple-iap-code-reference',
  title: 'Product ids referenced in app code',
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

    const findings = await Promise.all(scopedApps.map(readCodeReference));

    return { state: 'checked', apps: findings };
  },
} satisfies ReadinessProbe;
