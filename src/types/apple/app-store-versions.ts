// App Store versions, listing copy, screenshots, previews, and review.

/** One locale's stored App Store listing copy */
export type ListingLocalization = Readonly<{
  id: string;
  locale: string;
  fields: Record<string, string>;
}>;

/** One App Store screenshot **set** */
export type ScreenshotSetResource = Readonly<{
  id: string;
  screenshotDisplayType: string;
}>;

/** One uploaded App Store screenshot. */
export type ScreenshotResource = Readonly<{
  id: string;
  fileName: string;
  sourceFileChecksum?: string;
  assetDeliveryState?: string;
}>;

/** One App Store app-preview-video **set** */
export type PreviewSetResource = Readonly<{
  id: string;
  previewType: string;
}>;

/** One uploaded App Store app preview video. */
export type PreviewResource = Readonly<{
  id: string;
  fileName: string;
  sourceFileChecksum?: string;
  assetDeliveryState?: string;
}>;

/** An App Store version - the per-release container carrying lifecycle state, release type */
export type AppStoreVersionResource = Readonly<{
  id: string;
  versionString: string;
  appStoreState: string;
  releaseType?: string;
  /** Id of the build attached to this version; absent when no build is attached. */
  attachedBuildId?: string;
  attachedBuildNumber?: string;
  attachedBuildProcessingState?: string;
}>;

/** One locale's editable version copy. Launch only ever writes `whatsNew` (the release notes). */
export type AppStoreVersionLocalizationResource = Readonly<{
  id: string;
  locale: string;
  whatsNew?: string;
}>;

/** A version's phased-release schedule (Apple's 7-day staged rollout), present only once one exists. */
export type PhasedReleaseResource = Readonly<{
  id: string;
  phasedReleaseState: string;
  currentDayNumber?: number;
}>;

/** An App Store review submission */
export type ReviewSubmissionResource = Readonly<{
  id: string;
  state: string;
}>;

/** An app version's App Review details */
export type AppStoreReviewDetailResource = Readonly<{
  id: string;
  attributes: Record<string, string | boolean>;
}>;
