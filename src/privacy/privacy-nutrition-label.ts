export const APP_PRIVACY_HELP_URL =
  'https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy/';
/** The ordered manual steps to complete the App Privacy "nutrition label" in App Store Connect. */
export const APP_PRIVACY_STEPS: readonly string[] = [
  'Open App Store Connect -> your app -> App Privacy.',
  'Under Data Collection, declare whether your app or its third-party SDKs collect any data.',
  'For each data type collected, choose its category (Contact Info, Identifiers, Usage Data, Location, ...).',
  'For each data type, declare every purpose it serves (Analytics, App Functionality, Advertising, ...).',
  "Declare whether each data type is linked to the user's identity.",
  "Declare whether any data type is used to track the user across other companies' apps and websites.",
  'Save, then Publish the App Privacy details so they appear on the App Store product page.',
];
/** Render the App Privacy checklist as printable lines */
export function appPrivacyChecklist(): string[] {
  function writeStepLine(step: string, index: number) {
    return `  ${index + 1}. ${step}`;
  }

  return [
    "App Privacy 'nutrition label' is UI-only - App Store Connect has no API for it; complete it once per app:",
    ...APP_PRIVACY_STEPS.map(writeStepLine),
    `  Reference: ${APP_PRIVACY_HELP_URL}`,
  ];
}
