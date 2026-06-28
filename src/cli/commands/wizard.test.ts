import { describe, expect, it } from 'vitest';
import type { AppDescriptor, LaunchConfig } from '../../core/types.js';
import type { LastFlow } from '../../core/lastRun.js';
import {
  flowInvalidReason,
  formatFlowSummary,
  profileBudgetMB,
  validateCustomBudget,
} from './wizard.js';
import { DEFAULT_SIZE_BUDGET_MB } from '../../core/pipeline.js';

/** A minimal valid {@link LaunchConfig} with the given profile names (each a bare profile). */
function configWith(profileNames: string[]): LaunchConfig {
  return {
    profiles: Object.fromEntries(profileNames.map((name) => [name, { name }])),
    credentials: 'local',
    storage: 'local',
    buildEngine: 'fastlane',
    submit: 'app-store-connect',
  };
}

/** A discovered app declaring the given platform ids. */
function app(ids: { bundleId?: string; packageName?: string }): AppDescriptor {
  return { name: 'pomedero', dir: '/tmp/pomedero', configPath: '/tmp/pomedero/app.json', ...ids };
}

const IOS_APP = app({ bundleId: 'com.loopi.pomedero' });
const ANDROID_APP = app({ packageName: 'com.loopi.pomedero' });

const IOS_FLOW: LastFlow = {
  platform: 'ios',
  location: 'local',
  profile: 'production',
  submit: true,
  account: 'ABC123',
};

describe('formatFlowSummary — the one-line repeat-build summary', () => {
  it('shows the build location for iOS', () => {
    expect(formatFlowSummary(IOS_FLOW)).toBe('ios · This Mac · production · upload');
  });

  it('renders each iOS location with its wizard label', () => {
    expect(formatFlowSummary({ ...IOS_FLOW, location: 'aws' })).toContain('AWS cloud Mac');
    expect(
      formatFlowSummary({ ...IOS_FLOW, location: 'ssh', sshTarget: 'ec2-user@host' }),
    ).toContain('Mac over SSH');
    expect(formatFlowSummary({ ...IOS_FLOW, location: 'eas' })).toContain('Expo EAS');
  });

  it("omits the location for Android and says 'build only' when not uploading", () => {
    const flow: LastFlow = {
      platform: 'android',
      location: 'local',
      profile: 'production',
      submit: false,
    };
    expect(formatFlowSummary(flow)).toBe('android · production · build only');
  });
});

describe('flowInvalidReason — gates whether a repeat is offered', () => {
  const accounts = new Set(['ABC123']);

  it('returns null for a fully resolvable iOS flow', () => {
    expect(flowInvalidReason(IOS_FLOW, configWith(['production']), [IOS_APP], accounts)).toBeNull();
  });

  it('returns null for a resolvable Android flow (no account needed)', () => {
    const flow: LastFlow = {
      platform: 'android',
      location: 'local',
      profile: 'production',
      submit: true,
    };
    expect(
      flowInvalidReason(flow, configWith(['production']), [ANDROID_APP], new Set()),
    ).toBeNull();
  });

  it('rejects a flow whose platform is no longer configured', () => {
    expect(flowInvalidReason(IOS_FLOW, configWith(['production']), [ANDROID_APP], accounts)).toBe(
      'no ios app configured',
    );
  });

  it('rejects a flow whose profile was removed', () => {
    expect(flowInvalidReason(IOS_FLOW, configWith(['staging']), [IOS_APP], accounts)).toBe(
      'profile "production" no longer exists',
    );
  });

  it('accepts any profile when the config defines none (the pipeline default applies)', () => {
    expect(flowInvalidReason(IOS_FLOW, configWith([]), [IOS_APP], accounts)).toBeNull();
  });

  it('rejects an iOS flow whose Apple account is gone', () => {
    expect(flowInvalidReason(IOS_FLOW, configWith(['production']), [IOS_APP], new Set())).toBe(
      'the Apple account it used is no longer registered',
    );
  });

  it('rejects an SSH flow that lost its target', () => {
    const flow: LastFlow = {
      platform: 'ios',
      location: 'ssh',
      profile: 'production',
      submit: true,
      account: 'ABC123',
    };
    expect(flowInvalidReason(flow, configWith(['production']), [IOS_APP], accounts)).toBe(
      'the remembered SSH flow has no target',
    );
  });
});

describe('profileBudgetMB — the budget shown as the wizard default', () => {
  /** A config whose `production` profile declares the given size budget. */
  function configWithBudget(sizeBudgetMB: number): LaunchConfig {
    return {
      ...configWith(['production']),
      profiles: { production: { name: 'production', sizeBudgetMB } },
    };
  }

  it("returns the profile's declared budget", () => {
    expect(profileBudgetMB(configWithBudget(150), 'production')).toBe(150);
  });

  it('falls back to the default when the profile sets none', () => {
    expect(profileBudgetMB(configWith(['production']), 'production')).toBe(DEFAULT_SIZE_BUDGET_MB);
  });

  it('falls back to the default for an unknown profile', () => {
    expect(profileBudgetMB(configWith(['production']), 'staging')).toBe(DEFAULT_SIZE_BUDGET_MB);
  });
});

describe('validateCustomBudget — the wizard custom-budget input gate', () => {
  it('accepts a positive MB number (no error)', () => {
    expect(validateCustomBudget('250')).toBeUndefined();
    expect(validateCustomBudget('199.5')).toBeUndefined();
  });

  it('rejects non-numeric input', () => {
    expect(validateCustomBudget('big')).toBe('Enter a number of megabytes.');
    expect(validateCustomBudget('')).toBe('Enter a number of megabytes.');
  });

  it('rejects zero and negative budgets', () => {
    expect(validateCustomBudget('0')).toBe('Enter a budget greater than 0 MB.');
    expect(validateCustomBudget('-5')).toBe('Enter a budget greater than 0 MB.');
  });
});
