import type { AscHost } from './host.ts';
import type {
  BetaAppReviewSubmissionResource,
  BetaBuildLocalizationResource,
  BetaFeedbackCrashSubmissionResource,
  BetaFeedbackQuery,
  BetaFeedbackScreenshotSubmissionResource,
  BetaFeedbackSubmissionResource,
  BetaGroupResource,
  BetaReviewState,
  BetaTesterResource,
} from '@/types/apple-catalog.js';
import type { BetaFeedbackPage, BetaFeedbackRow } from './shared.ts';
import {
  AscRequestError,
  isRetryableIdempotentFailure,
  readFeedbackScreenshots,
} from './shared.ts';
import { retryAppleTransportRequest } from '../transport-helpers.ts';

export class ConnectTestflight {
  constructor(private readonly client: AscHost) {}

  /**
   * Get a list of beta groups associated with a specific app.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-betagroups
   */
  async listBetaGroups(appId: string): Promise<BetaGroupResource[]> {
    const appleResources = await this.client.requestAll<{
      name?: string;
      isInternalGroup?: boolean;
      publicLink?: string | null;
    }>(`/apps/${appId}/betaGroups?limit=200&fields[betaGroups]=name,isInternalGroup,publicLink`);

    function flatMapGroup(group: {
      id: string;
      attributes: { name?: string; isInternalGroup?: boolean; publicLink?: string | null };
      relationships?: { build?: { data?: { id: string } | null } };
    }) {
      const groupName = group.attributes.name;

      if (groupName == null) return [];

      const betaGroup: BetaGroupResource = { id: group.id, name: groupName };

      if (group.attributes.isInternalGroup != null)
        Object.assign(betaGroup, { isInternal: group.attributes.isInternalGroup });

      if (group.attributes.publicLink != null && group.attributes.publicLink != null)
        Object.assign(betaGroup, { publicLink: group.attributes.publicLink });

      return [betaGroup];
    }

    return appleResources.flatMap(flatMapGroup);
  }

  async findBetaGroupByName(appId: string, name: string): Promise<BetaGroupResource | null> {
    const wanted = name.toLowerCase();

    function findGroup(group: {
      readonly id: string;
      readonly name: string;
      readonly isInternal?: boolean;
      readonly publicLink?: string;
    }) {
      return group.name.toLowerCase() == wanted;
    }

    const matchingGroup = (await this.listBetaGroups(appId)).find(findGroup);

    if (matchingGroup == null) return null;

    return matchingGroup;
  }

  /**
   * Create a beta group associated with an app, optionally enabling TestFlight public links.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/post-v1-betagroups
   */
  async createBetaGroup(appId: string, name: string): Promise<BetaGroupResource> {
    const appleResources = await this.client.createResource<{
      name?: string;
    }>('/betaGroups', {
      type: 'betaGroups',
      attributes: { name },
      relationships: { app: { data: { type: 'apps', id: appId } } },
    });
    let createdGroupName = appleResources.attributes.name;

    if (createdGroupName == null) createdGroupName = name;

    return { id: appleResources.id, name: createdGroupName };
  }

  async listBetaTestersInGroup(groupId: string): Promise<BetaTesterResource[]> {
    return this.betaTestersFrom(
      `/betaGroups/${groupId}/betaTesters?limit=200&fields[betaTesters]=email,firstName,lastName,state`,
    );
  }

  async findBetaTesterByEmail(email: string): Promise<BetaTesterResource | null> {
    const wanted = email.toLowerCase();
    const uRIComponent = encodeURIComponent(email);
    const appleResources = await this.betaTestersFrom(
      `/betaTesters?filter[email]=${uRIComponent}&limit=1&fields[betaTesters]=email,firstName,lastName,state`,
    );

    function findTester(tester: {
      readonly id: string;
      readonly email: string;
      readonly firstName?: string;
      readonly lastName?: string;
      readonly state?: string;
    }) {
      return tester.email.toLowerCase() == wanted;
    }

    const matchingTester = appleResources.find(findTester);

    if (matchingTester != null) return matchingTester;

    const firstTester = appleResources[0];

    if (firstTester == null) return null;

    return firstTester;
  }

  /**
   * Create a beta tester assigned to a group, a build, or an app.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/post-v1-betatesters
   */
  async createBetaTester(
    groupId: string,
    input: {
      email: string;
      firstName?: string;
      lastName?: string;
    },
  ): Promise<BetaTesterResource> {
    const testerAttributes = { email: input.email };

    if (input.firstName != null) Object.assign(testerAttributes, { firstName: input.firstName });

    if (input.lastName != null) Object.assign(testerAttributes, { lastName: input.lastName });

    const appleResources = await this.client.createResource<{
      email?: string | null;
      firstName?: string | null;
      lastName?: string | null;
      state?: string;
    }>('/betaTesters', {
      type: 'betaTesters',
      attributes: testerAttributes,
      relationships: { betaGroups: { data: [{ type: 'betaGroups', id: groupId }] } },
    });
    let testerEmail = appleResources.attributes.email;

    if (typeof testerEmail != 'string') testerEmail = input.email;

    const betaTester: BetaTesterResource = { id: appleResources.id, email: testerEmail };

    if (typeof appleResources.attributes.firstName == 'string')
      Object.assign(betaTester, { firstName: appleResources.attributes.firstName });

    if (typeof appleResources.attributes.lastName == 'string')
      Object.assign(betaTester, { lastName: appleResources.attributes.lastName });

    if (appleResources.attributes.state != null)
      Object.assign(betaTester, { state: appleResources.attributes.state });

    return betaTester;
  }

  /**
   * Add a specific beta tester to one or more beta groups for beta testing.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/post-v1-betagroups-_id_-relationships-betatesters
   */
  async addTestersToGroup(groupId: string, testerIds: readonly string[]): Promise<void> {
    function mapId(id: string) {
      return { type: 'betaTesters', id };
    }

    await this.client.request<unknown>('POST', `/betaGroups/${groupId}/relationships/betaTesters`, {
      data: testerIds.map(mapId),
    });
  }

  /**
   * Remove a specific beta tester from a one or more beta groups, revoking their access to test
   * builds associated with those groups.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-betagroups-_id_-relationships-betatesters
   */
  async removeTestersFromGroup(groupId: string, testerIds: readonly string[]): Promise<void> {
    function mapId2(id: string) {
      return { type: 'betaTesters', id };
    }

    await this.client.request<unknown>(
      'DELETE',
      `/betaGroups/${groupId}/relationships/betaTesters`,
      {
        data: testerIds.map(mapId2),
      },
    );
  }

  private async betaTestersFrom(path: string): Promise<BetaTesterResource[]> {
    const appleResources = await this.client.requestAll<{
      email?: string | null;
      firstName?: string | null;
      lastName?: string | null;
      state?: string;
    }>(path);

    function flatMapTester(tester: {
      id: string;
      attributes: {
        email?: string | null;
        firstName?: string | null;
        lastName?: string | null;
        state?: string;
      };
      relationships?: { build?: { data?: { id: string } | null } };
    }) {
      let testerEmail = tester.attributes.email;

      const emailIsOmitted = typeof testerEmail == 'undefined';

      if (emailIsOmitted) return [];

      if (testerEmail == null) testerEmail = '';

      const betaTester: BetaTesterResource = { id: tester.id, email: testerEmail };

      if (typeof tester.attributes.firstName == 'string')
        Object.assign(betaTester, { firstName: tester.attributes.firstName });

      if (typeof tester.attributes.lastName == 'string')
        Object.assign(betaTester, { lastName: tester.attributes.lastName });

      if (tester.attributes.state != null)
        Object.assign(betaTester, { state: tester.attributes.state });

      return [betaTester];
    }

    return appleResources.flatMap(flatMapTester);
  }

  async listBetaFeedbackCrashSubmissions(
    appId: string,
    query: BetaFeedbackQuery = {},
  ): Promise<BetaFeedbackCrashSubmissionResource[]> {
    const submissions = await this.listBetaFeedback(
      `/apps/${appId}/betaFeedbackCrashSubmissions`,
      query,
    );

    function readBase(submission: {
      base: BetaFeedbackSubmissionResource;
      screenshots: { url: string; width?: number; height?: number }[];
    }) {
      return submission.base;
    }

    return submissions.map(readBase);
  }

  async listBetaFeedbackScreenshotSubmissions(
    appId: string,
    query: BetaFeedbackQuery = {},
  ): Promise<BetaFeedbackScreenshotSubmissionResource[]> {
    const submissions = await this.listBetaFeedback(
      `/apps/${appId}/betaFeedbackScreenshotSubmissions`,
      query,
      true,
    );

    function mapSubmission(submission: {
      base: BetaFeedbackSubmissionResource;
      screenshots: { url: string; width?: number; height?: number }[];
    }) {
      return {
        ...submission.base,
        screenshots: submission.screenshots,
      };
    }

    return submissions.map(mapSubmission);
  }

  private async listBetaFeedback(
    relatedPath: string,
    query: BetaFeedbackQuery,
    withScreenshots = false,
  ): Promise<BetaFeedbackRow[]> {
    let path = `${relatedPath}?include=build&sort=-createdDate&limit=200`;

    if (query.buildId) path += `&filter[build]=${encodeURIComponent(query.buildId)}`;

    const submissions: BetaFeedbackRow[] = [];
    let next: string | undefined = path;

    while (next) {
      // biome-ignore lint/performance/noAwaitInLoops: cursor pagination - each page’s `next` link comes from the prior response, so the reads are inherently sequential
      const page: BetaFeedbackPage = await this.client.request<BetaFeedbackPage>('GET', next);
      const buildVersionById = new Map<string, string>();
      let includedResources = page.included;

      if (includedResources == null) includedResources = [];

      for (const includedResource of includedResources) {
        if (includedResource.type == 'builds' && includedResource.attributes?.version)
          buildVersionById.set(includedResource.id, includedResource.attributes.version);
      }
      for (const { id, attributes, relationships } of page.data) {
        const buildId = relationships?.build?.data?.id;
        let buildVersion: string | undefined;

        if (buildId != null) buildVersion = buildVersionById.get(buildId);

        const submission: BetaFeedbackSubmissionResource = { id };

        if (attributes?.createdDate != null)
          Object.assign(submission, { createdDate: attributes.createdDate });

        if (typeof attributes?.comment == 'string')
          Object.assign(submission, { comment: attributes.comment });

        if (typeof attributes?.email == 'string')
          Object.assign(submission, { email: attributes.email });

        if (typeof attributes?.deviceModel == 'string')
          Object.assign(submission, { deviceModel: attributes.deviceModel });

        if (typeof attributes?.osVersion == 'string')
          Object.assign(submission, { osVersion: attributes.osVersion });

        if (buildVersion != null) Object.assign(submission, { buildVersion });

        let screenshots: BetaFeedbackRow['screenshots'] = [];

        if (withScreenshots) screenshots = readFeedbackScreenshots(attributes?.screenshots);

        submissions.push({ base: submission, screenshots });
      }

      next = page.links?.next;
    }

    return submissions;
  }

  async downloadBetaFeedbackScreenshot(url: string): Promise<Buffer> {
    async function retryAppleTransportRequestPiece() {
      const appleResponse = await fetch(url);

      if (!appleResponse.ok) {
        throw new AscRequestError(
          `Beta feedback screenshot download failed (${appleResponse.status}).`,
          appleResponse.status,
        );
      }

      return Buffer.from(await appleResponse.arrayBuffer());
    }

    return retryAppleTransportRequest(retryAppleTransportRequestPiece, {
      isRetryableFailure: isRetryableIdempotentFailure,
    });
  }

  /**
   * Get a list of localized beta test information for a specific build.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-builds-_id_-betabuildlocalizations
   */
  async listBetaBuildLocalizations(buildId: string): Promise<BetaBuildLocalizationResource[]> {
    const appleResources = await this.client.requestAll<{
      locale?: string;
      whatsNew?: string | null;
    }>(
      `/builds/${buildId}/betaBuildLocalizations?limit=200&fields[betaBuildLocalizations]=locale,whatsNew`,
    );

    function flatMapLocalization(localization: {
      id: string;
      attributes: { locale?: string; whatsNew?: string | null };
      relationships?: { build?: { data?: { id: string } | null } };
    }) {
      const locale = localization.attributes.locale;

      if (locale == null) return [];

      const betaLocalization: BetaBuildLocalizationResource = { id: localization.id, locale };

      if (typeof localization.attributes.whatsNew == 'string')
        Object.assign(betaLocalization, { whatsNew: localization.attributes.whatsNew });

      return [betaLocalization];
    }

    return appleResources.flatMap(flatMapLocalization);
  }

  /**
   * Create localized What’s New text for a build.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/post-v1-betabuildlocalizations
   */
  async createBetaBuildLocalization(
    buildId: string,
    locale: string,
    whatsNew: string,
  ): Promise<void> {
    await this.client.createResource('/betaBuildLocalizations', {
      type: 'betaBuildLocalizations',
      attributes: { locale, whatsNew },
      relationships: { build: { data: { type: 'builds', id: buildId } } },
    });
  }

  /**
   * Update the localized What’s New text for a specific beta build and locale.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-betabuildlocalizations-_id_
   */
  async updateBetaBuildLocalization(localizationId: string, whatsNew: string): Promise<void> {
    await this.client.updateResource(`/betaBuildLocalizations/${localizationId}`, {
      type: 'betaBuildLocalizations',
      id: localizationId,
      attributes: { whatsNew },
    });
  }

  /**
   * Get the beta app review submission status for a specific build.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-builds-_id_-betaappreviewsubmission
   */
  async getBetaAppReviewSubmission(
    buildId: string,
  ): Promise<BetaAppReviewSubmissionResource | null> {
    return this.client.getOptional(async () => {
      const { data: appleResources } = await this.client.request<{
        data: {
          id: string;
          attributes?: {
            betaReviewState?: BetaReviewState;
          };
        } | null;
      }>('GET', `/builds/${buildId}/betaAppReviewSubmission`);

      if (appleResources == null) return null;

      const reviewSubmission: BetaAppReviewSubmissionResource = { id: appleResources.id };

      if (appleResources.attributes?.betaReviewState != null)
        Object.assign(reviewSubmission, { state: appleResources.attributes.betaReviewState });

      return reviewSubmission;
    });
  }

  /**
   * Submit an app for beta app review to allow external testing.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/post-v1-betaappreviewsubmissions
   */
  async createBetaAppReviewSubmission(buildId: string): Promise<void> {
    await this.client.createResource('/betaAppReviewSubmissions', {
      type: 'betaAppReviewSubmissions',
      relationships: { build: { data: { type: 'builds', id: buildId } } },
    });
  }
}
