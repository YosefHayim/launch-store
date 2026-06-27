import { describe, expect, it } from 'vitest';
import type {
  CustomProductPageLocalizationResource,
  CustomProductPageResource,
  CustomProductPageVersionResource,
} from '../apple/ascClient.js';
import {
  type AscCustomPagesApi,
  type CustomProductPagesConfig,
  parseCustomProductPagesConfig,
  reconcileCustomProductPages,
  summarizeCustomPages,
} from './customProductPages.js';

/** Records every write the reconciler makes. */
interface Calls {
  createdPages: string[];
  createdLocs: { versionId: string; locale: string; promotionalText: string }[];
  updatedLocs: { id: string; promotionalText: string }[];
}

/** State the fake API serves on reads. */
interface State {
  appId: string | null;
  pages: CustomProductPageResource[];
  versions: CustomProductPageVersionResource[];
  localizations: CustomProductPageLocalizationResource[];
}

function makeApi(state: Partial<State>): { api: AscCustomPagesApi; calls: Calls } {
  const full: State = {
    appId: 'app-1',
    pages: [],
    versions: [{ id: 'ver-1', state: 'PREPARE_FOR_SUBMISSION' }],
    localizations: [],
    ...state,
  };
  const calls: Calls = { createdPages: [], createdLocs: [], updatedLocs: [] };
  const api: AscCustomPagesApi = {
    getAppId: () => Promise.resolve(full.appId),
    listCustomProductPages: () => Promise.resolve(full.pages),
    createCustomProductPage: (_appId, name) => {
      calls.createdPages.push(name);
      return Promise.resolve({ id: 'page-new', name });
    },
    listCustomProductPageVersions: () => Promise.resolve(full.versions),
    listCustomProductPageLocalizations: () => Promise.resolve(full.localizations),
    createCustomProductPageLocalization: (versionId, locale, promotionalText) => {
      calls.createdLocs.push({ versionId, locale, promotionalText });
      return Promise.resolve();
    },
    updateCustomProductPageLocalization: (id, promotionalText) => {
      calls.updatedLocs.push({ id, promotionalText });
      return Promise.resolve();
    },
  };
  return { api, calls };
}

const CONFIG: CustomProductPagesConfig = {
  pages: [{ name: 'Spring Sale', promotionalText: { 'en-US': '50% off this week!' } }],
};

describe('parseCustomProductPagesConfig', () => {
  it('parses pages with promotional text', () => {
    const config = parseCustomProductPagesConfig(CONFIG);
    expect(config.pages[0]?.name).toBe('Spring Sale');
    expect(config.pages[0]?.promotionalText?.['en-US']).toBe('50% off this week!');
  });

  it('rejects a non-object, an empty list, a duplicate name, and bad promo text', () => {
    expect(() => parseCustomProductPagesConfig('nope')).toThrow(/must be a JSON object/);
    expect(() => parseCustomProductPagesConfig({ pages: [] })).toThrow(/at least one entry/);
    expect(() => parseCustomProductPagesConfig({ pages: [{ name: 'A' }, { name: 'A' }] })).toThrow(
      /duplicate page name "A"/,
    );
    expect(() =>
      parseCustomProductPagesConfig({ pages: [{ name: 'A', promotionalText: { 'en-US': '' } }] }),
    ).toThrow(/must be a non-empty string/);
  });
});

describe('reconcileCustomProductPages', () => {
  it('throws when the app has no App Store Connect record', async () => {
    const { api } = makeApi({ appId: null });
    await expect(
      reconcileCustomProductPages(api, { bundleId: 'com.acme.app', config: CONFIG, dryRun: true }),
    ).rejects.toThrow(/No App Store Connect app record/);
  });

  it('creates a missing page and sets its promotional text (apply)', async () => {
    const { api, calls } = makeApi({});
    const report = await reconcileCustomProductPages(api, {
      bundleId: 'com.acme.app',
      config: CONFIG,
      dryRun: false,
    });
    expect(calls.createdPages).toEqual(['Spring Sale']);
    expect(calls.createdLocs).toEqual([
      { versionId: 'ver-1', locale: 'en-US', promotionalText: '50% off this week!' },
    ]);
    expect(summarizeCustomPages(report.actions)).toEqual({ applied: 2, failed: 0, skipped: 0 });
  });

  it('updates promotional text on an existing page when it differs, and skips an identical one', async () => {
    const { api, calls } = makeApi({
      pages: [{ id: 'page-1', name: 'Spring Sale' }],
      localizations: [{ id: 'loc-1', locale: 'en-US', promotionalText: 'Old copy' }],
    });
    await reconcileCustomProductPages(api, {
      bundleId: 'com.acme.app',
      config: CONFIG,
      dryRun: false,
    });
    expect(calls.createdPages).toHaveLength(0); // page already exists
    expect(calls.updatedLocs).toEqual([{ id: 'loc-1', promotionalText: '50% off this week!' }]);

    const { api: api2, calls: calls2 } = makeApi({
      pages: [{ id: 'page-1', name: 'Spring Sale' }],
      localizations: [{ id: 'loc-1', locale: 'en-US', promotionalText: '50% off this week!' }],
    });
    const report = await reconcileCustomProductPages(api2, {
      bundleId: 'com.acme.app',
      config: CONFIG,
      dryRun: false,
    });
    expect(calls2.updatedLocs).toHaveLength(0); // identical → no-op
    expect(report.actions).toHaveLength(0);
  });

  it("skips promotional text when there's no editable version", async () => {
    const { api, calls } = makeApi({
      pages: [{ id: 'page-1', name: 'Spring Sale' }],
      versions: [{ id: 'ver-1', state: 'APPROVED' }],
    });
    const report = await reconcileCustomProductPages(api, {
      bundleId: 'com.acme.app',
      config: CONFIG,
      dryRun: false,
    });
    expect(calls.createdLocs).toHaveLength(0);
    expect(summarizeCustomPages(report.actions)).toEqual({ applied: 0, failed: 0, skipped: 1 });
  });

  it('plans but performs nothing on a dry-run (new page)', async () => {
    const { api, calls } = makeApi({});
    const report = await reconcileCustomProductPages(api, {
      bundleId: 'com.acme.app',
      config: CONFIG,
      dryRun: true,
    });
    expect(calls.createdPages).toHaveLength(0);
    expect(calls.createdLocs).toHaveLength(0);
    expect(report.actions.every((action) => action.status === 'planned')).toBe(true);
    expect(report.actions).toHaveLength(2); // create page + set promo text
  });

  it("skips a page's promotional text when the page create failed", async () => {
    const { api } = makeApi({});
    api.createCustomProductPage = () => Promise.reject(new Error('page name taken'));
    const report = await reconcileCustomProductPages(api, {
      bundleId: 'com.acme.app',
      config: CONFIG,
      dryRun: false,
    });
    const summary = summarizeCustomPages(report.actions);
    expect(summary).toEqual({ applied: 0, failed: 1, skipped: 1 });
    expect(report.actions.find((action) => action.status === 'failed')?.error).toBe(
      'page name taken',
    );
  });
});
