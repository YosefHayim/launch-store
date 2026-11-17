import type { BetaGroupResource, BetaTesterResource } from '@core/types/appleCatalog.js';
import type { AppStoreConnectRequests } from '@/app-store-connect-api/api-client.js';
// Docs: https://developer.apple.com/documentation/appstoreconnectapi/beta-groups
export const makeBetaTestersAndGroupsApi = (api: AppStoreConnectRequests) => {
  /** List an app's TestFlight beta groups (internal + external), across all pages. */
  const listBetaGroups = async (appId: string): Promise<BetaGroupResource[]> => {
    const appleResources = await api.requestAll<{
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
  };
  /** Find an app's beta group by exact, case-insensitive name, or null when there's no such group. */
  const findBetaGroupByName = async (
    appId: string,
    name: string,
  ): Promise<BetaGroupResource | null> => {
    const wanted = name.toLowerCase();
    const matchingGroup = (await listBetaGroups(appId)).find(
      (group) => group.name.toLowerCase() === wanted,
    );
    if (matchingGroup === undefined) return null;
    return matchingGroup;
  };
  /** Create an external beta group on an app - the bucket external testers are invited into. */
  const createBetaGroup = async (appId: string, name: string): Promise<BetaGroupResource> => {
    const appleResources = await api.createResource<{
      name?: string;
    }>('/betaGroups', {
      type: 'betaGroups',
      attributes: { name },
      relationships: { app: { data: { type: 'apps', id: appId } } },
    });
    let createdGroupName = appleResources.attributes.name;
    if (createdGroupName === undefined) createdGroupName = name;
    return { id: appleResources.id, name: createdGroupName };
  };
  /** Shared GET -> BetaTesterResource[] for any beta-tester collection (group members or a lookup). */
  const betaTestersFrom = async (path: string): Promise<BetaTesterResource[]> => {
    const appleResources = await api.requestAll<{
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
  };
  /** List the testers in a beta group, across all pages. */
  const listBetaTestersInGroup = async (groupId: string): Promise<BetaTesterResource[]> => {
    return betaTestersFrom(
      `/betaGroups/${groupId}/betaTesters?limit=200&fields[betaTesters]=email,firstName,lastName,state`,
    );
  };
  /**
   * Find a tester by email anywhere on the team, or null. Testers are team-scoped, so a hit here is the
   * person to link into a group rather than re-create; createBetaTester would otherwise 409.
   */
  const findBetaTesterByEmail = async (email: string): Promise<BetaTesterResource | null> => {
    const wanted = email.toLowerCase();
    const appleResources = await betaTestersFrom(
      `/betaTesters?filter[email]=${encodeURIComponent(email)}&limit=1&fields[betaTesters]=email,firstName,lastName,state`,
    );
    const matchingTester = appleResources.find((tester) => tester.email.toLowerCase() === wanted);
    if (matchingTester !== undefined) return matchingTester;
    const firstTester = appleResources[0];
    if (firstTester === undefined) return null;
    return firstTester;
  };
  /**
   * Create a tester and add them to a beta group in one call - for an external group this sends the
   * TestFlight invite email. Use addTestersToGroup instead when the tester already exists on
   * the team (an existing email here returns Apple's 409).
   */
  const createBetaTester = async (
    groupId: string,
    input: {
      email: string;
      firstName?: string;
      lastName?: string;
    },
  ): Promise<BetaTesterResource> => {
    const testerAttributes = { email: input.email };
    if (input.firstName !== undefined)
      Object.assign(testerAttributes, { firstName: input.firstName });
    if (input.lastName !== undefined) Object.assign(testerAttributes, { lastName: input.lastName });
    const appleResources = await api.createResource<{
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
  };
  /** Add existing testers to a beta group in one relationship call (invites external testers). */
  const addTestersToGroup = async (
    groupId: string,
    testerIds: readonly string[],
  ): Promise<void> => {
    await api.request<unknown>('POST', `/betaGroups/${groupId}/relationships/betaTesters`, {
      data: testerIds.map((id) => ({ type: 'betaTesters', id })),
    });
  };
  /** Remove testers from a beta group; they keep app access through any other group they're in. */
  const removeTestersFromGroup = async (
    groupId: string,
    testerIds: readonly string[],
  ): Promise<void> => {
    await api.request<unknown>('DELETE', `/betaGroups/${groupId}/relationships/betaTesters`, {
      data: testerIds.map((id) => ({ type: 'betaTesters', id })),
    });
  };

  return {
    listBetaGroups,
    findBetaGroupByName,
    createBetaGroup,
    listBetaTestersInGroup,
    findBetaTesterByEmail,
    createBetaTester,
    addTestersToGroup,
    removeTestersFromGroup,
  };
};
