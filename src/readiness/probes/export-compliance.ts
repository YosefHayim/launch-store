// Checks that each iOS app declares export compliance before App Store Connect submission.

import type { AppDescriptor } from '@/types/app.js';
import type {
  AppReadiness,
  ProbeResult,
  ReadinessContext,
  ReadinessProbe,
} from '@/types/readiness.js';
import { OMITTED_PROBE } from './credentials-skip.ts';

type ComplianceApp = {
  name: string;
  identifier: string;
  declared: boolean | undefined;
};

function hasBundleId(app: AppDescriptor): app is AppDescriptor & { bundleId: string } {
  return app.bundleId != null;
}

function readComplianceApp(app: AppDescriptor): ComplianceApp | null {
  if (hasBundleId(app)) {
    return {
      name: app.name,
      identifier: app.bundleId,
      declared: app.usesNonExemptEncryption,
    };
  }

  return null;
}

function listComplianceApps(readinessContext: ReadinessContext): ComplianceApp[] {
  const complianceApps: ComplianceApp[] = [];

  for (const app of readinessContext.apps) {
    const complianceApp = readComplianceApp(app);

    const isOutsideScope = complianceApp == null;

    if (isOutsideScope) {
      continue;
    }

    complianceApps.push(complianceApp);
  }

  return complianceApps;
}

function gradeCompliance(app: ComplianceApp): AppReadiness {
  const isUndeclared = app.declared == null;

  if (isUndeclared) {
    return {
      app: app.name,
      identifier: app.identifier,
      status: 'warn',
      detail: 'export compliance not declared',
      hint: 'set `ios.config.usesNonExemptEncryption` in app.json so uploads skip the Missing-Compliance hold',
    };
  }

  return {
    app: app.name,
    identifier: app.identifier,
    status: 'ok',
    detail: `export compliance declared (usesNonExemptEncryption: ${app.declared})`,
  };
}

/** The iOS export-compliance declaration readiness probe (config-only). */
export const exportComplianceProbe = {
  id: 'apple-export-compliance',
  title: 'iOS export-compliance declared',
  store: 'appstore',
  categories: ['submit'],
  async check(readinessContext: ReadinessContext): Promise<ProbeResult> {
    const apps = listComplianceApps(readinessContext);

    const isNothingSelected = apps.length == 0;

    if (isNothingSelected) {
      return OMITTED_PROBE;
    }

    const findings = apps.map(gradeCompliance);

    return { state: 'checked', apps: findings };
  },
} satisfies ReadinessProbe;
