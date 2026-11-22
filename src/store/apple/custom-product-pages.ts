import type {
  CustomProductPageLocalizationResource,
  CustomProductPageResource,
  CustomProductPageVersionResource,
} from '../../types/apple-catalog.ts';
import { appRecordMissing, plan, skip, type ReconcileContext } from '../shared/reconcile.ts';
import { errorMessage } from '../../services/platform/error-message.ts';
import type { PlannedAction } from '../../types/reconcile.ts';
import { decodeStoreSurfaceConfig, loadStoreSurfaceConfig } from '../shared/surface-config.ts';

/** Custom-product-page version states Apple still lets us edit localizations in. */
const EDITABLE_VERSION_STATES = new Set(['PREPARE_FOR_SUBMISSION', 'REJECTED']);
const CUSTOM_PAGES_DOCUMENT_NAME = 'custom-pages.config.json';

/** One declared custom product page: a name plus optional per-locale promotional text. */
type CustomProductPageConfig = {
  name: string;
  promotionalText?: Record<string, string>;
};

/** The full custom-pages.config.json document. */
export type CustomProductPagesConfig = {
  pages: CustomProductPageConfig[];
};

/**
 * The exact slice of App Store Connect the custom-pages reconciler depends on, declared here so
 * the diff logic is unit-testable with a hand-rolled fake.
 */
export type AscCustomPagesApi = {
  getAppId(bundleId: string): Promise<string | null>;
  listCustomProductPages(appId: string): Promise<CustomProductPageResource[]>;
  createCustomProductPage(appId: string, name: string): Promise<CustomProductPageResource>;
  listCustomProductPageVersions(pageId: string): Promise<CustomProductPageVersionResource[]>;
  listCustomProductPageLocalizations(
    versionId: string,
  ): Promise<CustomProductPageLocalizationResource[]>;
  createCustomProductPageLocalization(
    versionId: string,
    locale: string,
    promotionalText: string,
  ): Promise<void>;
  updateCustomProductPageLocalization(
    localizationId: string,
    promotionalText: string,
  ): Promise<void>;
};

/** Inputs to reconcile one app's custom product pages. */
type CustomPagesReconcileInput = {
  bundleId: string;
  config: CustomProductPagesConfig;
  dryRun: boolean;
};

function isRecord(candidate: unknown): candidate is Record<string, unknown> {
  if (candidate == null) {
    return false;
  }

  if (typeof candidate != 'object') {
    return false;
  }

  if (Array.isArray(candidate)) {
    return false;
  }

  return true;
}

function readPageName(record: Record<string, unknown>): string {
  const name = record['name'];
  const isText = typeof name == 'string';

  if (isText == false) {
    throw new Error(`${CUSTOM_PAGES_DOCUMENT_NAME}: page name must be a non-empty string.`);
  }

  const isEmpty = name.length == 0;

  if (isEmpty) {
    throw new Error(`${CUSTOM_PAGES_DOCUMENT_NAME}: page name must be a non-empty string.`);
  }

  return name;
}

function readPromotionalText(record: Record<string, unknown>): Record<string, string> | null {
  const hasText = Object.hasOwn(record, 'promotionalText');

  if (hasText == false) {
    return null;
  }

  const promotionalText = record['promotionalText'];
  const isTextRecord = isRecord(promotionalText);

  if (isTextRecord == false) {
    throw new Error(`${CUSTOM_PAGES_DOCUMENT_NAME}: promotionalText must be an object.`);
  }

  const locales: Record<string, string> = {};

  for (const locale of Object.keys(promotionalText)) {
    const text = promotionalText[locale];
    const isLocaleText = typeof text == 'string';

    if (isLocaleText == false) {
      throw new Error(
        `${CUSTOM_PAGES_DOCUMENT_NAME}: promotional text must be a non-empty string.`,
      );
    }

    const isEmpty = text.length == 0;

    if (isEmpty) {
      throw new Error(
        `${CUSTOM_PAGES_DOCUMENT_NAME}: promotional text must be a non-empty string.`,
      );
    }

    locales[locale] = text;
  }

  return locales;
}

function readPage(entry: unknown): CustomProductPageConfig {
  const isPageRecord = isRecord(entry);

  if (isPageRecord == false) {
    throw new Error(`${CUSTOM_PAGES_DOCUMENT_NAME}: pages entries must be JSON objects.`);
  }

  const page: CustomProductPageConfig = { name: readPageName(entry) };
  const promotionalText = readPromotionalText(entry);
  const hasPromotionalText = promotionalText != null;

  if (hasPromotionalText) {
    page.promotionalText = promotionalText;
  }

  return page;
}

function decodeCustomProductPagesDocument(rawDocument: unknown): CustomProductPagesConfig {
  const documentRecord = rawDocument as Record<string, unknown>;
  const hasPages = Object.hasOwn(documentRecord, 'pages');

  if (hasPages == false) {
    throw new Error(`${CUSTOM_PAGES_DOCUMENT_NAME} must declare at least one entry under "pages".`);
  }

  const pagesField = documentRecord['pages'];
  const isPageList = Array.isArray(pagesField);

  if (isPageList == false) {
    throw new Error(`${CUSTOM_PAGES_DOCUMENT_NAME}: pages must be an array.`);
  }

  const isEmpty = pagesField.length == 0;

  if (isEmpty) {
    throw new Error(`${CUSTOM_PAGES_DOCUMENT_NAME} must declare at least one entry under "pages".`);
  }

  const pages: CustomProductPageConfig[] = [];
  const declaredPageNames = new Set<string>();

  for (const entry of pagesField) {
    const page = readPage(entry);
    const isDuplicate = declaredPageNames.has(page.name);

    if (isDuplicate) {
      throw new Error(`${CUSTOM_PAGES_DOCUMENT_NAME}: duplicate page name "${page.name}".`);
    }

    declaredPageNames.add(page.name);
    pages.push(page);
  }

  return { pages };
}

function missingCustomPagesMessage(configPath: string): string {
  return `No custom-pages config at ${configPath}. Create one (see \`launch custom-pages --help\`) or pass --config.`;
}

const customProductPagesConfigSpec = {
  documentName: CUSTOM_PAGES_DOCUMENT_NAME,
  displayName: 'custom product pages config',
  missingMessage: missingCustomPagesMessage,
  decodeDocument: decodeCustomProductPagesDocument,
};

function isEditableVersion(version: CustomProductPageVersionResource): boolean {
  return EDITABLE_VERSION_STATES.has(version.state);
}

function pageByName(page: CustomProductPageResource): [string, CustomProductPageResource] {
  return [page.name, page];
}

function localizationByLocale(
  localization: CustomProductPageLocalizationResource,
): [string, CustomProductPageLocalizationResource] {
  return [localization.locale, localization];
}

/** Read the page by name, creating it when absent. Returns its id, or null when create failed or was rehearsed. */
async function ensurePage(
  reconcileContext: ReconcileContext,
  api: AscCustomPagesApi,
  appId: string,
  name: string,
  existing: CustomProductPageResource | undefined,
): Promise<string | null> {
  const pageExists = existing != null;

  if (pageExists) {
    return existing.id;
  }

  const action = plan(reconcileContext, `create custom product page "${name}"`);
  const isDryRun = reconcileContext.dryRun == true;

  if (isDryRun) {
    return null;
  }

  try {
    const created = await api.createCustomProductPage(appId, name);
    action.status = 'applied';
    return created.id;
  } catch (writeFailure) {
    action.status = 'failed';
    action.error = errorMessage(writeFailure);
    return null;
  }
}

/** Reconcile a page's promotional text per declared locale on its editable version. */
async function reconcilePromoText(
  reconcileContext: ReconcileContext,
  api: AscCustomPagesApi,
  page: CustomProductPageConfig,
  pageId: string | null,
): Promise<void> {
  const declaredPromotionalText = page.promotionalText;
  const hasPromotionalText = declaredPromotionalText != null;

  if (hasPromotionalText == false) {
    return;
  }

  const locales = Object.entries(declaredPromotionalText);
  const hasLocales = locales.length > 0;

  if (hasLocales == false) {
    return;
  }

  const isPageMissing = pageId == null;

  if (isPageMissing) {
    for (const [locale] of locales) {
      const isDryRun = reconcileContext.dryRun == true;

      if (isDryRun) {
        plan(reconcileContext, `set promotional text on "${page.name}" (${locale})`);
        continue;
      }

      skip(
        reconcileContext,
        `promotional text on "${page.name}" (${locale}): skipped - page create failed`,
      );
    }

    return;
  }

  const versions = await api.listCustomProductPageVersions(pageId);
  const version = versions.find(isEditableVersion);
  const hasEditableVersion = version != null;

  if (hasEditableVersion == false) {
    skip(reconcileContext, `promotional text on "${page.name}": skipped - no editable version`);
    return;
  }

  const localizations = await api.listCustomProductPageLocalizations(version.id);
  const current = new Map(localizations.map(localizationByLocale));

  for (const [locale, text] of locales) {
    const existing = current.get(locale);
    let existingText = '';
    const existingPromotionalText = existing?.promotionalText;
    const hasExistingText = existingPromotionalText != null;

    if (hasExistingText) {
      existingText = existingPromotionalText;
    }

    const matchesExisting = existing != null;

    if (matchesExisting) {
      const textMatches = existingText == text;

      if (textMatches) {
        continue;
      }
    }

    let actionDescription = `set promotional text on "${page.name}" (${locale})`;

    if (matchesExisting) {
      actionDescription = `update promotional text on "${page.name}" (${locale})`;
    }

    const action = plan(reconcileContext, actionDescription);
    const isDryRun = reconcileContext.dryRun == true;

    if (isDryRun) {
      continue;
    }

    try {
      if (matchesExisting) {
        await api.updateCustomProductPageLocalization(existing.id, text);
      }

      const needsCreate = matchesExisting == false;

      if (needsCreate) {
        await api.createCustomProductPageLocalization(version.id, locale, text);
      }

      action.status = 'applied';
    } catch (writeFailure) {
      action.status = 'failed';
      action.error = errorMessage(writeFailure);
    }
  }
}

/**
 * Reconcile one app's custom product pages. Throws only for a precondition the user must fix (no App
 * Store Connect app record); per-action failures are captured so one never aborts the rest.
 */
export async function reconcileCustomProductPages(
  api: AscCustomPagesApi,
  reconcileInput: CustomPagesReconcileInput,
): Promise<{ bundleId: string; actions: PlannedAction[] }> {
  const reconcileContext: ReconcileContext = { actions: [], dryRun: reconcileInput.dryRun };
  const appId = await api.getAppId(reconcileInput.bundleId);
  const isAppMissing = appId == null;

  if (isAppMissing) {
    throw appRecordMissing(reconcileInput.bundleId, 'custom-pages');
  }

  const pages = await api.listCustomProductPages(appId);
  const existing = new Map(pages.map(pageByName));

  for (const page of reconcileInput.config.pages) {
    const pageId = await ensurePage(
      reconcileContext,
      api,
      appId,
      page.name,
      existing.get(page.name),
    );
    await reconcilePromoText(reconcileContext, api, page, pageId);
  }

  return { bundleId: reconcileInput.bundleId, actions: reconcileContext.actions };
}

/** Decode an untrusted custom product pages config document. */
export function parseCustomProductPagesConfig(rawDocument: unknown): CustomProductPagesConfig {
  return decodeStoreSurfaceConfig(rawDocument, customProductPagesConfigSpec);
}

/** Read and decode custom-pages.config.json. */
export function loadCustomProductPagesConfig(
  configPath: string,
): Promise<CustomProductPagesConfig> {
  return loadStoreSurfaceConfig(configPath, customProductPagesConfigSpec);
}

/** Tally a report's action statuses for the run summary. */
export function summarizeCustomPages(actions: PlannedAction[]): {
  applied: number;
  failed: number;
  skipped: number;
} {
  let applied = 0;
  let failed = 0;
  let skipped = 0;

  for (const action of actions) {
    if (action.status == 'applied') {
      applied += 1;
      continue;
    }

    if (action.status == 'failed') {
      failed += 1;
      continue;
    }

    if (action.status == 'skipped') {
      skipped += 1;
    }
  }

  return { applied, failed, skipped };
}
