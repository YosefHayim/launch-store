import { describe, expect, it } from 'vitest';
import type {
  CustomProductPageLocalizationResource,
  CustomProductPageResource,
  CustomProductPageVersionResource,
} from '@/types/apple-catalog.js';
import {
  type AscCustomPagesApi,
  type CustomProductPagesConfig,
  parseCustomProductPagesConfig,
  reconcileCustomProductPages,
  summarizeCustomPages,
} from './custom-product-pages.ts';
import type { ActionStatus } from '@/types/reconcile.js';

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
function makeApi(state: Partial<State>): {
  api: AscCustomPagesApi;
  calls: Calls;
} {
  const full: State = {
    appId: 'app-1',
    pages: [],
    versions: [{ id: 'ver-1', state: 'PREPARE_FOR_SUBMISSION' }],
    localizations: [],
    ...state,
  };
  const calls: Calls = { createdPages: [], createdLocs: [], updatedLocs: [] };
  const api: AscCustomPagesApi = {
    getAppId() {
      return Promise.resolve(full.appId);
    },
    listCustomProductPages() {
      return Promise.resolve(full.pages);
    },
    createCustomProductPage(_appId, name) {
      calls.createdPages.push(name);
      return Promise.resolve({ id: 'page-new', name });
    },
    listCustomProductPageVersions() {
      return Promise.resolve(full.versions);
    },
    listCustomProductPageLocalizations() {
      return Promise.resolve(full.localizations);
    },
    createCustomProductPageLocalization(versionId, locale, promotionalText) {
      calls.createdLocs.push({ versionId, locale, promotionalText });
      return Promise.resolve();
    },
    updateCustomProductPageLocalization(id, promotionalText) {
      calls.updatedLocs.push({ id, promotionalText });
      return Promise.resolve();
    },
  };

  return { api, calls };
}
/** Execute the custom-pages reconciler at the test boundary. */
function runReconcile(
  api: AscCustomPagesApi,
  input: Parameters<typeof reconcileCustomProductPages>[1],
) {
  return reconcileCustomProductPages(api, input);
}
const CONFIG: CustomProductPagesConfig = {
  pages: [{ name: 'Spring Sale', promotionalText: { 'en-US': '50% off this week!' } }],
};
function decodeCustomProductPagesConfig(rawDocument: unknown) {
  return parseCustomProductPagesConfig(rawDocument);
}
function describeParseCustomProductPagesPiece() {
  function parsesPagesWithPromotionalPiece() {
    const config = decodeCustomProductPagesConfig(CONFIG);
    expect(config.pages[0]?.name).toBe('Spring Sale');
    expect(config.pages[0]?.promotionalText?.['en-US']).toBe('50% off this week!');
  }

  it('parses pages with promotional text', parsesPagesWithPromotionalPiece);

  function rejectsANonObjectAnEmptyListADuplicateNameAndBadPromoPiece() {
    function callDecodeCustomProductPagesPiece() {
      return decodeCustomProductPagesConfig('nope');
    }

    expect(callDecodeCustomProductPagesPiece).toThrow(/must be a JSON object/);

    function callDecodeCustomProductPagesPiece2() {
      return decodeCustomProductPagesConfig({ pages: [] });
    }

    expect(callDecodeCustomProductPagesPiece2).toThrow(/at least one entry/);

    function callDecodeCustomProductPagesPiece3() {
      return decodeCustomProductPagesConfig({ pages: [{ name: 'A' }, { name: 'A' }] });
    }

    expect(callDecodeCustomProductPagesPiece3).toThrow(/duplicate page name/);

    function callDecodeCustomProductPagesPiece4() {
      return decodeCustomProductPagesConfig({
        pages: [{ name: 'A', promotionalText: { 'en-US': '' } }],
      });
    }

    expect(callDecodeCustomProductPagesPiece4).toThrow(/must be a non-empty string/);
  }

  it(
    'rejects a non-object, an empty list, a duplicate name, and bad promo text',
    rejectsANonObjectAnEmptyListADuplicateNameAndBadPromoPiece,
  );
}

describe('parseCustomProductPagesConfig', describeParseCustomProductPagesPiece);
function describeReconcileCustomProductPages() {
  async function throwsWhenTheAppHasNoAppStoreConnectPiece() {
    const { api } = makeApi({ appId: null });
    const reconcile = runReconcile(api, { bundleId: 'com.acme.app', config: CONFIG, dryRun: true });
    await expect(reconcile).rejects.toThrow(/No App Store Connect app record/);
  }

  it(
    'throws when the app has no App Store Connect record',
    throwsWhenTheAppHasNoAppStoreConnectPiece,
  );

  async function createsAMissingPageAndSetsItsPromotionalPieceApply() {
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

    const customPages = summarizeCustomPages(report.actions);

    expect(customPages).toEqual({ applied: 2, failed: 0, skipped: 0 });
  }

  it(
    'creates a missing page and sets its promotional text (apply)',
    createsAMissingPageAndSetsItsPromotionalPieceApply,
  );

  async function updatesPromotionalPieceOnAnExistingPageWhenItDiffersAndSkipsAnIdenticalOne() {
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
  }

  it(
    'updates promotional text on an existing page when it differs, and skips an identical one',
    updatesPromotionalPieceOnAnExistingPageWhenItDiffersAndSkipsAnIdenticalOne,
  );

  async function skipsPromotionalPieceWhenThereSNoEditableVersion() {
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

    const customPages = summarizeCustomPages(report.actions);

    expect(customPages).toEqual({ applied: 0, failed: 0, skipped: 1 });
  }

  it(
    "skips promotional text when there's no editable version",
    skipsPromotionalPieceWhenThereSNoEditableVersion,
  );

  async function plansButPerformsNothingOnADryRunNewPage() {
    const { api, calls } = makeApi({});
    const report = await runReconcile(api, {
      bundleId: 'com.acme.app',
      config: CONFIG,
      dryRun: true,
    });

    expect(calls.createdPages).toHaveLength(0);
    expect(calls.createdLocs).toHaveLength(0);

    function isPlannedAction(action: {
      readonly description: string;
      readonly destructive: boolean;
      status: ActionStatus;
      error?: string;
    }) {
      return action.status == 'planned';
    }

    expect(report.actions.every(isPlannedAction)).toBe(true);
    expect(report.actions).toHaveLength(2); // create page + set promo text
  }

  it('plans but performs nothing on a dry-run (new page)', plansButPerformsNothingOnADryRunNewPage);

  async function skipsAPageSPromotionalPieceWhenThePageCreateFailed() {
    const { api } = makeApi({});

    function runPiece() {
      return Promise.reject(new Error('page name taken'));
    }

    api.createCustomProductPage = runPiece;

    const report = await runReconcile(api, {
      bundleId: 'com.acme.app',
      config: CONFIG,
      dryRun: false,
    });
    const summary = summarizeCustomPages(report.actions);

    expect(summary).toEqual({ applied: 0, failed: 1, skipped: 1 });

    function isFailedAction(action: {
      readonly description: string;
      readonly destructive: boolean;
      status: ActionStatus;
      error?: string;
    }) {
      return action.status == 'failed';
    }

    expect(report.actions.find(isFailedAction)?.error).toBe('page name taken');
  }

  it(
    "skips a page's promotional text when the page create failed",
    skipsAPageSPromotionalPieceWhenThePageCreateFailed,
  );
}

describe('reconcileCustomProductPages', describeReconcileCustomProductPages);
