import { describe, expect, it } from 'vitest';
import {
  formatProvisioningReport,
  roleErrorMessage,
  type ProvisioningReport,
} from './setupCommand.js';

describe('roleErrorMessage', () => {
  it('names the inaccessible feature and points at the fix', () => {
    const message = roleErrorMessage('App ID capabilities');
    expect(message).toContain('App ID capabilities');
    expect(message).toContain('403');
    expect(message).toMatch(/Users & Access/);
  });
});

describe('formatProvisioningReport', () => {
  const readyReport: ProvisioningReport = {
    account: { label: 'Personal', keyId: 'ABC123', teamId: 'TEAM01' },
    app: { name: 'sampleapp', bundleId: 'com.example.sampleapp' },
    bundleIdRegistered: true,
    capabilities: ['PUSH_NOTIFICATIONS', 'ASSOCIATED_DOMAINS'],
    certificateSerial: 'AABBCC',
    profileName: 'Launch_com.example.sampleapp_AppStore',
    extensions: [],
    devices: [
      { name: 'iPhone 15', udid: '000-111', disabled: false },
      { name: 'Old iPad', udid: '222-333', disabled: true },
    ],
  };

  it('renders every section with the app heading and device lines', () => {
    const reportText = formatProvisioningReport(readyReport);
    expect(reportText).toContain('sampleapp (com.example.sampleapp)');
    expect(reportText).toContain('Personal (key ABC123, team TEAM01)');
    expect(reportText).toContain('registered');
    expect(reportText).toContain('PUSH_NOTIFICATIONS, ASSOCIATED_DOMAINS');
    expect(reportText).toContain('iPhone 15 - 000-111');
    expect(reportText).toContain('Old iPad - 222-333 (disabled)');
  });

  it('flags each gap when nothing is provisioned yet', () => {
    const reportText = formatProvisioningReport({
      ...readyReport,
      account: { label: 'Work', keyId: 'ZZZ999', teamId: null },
      bundleIdRegistered: false,
      capabilities: [],
      certificateSerial: null,
      profileName: null,
      devices: [],
    });
    expect(reportText).toContain('Work (key ZZZ999)');
    expect(reportText).not.toContain('team');
    expect(reportText).toContain('NOT registered');
    expect(reportText).toContain('none enabled');
    expect(reportText).toContain('none cached');
    expect(reportText).toContain('none (add with');
  });

  it('lists declared extensions with each provisioning status', () => {
    const reportText = formatProvisioningReport({
      ...readyReport,
      extensions: [
        { bundleId: 'com.example.sampleapp.widget', provisioned: true },
        { bundleId: 'com.example.sampleapp.share', provisioned: false },
      ],
    });
    expect(reportText).toContain('extensions:   2 declared');
    expect(reportText).toContain('com.example.sampleapp.widget - profile cached');
    expect(reportText).toContain('com.example.sampleapp.share - not provisioned');
  });

  it('omits the extensions section when none are declared', () => {
    expect(formatProvisioningReport(readyReport)).not.toContain('extensions:');
  });
});
