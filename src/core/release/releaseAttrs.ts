import { FileSystem } from '@effect/platform';
import { Data, Effect, Schema } from 'effect';
import { resolveSecretRef } from '../credentials/secretRef.js';
import { errorMessage } from '../services/errorMessage.js';
import { appRecordMissing, skip, type ReconcileContext } from '../store/reconcile.js';
import type {
  AgeRatingDeclarationResource,
  AgeRatingValue,
  AppInfoResource,
  AppStoreReviewDetailResource,
  PricePointResource,
} from '../types/appleCatalog.js';
import type { PlannedAction, ReconcileReport } from '../types/reconcile.js';
import type {
  ReleaseAttributesConfig,
  ReleaseCategories,
  ReleasePricing,
  ReviewDetailsConfig,
} from '../types/storeSurface.js';

const DEFAULT_PLATFORM = 'IOS';
const DEFAULT_TERRITORY = 'USA';
const DEMO_PASSWORD_KEY = 'demoAccountPassword';

const ReleaseDocumentSchema = Schema.Record({ key: Schema.String, value: Schema.Unknown });
const AgeRatingSettingSchema = Schema.Unknown.pipe(
  Schema.filter(
    (ageRatingSetting): ageRatingSetting is AgeRatingValue =>
      [typeof ageRatingSetting === 'string', typeof ageRatingSetting === 'boolean'].includes(true),
    {
      message: () => 'release.config.json: ageRating answers must be a string or boolean.',
    },
  ),
);
const CategoriesSchema = Schema.mutable(
  Schema.Struct({
    primary: Schema.optionalWith(Schema.String, { exact: true }),
    secondary: Schema.optionalWith(Schema.String, { exact: true }),
  }),
);
const CustomerPriceSchema = Schema.Number.annotations({
  message: () => 'release.config.json: pricing.customerPrice must be a non-negative number.',
}).pipe(
  Schema.finite({
    message: () => 'release.config.json: pricing.customerPrice must be a non-negative number.',
  }),
  Schema.nonNegative({
    message: () => 'release.config.json: pricing.customerPrice must be a non-negative number.',
  }),
);
const PricingSchema = Schema.mutable(
  Schema.Struct({
    baseTerritory: Schema.optionalWith(Schema.String, { exact: true }),
    customerPrice: CustomerPriceSchema,
  }),
);
const ReviewDetailsSchema = Schema.mutable(
  Schema.Struct({
    contactFirstName: Schema.optionalWith(Schema.String, { exact: true }),
    contactLastName: Schema.optionalWith(Schema.String, { exact: true }),
    contactPhone: Schema.optionalWith(Schema.String, { exact: true }),
    contactEmail: Schema.optionalWith(Schema.String, { exact: true }),
    demoAccountRequired: Schema.optionalWith(Schema.Boolean, { exact: true }),
    demoAccountName: Schema.optionalWith(Schema.String, { exact: true }),
    demoAccountPassword: Schema.optionalWith(Schema.String, { exact: true }),
    notes: Schema.optionalWith(Schema.String, { exact: true }),
  }),
);

export const ReleaseAttributesConfigSchema = Schema.mutable(
  Schema.Struct({
    ageRating: Schema.optionalWith(
      Schema.mutable(Schema.Record({ key: Schema.String, value: AgeRatingSettingSchema })),
      { exact: true },
    ),
    categories: Schema.optionalWith(CategoriesSchema, { exact: true }),
    pricing: Schema.optionalWith(PricingSchema, { exact: true }),
    reviewDetails: Schema.optionalWith(ReviewDetailsSchema, { exact: true }),
  }),
).pipe(
  Schema.filter(
    (releaseConfig) =>
      [
        releaseConfig.ageRating,
        releaseConfig.categories,
        releaseConfig.pricing,
        releaseConfig.reviewDetails,
      ].some((declaredSection) => declaredSection !== undefined),
    {
      message: () =>
        'release.config.json has no recognized section - declare at least one of ageRating / categories / pricing / reviewDetails.',
    },
  ),
);

/** Release-attribute decoding or reconciliation failed. */
export type ReleaseAttributesFailure = Readonly<{
  readonly _tag: 'ReleaseAttributesFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause: unknown;
}>;

export const makeReleaseAttributesFailure = Data.tagged<ReleaseAttributesFailure>(
  'ReleaseAttributesFailure',
);

/** Store API calls used by release-attribute reconciliation. */
export type AscReleaseApi = Readonly<{
  getAppId: (bundleId: string) => Effect.Effect<string | null, unknown>;
  getAppInfo: (appId: string) => Effect.Effect<AppInfoResource | null, unknown>;
  updateAppInfoCategories: (
    appInfoId: string,
    categories: { primaryCategoryId?: string; secondaryCategoryId?: string | null },
  ) => Effect.Effect<void, unknown>;
  getAgeRatingDeclaration: (
    appInfoId: string,
  ) => Effect.Effect<AgeRatingDeclarationResource | null, unknown>;
  updateAgeRatingDeclaration: (
    declarationId: string,
    attributes: Record<string, AgeRatingValue>,
  ) => Effect.Effect<void, unknown>;
  findAppPricePoint: (
    appId: string,
    territory: string,
    customerPrice: number,
  ) => Effect.Effect<PricePointResource | null, unknown>;
  getCurrentAppPrice: (appId: string, territory: string) => Effect.Effect<string | null, unknown>;
  createAppPriceSchedule: (
    appId: string,
    baseTerritory: string,
    pricePointId: string,
  ) => Effect.Effect<void, unknown>;
  findEditableAppStoreVersion: (
    appId: string,
    platform: string,
  ) => Effect.Effect<{ id: string } | null, unknown>;
  getAppStoreReviewDetail: (
    versionId: string,
  ) => Effect.Effect<AppStoreReviewDetailResource | null, unknown>;
  createAppStoreReviewDetail: (
    versionId: string,
    attributes: Record<string, string | boolean>,
  ) => Effect.Effect<{ id: string }, unknown>;
  updateAppStoreReviewDetail: (
    detailId: string,
    attributes: Record<string, string | boolean>,
  ) => Effect.Effect<void, unknown>;
}>;

/** Inputs for one app's release-attribute reconciliation. */
export type ReleaseReconcileInput = Readonly<{
  bundleId: string;
  config: ReleaseAttributesConfig;
  platform?: string;
  dryRun: boolean;
}>;

type SecretResolver<Requirements> = (
  secretReference: string,
  secretLabel: string,
) => Effect.Effect<string, unknown, Requirements>;

const releaseAttributesFailure = (
  operation: string,
  cause: unknown,
  explicitMessage?: string,
): ReleaseAttributesFailure => {
  let message = explicitMessage;
  if (message === undefined) message = errorMessage(cause);
  if (message.length === 0) message = `${operation} failed.`;
  return makeReleaseAttributesFailure({ operation, message, cause });
};

/** Record and optionally apply one non-destructive reconciliation action. */
const performAction = <Requirements>(
  reconcileContext: ReconcileContext,
  description: string,
  applyAction: () => Effect.Effect<void, unknown, Requirements>,
): Effect.Effect<void, never, Requirements> => {
  const plannedAction: PlannedAction = {
    description,
    destructive: false,
    status: 'planned',
  };
  reconcileContext.actions.push(plannedAction);
  if (reconcileContext.dryRun) return Effect.void;
  return applyAction().pipe(
    Effect.match({
      onSuccess: () => {
        plannedAction.status = 'applied';
      },
      onFailure: (actionFailure) => {
        plannedAction.status = 'failed';
        plannedAction.error = errorMessage(actionFailure);
      },
    }),
  );
};

const describeCategoryChanges = (categoryChanges: {
  primaryCategoryId?: string;
  secondaryCategoryId?: string | null;
}): string => {
  const changeDescriptions: string[] = [];
  if (categoryChanges.primaryCategoryId !== undefined) {
    changeDescriptions.push(`primary=${categoryChanges.primaryCategoryId}`);
  }
  if (categoryChanges.secondaryCategoryId !== undefined) {
    let secondaryCategory = categoryChanges.secondaryCategoryId;
    if (secondaryCategory === null) secondaryCategory = 'unset';
    changeDescriptions.push(`secondary=${secondaryCategory}`);
  }
  return changeDescriptions.join(', ');
};

/** Reconcile declared App Store categories. */
const reconcileCategories = (
  reconcileContext: ReconcileContext,
  appleReleaseApi: AscReleaseApi,
  appInformation: AppInfoResource,
  categories: ReleaseCategories | undefined,
): Effect.Effect<void> => {
  if (categories === undefined) return Effect.void;
  const categoryChanges: {
    primaryCategoryId?: string;
    secondaryCategoryId?: string | null;
  } = {};
  if (categories.primary !== undefined && categories.primary !== appInformation.primaryCategoryId) {
    categoryChanges.primaryCategoryId = categories.primary;
  }
  if (
    categories.secondary !== undefined &&
    categories.secondary !== appInformation.secondaryCategoryId
  ) {
    categoryChanges.secondaryCategoryId = categories.secondary;
  }
  // Config omits secondary while the live App Info still has one - clear the stale assignment.
  if (categories.secondary === undefined && appInformation.secondaryCategoryId !== undefined) {
    categoryChanges.secondaryCategoryId = null;
  }
  if (Object.keys(categoryChanges).length === 0) return Effect.void;
  return performAction(
    reconcileContext,
    `set categories (${describeCategoryChanges(categoryChanges)})`,
    () => appleReleaseApi.updateAppInfoCategories(appInformation.id, categoryChanges),
  );
};

/** Reconcile changed age-rating answers. */
const reconcileAgeRating = (
  reconcileContext: ReconcileContext,
  appleReleaseApi: AscReleaseApi,
  appInformation: AppInfoResource,
  desiredAnswers: Record<string, AgeRatingValue> | undefined,
): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    if (desiredAnswers === undefined) return;
    if (Object.keys(desiredAnswers).length === 0) return;
    const currentDeclaration = yield* appleReleaseApi.getAgeRatingDeclaration(appInformation.id);
    if (currentDeclaration === null) {
      skip(
        reconcileContext,
        'age rating: no declaration on the app yet (create the version, then re-run)',
      );
      return;
    }
    const changedAnswers: Record<string, AgeRatingValue> = {};
    for (const answerEntry of Object.entries(desiredAnswers)) {
      const answerName = answerEntry[0];
      const desiredAnswer = answerEntry[1];
      if (currentDeclaration.attributes[answerName] !== desiredAnswer) {
        changedAnswers[answerName] = desiredAnswer;
      }
    }
    if (Object.keys(changedAnswers).length === 0) return;
    yield* performAction(
      reconcileContext,
      `set age rating (${Object.keys(changedAnswers).join(', ')})`,
      () => appleReleaseApi.updateAgeRatingDeclaration(currentDeclaration.id, changedAnswers),
    );
  });

/** Reconcile the base-territory customer price. */
const reconcilePricing = (
  reconcileContext: ReconcileContext,
  appleReleaseApi: AscReleaseApi,
  appId: string,
  pricing: ReleasePricing,
): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    let baseTerritory = DEFAULT_TERRITORY;
    if (pricing.baseTerritory !== undefined) baseTerritory = pricing.baseTerritory;
    const currentPrice = yield* appleReleaseApi.getCurrentAppPrice(appId, baseTerritory);
    if (currentPrice !== null && Number.parseFloat(currentPrice) === pricing.customerPrice) {
      return;
    }
    yield* performAction(
      reconcileContext,
      `set app price = ${pricing.customerPrice} (${baseTerritory})`,
      () =>
        Effect.gen(function* () {
          const pricePoint = yield* appleReleaseApi.findAppPricePoint(
            appId,
            baseTerritory,
            pricing.customerPrice,
          );
          if (pricePoint === null) {
            return yield* Effect.fail(
              releaseAttributesFailure(
                'resolve App Store price point',
                pricing,
                `No ${baseTerritory} app price point matches ${pricing.customerPrice}.`,
              ),
            );
          }
          yield* appleReleaseApi.createAppPriceSchedule(appId, baseTerritory, pricePoint.id);
        }),
    );
  });

/** Keep only review fields Apple accepts on the write resource (string/boolean only). */
const reviewAttributes = (reviewDetails: ReviewDetailsConfig): Record<string, string | boolean> => {
  const reviewWrite: Record<string, string | boolean> = {};
  for (const reviewEntry of Object.entries(reviewDetails)) {
    const fieldName = reviewEntry[0];
    const fieldSetting = reviewEntry[1];
    if (typeof fieldSetting === 'string') reviewWrite[fieldName] = fieldSetting;
    if (typeof fieldSetting === 'boolean') reviewWrite[fieldName] = fieldSetting;
  }
  return reviewWrite;
};

/** Field names only - never render secret values into action descriptions. */
const renderFieldNames = (attributes: Record<string, string | boolean>): string =>
  Object.keys(attributes).join(', ');

/** Resolve a demo-password reference only when an action is applied. */
const resolveReviewWrite = <Requirements>(
  attributes: Record<string, string | boolean>,
  resolveDemoSecret: SecretResolver<Requirements>,
): Effect.Effect<Record<string, string | boolean>, unknown, Requirements> =>
  Effect.gen(function* () {
    const passwordReference = attributes[DEMO_PASSWORD_KEY];
    if (typeof passwordReference !== 'string') return attributes;
    return {
      ...attributes,
      [DEMO_PASSWORD_KEY]: yield* resolveDemoSecret(passwordReference, DEMO_PASSWORD_KEY),
    };
  });

/** Reconcile the editable version's App Review details. */
const reconcileReviewDetails = <Requirements>(
  reconcileContext: ReconcileContext,
  appleReleaseApi: AscReleaseApi,
  appId: string,
  platform: string,
  reviewDetails: ReviewDetailsConfig,
  resolveDemoSecret: SecretResolver<Requirements>,
): Effect.Effect<void, unknown, Requirements> =>
  Effect.gen(function* () {
    const desiredAttributes = reviewAttributes(reviewDetails);
    if (Object.keys(desiredAttributes).length === 0) return;
    const editableVersion = yield* appleReleaseApi.findEditableAppStoreVersion(appId, platform);
    if (editableVersion === null) {
      skip(
        reconcileContext,
        'App Review details: no editable App Store version (create/select a version first)',
      );
      return;
    }
    const currentReviewDetails = yield* appleReleaseApi.getAppStoreReviewDetail(editableVersion.id);
    if (currentReviewDetails === null) {
      yield* performAction(
        reconcileContext,
        `set App Review details (${renderFieldNames(desiredAttributes)})`,
        () =>
          Effect.gen(function* () {
            const resolvedAttributes = yield* resolveReviewWrite(
              desiredAttributes,
              resolveDemoSecret,
            );
            yield* appleReleaseApi.createAppStoreReviewDetail(
              editableVersion.id,
              resolvedAttributes,
            );
          }),
      );
      return;
    }
    const changedAttributes: Record<string, string | boolean> = {};
    for (const desiredEntry of Object.entries(desiredAttributes)) {
      const fieldName = desiredEntry[0];
      const desiredSetting = desiredEntry[1];
      // ASC never echoes the password - skip equality and attach it only when another field drifts.
      if (fieldName === DEMO_PASSWORD_KEY) continue;
      if (currentReviewDetails.attributes[fieldName] !== desiredSetting) {
        changedAttributes[fieldName] = desiredSetting;
      }
    }
    if (Object.keys(changedAttributes).length === 0) return;
    if (desiredAttributes[DEMO_PASSWORD_KEY] !== undefined) {
      changedAttributes[DEMO_PASSWORD_KEY] = desiredAttributes[DEMO_PASSWORD_KEY];
    }
    yield* performAction(
      reconcileContext,
      `update App Review details (${renderFieldNames(changedAttributes)})`,
      () =>
        Effect.gen(function* () {
          const resolvedAttributes = yield* resolveReviewWrite(
            changedAttributes,
            resolveDemoSecret,
          );
          yield* appleReleaseApi.updateAppStoreReviewDetail(
            currentReviewDetails.id,
            resolvedAttributes,
          );
        }),
    );
  });

/** Run reconciliation with an injected demo-secret resolver. */
const reconcileReleaseWith = <Requirements>(
  appleReleaseApi: AscReleaseApi,
  reconciliationInput: ReleaseReconcileInput,
  resolveDemoSecret: SecretResolver<Requirements>,
): Effect.Effect<ReconcileReport, unknown, Requirements> =>
  Effect.gen(function* () {
    const reconcileContext: ReconcileContext = {
      actions: [],
      dryRun: reconciliationInput.dryRun,
    };
    const releaseConfig = reconciliationInput.config;
    const appId = yield* appleReleaseApi.getAppId(reconciliationInput.bundleId);
    if (appId === null) {
      return yield* Effect.fail(appRecordMissing(reconciliationInput.bundleId, 'release-config'));
    }
    const ageRatingDeclared =
      releaseConfig.ageRating !== undefined && Object.keys(releaseConfig.ageRating).length > 0;
    if ([releaseConfig.categories !== undefined, ageRatingDeclared].includes(true)) {
      const appInformation = yield* appleReleaseApi.getAppInfo(appId);
      if (appInformation === null) {
        skip(reconcileContext, 'categories / age rating: no App Info record on the app yet');
      } else {
        yield* reconcileCategories(
          reconcileContext,
          appleReleaseApi,
          appInformation,
          releaseConfig.categories,
        );
        yield* reconcileAgeRating(
          reconcileContext,
          appleReleaseApi,
          appInformation,
          releaseConfig.ageRating,
        );
      }
    }
    if (releaseConfig.pricing !== undefined) {
      yield* reconcilePricing(reconcileContext, appleReleaseApi, appId, releaseConfig.pricing);
    }
    if (releaseConfig.reviewDetails !== undefined) {
      let platform = DEFAULT_PLATFORM;
      if (reconciliationInput.platform !== undefined) {
        platform = reconciliationInput.platform;
      }
      yield* reconcileReviewDetails(
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
  });

/** Reconcile release attributes and resolve secrets only during apply actions. */
export const reconcileRelease = (
  appleReleaseApi: AscReleaseApi,
  reconciliationInput: ReleaseReconcileInput,
) =>
  reconcileReleaseWith(appleReleaseApi, reconciliationInput, resolveSecretRef).pipe(
    Effect.mapError((cause) => releaseAttributesFailure('reconcile release attributes', cause)),
  );

/** Plan release attributes without resolving secret references. */
export const reconcileReleasePlan = (
  appleReleaseApi: AscReleaseApi,
  reconciliationInput: ReleaseReconcileInput,
) =>
  reconcileReleaseWith(appleReleaseApi, reconciliationInput, (secretReference) =>
    Effect.fail(
      releaseAttributesFailure(
        'resolve review secret during plan',
        secretReference,
        'A release-attribute plan must not resolve secrets.',
      ),
    ),
  ).pipe(Effect.mapError((cause) => releaseAttributesFailure('plan release attributes', cause)));

/** Decode an untrusted release.config.json document. */
export const parseReleaseConfig = (
  rawDocument: unknown,
): Effect.Effect<ReleaseAttributesConfig, ReleaseAttributesFailure> =>
  Effect.gen(function* () {
    const releaseDocument = yield* Schema.decodeUnknown(ReleaseDocumentSchema)(rawDocument).pipe(
      Effect.mapError((cause) =>
        releaseAttributesFailure(
          'decode release config document',
          cause,
          'release.config.json must be a JSON object.',
        ),
      ),
    );
    return yield* Schema.decodeUnknown(ReleaseAttributesConfigSchema)(releaseDocument).pipe(
      Effect.mapError((cause) =>
        releaseAttributesFailure('decode release config fields', cause, errorMessage(cause)),
      ),
    );
  });

/** Read and decode release.config.json through Effect Platform. */
export const loadReleaseConfig = (
  configPath: string,
): Effect.Effect<ReleaseAttributesConfig, ReleaseAttributesFailure, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const configExists = yield* fileSystem
      .exists(configPath)
      .pipe(Effect.mapError((cause) => releaseAttributesFailure('inspect release config', cause)));
    if (!configExists) {
      return yield* Effect.fail(
        releaseAttributesFailure(
          'read release config',
          configPath,
          `No release config at ${configPath}. Create one (see \`launch release-config --help\`) or pass --config.`,
        ),
      );
    }
    const configSource = yield* fileSystem
      .readFileString(configPath)
      .pipe(Effect.mapError((cause) => releaseAttributesFailure('read release config', cause)));
    const rawDocument = yield* Schema.decodeUnknown(Schema.parseJson())(configSource).pipe(
      Effect.mapError((cause) =>
        releaseAttributesFailure(
          'parse release config JSON',
          cause,
          `Invalid JSON in ${configPath}.`,
        ),
      ),
    );
    return yield* parseReleaseConfig(rawDocument);
  });
