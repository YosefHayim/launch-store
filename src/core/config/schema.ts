/**
 * Effect Schema home for the `launch.config.ts` boundary.
 *
 * The legacy zod schema still exists only as the JSON Schema compatibility source while the generated
 * config reference is moved over. Runtime validation enters through this module.
 */

import { Effect, Schema } from 'effect';
import type { ParseResult } from 'effect';
import {
  APP_CLIP_ACTIONS,
  LEADERBOARD_FORMATTERS,
  LEADERBOARD_SORT_TYPES,
  LEADERBOARD_SUBMISSION_TYPES,
} from '../../apple/ascResources.js';
import type { SchemaViolation } from './jsonSchema.js';
import {
  DEFAULT_BUILD_ENGINE,
  DEFAULT_CREDENTIALS_PROVIDER,
  DEFAULT_STORAGE_PROVIDER,
  DEFAULT_SUBMITTER,
} from '../types/config.js';
import { PLAY_TRACKS } from '../types/app.js';

const CONFIG_PARSE_OPTIONS = { errors: 'all', onExcessProperty: 'error' } as const;

const OptionalString = Schema.optional(Schema.String);
const OptionalNumber = Schema.optional(Schema.Number);
const OptionalBoolean = Schema.optional(Schema.Boolean);
const StringArray = Schema.Array(Schema.String);
const OptionalStringArray = Schema.optional(StringArray);
const StringMap = Schema.Record({ key: Schema.String, value: Schema.String });
const OptionalStringMap = Schema.optional(StringMap);

const PlayTrackSchema = Schema.Literal(...PLAY_TRACKS);
const SubmitByPlatformEffectSchema = Schema.Struct({
  ios: OptionalStringArray,
  android: OptionalStringArray,
  tvos: OptionalStringArray,
  macos: OptionalStringArray,
  visionos: OptionalStringArray,
});

const BuildProfileEffectSchema = Schema.Struct({
  name: Schema.String,
  envFile: OptionalString,
  env: OptionalStringMap,
  ssl: OptionalBoolean,
  sizeBudgetMB: OptionalNumber,
  track: Schema.optional(PlayTrackSchema),
  rollout: OptionalNumber,
});

const ProductLocalizationEffectSchema = Schema.Struct({
  locale: Schema.String,
  name: Schema.String,
  description: OptionalString,
});
const GroupLocalizationEffectSchema = Schema.Struct({ locale: Schema.String, name: Schema.String });
const ProductPriceEffectSchema = Schema.Struct({
  baseTerritory: OptionalString,
  customerPrice: Schema.Number,
});
const OfferPriceEffectSchema = Schema.Struct({
  territory: OptionalString,
  customerPrice: Schema.Number,
});
const PlayPriceConfigEffectSchema = Schema.Struct({
  priceMicros: Schema.String,
  currency: Schema.String,
});
const OfferDurationSchema = Schema.Literal(
  'THREE_DAYS',
  'ONE_WEEK',
  'TWO_WEEKS',
  'ONE_MONTH',
  'TWO_MONTHS',
  'THREE_MONTHS',
  'SIX_MONTHS',
  'ONE_YEAR',
);
const OfferModeSchema = Schema.Literal('PAY_AS_YOU_GO', 'PAY_UP_FRONT', 'FREE_TRIAL');
const OfferCustomerEligibilitySchema = Schema.Literal('NEW', 'EXISTING', 'EXPIRED');
const OfferEligibilitySchema = Schema.Literal('STACK_WITH_INTRO_OFFERS', 'REPLACE_INTRO_OFFERS');
const OfferConfigBaseSchema = {
  duration: OfferDurationSchema,
  offerMode: OfferModeSchema,
  numberOfPeriods: Schema.Number,
  prices: Schema.optional(Schema.Array(OfferPriceEffectSchema)),
};
const OfferCodeConfigEffectSchema = Schema.Struct({
  ...OfferConfigBaseSchema,
  name: Schema.String,
  customerEligibilities: Schema.Array(OfferCustomerEligibilitySchema),
  offerEligibility: OfferEligibilitySchema,
});
const PromotionalOfferConfigEffectSchema = Schema.Struct({
  ...OfferConfigBaseSchema,
  name: Schema.String,
  offerCode: Schema.String,
});
const IntroductoryOfferConfigEffectSchema = Schema.Struct({
  duration: OfferDurationSchema,
  offerMode: OfferModeSchema,
  numberOfPeriods: Schema.Number,
  territory: OptionalString,
  price: Schema.optional(OfferPriceEffectSchema),
  startDate: OptionalString,
  endDate: OptionalString,
});
const WinBackOfferConfigEffectSchema = Schema.Struct({
  ...OfferConfigBaseSchema,
  offerId: Schema.String,
  referenceName: Schema.String,
  eligiblePaidMonths: Schema.Number,
  monthsSinceLastSubscribed: Schema.Struct({ min: Schema.Number, max: Schema.Number }),
  waitBetweenOffersMonths: OptionalNumber,
  startDate: Schema.String,
  endDate: OptionalString,
  priority: Schema.optional(Schema.Literal('HIGH', 'NORMAL')),
  promotionIntent: Schema.optional(Schema.Literal('NOT_PROMOTED', 'USE_AUTO_GENERATED_ASSETS')),
});
const PlaySubscriptionOfferConfigEffectSchema = Schema.Struct({
  offerId: Schema.String,
  freeTrialDuration: OptionalString,
  introPrices: Schema.optional(
    Schema.Record({ key: Schema.String, value: PlayPriceConfigEffectSchema }),
  ),
  introRecurrenceCount: OptionalNumber,
});
const PlaySubscriptionOverrideEffectSchema = Schema.Struct({
  productId: OptionalString,
  basePlanId: OptionalString,
  prices: Schema.Record({ key: Schema.String, value: PlayPriceConfigEffectSchema }),
  offers: Schema.optional(Schema.Array(PlaySubscriptionOfferConfigEffectSchema)),
});
const SubscriptionPeriodSchema = Schema.Literal(
  'ONE_WEEK',
  'ONE_MONTH',
  'TWO_MONTHS',
  'THREE_MONTHS',
  'SIX_MONTHS',
  'ONE_YEAR',
);
const SubscriptionConfigEffectSchema = Schema.Struct({
  productId: Schema.String,
  referenceName: Schema.String,
  subscriptionPeriod: SubscriptionPeriodSchema,
  localizations: Schema.Array(ProductLocalizationEffectSchema),
  price: Schema.optional(ProductPriceEffectSchema),
  offerCodes: Schema.optional(Schema.Array(OfferCodeConfigEffectSchema)),
  promotionalOffers: Schema.optional(Schema.Array(PromotionalOfferConfigEffectSchema)),
  introductoryOffers: Schema.optional(Schema.Array(IntroductoryOfferConfigEffectSchema)),
  winBackOffers: Schema.optional(Schema.Array(WinBackOfferConfigEffectSchema)),
  reviewScreenshot: OptionalString,
  play: Schema.optional(PlaySubscriptionOverrideEffectSchema),
});
const SubscriptionGroupConfigEffectSchema = Schema.Struct({
  referenceName: Schema.String,
  localizations: Schema.Array(GroupLocalizationEffectSchema),
  subscriptions: Schema.Array(SubscriptionConfigEffectSchema),
});
const PlayProductOverrideEffectSchema = Schema.Struct({
  sku: OptionalString,
  defaultPrice: Schema.optional(PlayPriceConfigEffectSchema),
  prices: Schema.optional(
    Schema.Record({ key: Schema.String, value: PlayPriceConfigEffectSchema }),
  ),
});
const InAppPurchaseConfigEffectSchema = Schema.Struct({
  productId: Schema.String,
  referenceName: Schema.String,
  type: Schema.Literal('CONSUMABLE', 'NON_CONSUMABLE', 'NON_RENEWING_SUBSCRIPTION'),
  localizations: Schema.Array(ProductLocalizationEffectSchema),
  price: Schema.optional(ProductPriceEffectSchema),
  play: Schema.optional(PlayProductOverrideEffectSchema),
});
const PromotedPurchaseConfigEffectSchema = Schema.Struct({
  productId: Schema.String,
  visibleForAllUsers: OptionalBoolean,
  enabled: OptionalBoolean,
});
const AppProductsEffectSchema = Schema.Struct({
  subscriptionGroups: Schema.optional(Schema.Array(SubscriptionGroupConfigEffectSchema)),
  inAppPurchases: Schema.optional(Schema.Array(InAppPurchaseConfigEffectSchema)),
  promotedPurchases: Schema.optional(Schema.Array(PromotedPurchaseConfigEffectSchema)),
});

const ReleaseConfigEffectSchema = Schema.Struct({
  releaseType: Schema.optional(Schema.Literal('AFTER_APPROVAL', 'MANUAL', 'SCHEDULED')),
  earliestReleaseDate: OptionalString,
  phasedRelease: OptionalBoolean,
  usesNonExemptEncryption: OptionalBoolean,
  releaseNotes: Schema.optional(Schema.Union(Schema.String, StringMap)),
  primaryLocale: OptionalString,
});
const NotifyConfigEffectSchema = Schema.Struct({
  webhookUrl: OptionalString,
  command: OptionalString,
  events: Schema.optional(Schema.Array(Schema.Literal('build', 'submit', 'review', 'rollout'))),
});
const AchievementConfigEffectSchema = Schema.Struct({
  vendorIdentifier: Schema.String,
  referenceName: Schema.String,
  points: Schema.Number,
  showBeforeEarned: OptionalBoolean,
  repeatable: OptionalBoolean,
  name: Schema.String,
  beforeEarnedDescription: Schema.String,
  afterEarnedDescription: Schema.String,
  locale: OptionalString,
});
const LeaderboardConfigEffectSchema = Schema.Struct({
  vendorIdentifier: Schema.String,
  referenceName: Schema.String,
  defaultFormatter: Schema.Literal(...LEADERBOARD_FORMATTERS),
  submissionType: Schema.Literal(...LEADERBOARD_SUBMISSION_TYPES),
  scoreSortType: Schema.Literal(...LEADERBOARD_SORT_TYPES),
  name: Schema.String,
  locale: OptionalString,
});
const GameCenterConfigEffectSchema = Schema.Struct({
  achievements: Schema.optional(Schema.Array(AchievementConfigEffectSchema)),
  leaderboards: Schema.optional(Schema.Array(LeaderboardConfigEffectSchema)),
});
const AppClipLocalizationConfigEffectSchema = Schema.Struct({ subtitle: Schema.String });
const AppClipConfigEffectSchema = Schema.Struct({
  action: Schema.optional(Schema.Literal(...APP_CLIP_ACTIONS)),
  localizations: Schema.optional(
    Schema.Record({ key: Schema.String, value: AppClipLocalizationConfigEffectSchema }),
  ),
});
const AppClipsConfigEffectSchema = Schema.Struct({
  clips: Schema.Record({ key: Schema.String, value: AppClipConfigEffectSchema }),
});
const EuDistributionDomainConfigEffectSchema = Schema.Struct({
  domain: Schema.String,
  referenceName: Schema.String,
});
const EuDistributionConfigEffectSchema = Schema.Struct({
  domains: Schema.Array(EuDistributionDomainConfigEffectSchema),
});
const WalletIdConfigEffectSchema = Schema.Struct({
  identifier: Schema.String,
  name: Schema.String,
});
const WalletConfigEffectSchema = Schema.Struct({
  merchantIds: Schema.optional(Schema.Array(WalletIdConfigEffectSchema)),
  passTypeIds: Schema.optional(Schema.Array(WalletIdConfigEffectSchema)),
});
const ReleaseCategoriesEffectSchema = Schema.Struct({
  primary: OptionalString,
  secondary: OptionalString,
});
const ReleasePricingEffectSchema = Schema.Struct({
  baseTerritory: OptionalString,
  customerPrice: Schema.Number,
});
const ReviewDetailsConfigEffectSchema = Schema.Struct({
  contactFirstName: OptionalString,
  contactLastName: OptionalString,
  contactPhone: OptionalString,
  contactEmail: OptionalString,
  demoAccountRequired: OptionalBoolean,
  demoAccountName: OptionalString,
  demoAccountPassword: OptionalString,
  notes: OptionalString,
});
const ReleaseAttributesConfigEffectSchema = Schema.Struct({
  ageRating: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.Union(Schema.String, Schema.Boolean) }),
  ),
  categories: Schema.optional(ReleaseCategoriesEffectSchema),
  pricing: Schema.optional(ReleasePricingEffectSchema),
  reviewDetails: Schema.optional(ReviewDetailsConfigEffectSchema),
});
const SurfaceConfigFilesEffectSchema = Schema.Struct({
  availability: OptionalString,
  accessibility: OptionalString,
  experiments: OptionalString,
  customPages: OptionalString,
});
const McpConfigEffectSchema = Schema.Struct({
  capabilities: Schema.optional(
    Schema.Array(Schema.Literal('read', 'dryRun', 'write', 'dangerous')),
  ),
});
const AwsConfigEffectSchema = Schema.Struct({
  region: Schema.String,
  profile: OptionalString,
  amiId: OptionalString,
  instanceType: OptionalString,
});
const StorageConfigEffectSchema = Schema.Struct({
  endpoint: OptionalString,
  bucket: Schema.String,
  region: OptionalString,
  publicBaseUrl: Schema.String,
  supabaseUrl: OptionalString,
});

/**
 * Effect Schema source of truth for the authoring shape and decoded runtime config.
 */
export const LaunchConfigEffectSchema = Schema.Struct({
  profiles: Schema.Record({ key: Schema.String, value: BuildProfileEffectSchema }),
  credentials: Schema.optionalWith(Schema.String, { default: () => DEFAULT_CREDENTIALS_PROVIDER }),
  storage: Schema.optionalWith(Schema.String, { default: () => DEFAULT_STORAGE_PROVIDER }),
  buildEngine: Schema.optionalWith(Schema.String, { default: () => DEFAULT_BUILD_ENGINE }),
  submit: Schema.optionalWith(Schema.Union(Schema.String, SubmitByPlatformEffectSchema), {
    default: () => DEFAULT_SUBMITTER,
  }),
  appRoots: OptionalStringArray,
  products: Schema.optional(Schema.Record({ key: Schema.String, value: AppProductsEffectSchema })),
  notify: Schema.optional(NotifyConfigEffectSchema),
  release: Schema.optional(ReleaseConfigEffectSchema),
  gameCenter: Schema.optional(
    Schema.Record({ key: Schema.String, value: GameCenterConfigEffectSchema }),
  ),
  appClips: Schema.optional(
    Schema.Record({ key: Schema.String, value: AppClipsConfigEffectSchema }),
  ),
  releaseAttributes: Schema.optional(
    Schema.Record({ key: Schema.String, value: ReleaseAttributesConfigEffectSchema }),
  ),
  wallet: Schema.optional(WalletConfigEffectSchema),
  euDistribution: Schema.optional(EuDistributionConfigEffectSchema),
  configFiles: Schema.optional(SurfaceConfigFilesEffectSchema),
  aws: Schema.optional(AwsConfigEffectSchema),
  storageConfig: Schema.optional(StorageConfigEffectSchema),
  artifactDir: OptionalString,
  artifactRetentionDays: OptionalNumber,
  envExclude: OptionalStringArray,
  mcp: Schema.optional(McpConfigEffectSchema),
});

export type ParsedLaunchConfig = Schema.Schema.Type<typeof LaunchConfigEffectSchema>;
export type LaunchConfigEffectInput = Schema.Schema.Encoded<typeof LaunchConfigEffectSchema>;

/**
 * Decode an unknown config value through the Effect Schema boundary.
 *
 * @param candidateConfig - Value loaded from `launch.config.ts` or a JSON config file.
 * @returns Effect that succeeds with provider defaults filled or fails with an Effect parse error.
 *
 * @example
 * ```ts
 * const parsed = yield* parseLaunchConfig({ profiles: {} });
 * ```
 */
export function parseLaunchConfig(
  candidateConfig: unknown,
): Effect.Effect<ParsedLaunchConfig, ParseResult.ParseError> {
  return Schema.decodeUnknown(LaunchConfigEffectSchema, CONFIG_PARSE_OPTIONS)(candidateConfig);
}

/**
 * Validate an unknown config value and flatten Effect parse issues into Launch's public violation shape.
 *
 * @param candidateConfig - Value loaded from the config boundary.
 * @returns One violation per failing config path, or an empty array when valid.
 *
 * @example
 * ```ts
 * const violations = validateLaunchConfig({ profiles: {}, nope: true });
 * ```
 */
export function validateLaunchConfig(candidateConfig: unknown): SchemaViolation[] {
  const decodedConfig = Schema.decodeUnknownEither(
    LaunchConfigEffectSchema,
    CONFIG_PARSE_OPTIONS,
  )(candidateConfig);
  if (decodedConfig._tag === 'Right') return [];
  return parseIssueToViolations(decodedConfig.left.issue, []);
}

/**
 * Convert an Effect parse issue tree into flat Launch schema violations.
 *
 * @param parseIssue - Current Effect parse issue node being flattened.
 * @param parentPath - Path accumulated from parent pointer issues.
 * @returns Public Launch schema violations for this issue branch.
 */
function parseIssueToViolations(
  parseIssue: ParseResult.ParseIssue,
  parentPath: PropertyKey[],
): SchemaViolation[] {
  switch (parseIssue._tag) {
    case 'Composite':
      return parseIssuesToViolations(parseIssue.issues, parentPath);
    case 'Pointer':
      return parseIssueToViolations(parseIssue.issue, [
        ...parentPath,
        ...pathSegments(parseIssue.path),
      ]);
    case 'Refinement':
    case 'Transformation':
      return parseIssueToViolations(parseIssue.issue, parentPath);
    case 'Unexpected':
      return [{ path: formatPath(parentPath), message: 'unknown property' }];
    case 'Missing':
      return [{ path: formatPath(parentPath), message: parseIssue.message ?? 'is required' }];
    case 'Type':
    case 'Forbidden':
      return [{ path: formatPath(parentPath), message: parseIssue.message ?? 'invalid value' }];
  }
}

/**
 * Normalize Effect's single-or-non-empty path representation into an array.
 *
 * @param path - Effect parse path segment or non-empty segment array.
 * @returns Path segments as a mutable array for downstream formatting.
 */
function pathSegments(path: ParseResult.Path): PropertyKey[] {
  const pathValue: PropertyKey | readonly PropertyKey[] = path;
  return Array.isArray(pathValue)
    ? [...(pathValue as readonly PropertyKey[])]
    : [pathValue as PropertyKey];
}

/**
 * Convert one or many nested Effect parse issues into flat Launch schema violations.
 *
 * @param parseIssues - Single issue or non-empty issue array from an Effect composite.
 * @param parentPath - Path accumulated from parent pointer issues.
 * @returns Public Launch schema violations for every nested issue.
 */
function parseIssuesToViolations(
  parseIssues: ParseResult.SingleOrNonEmpty<ParseResult.ParseIssue>,
  parentPath: PropertyKey[],
): SchemaViolation[] {
  const issueList = Array.isArray(parseIssues) ? parseIssues : [parseIssues];
  return issueList.flatMap((nestedIssue) => parseIssueToViolations(nestedIssue, parentPath));
}

/**
 * Format a parsed config path as the dotted/bracketed path callers show.
 *
 * @param path - Config path segments reported by the Effect parser.
 * @returns Dotted path for identifiers and bracketed path for indexes or unusual keys.
 */
function formatPath(path: readonly PropertyKey[]): string {
  let formattedPath = '';
  for (const pathSegment of path) {
    if (typeof pathSegment === 'number') {
      formattedPath += `[${pathSegment}]`;
    } else if (typeof pathSegment === 'string' && /^[A-Za-z_$][\w$]*$/.test(pathSegment)) {
      formattedPath += formattedPath ? `.${pathSegment}` : pathSegment;
    } else {
      formattedPath += `[${JSON.stringify(String(pathSegment))}]`;
    }
  }
  return formattedPath;
}
