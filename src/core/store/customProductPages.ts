import { Effect, Schema } from 'effect';
import type {
  CustomProductPageLocalizationResource,
  CustomProductPageResource,
  CustomProductPageVersionResource,
} from '../types/appleCatalog.js';
import { appRecordMissing, plan, skip, type ReconcileContext } from './reconcile.js';
import { errorMessage } from '../services/errorMessage.js';
import type { PlannedAction } from '../types/reconcile.js';
import {
  decodeStoreSurfaceConfig,
  loadStoreSurfaceConfig,
  type StoreSurfaceConfigFailure,
} from './surfaceConfig.js';
/** Custom-product-page version states Apple still lets us edit localizations in. */
const EDITABLE_VERSION_STATES = new Set(['PREPARE_FOR_SUBMISSION', 'REJECTED']);

const PromotionalTextSchema = Schema.mutable(
  Schema.Record({
    key: Schema.String,
    value: Schema.String.pipe(
      Schema.nonEmptyString({
        message: () => 'custom-pages.config.json: promotional text must be a non-empty string.',
      }),
    ),
  }),
);

const CustomProductPageConfigSchema = Schema.mutable(
  Schema.Struct({
    name: Schema.String.pipe(
      Schema.nonEmptyString({
        message: () => 'custom-pages.config.json: page name must be a non-empty string.',
      }),
    ),
    promotionalText: Schema.optionalWith(PromotionalTextSchema, { exact: true }),
  }),
);

export const CustomProductPagesConfigSchema = Schema.mutable(
  Schema.Struct({
    pages: Schema.mutable(Schema.Array(CustomProductPageConfigSchema)).pipe(
      Schema.minItems(1, {
        message: () => 'custom-pages.config.json must declare at least one entry under "pages".',
      }),
      Schema.filter((declaredPages) => {
        const declaredPageNames = new Set<string>();
        for (const declaredPage of declaredPages) {
          if (declaredPageNames.has(declaredPage.name)) {
            return `custom-pages.config.json: duplicate page name "${declaredPage.name}".`;
          }
          declaredPageNames.add(declaredPage.name);
        }
        return true;
      }),
    ),
  }),
);

const CustomProductPagesConfigSpec = {
  documentName: 'custom-pages.config.json',
  displayName: 'custom product pages config',
  missingMessage: (configPath: string) =>
    `No custom-pages config at ${configPath}. Create one (see \`launch custom-pages --help\`) or pass --config.`,
  schema: CustomProductPagesConfigSchema,
};
/** One declared custom product page: a name plus optional per-locale promotional text. */
export type CustomProductPageConfig = {
  name: string;
  promotionalText?: Record<string, string>;
};
/** The full `custom-pages.config.json` document. */
export type CustomProductPagesConfig = {
  pages: CustomProductPageConfig[];
};
/**
 * The exact slice of {@link AppStoreConnectClient} the custom-pages reconciler depends on, declared here so
 * the diff logic is unit-testable with a hand-rolled fake (mirrors {@link AscGameCenterApi}).
 */
export type AscCustomPagesApi = {
  getAppId(bundleId: string): Effect.Effect<string | null, unknown>;
  listCustomProductPages(appId: string): Effect.Effect<CustomProductPageResource[], unknown>;
  createCustomProductPage(
    appId: string,
    name: string,
  ): Effect.Effect<CustomProductPageResource, unknown>;
  listCustomProductPageVersions(
    pageId: string,
  ): Effect.Effect<CustomProductPageVersionResource[], unknown>;
  listCustomProductPageLocalizations(
    versionId: string,
  ): Effect.Effect<CustomProductPageLocalizationResource[], unknown>;
  createCustomProductPageLocalization(
    versionId: string,
    locale: string,
    promotionalText: string,
  ): Effect.Effect<void, unknown>;
  updateCustomProductPageLocalization(
    localizationId: string,
    promotionalText: string,
  ): Effect.Effect<void, unknown>;
};
/** Inputs to reconcile one app's custom product pages. */
export type CustomPagesReconcileInput = {
  bundleId: string;
  config: CustomProductPagesConfig;
  dryRun: boolean;
};
/**
 * Reconcile one app's custom product pages. Throws only for a precondition the user must fix (no App
 * Store Connect app record); per-action failures are captured so one never aborts the rest.
 */
export const reconcileCustomProductPages = (
  api: AscCustomPagesApi,
  input: CustomPagesReconcileInput,
): Effect.Effect<{ bundleId: string; actions: PlannedAction[] }, unknown> =>
  Effect.gen(function* () {
    const reconcileContext: ReconcileContext = { actions: [], dryRun: input.dryRun };
    const appId = yield* api.getAppId(input.bundleId);
    if (!appId) return yield* Effect.fail(appRecordMissing(input.bundleId, 'custom-pages'));
    const pages = yield* api.listCustomProductPages(appId);
    const existing = new Map(pages.map((page) => [page.name, page]));
    for (const page of input.config.pages) {
      const pageId = yield* ensurePage(
        reconcileContext,
        api,
        appId,
        page.name,
        existing.get(page.name),
      );
      yield* reconcilePromoText(reconcileContext, api, page, pageId);
    }
    return { bundleId: input.bundleId, actions: reconcileContext.actions };
  });
/** Read the page by name, creating it when absent. Returns its id, or null when create failed / was rehearsed. */
const ensurePage = (
  reconcileContext: ReconcileContext,
  api: AscCustomPagesApi,
  appId: string,
  name: string,
  existing: CustomProductPageResource | undefined,
): Effect.Effect<string | null> => {
  if (existing) return Effect.succeed(existing.id);
  const action = plan(reconcileContext, `create custom product page "${name}"`);
  if (reconcileContext.dryRun) return Effect.succeed(null);
  return api.createCustomProductPage(appId, name).pipe(
    Effect.match({
      onFailure: (writeFailure) => {
        action.status = 'failed';
        action.error = errorMessage(writeFailure);
        return null;
      },
      onSuccess: (created) => {
        action.status = 'applied';
        return created.id;
      },
    }),
  );
};
/** Reconcile a page's promotional text per declared locale on its editable version. */
const reconcilePromoText = (
  reconcileContext: ReconcileContext,
  api: AscCustomPagesApi,
  page: CustomProductPageConfig,
  pageId: string | null,
): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    let declaredPromotionalText: Record<string, string> = {};
    if (page.promotionalText !== undefined) declaredPromotionalText = page.promotionalText;
    const locales = Object.entries(declaredPromotionalText);
    if (locales.length === 0) return;
    // No page id: either rehearsing a not-yet-created page (plan the sets) or its create failed (skip them).
    if (!pageId) {
      for (const [locale] of locales) {
        if (reconcileContext.dryRun)
          plan(reconcileContext, `set promotional text on "${page.name}" (${locale})`);
        else
          skip(
            reconcileContext,
            `promotional text on "${page.name}" (${locale}): skipped - page create failed`,
          );
      }
      return;
    }
    const versions = yield* api.listCustomProductPageVersions(pageId);
    const version = versions.find((entry) => EDITABLE_VERSION_STATES.has(entry.state));
    if (!version) {
      skip(reconcileContext, `promotional text on "${page.name}": skipped - no editable version`);
      return;
    }
    const localizations = yield* api.listCustomProductPageLocalizations(version.id);
    const current = new Map(
      localizations.map((localization) => [localization.locale, localization]),
    );
    for (const [locale, text] of locales) {
      const existing = current.get(locale);
      let existingText = '';
      if (existing?.promotionalText !== undefined) existingText = existing.promotionalText;
      if (existing !== undefined && existingText === text) continue;
      let actionDescription = `set promotional text on "${page.name}" (${locale})`;
      if (existing !== undefined) {
        actionDescription = `update promotional text on "${page.name}" (${locale})`;
      }
      const action = plan(reconcileContext, actionDescription);
      if (reconcileContext.dryRun) continue;
      let writePromotionalText = api.createCustomProductPageLocalization(version.id, locale, text);
      if (existing !== undefined) {
        writePromotionalText = api.updateCustomProductPageLocalization(existing.id, text);
      }
      yield* writePromotionalText.pipe(
        Effect.match({
          onFailure: (writeFailure) => {
            action.status = 'failed';
            action.error = errorMessage(writeFailure);
          },
          onSuccess: () => {
            action.status = 'applied';
          },
        }),
      );
    }
  });
/** Decode an untrusted custom product pages config document. */
export const parseCustomProductPagesConfig = (
  rawDocument: unknown,
): Effect.Effect<CustomProductPagesConfig, StoreSurfaceConfigFailure> =>
  decodeStoreSurfaceConfig(rawDocument, CustomProductPagesConfigSpec);

/** Read and decode custom-pages.config.json through Effect Platform. */
export const loadCustomProductPagesConfig = (configPath: string) =>
  loadStoreSurfaceConfig(configPath, CustomProductPagesConfigSpec);
/** Tally a report's action statuses for the run summary (mirrors the other store-sync commands). */
export const summarizeCustomPages = (
  actions: PlannedAction[],
): {
  applied: number;
  failed: number;
  skipped: number;
} => {
  let applied = 0;
  let failed = 0;
  let skipped = 0;
  for (const action of actions) {
    if (action.status === 'applied') applied++;
    else if (action.status === 'failed') failed++;
    else if (action.status === 'skipped') skipped++;
  }
  return { applied, failed, skipped };
};
