import { describe, expect, it } from 'vitest';
import { DEFAULT_SIZE_BUDGET_MB } from '../build/pipelineTypes.js';
import type { LastFlow } from '../distribution/lastRun.js';
import type { AppDescriptor } from '../types/app.js';
import type { LaunchConfig } from '../types/config.js';
import {
  flowInvalidReason,
  formatFlowSummary,
  profileBudgetMB,
  validateCustomBudget,
} from './wizardCommand.js';

const configWith = (profileNames: string[]): LaunchConfig => ({
  profiles: Object.fromEntries(
    profileNames.map((profileName) => [profileName, { name: profileName }]),
  ),
  credentials: 'local',
  storage: 'local',
  buildEngine: 'fastlane',
  submit: 'app-store-connect',
});

const configuredApp = (identifiers: {
  bundleId?: string;
  packageName?: string;
}): AppDescriptor => ({
  name: 'sampleapp',
  dir: '/tmp/sampleapp',
  configPath: '/tmp/sampleapp/app.json',
  ...identifiers,
});

const iosApp = configuredApp({ bundleId: 'com.example.sampleapp' });
const androidApp = configuredApp({ packageName: 'com.example.sampleapp' });
const iosFlow: LastFlow = {
  platform: 'ios',
  location: 'local',
  profile: 'production',
  submit: true,
  account: 'ABC123',
};

describe('wizard flow helpers', () => {
  it('formats Apple and Android build summaries', () => {
    expect(formatFlowSummary(iosFlow)).toBe('ios - This Mac - production - upload');
    expect(
      formatFlowSummary({
        platform: 'android',
        location: 'local',
        profile: 'production',
        submit: false,
      }),
    ).toBe('android - production - build only');
  });

  it('rejects stale platform, profile, account, and SSH choices', () => {
    const launchConfig = configWith(['production']);
    expect(flowInvalidReason(iosFlow, launchConfig, [androidApp], new Set(['ABC123']))).toBe(
      'no ios app configured',
    );
    expect(flowInvalidReason(iosFlow, configWith(['staging']), [iosApp], new Set(['ABC123']))).toBe(
      'profile "production" no longer exists',
    );
    expect(flowInvalidReason(iosFlow, launchConfig, [iosApp], new Set())).toBe(
      'the Apple account it used is no longer registered',
    );
    expect(
      flowInvalidReason(
        { ...iosFlow, location: 'ssh' },
        launchConfig,
        [iosApp],
        new Set(['ABC123']),
      ),
    ).toBe('the remembered SSH flow has no target');
  });

  it('accepts valid Apple and Android remembered flows', () => {
    expect(
      flowInvalidReason(iosFlow, configWith(['production']), [iosApp], new Set(['ABC123'])),
    ).toBeNull();
    expect(
      flowInvalidReason(
        {
          platform: 'android',
          location: 'local',
          profile: 'production',
          submit: true,
        },
        configWith(['production']),
        [androidApp],
        new Set(),
      ),
    ).toBeNull();
  });

  it('uses the profile budget and validates custom overrides', () => {
    const launchConfig = configWith(['production']);
    expect(profileBudgetMB(launchConfig, 'production')).toBe(DEFAULT_SIZE_BUDGET_MB);
    launchConfig.profiles['production'] = { name: 'production', sizeBudgetMB: 150 };
    expect(profileBudgetMB(launchConfig, 'production')).toBe(150);
    expect(validateCustomBudget('199.5')).toBeUndefined();
    expect(validateCustomBudget('large')).toBe('Enter a number of megabytes.');
    expect(validateCustomBudget('0')).toBe('Enter a budget greater than 0 MB.');
  });
});
