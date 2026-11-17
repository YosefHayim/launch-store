import type {
  BetaFeedbackCrashSubmissionResource,
  BetaFeedbackQuery,
  BetaFeedbackScreenshotSubmissionResource,
  BetaFeedbackSubmissionResource,
} from '@core/types/appleCatalog.js';
import {
  isRetryableIdempotentFailure,
  makeAscRequestError,
  retryAppleTransportRequest,
} from '@/app-store-connect-api/api-client.js';
import type { AppStoreConnectRequests } from '@/app-store-connect-api/api-client.js';
// Docs: https://developer.apple.com/documentation/appstoreconnectapi/beta-feedback-crash-submissions
/**
 * One page of an app's beta-feedback submissions (crash or screenshot), read with `include=build` so
 * each row's build *version* can be resolved from the page's `included` builds without a per-row call.
 * Kept separate from PagedList because requestAll drops both the
 * `included` sidebar and the `build` relationship linkage this needs. The `screenshots` attribute is
 * present only on the screenshot resource; crashes simply omit it.
 */
type BetaFeedbackPage = {
  data: {
    id: string;
    attributes?: {
      createdDate?: string;
      comment?: string | null;
      email?: string | null;
      deviceModel?: string | null;
      osVersion?: string | null;
      screenshots?: {
        url?: string;
        width?: number;
        height?: number;
      }[];
    };
    relationships?: {
      build?: {
        data?: {
          id: string;
        } | null;
      };
    };
  }[];
  included?: {
    type: string;
    id: string;
    attributes?: {
      version?: string;
    };
  }[];
  links?: {
    next?: string;
  };
};
/** One normalized beta-feedback row before the crash/screenshot readers split off their public shapes. */
type BetaFeedbackRow = {
  base: BetaFeedbackSubmissionResource;
  screenshots: {
    url: string;
    width?: number;
    height?: number;
  }[];
};
/**
 * Project a beta-screenshot-submission's raw `screenshots` attribute into the public shape, keeping only
 * entries with a usable URL (Apple occasionally returns expired/empty placeholders) and dropping absent
 * dimensions so a diff/JSON view stays clean.
 */
const toFeedbackScreenshots = (
  raw:
    | {
        url?: string;
        width?: number;
        height?: number;
      }[]
    | undefined,
): {
  url: string;
  width?: number;
  height?: number;
}[] => {
  if (!raw) return [];
  return raw.flatMap((screenshot) => {
    const screenshotUrl = screenshot.url;
    if (screenshotUrl === undefined) return [];
    const feedbackScreenshot: { url: string; width?: number; height?: number } = {
      url: screenshotUrl,
    };
    if (screenshot.width !== undefined)
      Object.assign(feedbackScreenshot, { width: screenshot.width });
    if (screenshot.height !== undefined)
      Object.assign(feedbackScreenshot, { height: screenshot.height });
    return [feedbackScreenshot];
  });
};
export const makeBetaFeedbackApi = (api: AppStoreConnectRequests) => {
  /**
   * Shared paginating read for both beta-feedback resources. Walks `links.next`, resolves each row's
   * build version from the page's `included` builds, and (when `withScreenshots`) flattens the screenshot
   * attachments. Returns the common base for crashes; the screenshot reader layers its attachments on top.
   */
  const listBetaFeedback = async (
    relatedPath: string,
    query: BetaFeedbackQuery,
    withScreenshots = false,
  ): Promise<BetaFeedbackRow[]> => {
    let path = `${relatedPath}?include=build&sort=-createdDate&limit=200`;
    if (query.buildId) path += `&filter[build]=${encodeURIComponent(query.buildId)}`;
    const submissions: BetaFeedbackRow[] = [];
    let next: string | undefined = path;
    while (next) {
      // biome-ignore lint/performance/noAwaitInLoops: cursor pagination - each page’s `next` link comes from the prior response, so the reads are inherently sequential
      const page: BetaFeedbackPage = await api.request<BetaFeedbackPage>('GET', next);
      const buildVersionById = new Map<string, string>();
      let includedResources = page.included;
      if (includedResources === undefined) includedResources = [];
      for (const includedResource of includedResources) {
        if (includedResource.type === 'builds' && includedResource.attributes?.version)
          buildVersionById.set(includedResource.id, includedResource.attributes.version);
      }
      for (const { id, attributes, relationships } of page.data) {
        const buildId = relationships?.build?.data?.id;
        let buildVersion: string | undefined;
        if (buildId !== undefined) buildVersion = buildVersionById.get(buildId);
        const submission: BetaFeedbackSubmissionResource = { id };
        if (attributes?.createdDate !== undefined)
          Object.assign(submission, { createdDate: attributes.createdDate });
        if (typeof attributes?.comment === 'string')
          Object.assign(submission, { comment: attributes.comment });
        if (typeof attributes?.email === 'string')
          Object.assign(submission, { email: attributes.email });
        if (typeof attributes?.deviceModel === 'string')
          Object.assign(submission, { deviceModel: attributes.deviceModel });
        if (typeof attributes?.osVersion === 'string')
          Object.assign(submission, { osVersion: attributes.osVersion });
        if (buildVersion !== undefined) Object.assign(submission, { buildVersion });
        let screenshots: BetaFeedbackRow['screenshots'] = [];
        if (withScreenshots) screenshots = toFeedbackScreenshots(attributes?.screenshots);
        submissions.push({ base: submission, screenshots });
      }
      next = page.links?.next;
    }
    return submissions;
  };
  /**
   * List an app's TestFlight crash-feedback submissions, newest first, across all pages. Uses the
   * `getToManyRelated` endpoint (which returns full resources, unlike the bare `relationships` linkage)
   * with `include=build` so each row's build version resolves from the page's `included` builds.
   * `query.buildId` narrows server-side via Apple's `filter[build]` (a build *resource id*).
   */
  const listBetaFeedbackCrashSubmissions = async (
    appId: string,
    query: BetaFeedbackQuery = {},
  ): Promise<BetaFeedbackCrashSubmissionResource[]> => {
    const submissions = await listBetaFeedback(
      `/apps/${appId}/betaFeedbackCrashSubmissions`,
      query,
    );
    return submissions.map((submission) => submission.base);
  };
  /**
   * List an app's TestFlight screenshot-feedback submissions, newest first, across all pages. Same
   * read shape as listBetaFeedbackCrashSubmissions, plus each row's attached screenshots
   * (presigned, short-lived image URLs); rows without a usable URL are dropped from `screenshots`.
   */
  const listBetaFeedbackScreenshotSubmissions = async (
    appId: string,
    query: BetaFeedbackQuery = {},
  ): Promise<BetaFeedbackScreenshotSubmissionResource[]> => {
    const submissions = await listBetaFeedback(
      `/apps/${appId}/betaFeedbackScreenshotSubmissions`,
      query,
      true,
    );
    return submissions.map((submission) => ({
      ...submission.base,
      screenshots: submission.screenshots,
    }));
  };
  /**
   * Download a beta-feedback screenshot from its presigned URL. Like downloadAnalyticsSegment,
   * the URL carries its own query-string auth, so this is an UNauthenticated fetch - adding the API
   * Bearer would make Apple's asset host reject the request for presenting two auth mechanisms.
   */
  const downloadBetaFeedbackScreenshot = async (url: string): Promise<Buffer> => {
    return retryAppleTransportRequest(
      async () => {
        const appleResponse = await fetch(url);
        if (!appleResponse.ok) {
          throw makeAscRequestError(
            `Beta feedback screenshot download failed (${appleResponse.status}).`,
            appleResponse.status,
          );
        }
        return Buffer.from(await appleResponse.arrayBuffer());
      },
      { isRetryableFailure: isRetryableIdempotentFailure },
    );
  };

  return {
    listBetaFeedbackCrashSubmissions,
    listBetaFeedbackScreenshotSubmissions,
    downloadBetaFeedbackScreenshot,
  };
};
