// TestFlight groups, testers, beta feedback, and beta review.

import type { components } from './apple-api-types.ts';

/** A TestFlight beta group - a named tester bucket that belongs to exactly one app. */
export type BetaGroupResource = Readonly<{
  id: string;
  name: string;
  isInternal?: boolean;
  publicLink?: string;
}>;

/** A TestFlight tester. */
export type BetaTesterResource = Readonly<{
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  state?: string;
}>;

/** Common attributes shared by Apple's two beta-feedback submission resources */
export type BetaFeedbackSubmissionResource = Readonly<{
  id: string;
  createdDate?: string;
  comment?: string;
  email?: string;
  deviceModel?: string;
  osVersion?: string;
  buildVersion?: string;
}>;

/** A TestFlight crash-feedback submission (`betaFeedbackCrashSubmissions`) - the device/OS context plus the tester's comment. */
export type BetaFeedbackCrashSubmissionResource = BetaFeedbackSubmissionResource;

/** A TestFlight screenshot-feedback submission (`betaFeedbackScreenshotSubmissions`) */
export type BetaFeedbackScreenshotSubmissionResource = BetaFeedbackSubmissionResource &
  Readonly<{
    screenshots: Readonly<{
      url: string;
      width?: number;
      height?: number;
    }>[];
  }>;

/** Server-side narrowing for the beta-feedback readers */
export type BetaFeedbackQuery = Readonly<{
  buildId?: string;
}>;

/** One locale's TestFlight "What to Test" note for a build (`betaBuildLocalizations`). */
export type BetaBuildLocalizationResource = Readonly<{
  id: string;
  locale: string;
  whatsNew?: string;
}>;

/** Apple's Beta App Review verdict for a build's submission. */
export type BetaReviewState = components['schemas']['BetaReviewState'];

/** A build's Beta App Review submission (`betaAppReviewSubmissions`) */
export type BetaAppReviewSubmissionResource = Readonly<{
  id: string;
  state?: BetaReviewState;
}>;
