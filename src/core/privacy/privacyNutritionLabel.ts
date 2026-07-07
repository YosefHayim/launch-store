/**
 * App Privacy "nutrition label" — spike verdict (issue #52) and the manual checklist Launch emits in its place.
 *
 * ## Verdict: UNUSABLE via the public API — the App Privacy questionnaire is UI-only.
 *
 * The hypothesis was that App Store Connect's REST API exposes the App Privacy data-collection
 * declarations (`appDataUsages`, `appDataUsageCategory`, `appDataUsagePurpose`,
 * `appDataUsageDataProtection`, and `appDataUsagesPublishState` to publish draft→live) even though
 * Apple's help pages document the flow as UI-only.
 *
 * Evidence — Apple's published OpenAPI spec, **App Store Connect API v4.4** (929 paths, 1346 schemas):
 * NONE of those resources exist. There is no `appDataUsage*` path or schema, and `appInfos` exposes only
 * `ageRatingDeclaration`, primary/secondary categories, and `territoryAgeRatings` — no data-usage
 * relationship. The single privacy-adjacent field is `privacyChoicesUrl` on `appInfoLocalizations`
 * (a link shown on the listing, not the data-collection questionnaire).
 *
 * Conclusion: the App Privacy nutrition label cannot be declared or published via the API today — it
 * stays a one-time manual step in App Store Connect. Rather than fake automation, Launch surfaces the
 * precise checklist below (via `launch doctor`) so the step isn't a surprise at submission time. If a
 * future spec adds the resources, regenerating ASC types (issue #56) will surface them and this verdict
 * can be revisited.
 */

/** Apple's help page for the App Privacy questionnaire — the authoritative reference for the steps below. */
export const APP_PRIVACY_HELP_URL =
  'https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy/';

/**
 * The ordered manual steps to complete the App Privacy "nutrition label" in App Store Connect. UI-only:
 * App Store Connect exposes no API for these declarations (see the module verdict), so Launch can guide
 * and remind, never automate. Mirrors the questionnaire's dimensions: collection → categories → purposes
 * → identity linkage → cross-app tracking → publish.
 */
export const APP_PRIVACY_STEPS: readonly string[] = [
  'Open App Store Connect → your app → App Privacy.',
  'Under Data Collection, declare whether your app or its third-party SDKs collect any data.',
  'For each data type collected, choose its category (Contact Info, Identifiers, Usage Data, Location, …).',
  'For each data type, declare every purpose it serves (Analytics, App Functionality, Advertising, …).',
  "Declare whether each data type is linked to the user's identity.",
  "Declare whether any data type is used to track the user across other companies' apps and websites.",
  'Save, then Publish the App Privacy details so they appear on the App Store product page.',
];

/**
 * Render the App Privacy checklist as printable lines: a one-line UI-only verdict, the numbered steps,
 * and the help link. Used by `launch doctor` to emit the precise "do these in the UI" list the API
 * cannot perform — the first line is the headline, the rest are indented detail.
 */
export function appPrivacyChecklist(): string[] {
  return [
    "App Privacy 'nutrition label' is UI-only — App Store Connect has no API for it; complete it once per app:",
    ...APP_PRIVACY_STEPS.map((step, index) => `  ${index + 1}. ${step}`),
    `  Reference: ${APP_PRIVACY_HELP_URL}`,
  ];
}
