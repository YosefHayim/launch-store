export type ScreenshotOrientation = 'both' | 'fixed';
/** Pixel dimensions accepted by one App Store screenshot display type. */
export type AppleScreenshotDimensions = {
  readonly canonical: readonly [number, number];
  readonly accepted: readonly (readonly [number, number])[];
  readonly orientation: ScreenshotOrientation;
};
/** One Apple device target shared by screenshot validation and preview labeling. */
export type AppleAssetTarget = {
  readonly key: string;
  readonly label: string;
  readonly screenshotDisplayType: string;
  readonly dimensions: AppleScreenshotDimensions;
  readonly previewType?: string;
  readonly defaultGeneration?: boolean;
  readonly readinessRequired?: boolean;
};
const IPHONE_67_DIMENSIONS: AppleScreenshotDimensions = {
  canonical: [1290, 2796],
  accepted: [
    [1290, 2796],
    [1284, 2778],
    [1260, 2736],
    [1320, 2868],
  ],
  orientation: 'both',
};
const IPHONE_65_DIMENSIONS: AppleScreenshotDimensions = {
  canonical: [1242, 2688],
  accepted: [
    [1242, 2688],
    [1284, 2778],
  ],
  orientation: 'both',
};
const IPHONE_58_DIMENSIONS: AppleScreenshotDimensions = {
  canonical: [1125, 2436],
  accepted: [
    [1125, 2436],
    [1170, 2532],
  ],
  orientation: 'both',
};
const IPAD_PRO_THIRD_GEN_129_DIMENSIONS: AppleScreenshotDimensions = {
  canonical: [2048, 2732],
  accepted: [
    [2048, 2732],
    [2064, 2752],
  ],
  orientation: 'both',
};
// Source: https://developer.apple.com/help/app-store-connect/reference/screenshot-specifications
export const APPLE_ASSET_TARGETS: readonly AppleAssetTarget[] = [
  {
    key: 'iphone67',
    label: 'iPhone 6.7"',
    screenshotDisplayType: 'APP_IPHONE_67',
    previewType: 'IPHONE_67',
    defaultGeneration: true,
    readinessRequired: true,
    dimensions: IPHONE_67_DIMENSIONS,
  },
  {
    key: 'iphone65',
    label: 'iPhone 6.5"',
    screenshotDisplayType: 'APP_IPHONE_65',
    previewType: 'IPHONE_65',
    dimensions: IPHONE_65_DIMENSIONS,
  },
  {
    key: 'iphone61',
    label: 'iPhone 6.1"',
    screenshotDisplayType: 'APP_IPHONE_61',
    previewType: 'IPHONE_61',
    dimensions: {
      canonical: [1170, 2532],
      accepted: [
        [1170, 2532],
        [1125, 2436],
        [1179, 2556],
        [1080, 2340],
        [1206, 2622],
      ],
      orientation: 'both',
    },
  },
  {
    key: 'iphone58',
    label: 'iPhone 5.8"',
    screenshotDisplayType: 'APP_IPHONE_58',
    previewType: 'IPHONE_58',
    dimensions: IPHONE_58_DIMENSIONS,
  },
  {
    key: 'iphone55',
    label: 'iPhone 5.5"',
    screenshotDisplayType: 'APP_IPHONE_55',
    previewType: 'IPHONE_55',
    dimensions: {
      canonical: [1242, 2208],
      accepted: [[1242, 2208]],
      orientation: 'both',
    },
  },
  {
    key: 'iphone47',
    label: 'iPhone 4.7"',
    screenshotDisplayType: 'APP_IPHONE_47',
    previewType: 'IPHONE_47',
    dimensions: {
      canonical: [750, 1334],
      accepted: [[750, 1334]],
      orientation: 'both',
    },
  },
  {
    key: 'iphone40',
    label: 'iPhone 4"',
    screenshotDisplayType: 'APP_IPHONE_40',
    previewType: 'IPHONE_40',
    dimensions: {
      canonical: [640, 1136],
      accepted: [
        [640, 1136],
        [640, 1096],
      ],
      orientation: 'both',
    },
  },
  {
    key: 'iphone35',
    label: 'iPhone 3.5"',
    screenshotDisplayType: 'APP_IPHONE_35',
    previewType: 'IPHONE_35',
    dimensions: {
      canonical: [640, 960],
      accepted: [
        [640, 960],
        [640, 920],
      ],
      orientation: 'both',
    },
  },
  {
    key: 'ipadProThirdGen129',
    label: 'iPad Pro 12.9" (3rd gen)',
    screenshotDisplayType: 'APP_IPAD_PRO_3GEN_129',
    previewType: 'IPAD_PRO_3GEN_129',
    defaultGeneration: true,
    dimensions: IPAD_PRO_THIRD_GEN_129_DIMENSIONS,
  },
  {
    key: 'ipadProThirdGen11',
    label: 'iPad Pro 11" (3rd gen)',
    screenshotDisplayType: 'APP_IPAD_PRO_3GEN_11',
    previewType: 'IPAD_PRO_3GEN_11',
    dimensions: {
      canonical: [1668, 2388],
      accepted: [
        [1668, 2388],
        [1668, 2420],
        [1488, 2266],
        [1640, 2360],
      ],
      orientation: 'both',
    },
  },
  {
    key: 'ipadPro129',
    label: 'iPad Pro 12.9"',
    screenshotDisplayType: 'APP_IPAD_PRO_129',
    previewType: 'IPAD_PRO_129',
    dimensions: {
      canonical: [2048, 2732],
      accepted: [[2048, 2732]],
      orientation: 'both',
    },
  },
  {
    key: 'ipad105',
    label: 'iPad 10.5"',
    screenshotDisplayType: 'APP_IPAD_105',
    previewType: 'IPAD_105',
    dimensions: {
      canonical: [1668, 2224],
      accepted: [[1668, 2224]],
      orientation: 'both',
    },
  },
  {
    key: 'ipad97',
    label: 'iPad 9.7"',
    screenshotDisplayType: 'APP_IPAD_97',
    previewType: 'IPAD_97',
    dimensions: {
      canonical: [1536, 2048],
      accepted: [
        [1536, 2048],
        [768, 1024],
      ],
      orientation: 'both',
    },
  },
  {
    key: 'mac',
    label: 'Mac',
    screenshotDisplayType: 'APP_DESKTOP',
    previewType: 'DESKTOP',
    dimensions: {
      canonical: [1280, 800],
      accepted: [
        [1280, 800],
        [1440, 900],
        [2560, 1600],
        [2880, 1800],
      ],
      orientation: 'fixed',
    },
  },
  {
    key: 'appleWatchUltra',
    label: 'Apple Watch Ultra',
    screenshotDisplayType: 'APP_WATCH_ULTRA',
    dimensions: {
      canonical: [410, 502],
      accepted: [
        [410, 502],
        [422, 514],
      ],
      orientation: 'fixed',
    },
  },
  {
    key: 'appleWatchSeries7',
    label: 'Apple Watch Series 7',
    screenshotDisplayType: 'APP_WATCH_SERIES_7',
    dimensions: {
      canonical: [396, 484],
      accepted: [
        [396, 484],
        [416, 496],
      ],
      orientation: 'fixed',
    },
  },
  {
    key: 'appleWatchSeries4',
    label: 'Apple Watch Series 4',
    screenshotDisplayType: 'APP_WATCH_SERIES_4',
    dimensions: {
      canonical: [368, 448],
      accepted: [[368, 448]],
      orientation: 'fixed',
    },
  },
  {
    key: 'appleWatchSeries3',
    label: 'Apple Watch Series 3',
    screenshotDisplayType: 'APP_WATCH_SERIES_3',
    dimensions: {
      canonical: [312, 390],
      accepted: [[312, 390]],
      orientation: 'fixed',
    },
  },
  {
    key: 'appleTv',
    label: 'Apple TV',
    screenshotDisplayType: 'APP_APPLE_TV',
    previewType: 'APPLE_TV',
    dimensions: {
      canonical: [1920, 1080],
      accepted: [
        [1920, 1080],
        [3840, 2160],
      ],
      orientation: 'fixed',
    },
  },
  {
    key: 'appleVisionPro',
    label: 'Apple Vision Pro',
    screenshotDisplayType: 'APP_APPLE_VISION_PRO',
    previewType: 'APPLE_VISION_PRO',
    dimensions: {
      canonical: [3840, 2160],
      accepted: [[3840, 2160]],
      orientation: 'fixed',
    },
  },
  {
    key: 'imessageIphone67',
    label: 'iMessage iPhone 6.7"',
    screenshotDisplayType: 'IMESSAGE_APP_IPHONE_67',
    dimensions: IPHONE_67_DIMENSIONS,
  },
  {
    key: 'imessageIphone65',
    label: 'iMessage iPhone 6.5"',
    screenshotDisplayType: 'IMESSAGE_APP_IPHONE_65',
    dimensions: IPHONE_65_DIMENSIONS,
  },
  {
    key: 'imessageIphone58',
    label: 'iMessage iPhone 5.8"',
    screenshotDisplayType: 'IMESSAGE_APP_IPHONE_58',
    dimensions: IPHONE_58_DIMENSIONS,
  },
  {
    key: 'imessageIpadProThirdGen129',
    label: 'iMessage iPad Pro 12.9"',
    screenshotDisplayType: 'IMESSAGE_APP_IPAD_PRO_3GEN_129',
    dimensions: IPAD_PRO_THIRD_GEN_129_DIMENSIONS,
  },
];
const appleTargetByKey = new Map(APPLE_ASSET_TARGETS.map((target) => [target.key, target]));
const appleTargetByDisplayType = new Map(
  APPLE_ASSET_TARGETS.map((target) => [target.screenshotDisplayType, target]),
);
const appleTargetsWithPreviews = APPLE_ASSET_TARGETS.filter(
  (assetTarget): assetTarget is AppleAssetTarget & { readonly previewType: string } =>
    assetTarget.previewType !== undefined,
);
const appleTargetByPreviewType = new Map(
  appleTargetsWithPreviews.map((assetTarget) => [assetTarget.previewType, assetTarget]),
);
/** Find an Apple asset target by its stable Launch key. */
export const findAppleAssetTarget = (targetKey: string): AppleAssetTarget | undefined => {
  return appleTargetByKey.get(targetKey);
};
/** Find an Apple asset target by its App Store screenshot display type. */
export const findAppleScreenshotTarget = (displayType: string): AppleAssetTarget | undefined => {
  return appleTargetByDisplayType.get(displayType);
};
/** Find an Apple asset target by its App Store preview type. */
export const findApplePreviewTarget = (previewType: string): AppleAssetTarget | undefined => {
  return appleTargetByPreviewType.get(previewType);
};
/** Return a display type's friendly label, falling back to an unknown future enum value. */
export const appleDisplayTypeLabel = (displayType: string): string => {
  const assetTarget = findAppleScreenshotTarget(displayType);
  if (assetTarget === undefined) return displayType;
  return assetTarget.label;
};
/** Return a preview type's friendly label, falling back to an unknown future enum value. */
export const applePreviewTypeLabel = (previewType: string): string => {
  const assetTarget = findApplePreviewTarget(previewType);
  if (assetTarget === undefined) return previewType;
  return assetTarget.label;
};
