import { readFile } from 'node:fs/promises';
import { resolveSecretRef } from '../credentials/secretRef.ts';
import { pathExists } from '../path-exists.ts';
import { errorMessage } from '../services/platform/errorMessage.ts';
import { appRecordMissing, skip, type ReconcileContext } from '../store/shared/reconcile.ts';
import {
  deprecatedAgeRatingVerdict,
  type AgeRatingDeclarationResource,
  type AgeRatingValue,
  type AppInfoResource,
  type AppStoreReviewDetailResource,
  type PricePointResource,
} from '../types/appleCatalog.ts';
import type { PlannedAction, ReconcileReport } from '../types/reconcile.ts';
import type {
  ReleaseAttributesConfig,
  ReleaseCategories,
  ReleasePricing,
  ReviewDetailsConfig,
} from '../types/storeSurface.ts';

const DEFAULT_PLATFORM = 'IOS';
const DEFAULT_TERRITORY = 'USA';
const DEMO_PASSWORD_KEY = 'demoAccountPassword';

/** Release-attribute decoding or reconciliation failed. */
type ReleaseAttributesFailure = Readonly<{
  readonly _tag: 'ReleaseAttributesFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause: unknown;
}>;

function makeReleaseAttributesFailure(fields: {
  operation: string;
  message: string;
  cause: unknown;
}): ReleaseAttributesFailure {
  return {
    _tag: 'ReleaseAttributesFailure',
    operation: fields.operation,
    message: fields.message,
    cause: fields.cause,
  };
}

/** Store API calls used by release-attribute reconciliation. */
export type AscReleaseApi = Readonly<{
  getAppId: (bundleId: string) => Promise<string | null>;
  getAppInfo: (appId: string) => Promise<AppInfoResource | null>;
  updateAppInfoCategories: (
    appInfoId: string,
    categories: { primaryCategoryId?: string; secondaryCategoryId?: string | null },
  ) => Promise<void>;
  getAgeRatingDeclaration: (appInfoId: string) => Promise<AgeRatingDeclarationResource | null>;
  updateAgeRatingDeclaration: (
    declarationId: string,
    attributes: Record<string, AgeRatingValue>,
  ) => Promise<void>;
  findAppPricePoint: (
    appId: string,
    territory: string,
    customerPrice: number,
  ) => Promise<PricePointResource | null>;
  getCurrentAppPrice: (appId: string, territory: string) => Promise<string | null>;
  createAppPriceSchedule: (
    appId: string,
    baseTerritory: string,
    pricePointId: string,
  ) => Promise<void>;
  findEditableAppStoreVersion: (appId: string, platform: string) => Promise<{ id: string } | null>;
  getAppStoreReviewDetail: (versionId: string) => Promise<AppStoreReviewDetailResource | null>;
  createAppStoreReviewDetail: (
    versionId: string,
    attributes: Record<string, string | boolean>,
  ) => Promise<{ id: string }>;
  updateAppStoreReviewDetail: (
    detailId: string,
    attributes: Record<string, string | boolean>,
  ) => Promise<void>;
}>;

/** Inputs for one app's release-attribute reconciliation. */
type ReleaseReconcileInput = Readonly<{
  bundleId: string;
  config: ReleaseAttributesConfig;
  platform?: string;
  dryRun: boolean;
}>;

type SecretResolver = (secretReference: string, secretLabel: string) => Promise<string>;

function releaseAttributesFailure(
  operation: string,
  cause: unknown,
  explicitMessage?: string,
): ReleaseAttributesFailure {
  let message = explicitMessage;

  if (message == null) {
    message = errorMessage(cause);
  }

  const isMessageEmpty = message.length == 0;

  if (isMessageEmpty) {
    message = `${operation} failed.`;
  }

  return makeReleaseAttributesFailure({ operation, message, cause });
}

/** Record and optionally apply one non-destructive reconciliation action. */
async function performAction(
  reconcileContext: ReconcileContext,
  description: string,
  applyAction: () => Promise<void>,
): Promise<void> {
  const plannedAction: PlannedAction = {
    description,
    destructive: false,
    status: 'planned',
  };
  reconcileContext.actions.push(plannedAction);

  if (reconcileContext.dryRun) {
    return;
  }

  try {
    await applyAction();
    plannedAction.status = 'applied';
  } catch (actionFailure) {
    plannedAction.status = 'failed';
    plannedAction.error = errorMessage(actionFailure);
  }
}

function describeCategoryChanges(categoryChanges: {
  primaryCategoryId?: string;
  secondaryCategoryId?: string | null;
}): string {
  const changeDescriptions: string[] = [];
  const primaryCategoryId = categoryChanges.primaryCategoryId;

  if (primaryCategoryId != null) {
    changeDescriptions.push(`primary=${primaryCategoryId}`);
  }

  const hasSecondaryChange = Object.hasOwn(categoryChanges, 'secondaryCategoryId');

  if (hasSecondaryChange) {
    let secondaryCategory = categoryChanges.secondaryCategoryId;

    if (secondaryCategory == null) {
      secondaryCategory = 'unset';
    }

    changeDescriptions.push(`secondary=${secondaryCategory}`);
  }

  return changeDescriptions.join(', ');
}

function changedPrimaryCategoryId(
  categories: ReleaseCategories,
  appInformation: AppInfoResource,
): string | null {
  const primaryCategoryId = categories.primary;
  const isPrimaryMissing = primaryCategoryId == null;

  if (isPrimaryMissing) {
    return null;
  }

  const isUnchanged = primaryCategoryId == appInformation.primaryCategoryId;

  if (isUnchanged) {
    return null;
  }

  return primaryCategoryId;
}

function changedSecondaryCategoryId(
  categories: ReleaseCategories,
  appInformation: AppInfoResource,
): string | null {
  const secondaryCategoryId = categories.secondary;
  const isSecondaryMissing = secondaryCategoryId == null;

  if (isSecondaryMissing) {
    return null;
  }

  const isUnchanged = secondaryCategoryId == appInformation.secondaryCategoryId;

  if (isUnchanged) {
    return null;
  }

  return secondaryCategoryId;
}

function shouldClearSecondaryCategory(
  categories: ReleaseCategories,
  appInformation: AppInfoResource,
): boolean {
  if (categories.secondary != null) {
    return false;
  }

  return appInformation.secondaryCategoryId != null;
}

/** Reconcile declared App Store categories. */
async function reconcileCategories(
  reconcileContext: ReconcileContext,
  appleReleaseApi: AscReleaseApi,
  appInformation: AppInfoResource,
  categories: ReleaseCategories | undefined,
): Promise<void> {
  if (categories == null) {
    return;
  }

  const categoryChanges: {
    primaryCategoryId?: string;
    secondaryCategoryId?: string | null;
  } = {};

  const primaryCategoryId = changedPrimaryCategoryId(categories, appInformation);
  const hasPrimaryCategoryChange = primaryCategoryId != null;

  if (hasPrimaryCategoryChange) {
    categoryChanges.primaryCategoryId = primaryCategoryId;
  }

  const secondaryCategoryId = changedSecondaryCategoryId(categories, appInformation);
  const hasSecondaryCategoryChange = secondaryCategoryId != null;

  if (hasSecondaryCategoryChange) {
    categoryChanges.secondaryCategoryId = secondaryCategoryId;
  }

  // Config omits secondary while the live App Info still has one - clear the stale assignment.
  if (shouldClearSecondaryCategory(categories, appInformation)) {
    categoryChanges.secondaryCategoryId = null;
  }

  const hasNoCategoryChanges = Object.keys(categoryChanges).length == 0;

  if (hasNoCategoryChanges) {
    return;
  }

  await performAction(
    reconcileContext,
    `set categories (${describeCategoryChanges(categoryChanges)})`,
    function updateCategories() {
      return appleReleaseApi.updateAppInfoCategories(appInformation.id, categoryChanges);
    },
  );
}

/** Reconcile changed age-rating answers. */
async function reconcileAgeRating(
  reconcileContext: ReconcileContext,
  appleReleaseApi: AscReleaseApi,
  appInformation: AppInfoResource,
  desiredAnswers: Record<string, AgeRatingValue> | undefined,
): Promise<void> {
  if (desiredAnswers == null) {
    return;
  }

  const hasNoAnswers = Object.keys(desiredAnswers).length == 0;

  if (hasNoAnswers) {
    return;
  }

  const currentDeclaration = await appleReleaseApi.getAgeRatingDeclaration(appInformation.id);
  const isDeclarationMissing = currentDeclaration == null;

  if (isDeclarationMissing) {
    skip(
      reconcileContext,
      'age rating: no declaration on the app yet (create the version, then re-run)',
    );
    return;
  }

  const changedAnswers: Record<string, AgeRatingValue> = {};

  for (const [answerName, desiredAnswer] of Object.entries(desiredAnswers)) {
    const isUnchanged = currentDeclaration.attributes[answerName] == desiredAnswer;

    if (isUnchanged == false) {
      changedAnswers[answerName] = desiredAnswer;
    }
  }

  const hasNoChanges = Object.keys(changedAnswers).length == 0;

  if (hasNoChanges) {
    return;
  }

  const answerNames = Object.keys(changedAnswers).join(', ');
  await performAction(
    reconcileContext,
    `set age rating (${answerNames})`,
    function updateAgeRating() {
      return appleReleaseApi.updateAgeRatingDeclaration(currentDeclaration.id, changedAnswers);
    },
  );
}

function isCurrentPrice(currentPrice: string | null, customerPrice: number): boolean {
  if (currentPrice == null) {
    return false;
  }

  return Number.parseFloat(currentPrice) == customerPrice;
}

/** Reconcile the base-territory customer price. */
async function reconcilePricing(
  reconcileContext: ReconcileContext,
  appleReleaseApi: AscReleaseApi,
  appId: string,
  pricing: ReleasePricing,
): Promise<void> {
  let baseTerritory = DEFAULT_TERRITORY;

  if (pricing.baseTerritory != null) {
    baseTerritory = pricing.baseTerritory;
  }

  const currentPrice = await appleReleaseApi.getCurrentAppPrice(appId, baseTerritory);
  const priceAlreadyMatches = isCurrentPrice(currentPrice, pricing.customerPrice);

  if (priceAlreadyMatches) {
    return;
  }

  await performAction(
    reconcileContext,
    `set app price = ${pricing.customerPrice} (${baseTerritory})`,
    async function schedulePrice() {
      const pricePoint = await appleReleaseApi.findAppPricePoint(
        appId,
        baseTerritory,
        pricing.customerPrice,
      );
      const isPricePointMissing = pricePoint == null;

      if (isPricePointMissing) {
        throw releaseAttributesFailure(
          'resolve App Store price point',
          pricing,
          `No ${baseTerritory} app price point matches ${pricing.customerPrice}.`,
        );
      }

      await appleReleaseApi.createAppPriceSchedule(appId, baseTerritory, pricePoint.id);
    },
  );
}

/** Keep only review fields Apple accepts on the write resource (string/boolean only). */
function reviewAttributes(reviewDetails: ReviewDetailsConfig): Record<string, string | boolean> {
  const reviewWrite: Record<string, string | boolean> = {};

  for (const [fieldName, fieldSetting] of Object.entries(reviewDetails)) {
    const isText = typeof fieldSetting == 'string';

    if (isText) {
      reviewWrite[fieldName] = fieldSetting;
    }

    const isBoolean = typeof fieldSetting == 'boolean';

    if (isBoolean) {
      reviewWrite[fieldName] = fieldSetting;
    }
  }

  return reviewWrite;
}

/** Field names only - never render secret values into action descriptions. */
function renderFieldNames(attributes: Record<string, string | boolean>): string {
  return Object.keys(attributes).join(', ');
}

/** Resolve a demo-password reference only when an action is applied. */
async function resolveReviewWrite(
  attributes: Record<string, string | boolean>,
  resolveDemoSecret: SecretResolver,
): Promise<Record<string, string | boolean>> {
  const passwordReference = attributes[DEMO_PASSWORD_KEY];
  const isPasswordText = typeof passwordReference == 'string';

  if (isPasswordText == false) {
    return attributes;
  }

  const resolvedPassword = await resolveDemoSecret(passwordReference, DEMO_PASSWORD_KEY);
  return {
    ...attributes,
    [DEMO_PASSWORD_KEY]: resolvedPassword,
  };
}

/** Reconcile the editable version's App Review details. */
async function reconcileReviewDetails(
  reconcileContext: ReconcileContext,
  appleReleaseApi: AscReleaseApi,
  appId: string,
  platform: string,
  reviewDetails: ReviewDetailsConfig,
  resolveDemoSecret: SecretResolver,
): Promise<void> {
  const desiredAttributes = reviewAttributes(reviewDetails);
  const hasNoReviewFields = Object.keys(desiredAttributes).length == 0;

  if (hasNoReviewFields) {
    return;
  }

  const editableVersion = await appleReleaseApi.findEditableAppStoreVersion(appId, platform);
  const isVersionMissing = editableVersion == null;

  if (isVersionMissing) {
    skip(
      reconcileContext,
      'App Review details: no editable App Store version (create/select a version first)',
    );
    return;
  }

  const currentReviewDetails = await appleReleaseApi.getAppStoreReviewDetail(editableVersion.id);
  const isReviewMissing = currentReviewDetails == null;

  if (isReviewMissing) {
    await performAction(
      reconcileContext,
      `set App Review details (${renderFieldNames(desiredAttributes)})`,
      async function createReviewDetails() {
        const resolvedAttributes = await resolveReviewWrite(desiredAttributes, resolveDemoSecret);
        await appleReleaseApi.createAppStoreReviewDetail(editableVersion.id, resolvedAttributes);
      },
    );
    return;
  }

  const changedAttributes: Record<string, string | boolean> = {};

  for (const [fieldName, desiredSetting] of Object.entries(desiredAttributes)) {
    const isPasswordField = fieldName == DEMO_PASSWORD_KEY;

    if (isPasswordField) {
      continue;
    }

    const isUnchanged = currentReviewDetails.attributes[fieldName] == desiredSetting;

    if (isUnchanged == false) {
      changedAttributes[fieldName] = desiredSetting;
    }
  }

  const hasNoReviewChanges = Object.keys(changedAttributes).length == 0;

  if (hasNoReviewChanges) {
    return;
  }

  const passwordSetting = desiredAttributes[DEMO_PASSWORD_KEY];

  if (passwordSetting != null) {
    changedAttributes[DEMO_PASSWORD_KEY] = passwordSetting;
  }

  await performAction(
    reconcileContext,
    `update App Review details (${renderFieldNames(changedAttributes)})`,
    async function updateReviewDetails() {
      const resolvedAttributes = await resolveReviewWrite(changedAttributes, resolveDemoSecret);
      await appleReleaseApi.updateAppStoreReviewDetail(currentReviewDetails.id, resolvedAttributes);
    },
  );
}

function hasDeclaredAgeRating(releaseConfig: ReleaseAttributesConfig): boolean {
  if (releaseConfig.ageRating == null) {
    return false;
  }

  return Object.keys(releaseConfig.ageRating).length > 0;
}

function needsAppInformation(releaseConfig: ReleaseAttributesConfig): boolean {
  if (releaseConfig.categories != null) {
    return true;
  }

  return hasDeclaredAgeRating(releaseConfig);
}

/** Run reconciliation with an injected demo-secret resolver. */
async function reconcileReleaseWith(
  appleReleaseApi: AscReleaseApi,
  reconciliationInput: ReleaseReconcileInput,
  resolveDemoSecret: SecretResolver,
): Promise<ReconcileReport> {
  const reconcileContext: ReconcileContext = {
    actions: [],
    dryRun: reconciliationInput.dryRun,
  };
  const releaseConfig = reconciliationInput.config;
  const appId = await appleReleaseApi.getAppId(reconciliationInput.bundleId);
  const isAppMissing = appId == null;

  if (isAppMissing) {
    throw appRecordMissing(reconciliationInput.bundleId, 'release-config');
  }

  if (needsAppInformation(releaseConfig)) {
    const appInformation = await appleReleaseApi.getAppInfo(appId);
    const isAppInformationMissing = appInformation == null;

    if (isAppInformationMissing) {
      skip(reconcileContext, 'categories / age rating: no App Info record on the app yet');
    }

    if (isAppInformationMissing == false) {
      await reconcileCategories(
        reconcileContext,
        appleReleaseApi,
        appInformation,
        releaseConfig.categories,
      );
      await reconcileAgeRating(
        reconcileContext,
        appleReleaseApi,
        appInformation,
        releaseConfig.ageRating,
      );
    }
  }

  if (releaseConfig.pricing != null) {
    await reconcilePricing(reconcileContext, appleReleaseApi, appId, releaseConfig.pricing);
  }

  if (releaseConfig.reviewDetails != null) {
    let platform = DEFAULT_PLATFORM;

    if (reconciliationInput.platform != null) {
      platform = reconciliationInput.platform;
    }

    await reconcileReviewDetails(
      reconcileContext,
      appleReleaseApi,
      appId,
      platform,
      releaseConfig.reviewDetails,
      resolveDemoSecret,
    );
  }

  return {
    bundleId: reconciliationInput.bundleId,
    actions: reconcileContext.actions,
  };
}

/** Reconcile release attributes and resolve secrets only during apply actions. */
export async function reconcileRelease(
  appleReleaseApi: AscReleaseApi,
  reconciliationInput: ReleaseReconcileInput,
): Promise<ReconcileReport> {
  try {
    return await reconcileReleaseWith(appleReleaseApi, reconciliationInput, resolveSecretRef);
  } catch (cause) {
    throw releaseAttributesFailure('reconcile release attributes', cause);
  }
}

/** Plan release attributes without resolving secret references. */
export async function reconcileReleasePlan(
  appleReleaseApi: AscReleaseApi,
  reconciliationInput: ReleaseReconcileInput,
): Promise<ReconcileReport> {
  async function refuseSecret(secretReference: string): Promise<string> {
    throw releaseAttributesFailure(
      'resolve review secret during plan',
      secretReference,
      'A release-attribute plan must not resolve secrets.',
    );
  }

  try {
    return await reconcileReleaseWith(appleReleaseApi, reconciliationInput, refuseSecret);
  } catch (cause) {
    throw releaseAttributesFailure('plan release attributes', cause);
  }
}

function isPlainRecord(candidate: unknown): candidate is Record<string, unknown> {
  if (candidate == null) {
    return false;
  }

  if (typeof candidate != 'object') {
    return false;
  }

  return Array.isArray(candidate) == false;
}

function isAgeRatingValue(answer: unknown): answer is AgeRatingValue {
  if (typeof answer == 'string') {
    return true;
  }

  return typeof answer == 'boolean';
}

function readOptionalText(
  record: Record<string, unknown>,
  fieldName: string,
  documentLabel: string,
): string | undefined {
  const hasField = Object.hasOwn(record, fieldName);

  if (hasField == false) {
    return undefined;
  }

  const field = record[fieldName];
  const isText = typeof field == 'string';

  if (isText == false) {
    throw releaseAttributesFailure(
      'decode release config fields',
      record,
      `release.config.json: ${documentLabel}.${fieldName} must be a string.`,
    );
  }

  return field;
}

function readOptionalBoolean(
  record: Record<string, unknown>,
  fieldName: string,
): boolean | undefined {
  const hasField = Object.hasOwn(record, fieldName);

  if (hasField == false) {
    return undefined;
  }

  const field = record[fieldName];
  const isBoolean = typeof field == 'boolean';

  if (isBoolean == false) {
    throw releaseAttributesFailure(
      'decode release config fields',
      record,
      `release.config.json: reviewDetails.${fieldName} must be a boolean.`,
    );
  }

  return field;
}

function decodeCategories(candidate: unknown): ReleaseCategories {
  const isObject = isPlainRecord(candidate);

  if (isObject == false) {
    throw releaseAttributesFailure(
      'decode release config fields',
      candidate,
      'release.config.json: categories must be an object.',
    );
  }

  const categories: { primary?: string; secondary?: string } = {};
  const primary = readOptionalText(candidate, 'primary', 'categories');
  const secondary = readOptionalText(candidate, 'secondary', 'categories');

  if (primary != null) {
    categories.primary = primary;
  }

  if (secondary != null) {
    categories.secondary = secondary;
  }

  return categories;
}

function decodeCustomerPrice(candidate: unknown): number {
  const isNumber = typeof candidate == 'number';

  if (isNumber == false) {
    throw releaseAttributesFailure(
      'decode release config fields',
      candidate,
      'release.config.json: pricing.customerPrice must be a non-negative number.',
    );
  }

  const isFinitePrice = Number.isFinite(candidate);

  if (isFinitePrice == false) {
    throw releaseAttributesFailure(
      'decode release config fields',
      candidate,
      'release.config.json: pricing.customerPrice must be a non-negative number.',
    );
  }

  const isNegative = candidate < 0;

  if (isNegative) {
    throw releaseAttributesFailure(
      'decode release config fields',
      candidate,
      'release.config.json: pricing.customerPrice must be a non-negative number.',
    );
  }

  return candidate;
}

function decodePricing(candidate: unknown): ReleasePricing {
  const isObject = isPlainRecord(candidate);

  if (isObject == false) {
    throw releaseAttributesFailure(
      'decode release config fields',
      candidate,
      'release.config.json: pricing must be an object.',
    );
  }

  const customerPrice = decodeCustomerPrice(candidate['customerPrice']);
  const baseTerritory = readOptionalText(candidate, 'baseTerritory', 'pricing');
  const pricing: { customerPrice: number; baseTerritory?: string } = { customerPrice };

  if (baseTerritory != null) {
    pricing.baseTerritory = baseTerritory;
  }

  return pricing;
}

function decodeReviewDetails(candidate: unknown): ReviewDetailsConfig {
  const isObject = isPlainRecord(candidate);

  if (isObject == false) {
    throw releaseAttributesFailure(
      'decode release config fields',
      candidate,
      'release.config.json: reviewDetails must be an object.',
    );
  }

  const reviewDetails: {
    contactFirstName?: string;
    contactLastName?: string;
    contactPhone?: string;
    contactEmail?: string;
    demoAccountRequired?: boolean;
    demoAccountName?: string;
    demoAccountPassword?: string;
    notes?: string;
  } = {};
  const contactFirstName = readOptionalText(candidate, 'contactFirstName', 'reviewDetails');
  const contactLastName = readOptionalText(candidate, 'contactLastName', 'reviewDetails');
  const contactPhone = readOptionalText(candidate, 'contactPhone', 'reviewDetails');
  const contactEmail = readOptionalText(candidate, 'contactEmail', 'reviewDetails');
  const demoAccountRequired = readOptionalBoolean(candidate, 'demoAccountRequired');
  const demoAccountName = readOptionalText(candidate, 'demoAccountName', 'reviewDetails');
  const demoAccountPassword = readOptionalText(candidate, 'demoAccountPassword', 'reviewDetails');
  const notes = readOptionalText(candidate, 'notes', 'reviewDetails');

  if (contactFirstName != null) {
    reviewDetails.contactFirstName = contactFirstName;
  }

  if (contactLastName != null) {
    reviewDetails.contactLastName = contactLastName;
  }

  if (contactPhone != null) {
    reviewDetails.contactPhone = contactPhone;
  }

  if (contactEmail != null) {
    reviewDetails.contactEmail = contactEmail;
  }

  if (demoAccountRequired != null) {
    reviewDetails.demoAccountRequired = demoAccountRequired;
  }

  if (demoAccountName != null) {
    reviewDetails.demoAccountName = demoAccountName;
  }

  if (demoAccountPassword != null) {
    reviewDetails.demoAccountPassword = demoAccountPassword;
  }

  if (notes != null) {
    reviewDetails.notes = notes;
  }

  return reviewDetails;
}

function decodeAgeRating(candidate: unknown): Record<string, AgeRatingValue> {
  const isObject = isPlainRecord(candidate);

  if (isObject == false) {
    throw releaseAttributesFailure(
      'decode release config fields',
      candidate,
      'release.config.json: ageRating answers must be a string or boolean.',
    );
  }

  const answers: Record<string, AgeRatingValue> = {};

  for (const [answerName, answer] of Object.entries(candidate)) {
    const isValidAnswer = isAgeRatingValue(answer);

    if (isValidAnswer == false) {
      throw releaseAttributesFailure(
        'decode release config fields',
        candidate,
        'release.config.json: ageRating answers must be a string or boolean.',
      );
    }

    answers[answerName] = answer;
  }

  const verdict = deprecatedAgeRatingVerdict(answers);
  const isDeprecated = verdict != true;

  if (isDeprecated) {
    throw releaseAttributesFailure('decode release config fields', candidate, verdict);
  }

  return answers;
}

function hasDeclaredSection(releaseConfig: ReleaseAttributesConfig): boolean {
  if (releaseConfig.ageRating != null) {
    return true;
  }

  if (releaseConfig.categories != null) {
    return true;
  }

  if (releaseConfig.pricing != null) {
    return true;
  }

  return releaseConfig.reviewDetails != null;
}

/** Decode an untrusted release.config.json document. */
export function parseReleaseConfig(rawDocument: unknown): ReleaseAttributesConfig {
  const isObject = isPlainRecord(rawDocument);

  if (isObject == false) {
    throw releaseAttributesFailure(
      'decode release config document',
      rawDocument,
      'release.config.json must be a JSON object.',
    );
  }

  const releaseConfig: {
    ageRating?: Record<string, AgeRatingValue>;
    categories?: ReleaseCategories;
    pricing?: ReleasePricing;
    reviewDetails?: ReviewDetailsConfig;
  } = {};

  if (Object.hasOwn(rawDocument, 'ageRating')) {
    releaseConfig.ageRating = decodeAgeRating(rawDocument['ageRating']);
  }

  if (Object.hasOwn(rawDocument, 'categories')) {
    releaseConfig.categories = decodeCategories(rawDocument['categories']);
  }

  if (Object.hasOwn(rawDocument, 'pricing')) {
    releaseConfig.pricing = decodePricing(rawDocument['pricing']);
  }

  if (Object.hasOwn(rawDocument, 'reviewDetails')) {
    releaseConfig.reviewDetails = decodeReviewDetails(rawDocument['reviewDetails']);
  }

  const hasSection = hasDeclaredSection(releaseConfig);

  if (hasSection == false) {
    throw releaseAttributesFailure(
      'decode release config fields',
      rawDocument,
      'release.config.json has no recognized section - declare at least one of ageRating / categories / pricing / reviewDetails.',
    );
  }

  return releaseConfig;
}

/** Read and decode release.config.json. */
export async function loadReleaseConfig(configPath: string): Promise<ReleaseAttributesConfig> {
  let configExists = false;

  try {
    configExists = await pathExists(configPath);
  } catch (cause) {
    throw releaseAttributesFailure('inspect release config', cause);
  }

  if (configExists == false) {
    throw releaseAttributesFailure(
      'read release config',
      configPath,
      `No release config at ${configPath}. Create one (see \`launch release-config --help\`) or pass --config.`,
    );
  }

  let configSource = '';

  try {
    configSource = await readFile(configPath, 'utf8');
  } catch (cause) {
    throw releaseAttributesFailure('read release config', cause);
  }

  let rawDocument: unknown;

  try {
    rawDocument = JSON.parse(configSource);
  } catch (cause) {
    throw releaseAttributesFailure(
      'parse release config JSON',
      cause,
      `Invalid JSON in ${configPath}.`,
    );
  }

  return parseReleaseConfig(rawDocument);
}
