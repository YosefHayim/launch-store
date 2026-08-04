import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';
import type { AppDescriptor } from '../types/app.js';
import { AdoptCommandInputSchema, selectAdoptApps } from './command.js';

const discoveredApp = (appName: string): AppDescriptor => ({
  name: appName,
  dir: `/workspace/${appName}`,
  configPath: `/workspace/${appName}/app.json`,
});

describe('AdoptCommandInputSchema', () => {
  it('defaults to every app without mutation or confirmation overrides', async () => {
    const commandInput = await Effect.runPromise(Schema.decodeUnknown(AdoptCommandInputSchema)({}));
    expect(commandInput).toEqual({ all: false, dryRun: false, yes: false });
  });
});

describe('selectAdoptApps', () => {
  const apps = [discoveredApp('alpha'), discoveredApp('beta')];

  it('returns every discovered app when no selector is supplied', async () => {
    const selectedApps = await Effect.runPromise(selectAdoptApps(apps, undefined));
    expect(selectedApps.map((selectedApp) => selectedApp.name)).toEqual(['alpha', 'beta']);
  });

  it('keeps the order requested by the comma-separated selector', async () => {
    const selectedApps = await Effect.runPromise(selectAdoptApps(apps, 'beta, alpha'));
    expect(selectedApps.map((selectedApp) => selectedApp.name)).toEqual(['beta', 'alpha']);
  });

  it('fails with the discovered handles when a selector is unknown', async () => {
    await expect(Effect.runPromise(selectAdoptApps(apps, 'missing'))).rejects.toThrow(
      /Discovered apps: alpha, beta/,
    );
  });
});
