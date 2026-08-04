import type { FileSystem } from '@effect/platform';
import { isApplePlatform } from '@core/services/platform.js';
import type { Platform } from '@core/types/app.js';
import { Effect } from 'effect';
import { readScreenshotDimensions } from './imageDimensions.js';
import { APPLE_ASSET_TARGETS, findAppleScreenshotTarget } from './targets.js';

export const DEFAULT_APPLE_DISPLAY_TYPES: readonly string[] = APPLE_ASSET_TARGETS.filter(
  (assetTarget) => assetTarget.defaultGeneration === true,
).map((assetTarget) => assetTarget.screenshotDisplayType);

export const REQUIRED_APPLE_SCREENSHOT_DISPLAY_TYPES: readonly string[] =
  APPLE_ASSET_TARGETS.filter((assetTarget) => assetTarget.readinessRequired === true).map(
    (assetTarget) => assetTarget.screenshotDisplayType,
  );

// Source: https://support.google.com/googleplay/android-developer/answer/9866151?hl=en
export const PLAY_SCREENSHOT_CONSTRAINTS = {
  minSide: 320,
  maxSide: 3840,
  maxAspectMultiple: 2,
} as const;

export type PlayFormFactor = 'phone' | 'sevenInchTablet' | 'tenInchTablet';

export const PLAY_FORM_FACTOR_DIMENSIONS: Readonly<
  Record<PlayFormFactor, readonly [number, number]>
> = {
  phone: [1080, 1920],
  sevenInchTablet: [1206, 2144],
  tenInchTablet: [1600, 2560],
};

export const DEFAULT_PLAY_FORM_FACTORS: readonly PlayFormFactor[] = ['phone'];

export type DimensionVerdict =
  | {
      readonly ok: true;
    }
  | {
      readonly ok: false;
      readonly reason: string;
    };

export type FileDimensionCheck =
  | {
      readonly measured: false;
    }
  | {
      readonly measured: true;
      readonly width: number;
      readonly height: number;
      readonly verdict: DimensionVerdict;
    };

const formatDimensions = (dimensions: readonly [number, number]): string => {
  return `${dimensions[0]}x${dimensions[1]}`;
};

export const validateAppleDimensions = (
  displayType: string,
  width: number,
  height: number,
): DimensionVerdict => {
  const assetTarget = findAppleScreenshotTarget(displayType);
  if (assetTarget === undefined) return { ok: true };

  const dimensionsMatch = assetTarget.dimensions.accepted.some(
    ([expectedWidth, expectedHeight]) => {
      if (width === expectedWidth && height === expectedHeight) return true;
      if (assetTarget.dimensions.orientation !== 'both') return false;
      return width === expectedHeight && height === expectedWidth;
    },
  );
  if (dimensionsMatch) return { ok: true };

  const acceptedDimensions = assetTarget.dimensions.accepted.map(formatDimensions).join(', ');
  return {
    ok: false,
    reason: `${formatDimensions([width, height])} is not a valid ${displayType} size (expected ${acceptedDimensions})`,
  };
};

export const validatePlayDimensions = (width: number, height: number): DimensionVerdict => {
  const { minSide, maxSide, maxAspectMultiple } = PLAY_SCREENSHOT_CONSTRAINTS;
  const shorterSide = Math.min(width, height);
  const longerSide = Math.max(width, height);
  if (shorterSide < minSide) {
    return {
      ok: false,
      reason: `${formatDimensions([width, height])} is outside Play's ${minSide}-${maxSide}px per-side range`,
    };
  }
  if (longerSide > maxSide) {
    return {
      ok: false,
      reason: `${formatDimensions([width, height])} is outside Play's ${minSide}-${maxSide}px per-side range`,
    };
  }
  if (longerSide > shorterSide * maxAspectMultiple) {
    return {
      ok: false,
      reason: `${formatDimensions([width, height])} is too elongated for Play (longest side must be <= ${maxAspectMultiple}x the shortest)`,
    };
  }
  return { ok: true };
};

const findPlayDimensions = (formFactor: string): readonly [number, number] | undefined => {
  switch (formFactor) {
    case 'phone':
      return PLAY_FORM_FACTOR_DIMENSIONS.phone;
    case 'sevenInchTablet':
      return PLAY_FORM_FACTOR_DIMENSIONS.sevenInchTablet;
    case 'tenInchTablet':
      return PLAY_FORM_FACTOR_DIMENSIONS.tenInchTablet;
    default:
      return undefined;
  }
};

export const canonicalDimensions = (
  platform: Platform,
  screenshotTarget: string,
): readonly [number, number] | undefined => {
  if (isApplePlatform(platform))
    return findAppleScreenshotTarget(screenshotTarget)?.dimensions.canonical;
  return findPlayDimensions(screenshotTarget);
};

export const checkScreenshotFile = (
  platform: Platform,
  screenshotTarget: string,
  filePath: string,
): Effect.Effect<FileDimensionCheck, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const dimensions = yield* readScreenshotDimensions(filePath);
    if (dimensions === null) return { measured: false };

    let verdict: DimensionVerdict;
    if (isApplePlatform(platform))
      verdict = validateAppleDimensions(screenshotTarget, dimensions.width, dimensions.height);
    else verdict = validatePlayDimensions(dimensions.width, dimensions.height);

    return {
      measured: true,
      width: dimensions.width,
      height: dimensions.height,
      verdict,
    };
  });
