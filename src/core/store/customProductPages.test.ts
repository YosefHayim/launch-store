import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import type {
  CustomProductPageLocalizationResource,
  CustomProductPageResource,
  CustomProductPageVersionResource,
} from '../types/appleCatalog.js';
import {
  type AscCustomPagesApi,
  type CustomProductPagesConfig,
  parseCustomProductPagesConfig,
  reconcileCustomProductPages,
  summarizeCustomPages,
} from './customProductPages.js';
/** Records every write the reconciler makes. */
type Calls = {
  createdPages: string[];
  createdLocs: {
    versionId: string;
    locale: string;
    promotionalText: string;
  }[];
  updatedLocs: {
    id: string;
    promotionalText: string;
  }[];
};
/** State the fake API serves on reads. */
type State = {
  appId: string | null;
  pages: CustomProductPageResource[];
  versions: CustomProductPageVersionResource[];
  localizations: CustomProductPageLocalizationResource[];
};
const makeApi = (
  state: Partial<State>,
): {
  api: AscCustomPagesApi;
  calls: Calls;
} => {
  const full: State = {
    appId: 'app-1',
    pages: [],
    versions: [{ id: 'ver-1', state: 'PREPARE_FOR_SUBMISSION' }],
    localizations: [],
    ...state,
  };
  const calls: Calls = { createdPages: [], createdLocs: [], updatedLocs: [] };
  const api: AscCustomPagesApi = {
    getAppId: () => Effect.succeed(full.appId),
    listCustomProductPages: () => Effect.succeed(full.pages),
    createCustomProductPage: (_appId, name) => {
      calls.createdPages.push(name);
      return Effect.succeed({ id: 'page-new', name });
    },
    listCustomProductPageVersions: () => Effect.succeed(full.versions),
    listCustomProductPageLocalizations: () => Effect.succeed(full.localizations),
    createCustomProductPageLocalization: (versionId, locale, promotionalText) => {
      calls.createdLocs.push({ versionId, locale, promotionalText });
      return Effect.void;
    },
    updateCustomProductPageLocalization: (id, promotionalText) => {
      calls.updatedLocs.push({ id, promotionalText });
      return Effect.void;
    },
  };
  return { api, calls };
};
/** Execute the custom-pages reconciler at the test boundary. */
const runReconcile = (
  api: AscCustomPagesApi,
  input: Parameters<typeof reconcileCustomProductPages>[1],
) => Effect.runPromise(reconcileCustomProductPages(api, input));
const CONFIG: CustomProductPagesConfig = {
  pages: [{ name: 'Spring Sale', promotionalText: { 'en-US': '50% off this week!' } }],
};
const decodeCustomProductPagesConfig = (rawDocument: unknown) =>
  Effect.runSync(parseCustomProductPagesConfig(rawDocument));
describe('parseCustomProductPagesConfig', () => {
  it('parses pages with promotional text', () => {
    const config = decodeCustomProductPagesConfig(CONFIG);
    expect(config.pages[0]?.name).toBe('Spring Sale');
    expect(config.pages[0]?.promotionalText?.['en-US']).toBe('50% off this week!');
  });
  it('rejects a non-object, an empty list, a duplicate name, and bad promo text', () => {
    expect(() => decodeCustomProductPagesConfig('nope')).toThrow(/must be a JSON object/);
    expect(() => decodeCustomProductPagesConfig({ pages: [] })).toThrow(/at least one entry/);
    expect(() => decodeCustomProductPagesConfig({ pages: [{ name: 'A' }, { name: 'A' }] })).toThrow(
      /duplicate page name/,
    );
    expect(() =>
      decodeCustomProductPagesConfig({
        pages: [{ name: 'A', promotionalText: { 'en-US': '' } }],
      }),
    ).toThrow(/must be a non-empty string/);
  });
});
describe('reconcileCustomProductPages', () => {
  it('throws when the app has no App Store Connect record', async () => {
    const { api } = makeApi({ appId: null });
    await expect(
      runReconcile(api, { bundleId: 'com.acme.app', config: CONFIG, dryRun: true }),
    ).rejects.toThrow(/No App Store Connect app record/);
  });
  it('creates a missing page and sets its promotional text (apply)', async () => {
    const { api, calls } = makeApi({});
    const report = await runReconcile(api, {
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
    await runReconcile(api, {
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
    const report = await runReconcile(api2, {
      bundleId: 'com.acme.app',
      config: CONFIG,
      dryRun: false,
    });
    expect(calls2.updatedLocs).toHaveLength(0); // identical -> no-op
    expect(report.actions).toHaveLength(0);
  });
  it("skips promotional text when there's no editable version", async () => {
    const { api, calls } = makeApi({
      pages: [{ id: 'page-1', name: 'Spring Sale' }],
      versions: [{ id: 'ver-1', state: 'APPROVED' }],
    });
    const report = await runReconcile(api, {
      bundleId: 'com.acme.app',
      config: CONFIG,
      dryRun: false,
    });
    expect(calls.createdLocs).toHaveLength(0);
    expect(summarizeCustomPages(report.actions)).toEqual({ applied: 0, failed: 0, skipped: 1 });
  });
  it('plans but performs nothing on a dry-run (new page)', async () => {
    const { api, calls } = makeApi({});
    const report = await runReconcile(api, {
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
    api.createCustomProductPage = () => Effect.fail(new Error('page name taken'));
    const report = await runReconcile(api, {
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
