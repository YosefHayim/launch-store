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
} from '../../types/apple-catalog.ts';
import type { BetaFeedbackPage, BetaFeedbackRow } from './shared.ts';
import { AscRequestError, isRetryableIdempotentFailure, toFeedbackScreenshots } from './shared.ts';
import { retryAppleTransportRequest } from '../transport-helpers.ts';

export class ConnectTestflight {
  constructor(private readonly client: AscHost) {}

  async listBetaGroups(appId: string): Promise<BetaGroupResource[]> {
    const appleResources = await this.client.requestAll<{
      name?: string;
      isInternalGroup?: boolean;
      publicLink?: string | null;
    }>(`/apps/${appId}/betaGroups?limit=200&fields[betaGroups]=name,isInternalGroup,publicLink`);
    return appleResources.flatMap((group) => {
      const groupName = group.attributes.name;
      if (groupName === undefined) return [];
      const betaGroup: BetaGroupResource = { id: group.id, name: groupName };
      if (group.attributes.isInternalGroup !== undefined)
        Object.assign(betaGroup, { isInternal: group.attributes.isInternalGroup });
      if (group.attributes.publicLink !== null && group.attributes.publicLink !== undefined)
        Object.assign(betaGroup, { publicLink: group.attributes.publicLink });
      return [betaGroup];
    });
  }

  async findBetaGroupByName(appId: string, name: string): Promise<BetaGroupResource | null> {
    const wanted = name.toLowerCase();
    const matchingGroup = (await this.listBetaGroups(appId)).find(
      (group) => group.name.toLowerCase() === wanted,
    );
    if (matchingGroup === undefined) return null;
    return matchingGroup;
  }

  async createBetaGroup(appId: string, name: string): Promise<BetaGroupResource> {
    const appleResources = await this.client.createResource<{
      name?: string;
    }>('/betaGroups', {
      type: 'betaGroups',
      attributes: { name },
      relationships: { app: { data: { type: 'apps', id: appId } } },
    });
    let createdGroupName = appleResources.attributes.name;
    if (createdGroupName === undefined) createdGroupName = name;
    return { id: appleResources.id, name: createdGroupName };
  }

  async listBetaTestersInGroup(groupId: string): Promise<BetaTesterResource[]> {
    return this.betaTestersFrom(
      `/betaGroups/${groupId}/betaTesters?limit=200&fields[betaTesters]=email,firstName,lastName,state`,
    );
  }

  async findBetaTesterByEmail(email: string): Promise<BetaTesterResource | null> {
    const wanted = email.toLowerCase();
    const appleResources = await this.betaTestersFrom(
      `/betaTesters?filter[email]=${encodeURIComponent(email)}&limit=1&fields[betaTesters]=email,firstName,lastName,state`,
    );
    const matchingTester = appleResources.find((tester) => tester.email.toLowerCase() === wanted);
    if (matchingTester !== undefined) return matchingTester;
    const firstTester = appleResources[0];
    if (firstTester === undefined) return null;
    return firstTester;
  }

  async createBetaTester(
    groupId: string,
    input: {
      email: string;
      firstName?: string;
      lastName?: string;
    },
  ): Promise<BetaTesterResource> {
    const testerAttributes = { email: input.email };
    if (input.firstName !== undefined)
      Object.assign(testerAttributes, { firstName: input.firstName });
    if (input.lastName !== undefined) Object.assign(testerAttributes, { lastName: input.lastName });
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
    if (typeof testerEmail !== 'string') testerEmail = input.email;
    const betaTester: BetaTesterResource = { id: appleResources.id, email: testerEmail };
    if (typeof appleResources.attributes.firstName === 'string')
      Object.assign(betaTester, { firstName: appleResources.attributes.firstName });
    if (typeof appleResources.attributes.lastName === 'string')
      Object.assign(betaTester, { lastName: appleResources.attributes.lastName });
    if (appleResources.attributes.state !== undefined)
      Object.assign(betaTester, { state: appleResources.attributes.state });
    return betaTester;
  }

  async addTestersToGroup(groupId: string, testerIds: readonly string[]): Promise<void> {
    await this.client.request<unknown>('POST', `/betaGroups/${groupId}/relationships/betaTesters`, {
      data: testerIds.map((id) => ({ type: 'betaTesters', id })),
    });
  }

  async removeTestersFromGroup(groupId: string, testerIds: readonly string[]): Promise<void> {
    await this.client.request<unknown>(
      'DELETE',
      `/betaGroups/${groupId}/relationships/betaTesters`,
      {
        data: testerIds.map((id) => ({ type: 'betaTesters', id })),
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
    return appleResources.flatMap((tester) => {
      let testerEmail = tester.attributes.email;
      if (testerEmail === undefined) return [];
      if (testerEmail === null) testerEmail = '';
      const betaTester: BetaTesterResource = { id: tester.id, email: testerEmail };
      if (typeof tester.attributes.firstName === 'string')
        Object.assign(betaTester, { firstName: tester.attributes.firstName });
      if (typeof tester.attributes.lastName === 'string')
        Object.assign(betaTester, { lastName: tester.attributes.lastName });
      if (tester.attributes.state !== undefined)
        Object.assign(betaTester, { state: tester.attributes.state });
      return [betaTester];
    });
  }

  async listBetaFeedbackCrashSubmissions(
    appId: string,
    query: BetaFeedbackQuery = {},
  ): Promise<BetaFeedbackCrashSubmissionResource[]> {
    const submissions = await this.listBetaFeedback(
      `/apps/${appId}/betaFeedbackCrashSubmissions`,
      query,
    );
    return submissions.map((submission) => submission.base);
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
    return submissions.map((submission) => ({
      ...submission.base,
      screenshots: submission.screenshots,
    }));
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
  }

  async downloadBetaFeedbackScreenshot(url: string): Promise<Buffer> {
    return retryAppleTransportRequest(
      async () => {
        const appleResponse = await fetch(url);
        if (!appleResponse.ok) {
          throw new AscRequestError(
            `Beta feedback screenshot download failed (${appleResponse.status}).`,
            appleResponse.status,
          );
        }
        return Buffer.from(await appleResponse.arrayBuffer());
      },
      { isRetryableFailure: isRetryableIdempotentFailure },
    );
  }

  async listBetaBuildLocalizations(buildId: string): Promise<BetaBuildLocalizationResource[]> {
    const appleResources = await this.client.requestAll<{
      locale?: string;
      whatsNew?: string | null;
    }>(
      `/builds/${buildId}/betaBuildLocalizations?limit=200&fields[betaBuildLocalizations]=locale,whatsNew`,
    );
    return appleResources.flatMap((localization) => {
      const locale = localization.attributes.locale;
      if (locale === undefined) return [];
      const betaLocalization: BetaBuildLocalizationResource = { id: localization.id, locale };
      if (typeof localization.attributes.whatsNew === 'string')
        Object.assign(betaLocalization, { whatsNew: localization.attributes.whatsNew });
      return [betaLocalization];
    });
  }

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

  async updateBetaBuildLocalization(localizationId: string, whatsNew: string): Promise<void> {
    await this.client.updateResource(`/betaBuildLocalizations/${localizationId}`, {
      type: 'betaBuildLocalizations',
      id: localizationId,
      attributes: { whatsNew },
    });
  }

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
      if (appleResources === null) return null;
      const reviewSubmission: BetaAppReviewSubmissionResource = { id: appleResources.id };
      if (appleResources.attributes?.betaReviewState !== undefined)
        Object.assign(reviewSubmission, { state: appleResources.attributes.betaReviewState });
      return reviewSubmission;
    });
  }

  async createBetaAppReviewSubmission(buildId: string): Promise<void> {
    await this.client.createResource('/betaAppReviewSubmissions', {
      type: 'betaAppReviewSubmissions',
      relationships: { build: { data: { type: 'builds', id: buildId } } },
    });
  }
}
