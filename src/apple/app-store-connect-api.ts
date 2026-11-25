// Generated from Apple's App Store Connect OpenAPI spec 4.6.1.
// Reproduce: python3 scripts/generate-api-methods.py

import type { operations } from './generated/schema.js';
import { appleRequestUrl } from './apple-query.js';
import type { AppStoreConnect } from './app-store-connect.js';

/** Every operation in Apple's App Store Connect OpenAPI spec, on the shared fetch client. */
export class AppStoreConnectApi {
  constructor(private readonly apple: AppStoreConnect) {}

  /**
   * POST /v1/accessibilityDeclarations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-accessibilitydeclarations}
   */
  async createAccessibilityDeclarations(
    document: operations['accessibilityDeclarations_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['accessibilityDeclarations_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/accessibilityDeclarations', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/accessibilityDeclarations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-accessibilitydeclarations-_id_}
   */
  async getAccessibilityDeclarations(
    resourceId: string,
    query?: operations['accessibilityDeclarations_getInstance']['parameters']['query'],
  ): Promise<
    operations['accessibilityDeclarations_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/accessibilityDeclarations/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/accessibilityDeclarations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-accessibilitydeclarations-_id_}
   */
  async updateAccessibilityDeclarations(
    resourceId: string,
    document: operations['accessibilityDeclarations_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['accessibilityDeclarations_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/accessibilityDeclarations/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v1/accessibilityDeclarations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-accessibilitydeclarations-_id_}
   */
  async deleteAccessibilityDeclarations(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/accessibilityDeclarations/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * GET /v1/actors
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-actors}
   */
  async listActors(
    query?: operations['actors_getCollection']['parameters']['query'],
  ): Promise<operations['actors_getCollection']['responses'][200]['content']['application/json']> {
    const url = appleRequestUrl('/v1/actors', undefined, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/actors/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-actors-_id_}
   */
  async getActors(
    resourceId: string,
    query?: operations['actors_getInstance']['parameters']['query'],
  ): Promise<operations['actors_getInstance']['responses'][200]['content']['application/json']> {
    const url = appleRequestUrl('/v1/actors/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/ageRatingDeclarations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-ageratingdeclarations-_id_}
   */
  async updateAgeRatingDeclarations(
    resourceId: string,
    document: operations['ageRatingDeclarations_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['ageRatingDeclarations_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/ageRatingDeclarations/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * GET /v1/alternativeDistributionDomains
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-alternativedistributiondomains}
   */
  async listAlternativeDistributionDomains(
    query?: operations['alternativeDistributionDomains_getCollection']['parameters']['query'],
  ): Promise<
    operations['alternativeDistributionDomains_getCollection']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/alternativeDistributionDomains', undefined, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * POST /v1/alternativeDistributionDomains
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-alternativedistributiondomains}
   */
  async createAlternativeDistributionDomains(
    document: operations['alternativeDistributionDomains_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['alternativeDistributionDomains_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/alternativeDistributionDomains', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/alternativeDistributionDomains/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-alternativedistributiondomains-_id_}
   */
  async getAlternativeDistributionDomains(
    resourceId: string,
    query?: operations['alternativeDistributionDomains_getInstance']['parameters']['query'],
  ): Promise<
    operations['alternativeDistributionDomains_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/alternativeDistributionDomains/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * DELETE /v1/alternativeDistributionDomains/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-alternativedistributiondomains-_id_}
   */
  async deleteAlternativeDistributionDomains(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/alternativeDistributionDomains/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * GET /v1/alternativeDistributionKeys
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-alternativedistributionkeys}
   */
  async listAlternativeDistributionKeys(
    query?: operations['alternativeDistributionKeys_getCollection']['parameters']['query'],
  ): Promise<
    operations['alternativeDistributionKeys_getCollection']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/alternativeDistributionKeys', undefined, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * POST /v1/alternativeDistributionKeys
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-alternativedistributionkeys}
   */
  async createAlternativeDistributionKeys(
    document: operations['alternativeDistributionKeys_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['alternativeDistributionKeys_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/alternativeDistributionKeys', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/alternativeDistributionKeys/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-alternativedistributionkeys-_id_}
   */
  async getAlternativeDistributionKeys(
    resourceId: string,
    query?: operations['alternativeDistributionKeys_getInstance']['parameters']['query'],
  ): Promise<
    operations['alternativeDistributionKeys_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/alternativeDistributionKeys/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * DELETE /v1/alternativeDistributionKeys/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-alternativedistributionkeys-_id_}
   */
  async deleteAlternativeDistributionKeys(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/alternativeDistributionKeys/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * GET /v1/alternativeDistributionPackageDeltas/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-alternativedistributionpackagedeltas-_id_}
   */
  async getAlternativeDistributionPackageDeltas(
    resourceId: string,
    query?: operations['alternativeDistributionPackageDeltas_getInstance']['parameters']['query'],
  ): Promise<
    operations['alternativeDistributionPackageDeltas_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/alternativeDistributionPackageDeltas/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/alternativeDistributionPackageVariants/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-alternativedistributionpackagevariants-_id_}
   */
  async getAlternativeDistributionPackageVariants(
    resourceId: string,
    query?: operations['alternativeDistributionPackageVariants_getInstance']['parameters']['query'],
  ): Promise<
    operations['alternativeDistributionPackageVariants_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/alternativeDistributionPackageVariants/{id}',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/alternativeDistributionPackageVersions/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-alternativedistributionpackageversions-_id_}
   */
  async getAlternativeDistributionPackageVersions(
    resourceId: string,
    query?: operations['alternativeDistributionPackageVersions_getInstance']['parameters']['query'],
  ): Promise<
    operations['alternativeDistributionPackageVersions_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/alternativeDistributionPackageVersions/{id}',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * POST /v1/alternativeDistributionPackages
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-alternativedistributionpackages}
   */
  async createAlternativeDistributionPackages(
    document: operations['alternativeDistributionPackages_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['alternativeDistributionPackages_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/alternativeDistributionPackages', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/alternativeDistributionPackages/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-alternativedistributionpackages-_id_}
   */
  async getAlternativeDistributionPackages(
    resourceId: string,
    query?: operations['alternativeDistributionPackages_getInstance']['parameters']['query'],
  ): Promise<
    operations['alternativeDistributionPackages_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/alternativeDistributionPackages/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/analyticsReportInstances/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-analyticsreportinstances-_id_}
   */
  async getAnalyticsReportInstances(
    resourceId: string,
    query?: operations['analyticsReportInstances_getInstance']['parameters']['query'],
  ): Promise<
    operations['analyticsReportInstances_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/analyticsReportInstances/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * POST /v1/analyticsReportRequests
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-analyticsreportrequests}
   */
  async createAnalyticsReportRequests(
    document: operations['analyticsReportRequests_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['analyticsReportRequests_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/analyticsReportRequests', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/analyticsReportRequests/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-analyticsreportrequests-_id_}
   */
  async getAnalyticsReportRequests(
    resourceId: string,
    query?: operations['analyticsReportRequests_getInstance']['parameters']['query'],
  ): Promise<
    operations['analyticsReportRequests_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/analyticsReportRequests/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * DELETE /v1/analyticsReportRequests/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-analyticsreportrequests-_id_}
   */
  async deleteAnalyticsReportRequests(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/analyticsReportRequests/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * GET /v1/analyticsReportSegments/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-analyticsreportsegments-_id_}
   */
  async getAnalyticsReportSegments(
    resourceId: string,
    query?: operations['analyticsReportSegments_getInstance']['parameters']['query'],
  ): Promise<
    operations['analyticsReportSegments_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/analyticsReportSegments/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/analyticsReports/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-analyticsreports-_id_}
   */
  async getAnalyticsReports(
    resourceId: string,
    query?: operations['analyticsReports_getInstance']['parameters']['query'],
  ): Promise<
    operations['analyticsReports_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/analyticsReports/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * POST /v1/androidToIosAppMappingDetails
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-androidtoiosappmappingdetails}
   */
  async createAndroidToIosAppMappingDetails(
    document: operations['androidToIosAppMappingDetails_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['androidToIosAppMappingDetails_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/androidToIosAppMappingDetails', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/androidToIosAppMappingDetails/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-androidtoiosappmappingdetails-_id_}
   */
  async getAndroidToIosAppMappingDetails(
    resourceId: string,
    query?: operations['androidToIosAppMappingDetails_getInstance']['parameters']['query'],
  ): Promise<
    operations['androidToIosAppMappingDetails_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/androidToIosAppMappingDetails/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/androidToIosAppMappingDetails/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-androidtoiosappmappingdetails-_id_}
   */
  async updateAndroidToIosAppMappingDetails(
    resourceId: string,
    document: operations['androidToIosAppMappingDetails_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['androidToIosAppMappingDetails_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/androidToIosAppMappingDetails/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v1/androidToIosAppMappingDetails/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-androidtoiosappmappingdetails-_id_}
   */
  async deleteAndroidToIosAppMappingDetails(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/androidToIosAppMappingDetails/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * GET /v1/appAssetLibraries/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appassetlibraries-_id_}
   */
  async getAppAssetLibraries(
    resourceId: string,
    query?: operations['appAssetLibraries_getInstance']['parameters']['query'],
  ): Promise<
    operations['appAssetLibraries_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appAssetLibraries/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * POST /v1/appAssetLibraryImages
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-appassetlibraryimages}
   */
  async createAppAssetLibraryImages(
    document: operations['appAssetLibraryImages_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['appAssetLibraryImages_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appAssetLibraryImages', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/appAssetLibraryImages/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appassetlibraryimages-_id_}
   */
  async getAppAssetLibraryImages(
    resourceId: string,
    query?: operations['appAssetLibraryImages_getInstance']['parameters']['query'],
  ): Promise<
    operations['appAssetLibraryImages_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appAssetLibraryImages/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/appAssetLibraryImages/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-appassetlibraryimages-_id_}
   */
  async updateAppAssetLibraryImages(
    resourceId: string,
    document: operations['appAssetLibraryImages_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['appAssetLibraryImages_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appAssetLibraryImages/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v1/appAssetLibraryImages/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-appassetlibraryimages-_id_}
   */
  async deleteAppAssetLibraryImages(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/appAssetLibraryImages/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * POST /v1/appAssetLibraryPlacementOrderingRequests
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-appassetlibraryplacementorderingrequests}
   */
  async createAppAssetLibraryPlacementOrderingRequests(
    document: operations['appAssetLibraryPlacementOrderingRequests_createInstance']['requestBody']['content']['application/json'],
    query?: operations['appAssetLibraryPlacementOrderingRequests_createInstance']['parameters']['query'],
  ): Promise<
    operations['appAssetLibraryPlacementOrderingRequests_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appAssetLibraryPlacementOrderingRequests', undefined, query);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * POST /v1/appAssetLibraryPlacements
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-appassetlibraryplacements}
   */
  async createAppAssetLibraryPlacements(
    document: operations['appAssetLibraryPlacements_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['appAssetLibraryPlacements_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appAssetLibraryPlacements', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/appAssetLibraryPlacements/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appassetlibraryplacements-_id_}
   */
  async getAppAssetLibraryPlacements(
    resourceId: string,
    query?: operations['appAssetLibraryPlacements_getInstance']['parameters']['query'],
  ): Promise<
    operations['appAssetLibraryPlacements_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appAssetLibraryPlacements/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * DELETE /v1/appAssetLibraryPlacements/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-appassetlibraryplacements-_id_}
   */
  async deleteAppAssetLibraryPlacements(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/appAssetLibraryPlacements/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * GET /v1/appAssetLibraryRefData
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appassetlibraryrefdata}
   */
  async listAppAssetLibraryRefData(
    query?: operations['appAssetLibraryRefData_getCollection']['parameters']['query'],
  ): Promise<
    operations['appAssetLibraryRefData_getCollection']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appAssetLibraryRefData', undefined, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appAssetLibraryRefData/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appassetlibraryrefdata-_id_}
   */
  async getAppAssetLibraryRefData(
    resourceId: string,
    query?: operations['appAssetLibraryRefData_getInstance']['parameters']['query'],
  ): Promise<
    operations['appAssetLibraryRefData_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appAssetLibraryRefData/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * POST /v1/appAssetLibraryVideos
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-appassetlibraryvideos}
   */
  async createAppAssetLibraryVideos(
    document: operations['appAssetLibraryVideos_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['appAssetLibraryVideos_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appAssetLibraryVideos', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/appAssetLibraryVideos/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appassetlibraryvideos-_id_}
   */
  async getAppAssetLibraryVideos(
    resourceId: string,
    query?: operations['appAssetLibraryVideos_getInstance']['parameters']['query'],
  ): Promise<
    operations['appAssetLibraryVideos_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appAssetLibraryVideos/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/appAssetLibraryVideos/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-appassetlibraryvideos-_id_}
   */
  async updateAppAssetLibraryVideos(
    resourceId: string,
    document: operations['appAssetLibraryVideos_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['appAssetLibraryVideos_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appAssetLibraryVideos/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v1/appAssetLibraryVideos/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-appassetlibraryvideos-_id_}
   */
  async deleteAppAssetLibraryVideos(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/appAssetLibraryVideos/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * POST /v2/appAvailabilities
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v2-appavailabilities}
   */
  async createAppAvailabilitiesV2(
    document: operations['appAvailabilitiesV2_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['appAvailabilitiesV2_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v2/appAvailabilities', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v2/appAvailabilities/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v2-appavailabilities-_id_}
   */
  async getAppAvailabilitiesV2(
    resourceId: string,
    query?: operations['appAvailabilitiesV2_getInstance']['parameters']['query'],
  ): Promise<
    operations['appAvailabilitiesV2_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v2/appAvailabilities/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appCategories
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appcategories}
   */
  async listAppCategories(
    query?: operations['appCategories_getCollection']['parameters']['query'],
  ): Promise<
    operations['appCategories_getCollection']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appCategories', undefined, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appCategories/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appcategories-_id_}
   */
  async getAppCategories(
    resourceId: string,
    query?: operations['appCategories_getInstance']['parameters']['query'],
  ): Promise<
    operations['appCategories_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appCategories/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * POST /v1/appClipAdvancedExperienceImages
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-appclipadvancedexperienceimages}
   */
  async createAppClipAdvancedExperienceImages(
    document: operations['appClipAdvancedExperienceImages_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['appClipAdvancedExperienceImages_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appClipAdvancedExperienceImages', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/appClipAdvancedExperienceImages/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appclipadvancedexperienceimages-_id_}
   */
  async getAppClipAdvancedExperienceImages(
    resourceId: string,
    query?: operations['appClipAdvancedExperienceImages_getInstance']['parameters']['query'],
  ): Promise<
    operations['appClipAdvancedExperienceImages_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appClipAdvancedExperienceImages/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/appClipAdvancedExperienceImages/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-appclipadvancedexperienceimages-_id_}
   */
  async updateAppClipAdvancedExperienceImages(
    resourceId: string,
    document: operations['appClipAdvancedExperienceImages_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['appClipAdvancedExperienceImages_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appClipAdvancedExperienceImages/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * POST /v1/appClipAdvancedExperiences
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-appclipadvancedexperiences}
   */
  async createAppClipAdvancedExperiences(
    document: operations['appClipAdvancedExperiences_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['appClipAdvancedExperiences_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appClipAdvancedExperiences', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/appClipAdvancedExperiences/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appclipadvancedexperiences-_id_}
   */
  async getAppClipAdvancedExperiences(
    resourceId: string,
    query?: operations['appClipAdvancedExperiences_getInstance']['parameters']['query'],
  ): Promise<
    operations['appClipAdvancedExperiences_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appClipAdvancedExperiences/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/appClipAdvancedExperiences/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-appclipadvancedexperiences-_id_}
   */
  async updateAppClipAdvancedExperiences(
    resourceId: string,
    document: operations['appClipAdvancedExperiences_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['appClipAdvancedExperiences_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appClipAdvancedExperiences/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * POST /v1/appClipAppStoreReviewDetails
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-appclipappstorereviewdetails}
   */
  async createAppClipAppStoreReviewDetails(
    document: operations['appClipAppStoreReviewDetails_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['appClipAppStoreReviewDetails_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appClipAppStoreReviewDetails', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/appClipAppStoreReviewDetails/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appclipappstorereviewdetails-_id_}
   */
  async getAppClipAppStoreReviewDetails(
    resourceId: string,
    query?: operations['appClipAppStoreReviewDetails_getInstance']['parameters']['query'],
  ): Promise<
    operations['appClipAppStoreReviewDetails_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appClipAppStoreReviewDetails/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/appClipAppStoreReviewDetails/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-appclipappstorereviewdetails-_id_}
   */
  async updateAppClipAppStoreReviewDetails(
    resourceId: string,
    document: operations['appClipAppStoreReviewDetails_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['appClipAppStoreReviewDetails_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appClipAppStoreReviewDetails/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * POST /v1/appClipDefaultExperienceLocalizations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-appclipdefaultexperiencelocalizations}
   */
  async createAppClipDefaultExperienceLocalizations(
    document: operations['appClipDefaultExperienceLocalizations_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['appClipDefaultExperienceLocalizations_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appClipDefaultExperienceLocalizations', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/appClipDefaultExperienceLocalizations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appclipdefaultexperiencelocalizations-_id_}
   */
  async getAppClipDefaultExperienceLocalizations(
    resourceId: string,
    query?: operations['appClipDefaultExperienceLocalizations_getInstance']['parameters']['query'],
  ): Promise<
    operations['appClipDefaultExperienceLocalizations_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appClipDefaultExperienceLocalizations/{id}',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/appClipDefaultExperienceLocalizations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-appclipdefaultexperiencelocalizations-_id_}
   */
  async updateAppClipDefaultExperienceLocalizations(
    resourceId: string,
    document: operations['appClipDefaultExperienceLocalizations_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['appClipDefaultExperienceLocalizations_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appClipDefaultExperienceLocalizations/{id}',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v1/appClipDefaultExperienceLocalizations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-appclipdefaultexperiencelocalizations-_id_}
   */
  async deleteAppClipDefaultExperienceLocalizations(resourceId: string): Promise<void> {
    const url = appleRequestUrl(
      '/v1/appClipDefaultExperienceLocalizations/{id}',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * POST /v1/appClipDefaultExperiences
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-appclipdefaultexperiences}
   */
  async createAppClipDefaultExperiences(
    document: operations['appClipDefaultExperiences_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['appClipDefaultExperiences_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appClipDefaultExperiences', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/appClipDefaultExperiences/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appclipdefaultexperiences-_id_}
   */
  async getAppClipDefaultExperiences(
    resourceId: string,
    query?: operations['appClipDefaultExperiences_getInstance']['parameters']['query'],
  ): Promise<
    operations['appClipDefaultExperiences_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appClipDefaultExperiences/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/appClipDefaultExperiences/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-appclipdefaultexperiences-_id_}
   */
  async updateAppClipDefaultExperiences(
    resourceId: string,
    document: operations['appClipDefaultExperiences_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['appClipDefaultExperiences_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appClipDefaultExperiences/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v1/appClipDefaultExperiences/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-appclipdefaultexperiences-_id_}
   */
  async deleteAppClipDefaultExperiences(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/appClipDefaultExperiences/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * POST /v1/appClipHeaderImages
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-appclipheaderimages}
   */
  async createAppClipHeaderImages(
    document: operations['appClipHeaderImages_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['appClipHeaderImages_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appClipHeaderImages', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/appClipHeaderImages/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appclipheaderimages-_id_}
   */
  async getAppClipHeaderImages(
    resourceId: string,
    query?: operations['appClipHeaderImages_getInstance']['parameters']['query'],
  ): Promise<
    operations['appClipHeaderImages_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appClipHeaderImages/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/appClipHeaderImages/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-appclipheaderimages-_id_}
   */
  async updateAppClipHeaderImages(
    resourceId: string,
    document: operations['appClipHeaderImages_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['appClipHeaderImages_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appClipHeaderImages/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v1/appClipHeaderImages/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-appclipheaderimages-_id_}
   */
  async deleteAppClipHeaderImages(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/appClipHeaderImages/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * GET /v1/appClips/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appclips-_id_}
   */
  async getAppClips(
    resourceId: string,
    query?: operations['appClips_getInstance']['parameters']['query'],
  ): Promise<operations['appClips_getInstance']['responses'][200]['content']['application/json']> {
    const url = appleRequestUrl('/v1/appClips/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * POST /v1/appCustomProductPageLocalizations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-appcustomproductpagelocalizations}
   */
  async createAppCustomProductPageLocalizations(
    document: operations['appCustomProductPageLocalizations_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['appCustomProductPageLocalizations_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appCustomProductPageLocalizations', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/appCustomProductPageLocalizations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appcustomproductpagelocalizations-_id_}
   */
  async getAppCustomProductPageLocalizations(
    resourceId: string,
    query?: operations['appCustomProductPageLocalizations_getInstance']['parameters']['query'],
  ): Promise<
    operations['appCustomProductPageLocalizations_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appCustomProductPageLocalizations/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/appCustomProductPageLocalizations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-appcustomproductpagelocalizations-_id_}
   */
  async updateAppCustomProductPageLocalizations(
    resourceId: string,
    document: operations['appCustomProductPageLocalizations_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['appCustomProductPageLocalizations_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appCustomProductPageLocalizations/{id}',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v1/appCustomProductPageLocalizations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-appcustomproductpagelocalizations-_id_}
   */
  async deleteAppCustomProductPageLocalizations(resourceId: string): Promise<void> {
    const url = appleRequestUrl(
      '/v1/appCustomProductPageLocalizations/{id}',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * POST /v1/appCustomProductPageVersions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-appcustomproductpageversions}
   */
  async createAppCustomProductPageVersions(
    document: operations['appCustomProductPageVersions_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['appCustomProductPageVersions_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appCustomProductPageVersions', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/appCustomProductPageVersions/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appcustomproductpageversions-_id_}
   */
  async getAppCustomProductPageVersions(
    resourceId: string,
    query?: operations['appCustomProductPageVersions_getInstance']['parameters']['query'],
  ): Promise<
    operations['appCustomProductPageVersions_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appCustomProductPageVersions/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/appCustomProductPageVersions/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-appcustomproductpageversions-_id_}
   */
  async updateAppCustomProductPageVersions(
    resourceId: string,
    document: operations['appCustomProductPageVersions_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['appCustomProductPageVersions_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appCustomProductPageVersions/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * POST /v1/appCustomProductPages
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-appcustomproductpages}
   */
  async createAppCustomProductPages(
    document: operations['appCustomProductPages_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['appCustomProductPages_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appCustomProductPages', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/appCustomProductPages/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appcustomproductpages-_id_}
   */
  async getAppCustomProductPages(
    resourceId: string,
    query?: operations['appCustomProductPages_getInstance']['parameters']['query'],
  ): Promise<
    operations['appCustomProductPages_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appCustomProductPages/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/appCustomProductPages/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-appcustomproductpages-_id_}
   */
  async updateAppCustomProductPages(
    resourceId: string,
    document: operations['appCustomProductPages_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['appCustomProductPages_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appCustomProductPages/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v1/appCustomProductPages/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-appcustomproductpages-_id_}
   */
  async deleteAppCustomProductPages(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/appCustomProductPages/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * POST /v1/appEncryptionDeclarationDocuments
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-appencryptiondeclarationdocuments}
   */
  async createAppEncryptionDeclarationDocuments(
    document: operations['appEncryptionDeclarationDocuments_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['appEncryptionDeclarationDocuments_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appEncryptionDeclarationDocuments', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/appEncryptionDeclarationDocuments/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appencryptiondeclarationdocuments-_id_}
   */
  async getAppEncryptionDeclarationDocuments(
    resourceId: string,
    query?: operations['appEncryptionDeclarationDocuments_getInstance']['parameters']['query'],
  ): Promise<
    operations['appEncryptionDeclarationDocuments_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appEncryptionDeclarationDocuments/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/appEncryptionDeclarationDocuments/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-appencryptiondeclarationdocuments-_id_}
   */
  async updateAppEncryptionDeclarationDocuments(
    resourceId: string,
    document: operations['appEncryptionDeclarationDocuments_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['appEncryptionDeclarationDocuments_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appEncryptionDeclarationDocuments/{id}',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * GET /v1/appEncryptionDeclarations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appencryptiondeclarations}
   */
  async listAppEncryptionDeclarations(
    query?: operations['appEncryptionDeclarations_getCollection']['parameters']['query'],
  ): Promise<
    operations['appEncryptionDeclarations_getCollection']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appEncryptionDeclarations', undefined, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * POST /v1/appEncryptionDeclarations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-appencryptiondeclarations}
   */
  async createAppEncryptionDeclarations(
    document: operations['appEncryptionDeclarations_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['appEncryptionDeclarations_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appEncryptionDeclarations', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/appEncryptionDeclarations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appencryptiondeclarations-_id_}
   */
  async getAppEncryptionDeclarations(
    resourceId: string,
    query?: operations['appEncryptionDeclarations_getInstance']['parameters']['query'],
  ): Promise<
    operations['appEncryptionDeclarations_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appEncryptionDeclarations/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * POST /v1/appEventLocalizations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-appeventlocalizations}
   */
  async createAppEventLocalizations(
    document: operations['appEventLocalizations_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['appEventLocalizations_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appEventLocalizations', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/appEventLocalizations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appeventlocalizations-_id_}
   */
  async getAppEventLocalizations(
    resourceId: string,
    query?: operations['appEventLocalizations_getInstance']['parameters']['query'],
  ): Promise<
    operations['appEventLocalizations_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appEventLocalizations/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/appEventLocalizations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-appeventlocalizations-_id_}
   */
  async updateAppEventLocalizations(
    resourceId: string,
    document: operations['appEventLocalizations_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['appEventLocalizations_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appEventLocalizations/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v1/appEventLocalizations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-appeventlocalizations-_id_}
   */
  async deleteAppEventLocalizations(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/appEventLocalizations/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * POST /v1/appEventScreenshots
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-appeventscreenshots}
   */
  async createAppEventScreenshots(
    document: operations['appEventScreenshots_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['appEventScreenshots_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appEventScreenshots', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/appEventScreenshots/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appeventscreenshots-_id_}
   */
  async getAppEventScreenshots(
    resourceId: string,
    query?: operations['appEventScreenshots_getInstance']['parameters']['query'],
  ): Promise<
    operations['appEventScreenshots_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appEventScreenshots/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/appEventScreenshots/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-appeventscreenshots-_id_}
   */
  async updateAppEventScreenshots(
    resourceId: string,
    document: operations['appEventScreenshots_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['appEventScreenshots_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appEventScreenshots/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v1/appEventScreenshots/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-appeventscreenshots-_id_}
   */
  async deleteAppEventScreenshots(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/appEventScreenshots/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * POST /v1/appEventVideoClips
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-appeventvideoclips}
   */
  async createAppEventVideoClips(
    document: operations['appEventVideoClips_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['appEventVideoClips_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appEventVideoClips', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/appEventVideoClips/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appeventvideoclips-_id_}
   */
  async getAppEventVideoClips(
    resourceId: string,
    query?: operations['appEventVideoClips_getInstance']['parameters']['query'],
  ): Promise<
    operations['appEventVideoClips_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appEventVideoClips/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/appEventVideoClips/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-appeventvideoclips-_id_}
   */
  async updateAppEventVideoClips(
    resourceId: string,
    document: operations['appEventVideoClips_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['appEventVideoClips_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appEventVideoClips/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v1/appEventVideoClips/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-appeventvideoclips-_id_}
   */
  async deleteAppEventVideoClips(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/appEventVideoClips/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * POST /v1/appEvents
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-appevents}
   */
  async createAppEvents(
    document: operations['appEvents_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['appEvents_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appEvents', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/appEvents/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appevents-_id_}
   */
  async getAppEvents(
    resourceId: string,
    query?: operations['appEvents_getInstance']['parameters']['query'],
  ): Promise<operations['appEvents_getInstance']['responses'][200]['content']['application/json']> {
    const url = appleRequestUrl('/v1/appEvents/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/appEvents/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-appevents-_id_}
   */
  async updateAppEvents(
    resourceId: string,
    document: operations['appEvents_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['appEvents_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appEvents/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v1/appEvents/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-appevents-_id_}
   */
  async deleteAppEvents(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/appEvents/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * POST /v1/appInfoLocalizations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-appinfolocalizations}
   */
  async createAppInfoLocalizations(
    document: operations['appInfoLocalizations_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['appInfoLocalizations_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appInfoLocalizations', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/appInfoLocalizations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appinfolocalizations-_id_}
   */
  async getAppInfoLocalizations(
    resourceId: string,
    query?: operations['appInfoLocalizations_getInstance']['parameters']['query'],
  ): Promise<
    operations['appInfoLocalizations_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appInfoLocalizations/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/appInfoLocalizations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-appinfolocalizations-_id_}
   */
  async updateAppInfoLocalizations(
    resourceId: string,
    document: operations['appInfoLocalizations_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['appInfoLocalizations_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appInfoLocalizations/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v1/appInfoLocalizations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-appinfolocalizations-_id_}
   */
  async deleteAppInfoLocalizations(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/appInfoLocalizations/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * GET /v1/appInfos/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appinfos-_id_}
   */
  async getAppInfos(
    resourceId: string,
    query?: operations['appInfos_getInstance']['parameters']['query'],
  ): Promise<operations['appInfos_getInstance']['responses'][200]['content']['application/json']> {
    const url = appleRequestUrl('/v1/appInfos/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/appInfos/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-appinfos-_id_}
   */
  async updateAppInfos(
    resourceId: string,
    document: operations['appInfos_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['appInfos_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appInfos/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * POST /v1/appPreviewSets
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-apppreviewsets}
   */
  async createAppPreviewSets(
    document: operations['appPreviewSets_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['appPreviewSets_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appPreviewSets', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/appPreviewSets/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apppreviewsets-_id_}
   */
  async getAppPreviewSets(
    resourceId: string,
    query?: operations['appPreviewSets_getInstance']['parameters']['query'],
  ): Promise<
    operations['appPreviewSets_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appPreviewSets/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * DELETE /v1/appPreviewSets/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-apppreviewsets-_id_}
   */
  async deleteAppPreviewSets(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/appPreviewSets/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * POST /v1/appPreviews
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-apppreviews}
   */
  async createAppPreviews(
    document: operations['appPreviews_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['appPreviews_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appPreviews', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/appPreviews/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apppreviews-_id_}
   */
  async getAppPreviews(
    resourceId: string,
    query?: operations['appPreviews_getInstance']['parameters']['query'],
  ): Promise<
    operations['appPreviews_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appPreviews/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/appPreviews/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-apppreviews-_id_}
   */
  async updateAppPreviews(
    resourceId: string,
    document: operations['appPreviews_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['appPreviews_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appPreviews/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v1/appPreviews/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-apppreviews-_id_}
   */
  async deleteAppPreviews(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/appPreviews/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * GET /v3/appPricePoints/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v3-apppricepoints-_id_}
   */
  async getAppPricePointsV3(
    resourceId: string,
    query?: operations['appPricePointsV3_getInstance']['parameters']['query'],
  ): Promise<
    operations['appPricePointsV3_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v3/appPricePoints/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * POST /v1/appPriceSchedules
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-apppriceschedules}
   */
  async createAppPriceSchedules(
    document: operations['appPriceSchedules_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['appPriceSchedules_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appPriceSchedules', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/appPriceSchedules/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apppriceschedules-_id_}
   */
  async getAppPriceSchedules(
    resourceId: string,
    query?: operations['appPriceSchedules_getInstance']['parameters']['query'],
  ): Promise<
    operations['appPriceSchedules_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appPriceSchedules/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * POST /v1/appScreenshotSets
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-appscreenshotsets}
   */
  async createAppScreenshotSets(
    document: operations['appScreenshotSets_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['appScreenshotSets_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appScreenshotSets', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/appScreenshotSets/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appscreenshotsets-_id_}
   */
  async getAppScreenshotSets(
    resourceId: string,
    query?: operations['appScreenshotSets_getInstance']['parameters']['query'],
  ): Promise<
    operations['appScreenshotSets_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appScreenshotSets/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * DELETE /v1/appScreenshotSets/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-appscreenshotsets-_id_}
   */
  async deleteAppScreenshotSets(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/appScreenshotSets/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * POST /v1/appScreenshots
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-appscreenshots}
   */
  async createAppScreenshots(
    document: operations['appScreenshots_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['appScreenshots_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appScreenshots', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/appScreenshots/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appscreenshots-_id_}
   */
  async getAppScreenshots(
    resourceId: string,
    query?: operations['appScreenshots_getInstance']['parameters']['query'],
  ): Promise<
    operations['appScreenshots_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appScreenshots/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/appScreenshots/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-appscreenshots-_id_}
   */
  async updateAppScreenshots(
    resourceId: string,
    document: operations['appScreenshots_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['appScreenshots_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appScreenshots/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v1/appScreenshots/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-appscreenshots-_id_}
   */
  async deleteAppScreenshots(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/appScreenshots/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * POST /v1/appStoreReviewAttachments
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-appstorereviewattachments}
   */
  async createAppStoreReviewAttachments(
    document: operations['appStoreReviewAttachments_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['appStoreReviewAttachments_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appStoreReviewAttachments', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/appStoreReviewAttachments/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appstorereviewattachments-_id_}
   */
  async getAppStoreReviewAttachments(
    resourceId: string,
    query?: operations['appStoreReviewAttachments_getInstance']['parameters']['query'],
  ): Promise<
    operations['appStoreReviewAttachments_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appStoreReviewAttachments/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/appStoreReviewAttachments/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-appstorereviewattachments-_id_}
   */
  async updateAppStoreReviewAttachments(
    resourceId: string,
    document: operations['appStoreReviewAttachments_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['appStoreReviewAttachments_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appStoreReviewAttachments/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v1/appStoreReviewAttachments/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-appstorereviewattachments-_id_}
   */
  async deleteAppStoreReviewAttachments(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/appStoreReviewAttachments/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * POST /v1/appStoreReviewDetails
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-appstorereviewdetails}
   */
  async createAppStoreReviewDetails(
    document: operations['appStoreReviewDetails_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['appStoreReviewDetails_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appStoreReviewDetails', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/appStoreReviewDetails/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appstorereviewdetails-_id_}
   */
  async getAppStoreReviewDetails(
    resourceId: string,
    query?: operations['appStoreReviewDetails_getInstance']['parameters']['query'],
  ): Promise<
    operations['appStoreReviewDetails_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appStoreReviewDetails/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/appStoreReviewDetails/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-appstorereviewdetails-_id_}
   */
  async updateAppStoreReviewDetails(
    resourceId: string,
    document: operations['appStoreReviewDetails_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['appStoreReviewDetails_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appStoreReviewDetails/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * POST /v1/appStoreVersionExperimentTreatmentLocalizations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-appstoreversionexperimenttreatmentlocalizations}
   */
  async createAppStoreVersionExperimentTreatmentLocalizations(
    document: operations['appStoreVersionExperimentTreatmentLocalizations_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['appStoreVersionExperimentTreatmentLocalizations_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appStoreVersionExperimentTreatmentLocalizations',
      undefined,
      undefined,
    );
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/appStoreVersionExperimentTreatmentLocalizations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appstoreversionexperimenttreatmentlocalizations-_id_}
   */
  async getAppStoreVersionExperimentTreatmentLocalizations(
    resourceId: string,
    query?: operations['appStoreVersionExperimentTreatmentLocalizations_getInstance']['parameters']['query'],
  ): Promise<
    operations['appStoreVersionExperimentTreatmentLocalizations_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appStoreVersionExperimentTreatmentLocalizations/{id}',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * DELETE /v1/appStoreVersionExperimentTreatmentLocalizations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-appstoreversionexperimenttreatmentlocalizations-_id_}
   */
  async deleteAppStoreVersionExperimentTreatmentLocalizations(resourceId: string): Promise<void> {
    const url = appleRequestUrl(
      '/v1/appStoreVersionExperimentTreatmentLocalizations/{id}',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * POST /v1/appStoreVersionExperimentTreatments
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-appstoreversionexperimenttreatments}
   */
  async createAppStoreVersionExperimentTreatments(
    document: operations['appStoreVersionExperimentTreatments_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['appStoreVersionExperimentTreatments_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appStoreVersionExperimentTreatments', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/appStoreVersionExperimentTreatments/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appstoreversionexperimenttreatments-_id_}
   */
  async getAppStoreVersionExperimentTreatments(
    resourceId: string,
    query?: operations['appStoreVersionExperimentTreatments_getInstance']['parameters']['query'],
  ): Promise<
    operations['appStoreVersionExperimentTreatments_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appStoreVersionExperimentTreatments/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/appStoreVersionExperimentTreatments/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-appstoreversionexperimenttreatments-_id_}
   */
  async updateAppStoreVersionExperimentTreatments(
    resourceId: string,
    document: operations['appStoreVersionExperimentTreatments_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['appStoreVersionExperimentTreatments_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appStoreVersionExperimentTreatments/{id}',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v1/appStoreVersionExperimentTreatments/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-appstoreversionexperimenttreatments-_id_}
   */
  async deleteAppStoreVersionExperimentTreatments(resourceId: string): Promise<void> {
    const url = appleRequestUrl(
      '/v1/appStoreVersionExperimentTreatments/{id}',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * POST /v2/appStoreVersionExperiments
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v2-appstoreversionexperiments}
   */
  async createAppStoreVersionExperimentsV2(
    document: operations['appStoreVersionExperimentsV2_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['appStoreVersionExperimentsV2_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v2/appStoreVersionExperiments', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v2/appStoreVersionExperiments/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v2-appstoreversionexperiments-_id_}
   */
  async getAppStoreVersionExperimentsV2(
    resourceId: string,
    query?: operations['appStoreVersionExperimentsV2_getInstance']['parameters']['query'],
  ): Promise<
    operations['appStoreVersionExperimentsV2_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v2/appStoreVersionExperiments/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v2/appStoreVersionExperiments/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v2-appstoreversionexperiments-_id_}
   */
  async updateAppStoreVersionExperimentsV2(
    resourceId: string,
    document: operations['appStoreVersionExperimentsV2_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['appStoreVersionExperimentsV2_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v2/appStoreVersionExperiments/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v2/appStoreVersionExperiments/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v2-appstoreversionexperiments-_id_}
   */
  async deleteAppStoreVersionExperimentsV2(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v2/appStoreVersionExperiments/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * POST /v1/appStoreVersionExperiments
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-appstoreversionexperiments}
   */
  async createAppStoreVersionExperiments(
    document: operations['appStoreVersionExperiments_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['appStoreVersionExperiments_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appStoreVersionExperiments', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/appStoreVersionExperiments/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appstoreversionexperiments-_id_}
   */
  async getAppStoreVersionExperiments(
    resourceId: string,
    query?: operations['appStoreVersionExperiments_getInstance']['parameters']['query'],
  ): Promise<
    operations['appStoreVersionExperiments_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appStoreVersionExperiments/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/appStoreVersionExperiments/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-appstoreversionexperiments-_id_}
   */
  async updateAppStoreVersionExperiments(
    resourceId: string,
    document: operations['appStoreVersionExperiments_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['appStoreVersionExperiments_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appStoreVersionExperiments/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v1/appStoreVersionExperiments/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-appstoreversionexperiments-_id_}
   */
  async deleteAppStoreVersionExperiments(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/appStoreVersionExperiments/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * POST /v1/appStoreVersionLocalizations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-appstoreversionlocalizations}
   */
  async createAppStoreVersionLocalizations(
    document: operations['appStoreVersionLocalizations_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['appStoreVersionLocalizations_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appStoreVersionLocalizations', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/appStoreVersionLocalizations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appstoreversionlocalizations-_id_}
   */
  async getAppStoreVersionLocalizations(
    resourceId: string,
    query?: operations['appStoreVersionLocalizations_getInstance']['parameters']['query'],
  ): Promise<
    operations['appStoreVersionLocalizations_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appStoreVersionLocalizations/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/appStoreVersionLocalizations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-appstoreversionlocalizations-_id_}
   */
  async updateAppStoreVersionLocalizations(
    resourceId: string,
    document: operations['appStoreVersionLocalizations_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['appStoreVersionLocalizations_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appStoreVersionLocalizations/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v1/appStoreVersionLocalizations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-appstoreversionlocalizations-_id_}
   */
  async deleteAppStoreVersionLocalizations(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/appStoreVersionLocalizations/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * POST /v1/appStoreVersionPhasedReleases
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-appstoreversionphasedreleases}
   */
  async createAppStoreVersionPhasedReleases(
    document: operations['appStoreVersionPhasedReleases_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['appStoreVersionPhasedReleases_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appStoreVersionPhasedReleases', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * PATCH /v1/appStoreVersionPhasedReleases/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-appstoreversionphasedreleases-_id_}
   */
  async updateAppStoreVersionPhasedReleases(
    resourceId: string,
    document: operations['appStoreVersionPhasedReleases_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['appStoreVersionPhasedReleases_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appStoreVersionPhasedReleases/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v1/appStoreVersionPhasedReleases/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-appstoreversionphasedreleases-_id_}
   */
  async deleteAppStoreVersionPhasedReleases(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/appStoreVersionPhasedReleases/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * POST /v1/appStoreVersionPromotions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-appstoreversionpromotions}
   */
  async createAppStoreVersionPromotions(
    document: operations['appStoreVersionPromotions_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['appStoreVersionPromotions_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appStoreVersionPromotions', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * POST /v1/appStoreVersionReleaseRequests
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-appstoreversionreleaserequests}
   */
  async createAppStoreVersionReleaseRequests(
    document: operations['appStoreVersionReleaseRequests_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['appStoreVersionReleaseRequests_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appStoreVersionReleaseRequests', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * DELETE /v1/appStoreVersionSubmissions/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-appstoreversionsubmissions-_id_}
   */
  async deleteAppStoreVersionSubmissions(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/appStoreVersionSubmissions/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * POST /v1/appStoreVersions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-appstoreversions}
   */
  async createAppStoreVersions(
    document: operations['appStoreVersions_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['appStoreVersions_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appStoreVersions', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/appStoreVersions/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appstoreversions-_id_}
   */
  async getAppStoreVersions(
    resourceId: string,
    query?: operations['appStoreVersions_getInstance']['parameters']['query'],
  ): Promise<
    operations['appStoreVersions_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appStoreVersions/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/appStoreVersions/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-appstoreversions-_id_}
   */
  async updateAppStoreVersions(
    resourceId: string,
    document: operations['appStoreVersions_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['appStoreVersions_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appStoreVersions/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v1/appStoreVersions/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-appstoreversions-_id_}
   */
  async deleteAppStoreVersions(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/appStoreVersions/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * PATCH /v1/appTags/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-apptags-_id_}
   */
  async updateAppTags(
    resourceId: string,
    document: operations['appTags_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['appTags_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appTags/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * GET /v1/apps
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps}
   */
  async listApps(
    query?: operations['apps_getCollection']['parameters']['query'],
  ): Promise<operations['apps_getCollection']['responses'][200]['content']['application/json']> {
    const url = appleRequestUrl('/v1/apps', undefined, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_}
   */
  async getApps(
    resourceId: string,
    query?: operations['apps_getInstance']['parameters']['query'],
  ): Promise<operations['apps_getInstance']['responses'][200]['content']['application/json']> {
    const url = appleRequestUrl('/v1/apps/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/apps/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-apps-_id_}
   */
  async updateApps(
    resourceId: string,
    document: operations['apps_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<operations['apps_updateInstance']['responses'][200]['content']['application/json']> {
    const url = appleRequestUrl('/v1/apps/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * POST /v1/backgroundAssetUploadFiles
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-backgroundassetuploadfiles}
   */
  async createBackgroundAssetUploadFiles(
    document: operations['backgroundAssetUploadFiles_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['backgroundAssetUploadFiles_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/backgroundAssetUploadFiles', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/backgroundAssetUploadFiles/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-backgroundassetuploadfiles-_id_}
   */
  async getBackgroundAssetUploadFiles(
    resourceId: string,
    query?: operations['backgroundAssetUploadFiles_getInstance']['parameters']['query'],
  ): Promise<
    operations['backgroundAssetUploadFiles_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/backgroundAssetUploadFiles/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/backgroundAssetUploadFiles/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-backgroundassetuploadfiles-_id_}
   */
  async updateBackgroundAssetUploadFiles(
    resourceId: string,
    document: operations['backgroundAssetUploadFiles_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['backgroundAssetUploadFiles_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/backgroundAssetUploadFiles/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * GET /v1/backgroundAssetVersionAppStoreReleases/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-backgroundassetversionappstorereleases-_id_}
   */
  async getBackgroundAssetVersionAppStoreReleases(
    resourceId: string,
    query?: operations['backgroundAssetVersionAppStoreReleases_getInstance']['parameters']['query'],
  ): Promise<
    operations['backgroundAssetVersionAppStoreReleases_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/backgroundAssetVersionAppStoreReleases/{id}',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/backgroundAssetVersionExternalBetaReleases/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-backgroundassetversionexternalbetareleases-_id_}
   */
  async getBackgroundAssetVersionExternalBetaReleases(
    resourceId: string,
    query?: operations['backgroundAssetVersionExternalBetaReleases_getInstance']['parameters']['query'],
  ): Promise<
    operations['backgroundAssetVersionExternalBetaReleases_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/backgroundAssetVersionExternalBetaReleases/{id}',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/backgroundAssetVersionInternalBetaReleases/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-backgroundassetversioninternalbetareleases-_id_}
   */
  async getBackgroundAssetVersionInternalBetaReleases(
    resourceId: string,
    query?: operations['backgroundAssetVersionInternalBetaReleases_getInstance']['parameters']['query'],
  ): Promise<
    operations['backgroundAssetVersionInternalBetaReleases_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/backgroundAssetVersionInternalBetaReleases/{id}',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * POST /v1/backgroundAssetVersions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-backgroundassetversions}
   */
  async createBackgroundAssetVersions(
    document: operations['backgroundAssetVersions_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['backgroundAssetVersions_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/backgroundAssetVersions', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/backgroundAssetVersions/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-backgroundassetversions-_id_}
   */
  async getBackgroundAssetVersions(
    resourceId: string,
    query?: operations['backgroundAssetVersions_getInstance']['parameters']['query'],
  ): Promise<
    operations['backgroundAssetVersions_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/backgroundAssetVersions/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * POST /v1/backgroundAssets
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-backgroundassets}
   */
  async createBackgroundAssets(
    document: operations['backgroundAssets_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['backgroundAssets_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/backgroundAssets', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/backgroundAssets/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-backgroundassets-_id_}
   */
  async getBackgroundAssets(
    resourceId: string,
    query?: operations['backgroundAssets_getInstance']['parameters']['query'],
  ): Promise<
    operations['backgroundAssets_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/backgroundAssets/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/backgroundAssets/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-backgroundassets-_id_}
   */
  async updateBackgroundAssets(
    resourceId: string,
    document: operations['backgroundAssets_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['backgroundAssets_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/backgroundAssets/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * POST /v1/betaAppClipInvocationLocalizations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-betaappclipinvocationlocalizations}
   */
  async createBetaAppClipInvocationLocalizations(
    document: operations['betaAppClipInvocationLocalizations_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['betaAppClipInvocationLocalizations_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/betaAppClipInvocationLocalizations', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * PATCH /v1/betaAppClipInvocationLocalizations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-betaappclipinvocationlocalizations-_id_}
   */
  async updateBetaAppClipInvocationLocalizations(
    resourceId: string,
    document: operations['betaAppClipInvocationLocalizations_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['betaAppClipInvocationLocalizations_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/betaAppClipInvocationLocalizations/{id}',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v1/betaAppClipInvocationLocalizations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-betaappclipinvocationlocalizations-_id_}
   */
  async deleteBetaAppClipInvocationLocalizations(resourceId: string): Promise<void> {
    const url = appleRequestUrl(
      '/v1/betaAppClipInvocationLocalizations/{id}',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * POST /v1/betaAppClipInvocations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-betaappclipinvocations}
   */
  async createBetaAppClipInvocations(
    document: operations['betaAppClipInvocations_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['betaAppClipInvocations_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/betaAppClipInvocations', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/betaAppClipInvocations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-betaappclipinvocations-_id_}
   */
  async getBetaAppClipInvocations(
    resourceId: string,
    query?: operations['betaAppClipInvocations_getInstance']['parameters']['query'],
  ): Promise<
    operations['betaAppClipInvocations_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/betaAppClipInvocations/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/betaAppClipInvocations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-betaappclipinvocations-_id_}
   */
  async updateBetaAppClipInvocations(
    resourceId: string,
    document: operations['betaAppClipInvocations_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['betaAppClipInvocations_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/betaAppClipInvocations/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v1/betaAppClipInvocations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-betaappclipinvocations-_id_}
   */
  async deleteBetaAppClipInvocations(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/betaAppClipInvocations/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * GET /v1/betaAppLocalizations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-betaapplocalizations}
   */
  async listBetaAppLocalizations(
    query?: operations['betaAppLocalizations_getCollection']['parameters']['query'],
  ): Promise<
    operations['betaAppLocalizations_getCollection']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/betaAppLocalizations', undefined, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * POST /v1/betaAppLocalizations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-betaapplocalizations}
   */
  async createBetaAppLocalizations(
    document: operations['betaAppLocalizations_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['betaAppLocalizations_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/betaAppLocalizations', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/betaAppLocalizations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-betaapplocalizations-_id_}
   */
  async getBetaAppLocalizations(
    resourceId: string,
    query?: operations['betaAppLocalizations_getInstance']['parameters']['query'],
  ): Promise<
    operations['betaAppLocalizations_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/betaAppLocalizations/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/betaAppLocalizations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-betaapplocalizations-_id_}
   */
  async updateBetaAppLocalizations(
    resourceId: string,
    document: operations['betaAppLocalizations_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['betaAppLocalizations_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/betaAppLocalizations/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v1/betaAppLocalizations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-betaapplocalizations-_id_}
   */
  async deleteBetaAppLocalizations(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/betaAppLocalizations/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * GET /v1/betaAppReviewDetails
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-betaappreviewdetails}
   */
  async listBetaAppReviewDetails(
    query?: operations['betaAppReviewDetails_getCollection']['parameters']['query'],
  ): Promise<
    operations['betaAppReviewDetails_getCollection']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/betaAppReviewDetails', undefined, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/betaAppReviewDetails/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-betaappreviewdetails-_id_}
   */
  async getBetaAppReviewDetails(
    resourceId: string,
    query?: operations['betaAppReviewDetails_getInstance']['parameters']['query'],
  ): Promise<
    operations['betaAppReviewDetails_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/betaAppReviewDetails/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/betaAppReviewDetails/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-betaappreviewdetails-_id_}
   */
  async updateBetaAppReviewDetails(
    resourceId: string,
    document: operations['betaAppReviewDetails_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['betaAppReviewDetails_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/betaAppReviewDetails/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * GET /v1/betaAppReviewSubmissions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-betaappreviewsubmissions}
   */
  async listBetaAppReviewSubmissions(
    query?: operations['betaAppReviewSubmissions_getCollection']['parameters']['query'],
  ): Promise<
    operations['betaAppReviewSubmissions_getCollection']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/betaAppReviewSubmissions', undefined, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * POST /v1/betaAppReviewSubmissions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-betaappreviewsubmissions}
   */
  async createBetaAppReviewSubmissions(
    document: operations['betaAppReviewSubmissions_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['betaAppReviewSubmissions_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/betaAppReviewSubmissions', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/betaAppReviewSubmissions/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-betaappreviewsubmissions-_id_}
   */
  async getBetaAppReviewSubmissions(
    resourceId: string,
    query?: operations['betaAppReviewSubmissions_getInstance']['parameters']['query'],
  ): Promise<
    operations['betaAppReviewSubmissions_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/betaAppReviewSubmissions/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/betaBuildLocalizations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-betabuildlocalizations}
   */
  async listBetaBuildLocalizations(
    query?: operations['betaBuildLocalizations_getCollection']['parameters']['query'],
  ): Promise<
    operations['betaBuildLocalizations_getCollection']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/betaBuildLocalizations', undefined, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * POST /v1/betaBuildLocalizations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-betabuildlocalizations}
   */
  async createBetaBuildLocalizations(
    document: operations['betaBuildLocalizations_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['betaBuildLocalizations_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/betaBuildLocalizations', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/betaBuildLocalizations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-betabuildlocalizations-_id_}
   */
  async getBetaBuildLocalizations(
    resourceId: string,
    query?: operations['betaBuildLocalizations_getInstance']['parameters']['query'],
  ): Promise<
    operations['betaBuildLocalizations_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/betaBuildLocalizations/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/betaBuildLocalizations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-betabuildlocalizations-_id_}
   */
  async updateBetaBuildLocalizations(
    resourceId: string,
    document: operations['betaBuildLocalizations_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['betaBuildLocalizations_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/betaBuildLocalizations/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v1/betaBuildLocalizations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-betabuildlocalizations-_id_}
   */
  async deleteBetaBuildLocalizations(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/betaBuildLocalizations/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * GET /v1/betaCrashLogs/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-betacrashlogs-_id_}
   */
  async getBetaCrashLogs(
    resourceId: string,
    query?: operations['betaCrashLogs_getInstance']['parameters']['query'],
  ): Promise<
    operations['betaCrashLogs_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/betaCrashLogs/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/betaFeedbackCrashSubmissions/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-betafeedbackcrashsubmissions-_id_}
   */
  async getBetaFeedbackCrashSubmissions(
    resourceId: string,
    query?: operations['betaFeedbackCrashSubmissions_getInstance']['parameters']['query'],
  ): Promise<
    operations['betaFeedbackCrashSubmissions_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/betaFeedbackCrashSubmissions/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * DELETE /v1/betaFeedbackCrashSubmissions/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-betafeedbackcrashsubmissions-_id_}
   */
  async deleteBetaFeedbackCrashSubmissions(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/betaFeedbackCrashSubmissions/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * GET /v1/betaFeedbackScreenshotSubmissions/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-betafeedbackscreenshotsubmissions-_id_}
   */
  async getBetaFeedbackScreenshotSubmissions(
    resourceId: string,
    query?: operations['betaFeedbackScreenshotSubmissions_getInstance']['parameters']['query'],
  ): Promise<
    operations['betaFeedbackScreenshotSubmissions_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/betaFeedbackScreenshotSubmissions/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * DELETE /v1/betaFeedbackScreenshotSubmissions/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-betafeedbackscreenshotsubmissions-_id_}
   */
  async deleteBetaFeedbackScreenshotSubmissions(resourceId: string): Promise<void> {
    const url = appleRequestUrl(
      '/v1/betaFeedbackScreenshotSubmissions/{id}',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * GET /v1/betaGroups
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-betagroups}
   */
  async listBetaGroups(
    query?: operations['betaGroups_getCollection']['parameters']['query'],
  ): Promise<
    operations['betaGroups_getCollection']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/betaGroups', undefined, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * POST /v1/betaGroups
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-betagroups}
   */
  async createBetaGroups(
    document: operations['betaGroups_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['betaGroups_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/betaGroups', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/betaGroups/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-betagroups-_id_}
   */
  async getBetaGroups(
    resourceId: string,
    query?: operations['betaGroups_getInstance']['parameters']['query'],
  ): Promise<
    operations['betaGroups_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/betaGroups/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/betaGroups/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-betagroups-_id_}
   */
  async updateBetaGroups(
    resourceId: string,
    document: operations['betaGroups_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['betaGroups_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/betaGroups/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v1/betaGroups/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-betagroups-_id_}
   */
  async deleteBetaGroups(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/betaGroups/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * GET /v1/betaLicenseAgreements
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-betalicenseagreements}
   */
  async listBetaLicenseAgreements(
    query?: operations['betaLicenseAgreements_getCollection']['parameters']['query'],
  ): Promise<
    operations['betaLicenseAgreements_getCollection']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/betaLicenseAgreements', undefined, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/betaLicenseAgreements/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-betalicenseagreements-_id_}
   */
  async getBetaLicenseAgreements(
    resourceId: string,
    query?: operations['betaLicenseAgreements_getInstance']['parameters']['query'],
  ): Promise<
    operations['betaLicenseAgreements_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/betaLicenseAgreements/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/betaLicenseAgreements/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-betalicenseagreements-_id_}
   */
  async updateBetaLicenseAgreements(
    resourceId: string,
    document: operations['betaLicenseAgreements_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['betaLicenseAgreements_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/betaLicenseAgreements/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * POST /v1/betaRecruitmentCriteria
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-betarecruitmentcriteria}
   */
  async createBetaRecruitmentCriteria(
    document: operations['betaRecruitmentCriteria_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['betaRecruitmentCriteria_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/betaRecruitmentCriteria', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * PATCH /v1/betaRecruitmentCriteria/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-betarecruitmentcriteria-_id_}
   */
  async updateBetaRecruitmentCriteria(
    resourceId: string,
    document: operations['betaRecruitmentCriteria_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['betaRecruitmentCriteria_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/betaRecruitmentCriteria/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v1/betaRecruitmentCriteria/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-betarecruitmentcriteria-_id_}
   */
  async deleteBetaRecruitmentCriteria(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/betaRecruitmentCriteria/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * GET /v1/betaRecruitmentCriterionOptions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-betarecruitmentcriterionoptions}
   */
  async listBetaRecruitmentCriterionOptions(
    query?: operations['betaRecruitmentCriterionOptions_getCollection']['parameters']['query'],
  ): Promise<
    operations['betaRecruitmentCriterionOptions_getCollection']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/betaRecruitmentCriterionOptions', undefined, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * POST /v1/betaTesterInvitations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-betatesterinvitations}
   */
  async createBetaTesterInvitations(
    document: operations['betaTesterInvitations_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['betaTesterInvitations_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/betaTesterInvitations', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/betaTesters
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-betatesters}
   */
  async listBetaTesters(
    query?: operations['betaTesters_getCollection']['parameters']['query'],
  ): Promise<
    operations['betaTesters_getCollection']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/betaTesters', undefined, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * POST /v1/betaTesters
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-betatesters}
   */
  async createBetaTesters(
    document: operations['betaTesters_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['betaTesters_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/betaTesters', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/betaTesters/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-betatesters-_id_}
   */
  async getBetaTesters(
    resourceId: string,
    query?: operations['betaTesters_getInstance']['parameters']['query'],
  ): Promise<
    operations['betaTesters_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/betaTesters/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * DELETE /v1/betaTesters/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-betatesters-_id_}
   */
  async deleteBetaTesters(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/betaTesters/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * GET /v1/buildBetaDetails
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-buildbetadetails}
   */
  async listBuildBetaDetails(
    query?: operations['buildBetaDetails_getCollection']['parameters']['query'],
  ): Promise<
    operations['buildBetaDetails_getCollection']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/buildBetaDetails', undefined, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/buildBetaDetails/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-buildbetadetails-_id_}
   */
  async getBuildBetaDetails(
    resourceId: string,
    query?: operations['buildBetaDetails_getInstance']['parameters']['query'],
  ): Promise<
    operations['buildBetaDetails_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/buildBetaDetails/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/buildBetaDetails/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-buildbetadetails-_id_}
   */
  async updateBuildBetaDetails(
    resourceId: string,
    document: operations['buildBetaDetails_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['buildBetaDetails_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/buildBetaDetails/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * POST /v1/buildBetaNotifications
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-buildbetanotifications}
   */
  async createBuildBetaNotifications(
    document: operations['buildBetaNotifications_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['buildBetaNotifications_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/buildBetaNotifications', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * POST /v1/buildUploadFiles
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-builduploadfiles}
   */
  async createBuildUploadFiles(
    document: operations['buildUploadFiles_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['buildUploadFiles_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/buildUploadFiles', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/buildUploadFiles/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-builduploadfiles-_id_}
   */
  async getBuildUploadFiles(
    resourceId: string,
    query?: operations['buildUploadFiles_getInstance']['parameters']['query'],
  ): Promise<
    operations['buildUploadFiles_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/buildUploadFiles/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/buildUploadFiles/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-builduploadfiles-_id_}
   */
  async updateBuildUploadFiles(
    resourceId: string,
    document: operations['buildUploadFiles_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['buildUploadFiles_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/buildUploadFiles/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * POST /v1/buildUploads
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-builduploads}
   */
  async createBuildUploads(
    document: operations['buildUploads_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['buildUploads_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/buildUploads', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/buildUploads/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-builduploads-_id_}
   */
  async getBuildUploads(
    resourceId: string,
    query?: operations['buildUploads_getInstance']['parameters']['query'],
  ): Promise<
    operations['buildUploads_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/buildUploads/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * DELETE /v1/buildUploads/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-builduploads-_id_}
   */
  async deleteBuildUploads(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/buildUploads/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * GET /v1/builds
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-builds}
   */
  async listBuilds(
    query?: operations['builds_getCollection']['parameters']['query'],
  ): Promise<operations['builds_getCollection']['responses'][200]['content']['application/json']> {
    const url = appleRequestUrl('/v1/builds', undefined, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/builds/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-builds-_id_}
   */
  async getBuilds(
    resourceId: string,
    query?: operations['builds_getInstance']['parameters']['query'],
  ): Promise<operations['builds_getInstance']['responses'][200]['content']['application/json']> {
    const url = appleRequestUrl('/v1/builds/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/builds/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-builds-_id_}
   */
  async updateBuilds(
    resourceId: string,
    document: operations['builds_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<operations['builds_updateInstance']['responses'][200]['content']['application/json']> {
    const url = appleRequestUrl('/v1/builds/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * POST /v1/bundleIdCapabilities
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-bundleidcapabilities}
   */
  async createBundleIdCapabilities(
    document: operations['bundleIdCapabilities_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['bundleIdCapabilities_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/bundleIdCapabilities', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * PATCH /v1/bundleIdCapabilities/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-bundleidcapabilities-_id_}
   */
  async updateBundleIdCapabilities(
    resourceId: string,
    document: operations['bundleIdCapabilities_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['bundleIdCapabilities_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/bundleIdCapabilities/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v1/bundleIdCapabilities/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-bundleidcapabilities-_id_}
   */
  async deleteBundleIdCapabilities(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/bundleIdCapabilities/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * GET /v1/bundleIds
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-bundleids}
   */
  async listBundleIds(
    query?: operations['bundleIds_getCollection']['parameters']['query'],
  ): Promise<
    operations['bundleIds_getCollection']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/bundleIds', undefined, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * POST /v1/bundleIds
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-bundleids}
   */
  async createBundleIds(
    document: operations['bundleIds_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['bundleIds_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/bundleIds', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/bundleIds/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-bundleids-_id_}
   */
  async getBundleIds(
    resourceId: string,
    query?: operations['bundleIds_getInstance']['parameters']['query'],
  ): Promise<operations['bundleIds_getInstance']['responses'][200]['content']['application/json']> {
    const url = appleRequestUrl('/v1/bundleIds/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/bundleIds/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-bundleids-_id_}
   */
  async updateBundleIds(
    resourceId: string,
    document: operations['bundleIds_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['bundleIds_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/bundleIds/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v1/bundleIds/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-bundleids-_id_}
   */
  async deleteBundleIds(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/bundleIds/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * GET /v1/certificates
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-certificates}
   */
  async listCertificates(
    query?: operations['certificates_getCollection']['parameters']['query'],
  ): Promise<
    operations['certificates_getCollection']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/certificates', undefined, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * POST /v1/certificates
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-certificates}
   */
  async createCertificates(
    document: operations['certificates_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['certificates_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/certificates', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/certificates/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-certificates-_id_}
   */
  async getCertificates(
    resourceId: string,
    query?: operations['certificates_getInstance']['parameters']['query'],
  ): Promise<
    operations['certificates_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/certificates/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/certificates/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-certificates-_id_}
   */
  async updateCertificates(
    resourceId: string,
    document: operations['certificates_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['certificates_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/certificates/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v1/certificates/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-certificates-_id_}
   */
  async deleteCertificates(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/certificates/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * GET /v1/ciArtifacts/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-ciartifacts-_id_}
   */
  async getCiArtifacts(
    resourceId: string,
    query?: operations['ciArtifacts_getInstance']['parameters']['query'],
  ): Promise<
    operations['ciArtifacts_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/ciArtifacts/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/ciBuildActions/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-cibuildactions-_id_}
   */
  async getCiBuildActions(
    resourceId: string,
    query?: operations['ciBuildActions_getInstance']['parameters']['query'],
  ): Promise<
    operations['ciBuildActions_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/ciBuildActions/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * POST /v1/ciBuildRuns
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-cibuildruns}
   */
  async createCiBuildRuns(
    document: operations['ciBuildRuns_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['ciBuildRuns_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/ciBuildRuns', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/ciBuildRuns/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-cibuildruns-_id_}
   */
  async getCiBuildRuns(
    resourceId: string,
    query?: operations['ciBuildRuns_getInstance']['parameters']['query'],
  ): Promise<
    operations['ciBuildRuns_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/ciBuildRuns/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/ciIssues/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-ciissues-_id_}
   */
  async getCiIssues(
    resourceId: string,
    query?: operations['ciIssues_getInstance']['parameters']['query'],
  ): Promise<operations['ciIssues_getInstance']['responses'][200]['content']['application/json']> {
    const url = appleRequestUrl('/v1/ciIssues/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/ciMacOsVersions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-cimacosversions}
   */
  async listCiMacOsVersions(
    query?: operations['ciMacOsVersions_getCollection']['parameters']['query'],
  ): Promise<
    operations['ciMacOsVersions_getCollection']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/ciMacOsVersions', undefined, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/ciMacOsVersions/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-cimacosversions-_id_}
   */
  async getCiMacOsVersions(
    resourceId: string,
    query?: operations['ciMacOsVersions_getInstance']['parameters']['query'],
  ): Promise<
    operations['ciMacOsVersions_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/ciMacOsVersions/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/ciProducts
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-ciproducts}
   */
  async listCiProducts(
    query?: operations['ciProducts_getCollection']['parameters']['query'],
  ): Promise<
    operations['ciProducts_getCollection']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/ciProducts', undefined, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/ciProducts/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-ciproducts-_id_}
   */
  async getCiProducts(
    resourceId: string,
    query?: operations['ciProducts_getInstance']['parameters']['query'],
  ): Promise<
    operations['ciProducts_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/ciProducts/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * DELETE /v1/ciProducts/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-ciproducts-_id_}
   */
  async deleteCiProducts(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/ciProducts/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * GET /v1/ciTestResults/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-citestresults-_id_}
   */
  async getCiTestResults(
    resourceId: string,
    query?: operations['ciTestResults_getInstance']['parameters']['query'],
  ): Promise<
    operations['ciTestResults_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/ciTestResults/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * POST /v1/ciWorkflows
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-ciworkflows}
   */
  async createCiWorkflows(
    document: operations['ciWorkflows_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['ciWorkflows_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/ciWorkflows', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/ciWorkflows/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-ciworkflows-_id_}
   */
  async getCiWorkflows(
    resourceId: string,
    query?: operations['ciWorkflows_getInstance']['parameters']['query'],
  ): Promise<
    operations['ciWorkflows_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/ciWorkflows/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/ciWorkflows/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-ciworkflows-_id_}
   */
  async updateCiWorkflows(
    resourceId: string,
    document: operations['ciWorkflows_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['ciWorkflows_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/ciWorkflows/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v1/ciWorkflows/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-ciworkflows-_id_}
   */
  async deleteCiWorkflows(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/ciWorkflows/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * GET /v1/ciXcodeVersions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-cixcodeversions}
   */
  async listCiXcodeVersions(
    query?: operations['ciXcodeVersions_getCollection']['parameters']['query'],
  ): Promise<
    operations['ciXcodeVersions_getCollection']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/ciXcodeVersions', undefined, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/ciXcodeVersions/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-cixcodeversions-_id_}
   */
  async getCiXcodeVersions(
    resourceId: string,
    query?: operations['ciXcodeVersions_getInstance']['parameters']['query'],
  ): Promise<
    operations['ciXcodeVersions_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/ciXcodeVersions/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * POST /v1/customerReviewResponses
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-customerreviewresponses}
   */
  async createCustomerReviewResponses(
    document: operations['customerReviewResponses_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['customerReviewResponses_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/customerReviewResponses', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/customerReviewResponses/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-customerreviewresponses-_id_}
   */
  async getCustomerReviewResponses(
    resourceId: string,
    query?: operations['customerReviewResponses_getInstance']['parameters']['query'],
  ): Promise<
    operations['customerReviewResponses_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/customerReviewResponses/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * DELETE /v1/customerReviewResponses/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-customerreviewresponses-_id_}
   */
  async deleteCustomerReviewResponses(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/customerReviewResponses/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * GET /v1/customerReviews/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-customerreviews-_id_}
   */
  async getCustomerReviews(
    resourceId: string,
    query?: operations['customerReviews_getInstance']['parameters']['query'],
  ): Promise<
    operations['customerReviews_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/customerReviews/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/devices
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-devices}
   */
  async listDevices(
    query?: operations['devices_getCollection']['parameters']['query'],
  ): Promise<operations['devices_getCollection']['responses'][200]['content']['application/json']> {
    const url = appleRequestUrl('/v1/devices', undefined, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * POST /v1/devices
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-devices}
   */
  async createDevices(
    document: operations['devices_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['devices_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/devices', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/devices/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-devices-_id_}
   */
  async getDevices(
    resourceId: string,
    query?: operations['devices_getInstance']['parameters']['query'],
  ): Promise<operations['devices_getInstance']['responses'][200]['content']['application/json']> {
    const url = appleRequestUrl('/v1/devices/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/devices/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-devices-_id_}
   */
  async updateDevices(
    resourceId: string,
    document: operations['devices_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['devices_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/devices/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * POST /v1/endAppAvailabilityPreOrders
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-endappavailabilitypreorders}
   */
  async createEndAppAvailabilityPreOrders(
    document: operations['endAppAvailabilityPreOrders_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['endAppAvailabilityPreOrders_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/endAppAvailabilityPreOrders', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * POST /v1/endUserLicenseAgreements
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-enduserlicenseagreements}
   */
  async createEndUserLicenseAgreements(
    document: operations['endUserLicenseAgreements_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['endUserLicenseAgreements_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/endUserLicenseAgreements', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/endUserLicenseAgreements/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-enduserlicenseagreements-_id_}
   */
  async getEndUserLicenseAgreements(
    resourceId: string,
    query?: operations['endUserLicenseAgreements_getInstance']['parameters']['query'],
  ): Promise<
    operations['endUserLicenseAgreements_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/endUserLicenseAgreements/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/endUserLicenseAgreements/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-enduserlicenseagreements-_id_}
   */
  async updateEndUserLicenseAgreements(
    resourceId: string,
    document: operations['endUserLicenseAgreements_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['endUserLicenseAgreements_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/endUserLicenseAgreements/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v1/endUserLicenseAgreements/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-enduserlicenseagreements-_id_}
   */
  async deleteEndUserLicenseAgreements(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/endUserLicenseAgreements/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * GET /v1/financeReports
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-financereports}
   */
  async listFinanceReports(
    query?: operations['financeReports_getCollection']['parameters']['query'],
  ): Promise<Buffer> {
    const url = appleRequestUrl('/v1/financeReports', undefined, query);
    return this.apple.sendBytes('GET', url, 'application/a-gzip');
  }

  /**
   * POST /v1/gameCenterAchievementImages
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-gamecenterachievementimages}
   */
  async createGameCenterAchievementImages(
    document: operations['gameCenterAchievementImages_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['gameCenterAchievementImages_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterAchievementImages', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/gameCenterAchievementImages/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterachievementimages-_id_}
   */
  async getGameCenterAchievementImages(
    resourceId: string,
    query?: operations['gameCenterAchievementImages_getInstance']['parameters']['query'],
  ): Promise<
    operations['gameCenterAchievementImages_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterAchievementImages/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/gameCenterAchievementImages/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-gamecenterachievementimages-_id_}
   */
  async updateGameCenterAchievementImages(
    resourceId: string,
    document: operations['gameCenterAchievementImages_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['gameCenterAchievementImages_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterAchievementImages/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v1/gameCenterAchievementImages/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-gamecenterachievementimages-_id_}
   */
  async deleteGameCenterAchievementImages(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/gameCenterAchievementImages/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * POST /v2/gameCenterAchievementImages
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v2-gamecenterachievementimages}
   */
  async createGameCenterAchievementImagesV2(
    document: operations['gameCenterAchievementImagesV2_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['gameCenterAchievementImagesV2_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v2/gameCenterAchievementImages', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v2/gameCenterAchievementImages/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v2-gamecenterachievementimages-_id_}
   */
  async getGameCenterAchievementImagesV2(
    resourceId: string,
    query?: operations['gameCenterAchievementImagesV2_getInstance']['parameters']['query'],
  ): Promise<
    operations['gameCenterAchievementImagesV2_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v2/gameCenterAchievementImages/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v2/gameCenterAchievementImages/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v2-gamecenterachievementimages-_id_}
   */
  async updateGameCenterAchievementImagesV2(
    resourceId: string,
    document: operations['gameCenterAchievementImagesV2_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['gameCenterAchievementImagesV2_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v2/gameCenterAchievementImages/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v2/gameCenterAchievementImages/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v2-gamecenterachievementimages-_id_}
   */
  async deleteGameCenterAchievementImagesV2(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v2/gameCenterAchievementImages/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * POST /v2/gameCenterAchievementLocalizations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v2-gamecenterachievementlocalizations}
   */
  async createGameCenterAchievementLocalizationsV2(
    document: operations['gameCenterAchievementLocalizationsV2_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['gameCenterAchievementLocalizationsV2_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v2/gameCenterAchievementLocalizations', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v2/gameCenterAchievementLocalizations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v2-gamecenterachievementlocalizations-_id_}
   */
  async getGameCenterAchievementLocalizationsV2(
    resourceId: string,
    query?: operations['gameCenterAchievementLocalizationsV2_getInstance']['parameters']['query'],
  ): Promise<
    operations['gameCenterAchievementLocalizationsV2_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v2/gameCenterAchievementLocalizations/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v2/gameCenterAchievementLocalizations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v2-gamecenterachievementlocalizations-_id_}
   */
  async updateGameCenterAchievementLocalizationsV2(
    resourceId: string,
    document: operations['gameCenterAchievementLocalizationsV2_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['gameCenterAchievementLocalizationsV2_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v2/gameCenterAchievementLocalizations/{id}',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v2/gameCenterAchievementLocalizations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v2-gamecenterachievementlocalizations-_id_}
   */
  async deleteGameCenterAchievementLocalizationsV2(resourceId: string): Promise<void> {
    const url = appleRequestUrl(
      '/v2/gameCenterAchievementLocalizations/{id}',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * POST /v1/gameCenterAchievementLocalizations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-gamecenterachievementlocalizations}
   */
  async createGameCenterAchievementLocalizations(
    document: operations['gameCenterAchievementLocalizations_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['gameCenterAchievementLocalizations_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterAchievementLocalizations', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/gameCenterAchievementLocalizations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterachievementlocalizations-_id_}
   */
  async getGameCenterAchievementLocalizations(
    resourceId: string,
    query?: operations['gameCenterAchievementLocalizations_getInstance']['parameters']['query'],
  ): Promise<
    operations['gameCenterAchievementLocalizations_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterAchievementLocalizations/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/gameCenterAchievementLocalizations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-gamecenterachievementlocalizations-_id_}
   */
  async updateGameCenterAchievementLocalizations(
    resourceId: string,
    document: operations['gameCenterAchievementLocalizations_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['gameCenterAchievementLocalizations_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterAchievementLocalizations/{id}',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v1/gameCenterAchievementLocalizations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-gamecenterachievementlocalizations-_id_}
   */
  async deleteGameCenterAchievementLocalizations(resourceId: string): Promise<void> {
    const url = appleRequestUrl(
      '/v1/gameCenterAchievementLocalizations/{id}',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * POST /v1/gameCenterAchievementReleases
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-gamecenterachievementreleases}
   */
  async createGameCenterAchievementReleases(
    document: operations['gameCenterAchievementReleases_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['gameCenterAchievementReleases_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterAchievementReleases', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/gameCenterAchievementReleases/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterachievementreleases-_id_}
   */
  async getGameCenterAchievementReleases(
    resourceId: string,
    query?: operations['gameCenterAchievementReleases_getInstance']['parameters']['query'],
  ): Promise<
    operations['gameCenterAchievementReleases_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterAchievementReleases/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * DELETE /v1/gameCenterAchievementReleases/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-gamecenterachievementreleases-_id_}
   */
  async deleteGameCenterAchievementReleases(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/gameCenterAchievementReleases/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * POST /v2/gameCenterAchievementVersions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v2-gamecenterachievementversions}
   */
  async createGameCenterAchievementVersionsV2(
    document: operations['gameCenterAchievementVersionsV2_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['gameCenterAchievementVersionsV2_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v2/gameCenterAchievementVersions', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v2/gameCenterAchievementVersions/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v2-gamecenterachievementversions-_id_}
   */
  async getGameCenterAchievementVersionsV2(
    resourceId: string,
    query?: operations['gameCenterAchievementVersionsV2_getInstance']['parameters']['query'],
  ): Promise<
    operations['gameCenterAchievementVersionsV2_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v2/gameCenterAchievementVersions/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * POST /v2/gameCenterAchievements
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v2-gamecenterachievements}
   */
  async createGameCenterAchievementsV2(
    document: operations['gameCenterAchievementsV2_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['gameCenterAchievementsV2_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v2/gameCenterAchievements', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v2/gameCenterAchievements/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v2-gamecenterachievements-_id_}
   */
  async getGameCenterAchievementsV2(
    resourceId: string,
    query?: operations['gameCenterAchievementsV2_getInstance']['parameters']['query'],
  ): Promise<
    operations['gameCenterAchievementsV2_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v2/gameCenterAchievements/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v2/gameCenterAchievements/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v2-gamecenterachievements-_id_}
   */
  async updateGameCenterAchievementsV2(
    resourceId: string,
    document: operations['gameCenterAchievementsV2_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['gameCenterAchievementsV2_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v2/gameCenterAchievements/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v2/gameCenterAchievements/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v2-gamecenterachievements-_id_}
   */
  async deleteGameCenterAchievementsV2(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v2/gameCenterAchievements/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * POST /v1/gameCenterAchievements
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-gamecenterachievements}
   */
  async createGameCenterAchievements(
    document: operations['gameCenterAchievements_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['gameCenterAchievements_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterAchievements', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/gameCenterAchievements/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterachievements-_id_}
   */
  async getGameCenterAchievements(
    resourceId: string,
    query?: operations['gameCenterAchievements_getInstance']['parameters']['query'],
  ): Promise<
    operations['gameCenterAchievements_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterAchievements/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/gameCenterAchievements/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-gamecenterachievements-_id_}
   */
  async updateGameCenterAchievements(
    resourceId: string,
    document: operations['gameCenterAchievements_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['gameCenterAchievements_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterAchievements/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v1/gameCenterAchievements/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-gamecenterachievements-_id_}
   */
  async deleteGameCenterAchievements(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/gameCenterAchievements/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * POST /v1/gameCenterActivities
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-gamecenteractivities}
   */
  async createGameCenterActivities(
    document: operations['gameCenterActivities_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['gameCenterActivities_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterActivities', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/gameCenterActivities/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenteractivities-_id_}
   */
  async getGameCenterActivities(
    resourceId: string,
    query?: operations['gameCenterActivities_getInstance']['parameters']['query'],
  ): Promise<
    operations['gameCenterActivities_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterActivities/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/gameCenterActivities/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-gamecenteractivities-_id_}
   */
  async updateGameCenterActivities(
    resourceId: string,
    document: operations['gameCenterActivities_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['gameCenterActivities_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterActivities/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v1/gameCenterActivities/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-gamecenteractivities-_id_}
   */
  async deleteGameCenterActivities(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/gameCenterActivities/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * POST /v1/gameCenterActivityImages
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-gamecenteractivityimages}
   */
  async createGameCenterActivityImages(
    document: operations['gameCenterActivityImages_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['gameCenterActivityImages_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterActivityImages', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/gameCenterActivityImages/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenteractivityimages-_id_}
   */
  async getGameCenterActivityImages(
    resourceId: string,
    query?: operations['gameCenterActivityImages_getInstance']['parameters']['query'],
  ): Promise<
    operations['gameCenterActivityImages_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterActivityImages/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/gameCenterActivityImages/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-gamecenteractivityimages-_id_}
   */
  async updateGameCenterActivityImages(
    resourceId: string,
    document: operations['gameCenterActivityImages_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['gameCenterActivityImages_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterActivityImages/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v1/gameCenterActivityImages/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-gamecenteractivityimages-_id_}
   */
  async deleteGameCenterActivityImages(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/gameCenterActivityImages/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * POST /v1/gameCenterActivityLocalizations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-gamecenteractivitylocalizations}
   */
  async createGameCenterActivityLocalizations(
    document: operations['gameCenterActivityLocalizations_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['gameCenterActivityLocalizations_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterActivityLocalizations', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/gameCenterActivityLocalizations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenteractivitylocalizations-_id_}
   */
  async getGameCenterActivityLocalizations(
    resourceId: string,
    query?: operations['gameCenterActivityLocalizations_getInstance']['parameters']['query'],
  ): Promise<
    operations['gameCenterActivityLocalizations_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterActivityLocalizations/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/gameCenterActivityLocalizations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-gamecenteractivitylocalizations-_id_}
   */
  async updateGameCenterActivityLocalizations(
    resourceId: string,
    document: operations['gameCenterActivityLocalizations_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['gameCenterActivityLocalizations_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterActivityLocalizations/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v1/gameCenterActivityLocalizations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-gamecenteractivitylocalizations-_id_}
   */
  async deleteGameCenterActivityLocalizations(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/gameCenterActivityLocalizations/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * POST /v1/gameCenterActivityVersionReleases
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-gamecenteractivityversionreleases}
   */
  async createGameCenterActivityVersionReleases(
    document: operations['gameCenterActivityVersionReleases_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['gameCenterActivityVersionReleases_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterActivityVersionReleases', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/gameCenterActivityVersionReleases/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenteractivityversionreleases-_id_}
   */
  async getGameCenterActivityVersionReleases(
    resourceId: string,
    query?: operations['gameCenterActivityVersionReleases_getInstance']['parameters']['query'],
  ): Promise<
    operations['gameCenterActivityVersionReleases_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterActivityVersionReleases/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * DELETE /v1/gameCenterActivityVersionReleases/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-gamecenteractivityversionreleases-_id_}
   */
  async deleteGameCenterActivityVersionReleases(resourceId: string): Promise<void> {
    const url = appleRequestUrl(
      '/v1/gameCenterActivityVersionReleases/{id}',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * POST /v1/gameCenterActivityVersions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-gamecenteractivityversions}
   */
  async createGameCenterActivityVersions(
    document: operations['gameCenterActivityVersions_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['gameCenterActivityVersions_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterActivityVersions', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/gameCenterActivityVersions/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenteractivityversions-_id_}
   */
  async getGameCenterActivityVersions(
    resourceId: string,
    query?: operations['gameCenterActivityVersions_getInstance']['parameters']['query'],
  ): Promise<
    operations['gameCenterActivityVersions_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterActivityVersions/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/gameCenterActivityVersions/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-gamecenteractivityversions-_id_}
   */
  async updateGameCenterActivityVersions(
    resourceId: string,
    document: operations['gameCenterActivityVersions_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['gameCenterActivityVersions_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterActivityVersions/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * POST /v1/gameCenterAppVersions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-gamecenterappversions}
   */
  async createGameCenterAppVersions(
    document: operations['gameCenterAppVersions_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['gameCenterAppVersions_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterAppVersions', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/gameCenterAppVersions/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterappversions-_id_}
   */
  async getGameCenterAppVersions(
    resourceId: string,
    query?: operations['gameCenterAppVersions_getInstance']['parameters']['query'],
  ): Promise<
    operations['gameCenterAppVersions_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterAppVersions/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/gameCenterAppVersions/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-gamecenterappversions-_id_}
   */
  async updateGameCenterAppVersions(
    resourceId: string,
    document: operations['gameCenterAppVersions_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['gameCenterAppVersions_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterAppVersions/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * POST /v1/gameCenterChallengeImages
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-gamecenterchallengeimages}
   */
  async createGameCenterChallengeImages(
    document: operations['gameCenterChallengeImages_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['gameCenterChallengeImages_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterChallengeImages', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/gameCenterChallengeImages/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterchallengeimages-_id_}
   */
  async getGameCenterChallengeImages(
    resourceId: string,
    query?: operations['gameCenterChallengeImages_getInstance']['parameters']['query'],
  ): Promise<
    operations['gameCenterChallengeImages_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterChallengeImages/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/gameCenterChallengeImages/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-gamecenterchallengeimages-_id_}
   */
  async updateGameCenterChallengeImages(
    resourceId: string,
    document: operations['gameCenterChallengeImages_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['gameCenterChallengeImages_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterChallengeImages/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v1/gameCenterChallengeImages/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-gamecenterchallengeimages-_id_}
   */
  async deleteGameCenterChallengeImages(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/gameCenterChallengeImages/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * POST /v1/gameCenterChallengeLocalizations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-gamecenterchallengelocalizations}
   */
  async createGameCenterChallengeLocalizations(
    document: operations['gameCenterChallengeLocalizations_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['gameCenterChallengeLocalizations_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterChallengeLocalizations', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/gameCenterChallengeLocalizations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterchallengelocalizations-_id_}
   */
  async getGameCenterChallengeLocalizations(
    resourceId: string,
    query?: operations['gameCenterChallengeLocalizations_getInstance']['parameters']['query'],
  ): Promise<
    operations['gameCenterChallengeLocalizations_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterChallengeLocalizations/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/gameCenterChallengeLocalizations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-gamecenterchallengelocalizations-_id_}
   */
  async updateGameCenterChallengeLocalizations(
    resourceId: string,
    document: operations['gameCenterChallengeLocalizations_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['gameCenterChallengeLocalizations_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterChallengeLocalizations/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v1/gameCenterChallengeLocalizations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-gamecenterchallengelocalizations-_id_}
   */
  async deleteGameCenterChallengeLocalizations(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/gameCenterChallengeLocalizations/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * POST /v1/gameCenterChallengeVersionReleases
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-gamecenterchallengeversionreleases}
   */
  async createGameCenterChallengeVersionReleases(
    document: operations['gameCenterChallengeVersionReleases_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['gameCenterChallengeVersionReleases_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterChallengeVersionReleases', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/gameCenterChallengeVersionReleases/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterchallengeversionreleases-_id_}
   */
  async getGameCenterChallengeVersionReleases(
    resourceId: string,
    query?: operations['gameCenterChallengeVersionReleases_getInstance']['parameters']['query'],
  ): Promise<
    operations['gameCenterChallengeVersionReleases_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterChallengeVersionReleases/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * DELETE /v1/gameCenterChallengeVersionReleases/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-gamecenterchallengeversionreleases-_id_}
   */
  async deleteGameCenterChallengeVersionReleases(resourceId: string): Promise<void> {
    const url = appleRequestUrl(
      '/v1/gameCenterChallengeVersionReleases/{id}',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * POST /v1/gameCenterChallengeVersions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-gamecenterchallengeversions}
   */
  async createGameCenterChallengeVersions(
    document: operations['gameCenterChallengeVersions_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['gameCenterChallengeVersions_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterChallengeVersions', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/gameCenterChallengeVersions/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterchallengeversions-_id_}
   */
  async getGameCenterChallengeVersions(
    resourceId: string,
    query?: operations['gameCenterChallengeVersions_getInstance']['parameters']['query'],
  ): Promise<
    operations['gameCenterChallengeVersions_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterChallengeVersions/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * POST /v1/gameCenterChallenges
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-gamecenterchallenges}
   */
  async createGameCenterChallenges(
    document: operations['gameCenterChallenges_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['gameCenterChallenges_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterChallenges', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/gameCenterChallenges/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterchallenges-_id_}
   */
  async getGameCenterChallenges(
    resourceId: string,
    query?: operations['gameCenterChallenges_getInstance']['parameters']['query'],
  ): Promise<
    operations['gameCenterChallenges_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterChallenges/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/gameCenterChallenges/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-gamecenterchallenges-_id_}
   */
  async updateGameCenterChallenges(
    resourceId: string,
    document: operations['gameCenterChallenges_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['gameCenterChallenges_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterChallenges/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v1/gameCenterChallenges/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-gamecenterchallenges-_id_}
   */
  async deleteGameCenterChallenges(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/gameCenterChallenges/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * PATCH /v1/gameCenterDetailPlayers/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-gamecenterdetailplayers-_id_}
   */
  async updateGameCenterDetailPlayers(
    resourceId: string,
    document: operations['gameCenterDetailPlayers_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['gameCenterDetailPlayers_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterDetailPlayers/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * POST /v1/gameCenterDetails
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-gamecenterdetails}
   */
  async createGameCenterDetails(
    document: operations['gameCenterDetails_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['gameCenterDetails_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterDetails', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/gameCenterDetails/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterdetails-_id_}
   */
  async getGameCenterDetails(
    resourceId: string,
    query?: operations['gameCenterDetails_getInstance']['parameters']['query'],
  ): Promise<
    operations['gameCenterDetails_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterDetails/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/gameCenterDetails/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-gamecenterdetails-_id_}
   */
  async updateGameCenterDetails(
    resourceId: string,
    document: operations['gameCenterDetails_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['gameCenterDetails_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterDetails/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * GET /v1/gameCenterGroups
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecentergroups}
   */
  async listGameCenterGroups(
    query?: operations['gameCenterGroups_getCollection']['parameters']['query'],
  ): Promise<
    operations['gameCenterGroups_getCollection']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterGroups', undefined, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * POST /v1/gameCenterGroups
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-gamecentergroups}
   */
  async createGameCenterGroups(
    document: operations['gameCenterGroups_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['gameCenterGroups_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterGroups', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/gameCenterGroups/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecentergroups-_id_}
   */
  async getGameCenterGroups(
    resourceId: string,
    query?: operations['gameCenterGroups_getInstance']['parameters']['query'],
  ): Promise<
    operations['gameCenterGroups_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterGroups/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/gameCenterGroups/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-gamecentergroups-_id_}
   */
  async updateGameCenterGroups(
    resourceId: string,
    document: operations['gameCenterGroups_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['gameCenterGroups_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterGroups/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v1/gameCenterGroups/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-gamecentergroups-_id_}
   */
  async deleteGameCenterGroups(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/gameCenterGroups/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * POST /v1/gameCenterLeaderboardEntrySubmissions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-gamecenterleaderboardentrysubmissions}
   */
  async createGameCenterLeaderboardEntrySubmissions(
    document: operations['gameCenterLeaderboardEntrySubmissions_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['gameCenterLeaderboardEntrySubmissions_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterLeaderboardEntrySubmissions', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * POST /v1/gameCenterLeaderboardImages
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-gamecenterleaderboardimages}
   */
  async createGameCenterLeaderboardImages(
    document: operations['gameCenterLeaderboardImages_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['gameCenterLeaderboardImages_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterLeaderboardImages', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/gameCenterLeaderboardImages/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterleaderboardimages-_id_}
   */
  async getGameCenterLeaderboardImages(
    resourceId: string,
    query?: operations['gameCenterLeaderboardImages_getInstance']['parameters']['query'],
  ): Promise<
    operations['gameCenterLeaderboardImages_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterLeaderboardImages/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/gameCenterLeaderboardImages/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-gamecenterleaderboardimages-_id_}
   */
  async updateGameCenterLeaderboardImages(
    resourceId: string,
    document: operations['gameCenterLeaderboardImages_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['gameCenterLeaderboardImages_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterLeaderboardImages/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v1/gameCenterLeaderboardImages/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-gamecenterleaderboardimages-_id_}
   */
  async deleteGameCenterLeaderboardImages(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/gameCenterLeaderboardImages/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * POST /v2/gameCenterLeaderboardImages
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v2-gamecenterleaderboardimages}
   */
  async createGameCenterLeaderboardImagesV2(
    document: operations['gameCenterLeaderboardImagesV2_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['gameCenterLeaderboardImagesV2_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v2/gameCenterLeaderboardImages', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v2/gameCenterLeaderboardImages/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v2-gamecenterleaderboardimages-_id_}
   */
  async getGameCenterLeaderboardImagesV2(
    resourceId: string,
    query?: operations['gameCenterLeaderboardImagesV2_getInstance']['parameters']['query'],
  ): Promise<
    operations['gameCenterLeaderboardImagesV2_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v2/gameCenterLeaderboardImages/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v2/gameCenterLeaderboardImages/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v2-gamecenterleaderboardimages-_id_}
   */
  async updateGameCenterLeaderboardImagesV2(
    resourceId: string,
    document: operations['gameCenterLeaderboardImagesV2_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['gameCenterLeaderboardImagesV2_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v2/gameCenterLeaderboardImages/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v2/gameCenterLeaderboardImages/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v2-gamecenterleaderboardimages-_id_}
   */
  async deleteGameCenterLeaderboardImagesV2(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v2/gameCenterLeaderboardImages/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * POST /v1/gameCenterLeaderboardLocalizations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-gamecenterleaderboardlocalizations}
   */
  async createGameCenterLeaderboardLocalizations(
    document: operations['gameCenterLeaderboardLocalizations_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['gameCenterLeaderboardLocalizations_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterLeaderboardLocalizations', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/gameCenterLeaderboardLocalizations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterleaderboardlocalizations-_id_}
   */
  async getGameCenterLeaderboardLocalizations(
    resourceId: string,
    query?: operations['gameCenterLeaderboardLocalizations_getInstance']['parameters']['query'],
  ): Promise<
    operations['gameCenterLeaderboardLocalizations_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterLeaderboardLocalizations/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/gameCenterLeaderboardLocalizations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-gamecenterleaderboardlocalizations-_id_}
   */
  async updateGameCenterLeaderboardLocalizations(
    resourceId: string,
    document: operations['gameCenterLeaderboardLocalizations_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['gameCenterLeaderboardLocalizations_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterLeaderboardLocalizations/{id}',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v1/gameCenterLeaderboardLocalizations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-gamecenterleaderboardlocalizations-_id_}
   */
  async deleteGameCenterLeaderboardLocalizations(resourceId: string): Promise<void> {
    const url = appleRequestUrl(
      '/v1/gameCenterLeaderboardLocalizations/{id}',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * POST /v2/gameCenterLeaderboardLocalizations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v2-gamecenterleaderboardlocalizations}
   */
  async createGameCenterLeaderboardLocalizationsV2(
    document: operations['gameCenterLeaderboardLocalizationsV2_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['gameCenterLeaderboardLocalizationsV2_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v2/gameCenterLeaderboardLocalizations', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v2/gameCenterLeaderboardLocalizations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v2-gamecenterleaderboardlocalizations-_id_}
   */
  async getGameCenterLeaderboardLocalizationsV2(
    resourceId: string,
    query?: operations['gameCenterLeaderboardLocalizationsV2_getInstance']['parameters']['query'],
  ): Promise<
    operations['gameCenterLeaderboardLocalizationsV2_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v2/gameCenterLeaderboardLocalizations/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v2/gameCenterLeaderboardLocalizations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v2-gamecenterleaderboardlocalizations-_id_}
   */
  async updateGameCenterLeaderboardLocalizationsV2(
    resourceId: string,
    document: operations['gameCenterLeaderboardLocalizationsV2_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['gameCenterLeaderboardLocalizationsV2_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v2/gameCenterLeaderboardLocalizations/{id}',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v2/gameCenterLeaderboardLocalizations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v2-gamecenterleaderboardlocalizations-_id_}
   */
  async deleteGameCenterLeaderboardLocalizationsV2(resourceId: string): Promise<void> {
    const url = appleRequestUrl(
      '/v2/gameCenterLeaderboardLocalizations/{id}',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * POST /v1/gameCenterLeaderboardReleases
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-gamecenterleaderboardreleases}
   */
  async createGameCenterLeaderboardReleases(
    document: operations['gameCenterLeaderboardReleases_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['gameCenterLeaderboardReleases_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterLeaderboardReleases', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/gameCenterLeaderboardReleases/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterleaderboardreleases-_id_}
   */
  async getGameCenterLeaderboardReleases(
    resourceId: string,
    query?: operations['gameCenterLeaderboardReleases_getInstance']['parameters']['query'],
  ): Promise<
    operations['gameCenterLeaderboardReleases_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterLeaderboardReleases/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * DELETE /v1/gameCenterLeaderboardReleases/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-gamecenterleaderboardreleases-_id_}
   */
  async deleteGameCenterLeaderboardReleases(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/gameCenterLeaderboardReleases/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * POST /v1/gameCenterLeaderboardSetImages
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-gamecenterleaderboardsetimages}
   */
  async createGameCenterLeaderboardSetImages(
    document: operations['gameCenterLeaderboardSetImages_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['gameCenterLeaderboardSetImages_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterLeaderboardSetImages', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/gameCenterLeaderboardSetImages/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterleaderboardsetimages-_id_}
   */
  async getGameCenterLeaderboardSetImages(
    resourceId: string,
    query?: operations['gameCenterLeaderboardSetImages_getInstance']['parameters']['query'],
  ): Promise<
    operations['gameCenterLeaderboardSetImages_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterLeaderboardSetImages/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/gameCenterLeaderboardSetImages/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-gamecenterleaderboardsetimages-_id_}
   */
  async updateGameCenterLeaderboardSetImages(
    resourceId: string,
    document: operations['gameCenterLeaderboardSetImages_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['gameCenterLeaderboardSetImages_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterLeaderboardSetImages/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v1/gameCenterLeaderboardSetImages/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-gamecenterleaderboardsetimages-_id_}
   */
  async deleteGameCenterLeaderboardSetImages(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/gameCenterLeaderboardSetImages/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * POST /v2/gameCenterLeaderboardSetImages
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v2-gamecenterleaderboardsetimages}
   */
  async createGameCenterLeaderboardSetImagesV2(
    document: operations['gameCenterLeaderboardSetImagesV2_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['gameCenterLeaderboardSetImagesV2_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v2/gameCenterLeaderboardSetImages', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v2/gameCenterLeaderboardSetImages/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v2-gamecenterleaderboardsetimages-_id_}
   */
  async getGameCenterLeaderboardSetImagesV2(
    resourceId: string,
    query?: operations['gameCenterLeaderboardSetImagesV2_getInstance']['parameters']['query'],
  ): Promise<
    operations['gameCenterLeaderboardSetImagesV2_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v2/gameCenterLeaderboardSetImages/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v2/gameCenterLeaderboardSetImages/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v2-gamecenterleaderboardsetimages-_id_}
   */
  async updateGameCenterLeaderboardSetImagesV2(
    resourceId: string,
    document: operations['gameCenterLeaderboardSetImagesV2_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['gameCenterLeaderboardSetImagesV2_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v2/gameCenterLeaderboardSetImages/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v2/gameCenterLeaderboardSetImages/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v2-gamecenterleaderboardsetimages-_id_}
   */
  async deleteGameCenterLeaderboardSetImagesV2(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v2/gameCenterLeaderboardSetImages/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * POST /v1/gameCenterLeaderboardSetLocalizations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-gamecenterleaderboardsetlocalizations}
   */
  async createGameCenterLeaderboardSetLocalizations(
    document: operations['gameCenterLeaderboardSetLocalizations_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['gameCenterLeaderboardSetLocalizations_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterLeaderboardSetLocalizations', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/gameCenterLeaderboardSetLocalizations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterleaderboardsetlocalizations-_id_}
   */
  async getGameCenterLeaderboardSetLocalizations(
    resourceId: string,
    query?: operations['gameCenterLeaderboardSetLocalizations_getInstance']['parameters']['query'],
  ): Promise<
    operations['gameCenterLeaderboardSetLocalizations_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterLeaderboardSetLocalizations/{id}',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/gameCenterLeaderboardSetLocalizations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-gamecenterleaderboardsetlocalizations-_id_}
   */
  async updateGameCenterLeaderboardSetLocalizations(
    resourceId: string,
    document: operations['gameCenterLeaderboardSetLocalizations_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['gameCenterLeaderboardSetLocalizations_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterLeaderboardSetLocalizations/{id}',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v1/gameCenterLeaderboardSetLocalizations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-gamecenterleaderboardsetlocalizations-_id_}
   */
  async deleteGameCenterLeaderboardSetLocalizations(resourceId: string): Promise<void> {
    const url = appleRequestUrl(
      '/v1/gameCenterLeaderboardSetLocalizations/{id}',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * POST /v2/gameCenterLeaderboardSetLocalizations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v2-gamecenterleaderboardsetlocalizations}
   */
  async createGameCenterLeaderboardSetLocalizationsV2(
    document: operations['gameCenterLeaderboardSetLocalizationsV2_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['gameCenterLeaderboardSetLocalizationsV2_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v2/gameCenterLeaderboardSetLocalizations', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v2/gameCenterLeaderboardSetLocalizations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v2-gamecenterleaderboardsetlocalizations-_id_}
   */
  async getGameCenterLeaderboardSetLocalizationsV2(
    resourceId: string,
    query?: operations['gameCenterLeaderboardSetLocalizationsV2_getInstance']['parameters']['query'],
  ): Promise<
    operations['gameCenterLeaderboardSetLocalizationsV2_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v2/gameCenterLeaderboardSetLocalizations/{id}',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v2/gameCenterLeaderboardSetLocalizations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v2-gamecenterleaderboardsetlocalizations-_id_}
   */
  async updateGameCenterLeaderboardSetLocalizationsV2(
    resourceId: string,
    document: operations['gameCenterLeaderboardSetLocalizationsV2_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['gameCenterLeaderboardSetLocalizationsV2_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v2/gameCenterLeaderboardSetLocalizations/{id}',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v2/gameCenterLeaderboardSetLocalizations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v2-gamecenterleaderboardsetlocalizations-_id_}
   */
  async deleteGameCenterLeaderboardSetLocalizationsV2(resourceId: string): Promise<void> {
    const url = appleRequestUrl(
      '/v2/gameCenterLeaderboardSetLocalizations/{id}',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * GET /v1/gameCenterLeaderboardSetMemberLocalizations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterleaderboardsetmemberlocalizations}
   */
  async listGameCenterLeaderboardSetMemberLocalizations(
    query?: operations['gameCenterLeaderboardSetMemberLocalizations_getCollection']['parameters']['query'],
  ): Promise<
    operations['gameCenterLeaderboardSetMemberLocalizations_getCollection']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterLeaderboardSetMemberLocalizations',
      undefined,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * POST /v1/gameCenterLeaderboardSetMemberLocalizations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-gamecenterleaderboardsetmemberlocalizations}
   */
  async createGameCenterLeaderboardSetMemberLocalizations(
    document: operations['gameCenterLeaderboardSetMemberLocalizations_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['gameCenterLeaderboardSetMemberLocalizations_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterLeaderboardSetMemberLocalizations',
      undefined,
      undefined,
    );
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * PATCH /v1/gameCenterLeaderboardSetMemberLocalizations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-gamecenterleaderboardsetmemberlocalizations-_id_}
   */
  async updateGameCenterLeaderboardSetMemberLocalizations(
    resourceId: string,
    document: operations['gameCenterLeaderboardSetMemberLocalizations_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['gameCenterLeaderboardSetMemberLocalizations_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterLeaderboardSetMemberLocalizations/{id}',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v1/gameCenterLeaderboardSetMemberLocalizations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-gamecenterleaderboardsetmemberlocalizations-_id_}
   */
  async deleteGameCenterLeaderboardSetMemberLocalizations(resourceId: string): Promise<void> {
    const url = appleRequestUrl(
      '/v1/gameCenterLeaderboardSetMemberLocalizations/{id}',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * POST /v1/gameCenterLeaderboardSetReleases
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-gamecenterleaderboardsetreleases}
   */
  async createGameCenterLeaderboardSetReleases(
    document: operations['gameCenterLeaderboardSetReleases_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['gameCenterLeaderboardSetReleases_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterLeaderboardSetReleases', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/gameCenterLeaderboardSetReleases/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterleaderboardsetreleases-_id_}
   */
  async getGameCenterLeaderboardSetReleases(
    resourceId: string,
    query?: operations['gameCenterLeaderboardSetReleases_getInstance']['parameters']['query'],
  ): Promise<
    operations['gameCenterLeaderboardSetReleases_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterLeaderboardSetReleases/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * DELETE /v1/gameCenterLeaderboardSetReleases/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-gamecenterleaderboardsetreleases-_id_}
   */
  async deleteGameCenterLeaderboardSetReleases(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/gameCenterLeaderboardSetReleases/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * POST /v2/gameCenterLeaderboardSetVersions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v2-gamecenterleaderboardsetversions}
   */
  async createGameCenterLeaderboardSetVersionsV2(
    document: operations['gameCenterLeaderboardSetVersionsV2_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['gameCenterLeaderboardSetVersionsV2_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v2/gameCenterLeaderboardSetVersions', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v2/gameCenterLeaderboardSetVersions/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v2-gamecenterleaderboardsetversions-_id_}
   */
  async getGameCenterLeaderboardSetVersionsV2(
    resourceId: string,
    query?: operations['gameCenterLeaderboardSetVersionsV2_getInstance']['parameters']['query'],
  ): Promise<
    operations['gameCenterLeaderboardSetVersionsV2_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v2/gameCenterLeaderboardSetVersions/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * POST /v2/gameCenterLeaderboardSets
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v2-gamecenterleaderboardsets}
   */
  async createGameCenterLeaderboardSetsV2(
    document: operations['gameCenterLeaderboardSetsV2_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['gameCenterLeaderboardSetsV2_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v2/gameCenterLeaderboardSets', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v2/gameCenterLeaderboardSets/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v2-gamecenterleaderboardsets-_id_}
   */
  async getGameCenterLeaderboardSetsV2(
    resourceId: string,
    query?: operations['gameCenterLeaderboardSetsV2_getInstance']['parameters']['query'],
  ): Promise<
    operations['gameCenterLeaderboardSetsV2_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v2/gameCenterLeaderboardSets/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v2/gameCenterLeaderboardSets/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v2-gamecenterleaderboardsets-_id_}
   */
  async updateGameCenterLeaderboardSetsV2(
    resourceId: string,
    document: operations['gameCenterLeaderboardSetsV2_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['gameCenterLeaderboardSetsV2_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v2/gameCenterLeaderboardSets/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v2/gameCenterLeaderboardSets/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v2-gamecenterleaderboardsets-_id_}
   */
  async deleteGameCenterLeaderboardSetsV2(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v2/gameCenterLeaderboardSets/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * POST /v1/gameCenterLeaderboardSets
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-gamecenterleaderboardsets}
   */
  async createGameCenterLeaderboardSets(
    document: operations['gameCenterLeaderboardSets_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['gameCenterLeaderboardSets_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterLeaderboardSets', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/gameCenterLeaderboardSets/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterleaderboardsets-_id_}
   */
  async getGameCenterLeaderboardSets(
    resourceId: string,
    query?: operations['gameCenterLeaderboardSets_getInstance']['parameters']['query'],
  ): Promise<
    operations['gameCenterLeaderboardSets_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterLeaderboardSets/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/gameCenterLeaderboardSets/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-gamecenterleaderboardsets-_id_}
   */
  async updateGameCenterLeaderboardSets(
    resourceId: string,
    document: operations['gameCenterLeaderboardSets_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['gameCenterLeaderboardSets_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterLeaderboardSets/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v1/gameCenterLeaderboardSets/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-gamecenterleaderboardsets-_id_}
   */
  async deleteGameCenterLeaderboardSets(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/gameCenterLeaderboardSets/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * POST /v2/gameCenterLeaderboardVersions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v2-gamecenterleaderboardversions}
   */
  async createGameCenterLeaderboardVersionsV2(
    document: operations['gameCenterLeaderboardVersionsV2_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['gameCenterLeaderboardVersionsV2_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v2/gameCenterLeaderboardVersions', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v2/gameCenterLeaderboardVersions/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v2-gamecenterleaderboardversions-_id_}
   */
  async getGameCenterLeaderboardVersionsV2(
    resourceId: string,
    query?: operations['gameCenterLeaderboardVersionsV2_getInstance']['parameters']['query'],
  ): Promise<
    operations['gameCenterLeaderboardVersionsV2_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v2/gameCenterLeaderboardVersions/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * POST /v1/gameCenterLeaderboards
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-gamecenterleaderboards}
   */
  async createGameCenterLeaderboards(
    document: operations['gameCenterLeaderboards_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['gameCenterLeaderboards_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterLeaderboards', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/gameCenterLeaderboards/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterleaderboards-_id_}
   */
  async getGameCenterLeaderboards(
    resourceId: string,
    query?: operations['gameCenterLeaderboards_getInstance']['parameters']['query'],
  ): Promise<
    operations['gameCenterLeaderboards_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterLeaderboards/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/gameCenterLeaderboards/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-gamecenterleaderboards-_id_}
   */
  async updateGameCenterLeaderboards(
    resourceId: string,
    document: operations['gameCenterLeaderboards_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['gameCenterLeaderboards_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterLeaderboards/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v1/gameCenterLeaderboards/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-gamecenterleaderboards-_id_}
   */
  async deleteGameCenterLeaderboards(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/gameCenterLeaderboards/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * POST /v2/gameCenterLeaderboards
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v2-gamecenterleaderboards}
   */
  async createGameCenterLeaderboardsV2(
    document: operations['gameCenterLeaderboardsV2_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['gameCenterLeaderboardsV2_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v2/gameCenterLeaderboards', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v2/gameCenterLeaderboards/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v2-gamecenterleaderboards-_id_}
   */
  async getGameCenterLeaderboardsV2(
    resourceId: string,
    query?: operations['gameCenterLeaderboardsV2_getInstance']['parameters']['query'],
  ): Promise<
    operations['gameCenterLeaderboardsV2_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v2/gameCenterLeaderboards/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v2/gameCenterLeaderboards/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v2-gamecenterleaderboards-_id_}
   */
  async updateGameCenterLeaderboardsV2(
    resourceId: string,
    document: operations['gameCenterLeaderboardsV2_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['gameCenterLeaderboardsV2_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v2/gameCenterLeaderboards/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v2/gameCenterLeaderboards/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v2-gamecenterleaderboards-_id_}
   */
  async deleteGameCenterLeaderboardsV2(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v2/gameCenterLeaderboards/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * GET /v1/gameCenterMatchmakingQueues
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecentermatchmakingqueues}
   */
  async listGameCenterMatchmakingQueues(
    query?: operations['gameCenterMatchmakingQueues_getCollection']['parameters']['query'],
  ): Promise<
    operations['gameCenterMatchmakingQueues_getCollection']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterMatchmakingQueues', undefined, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * POST /v1/gameCenterMatchmakingQueues
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-gamecentermatchmakingqueues}
   */
  async createGameCenterMatchmakingQueues(
    document: operations['gameCenterMatchmakingQueues_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['gameCenterMatchmakingQueues_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterMatchmakingQueues', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/gameCenterMatchmakingQueues/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecentermatchmakingqueues-_id_}
   */
  async getGameCenterMatchmakingQueues(
    resourceId: string,
    query?: operations['gameCenterMatchmakingQueues_getInstance']['parameters']['query'],
  ): Promise<
    operations['gameCenterMatchmakingQueues_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterMatchmakingQueues/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/gameCenterMatchmakingQueues/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-gamecentermatchmakingqueues-_id_}
   */
  async updateGameCenterMatchmakingQueues(
    resourceId: string,
    document: operations['gameCenterMatchmakingQueues_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['gameCenterMatchmakingQueues_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterMatchmakingQueues/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v1/gameCenterMatchmakingQueues/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-gamecentermatchmakingqueues-_id_}
   */
  async deleteGameCenterMatchmakingQueues(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/gameCenterMatchmakingQueues/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * POST /v1/gameCenterMatchmakingRuleSetTests
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-gamecentermatchmakingrulesettests}
   */
  async createGameCenterMatchmakingRuleSetTests(
    document: operations['gameCenterMatchmakingRuleSetTests_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['gameCenterMatchmakingRuleSetTests_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterMatchmakingRuleSetTests', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/gameCenterMatchmakingRuleSets
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecentermatchmakingrulesets}
   */
  async listGameCenterMatchmakingRuleSets(
    query?: operations['gameCenterMatchmakingRuleSets_getCollection']['parameters']['query'],
  ): Promise<
    operations['gameCenterMatchmakingRuleSets_getCollection']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterMatchmakingRuleSets', undefined, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * POST /v1/gameCenterMatchmakingRuleSets
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-gamecentermatchmakingrulesets}
   */
  async createGameCenterMatchmakingRuleSets(
    document: operations['gameCenterMatchmakingRuleSets_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['gameCenterMatchmakingRuleSets_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterMatchmakingRuleSets', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/gameCenterMatchmakingRuleSets/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecentermatchmakingrulesets-_id_}
   */
  async getGameCenterMatchmakingRuleSets(
    resourceId: string,
    query?: operations['gameCenterMatchmakingRuleSets_getInstance']['parameters']['query'],
  ): Promise<
    operations['gameCenterMatchmakingRuleSets_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterMatchmakingRuleSets/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/gameCenterMatchmakingRuleSets/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-gamecentermatchmakingrulesets-_id_}
   */
  async updateGameCenterMatchmakingRuleSets(
    resourceId: string,
    document: operations['gameCenterMatchmakingRuleSets_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['gameCenterMatchmakingRuleSets_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterMatchmakingRuleSets/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v1/gameCenterMatchmakingRuleSets/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-gamecentermatchmakingrulesets-_id_}
   */
  async deleteGameCenterMatchmakingRuleSets(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/gameCenterMatchmakingRuleSets/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * POST /v1/gameCenterMatchmakingRules
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-gamecentermatchmakingrules}
   */
  async createGameCenterMatchmakingRules(
    document: operations['gameCenterMatchmakingRules_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['gameCenterMatchmakingRules_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterMatchmakingRules', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * PATCH /v1/gameCenterMatchmakingRules/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-gamecentermatchmakingrules-_id_}
   */
  async updateGameCenterMatchmakingRules(
    resourceId: string,
    document: operations['gameCenterMatchmakingRules_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['gameCenterMatchmakingRules_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterMatchmakingRules/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v1/gameCenterMatchmakingRules/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-gamecentermatchmakingrules-_id_}
   */
  async deleteGameCenterMatchmakingRules(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/gameCenterMatchmakingRules/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * POST /v1/gameCenterMatchmakingTeams
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-gamecentermatchmakingteams}
   */
  async createGameCenterMatchmakingTeams(
    document: operations['gameCenterMatchmakingTeams_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['gameCenterMatchmakingTeams_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterMatchmakingTeams', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * PATCH /v1/gameCenterMatchmakingTeams/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-gamecentermatchmakingteams-_id_}
   */
  async updateGameCenterMatchmakingTeams(
    resourceId: string,
    document: operations['gameCenterMatchmakingTeams_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['gameCenterMatchmakingTeams_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterMatchmakingTeams/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v1/gameCenterMatchmakingTeams/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-gamecentermatchmakingteams-_id_}
   */
  async deleteGameCenterMatchmakingTeams(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/gameCenterMatchmakingTeams/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * POST /v1/gameCenterPlayerAchievementSubmissions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-gamecenterplayerachievementsubmissions}
   */
  async createGameCenterPlayerAchievementSubmissions(
    document: operations['gameCenterPlayerAchievementSubmissions_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['gameCenterPlayerAchievementSubmissions_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterPlayerAchievementSubmissions', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * PATCH /v1/gameCenterScoreModerations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-gamecenterscoremoderations-_id_}
   */
  async updateGameCenterScoreModerations(
    resourceId: string,
    document: operations['gameCenterScoreModerations_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['gameCenterScoreModerations_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterScoreModerations/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * POST /v1/inAppPurchaseAppStoreReviewScreenshots
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-inapppurchaseappstorereviewscreenshots}
   */
  async createInAppPurchaseAppStoreReviewScreenshots(
    document: operations['inAppPurchaseAppStoreReviewScreenshots_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['inAppPurchaseAppStoreReviewScreenshots_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/inAppPurchaseAppStoreReviewScreenshots', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/inAppPurchaseAppStoreReviewScreenshots/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-inapppurchaseappstorereviewscreenshots-_id_}
   */
  async getInAppPurchaseAppStoreReviewScreenshots(
    resourceId: string,
    query?: operations['inAppPurchaseAppStoreReviewScreenshots_getInstance']['parameters']['query'],
  ): Promise<
    operations['inAppPurchaseAppStoreReviewScreenshots_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/inAppPurchaseAppStoreReviewScreenshots/{id}',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/inAppPurchaseAppStoreReviewScreenshots/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-inapppurchaseappstorereviewscreenshots-_id_}
   */
  async updateInAppPurchaseAppStoreReviewScreenshots(
    resourceId: string,
    document: operations['inAppPurchaseAppStoreReviewScreenshots_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['inAppPurchaseAppStoreReviewScreenshots_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/inAppPurchaseAppStoreReviewScreenshots/{id}',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v1/inAppPurchaseAppStoreReviewScreenshots/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-inapppurchaseappstorereviewscreenshots-_id_}
   */
  async deleteInAppPurchaseAppStoreReviewScreenshots(resourceId: string): Promise<void> {
    const url = appleRequestUrl(
      '/v1/inAppPurchaseAppStoreReviewScreenshots/{id}',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * POST /v1/inAppPurchaseAvailabilities
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-inapppurchaseavailabilities}
   */
  async createInAppPurchaseAvailabilities(
    document: operations['inAppPurchaseAvailabilities_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['inAppPurchaseAvailabilities_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/inAppPurchaseAvailabilities', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/inAppPurchaseAvailabilities/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-inapppurchaseavailabilities-_id_}
   */
  async getInAppPurchaseAvailabilities(
    resourceId: string,
    query?: operations['inAppPurchaseAvailabilities_getInstance']['parameters']['query'],
  ): Promise<
    operations['inAppPurchaseAvailabilities_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/inAppPurchaseAvailabilities/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/inAppPurchaseContents/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-inapppurchasecontents-_id_}
   */
  async getInAppPurchaseContents(
    resourceId: string,
    query?: operations['inAppPurchaseContents_getInstance']['parameters']['query'],
  ): Promise<
    operations['inAppPurchaseContents_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/inAppPurchaseContents/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * POST /v1/inAppPurchaseImages
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-inapppurchaseimages}
   */
  async createInAppPurchaseImages(
    document: operations['inAppPurchaseImages_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['inAppPurchaseImages_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/inAppPurchaseImages', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/inAppPurchaseImages/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-inapppurchaseimages-_id_}
   */
  async getInAppPurchaseImages(
    resourceId: string,
    query?: operations['inAppPurchaseImages_getInstance']['parameters']['query'],
  ): Promise<
    operations['inAppPurchaseImages_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/inAppPurchaseImages/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/inAppPurchaseImages/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-inapppurchaseimages-_id_}
   */
  async updateInAppPurchaseImages(
    resourceId: string,
    document: operations['inAppPurchaseImages_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['inAppPurchaseImages_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/inAppPurchaseImages/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v1/inAppPurchaseImages/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-inapppurchaseimages-_id_}
   */
  async deleteInAppPurchaseImages(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/inAppPurchaseImages/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * POST /v2/inAppPurchaseImages
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v2-inapppurchaseimages}
   */
  async createInAppPurchaseImagesV2(
    document: operations['inAppPurchaseImagesV2_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['inAppPurchaseImagesV2_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v2/inAppPurchaseImages', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v2/inAppPurchaseImages/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v2-inapppurchaseimages-_id_}
   */
  async getInAppPurchaseImagesV2(
    resourceId: string,
    query?: operations['inAppPurchaseImagesV2_getInstance']['parameters']['query'],
  ): Promise<
    operations['inAppPurchaseImagesV2_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v2/inAppPurchaseImages/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v2/inAppPurchaseImages/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v2-inapppurchaseimages-_id_}
   */
  async updateInAppPurchaseImagesV2(
    resourceId: string,
    document: operations['inAppPurchaseImagesV2_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['inAppPurchaseImagesV2_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v2/inAppPurchaseImages/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v2/inAppPurchaseImages/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v2-inapppurchaseimages-_id_}
   */
  async deleteInAppPurchaseImagesV2(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v2/inAppPurchaseImages/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * POST /v1/inAppPurchaseLocalizations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-inapppurchaselocalizations}
   */
  async createInAppPurchaseLocalizations(
    document: operations['inAppPurchaseLocalizations_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['inAppPurchaseLocalizations_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/inAppPurchaseLocalizations', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/inAppPurchaseLocalizations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-inapppurchaselocalizations-_id_}
   */
  async getInAppPurchaseLocalizations(
    resourceId: string,
    query?: operations['inAppPurchaseLocalizations_getInstance']['parameters']['query'],
  ): Promise<
    operations['inAppPurchaseLocalizations_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/inAppPurchaseLocalizations/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/inAppPurchaseLocalizations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-inapppurchaselocalizations-_id_}
   */
  async updateInAppPurchaseLocalizations(
    resourceId: string,
    document: operations['inAppPurchaseLocalizations_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['inAppPurchaseLocalizations_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/inAppPurchaseLocalizations/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v1/inAppPurchaseLocalizations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-inapppurchaselocalizations-_id_}
   */
  async deleteInAppPurchaseLocalizations(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/inAppPurchaseLocalizations/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * POST /v2/inAppPurchaseLocalizations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v2-inapppurchaselocalizations}
   */
  async createInAppPurchaseLocalizationsV2(
    document: operations['inAppPurchaseLocalizationsV2_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['inAppPurchaseLocalizationsV2_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v2/inAppPurchaseLocalizations', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v2/inAppPurchaseLocalizations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v2-inapppurchaselocalizations-_id_}
   */
  async getInAppPurchaseLocalizationsV2(
    resourceId: string,
    query?: operations['inAppPurchaseLocalizationsV2_getInstance']['parameters']['query'],
  ): Promise<
    operations['inAppPurchaseLocalizationsV2_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v2/inAppPurchaseLocalizations/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v2/inAppPurchaseLocalizations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v2-inapppurchaselocalizations-_id_}
   */
  async updateInAppPurchaseLocalizationsV2(
    resourceId: string,
    document: operations['inAppPurchaseLocalizationsV2_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['inAppPurchaseLocalizationsV2_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v2/inAppPurchaseLocalizations/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v2/inAppPurchaseLocalizations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v2-inapppurchaselocalizations-_id_}
   */
  async deleteInAppPurchaseLocalizationsV2(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v2/inAppPurchaseLocalizations/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * POST /v1/inAppPurchaseOfferCodeCustomCodes
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-inapppurchaseoffercodecustomcodes}
   */
  async createInAppPurchaseOfferCodeCustomCodes(
    document: operations['inAppPurchaseOfferCodeCustomCodes_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['inAppPurchaseOfferCodeCustomCodes_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/inAppPurchaseOfferCodeCustomCodes', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/inAppPurchaseOfferCodeCustomCodes/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-inapppurchaseoffercodecustomcodes-_id_}
   */
  async getInAppPurchaseOfferCodeCustomCodes(
    resourceId: string,
    query?: operations['inAppPurchaseOfferCodeCustomCodes_getInstance']['parameters']['query'],
  ): Promise<
    operations['inAppPurchaseOfferCodeCustomCodes_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/inAppPurchaseOfferCodeCustomCodes/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/inAppPurchaseOfferCodeCustomCodes/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-inapppurchaseoffercodecustomcodes-_id_}
   */
  async updateInAppPurchaseOfferCodeCustomCodes(
    resourceId: string,
    document: operations['inAppPurchaseOfferCodeCustomCodes_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['inAppPurchaseOfferCodeCustomCodes_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/inAppPurchaseOfferCodeCustomCodes/{id}',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * POST /v1/inAppPurchaseOfferCodeOneTimeUseCodes
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-inapppurchaseoffercodeonetimeusecodes}
   */
  async createInAppPurchaseOfferCodeOneTimeUseCodes(
    document: operations['inAppPurchaseOfferCodeOneTimeUseCodes_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['inAppPurchaseOfferCodeOneTimeUseCodes_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/inAppPurchaseOfferCodeOneTimeUseCodes', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/inAppPurchaseOfferCodeOneTimeUseCodes/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-inapppurchaseoffercodeonetimeusecodes-_id_}
   */
  async getInAppPurchaseOfferCodeOneTimeUseCodes(
    resourceId: string,
    query?: operations['inAppPurchaseOfferCodeOneTimeUseCodes_getInstance']['parameters']['query'],
  ): Promise<
    operations['inAppPurchaseOfferCodeOneTimeUseCodes_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/inAppPurchaseOfferCodeOneTimeUseCodes/{id}',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/inAppPurchaseOfferCodeOneTimeUseCodes/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-inapppurchaseoffercodeonetimeusecodes-_id_}
   */
  async updateInAppPurchaseOfferCodeOneTimeUseCodes(
    resourceId: string,
    document: operations['inAppPurchaseOfferCodeOneTimeUseCodes_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['inAppPurchaseOfferCodeOneTimeUseCodes_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/inAppPurchaseOfferCodeOneTimeUseCodes/{id}',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * POST /v1/inAppPurchaseOfferCodes
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-inapppurchaseoffercodes}
   */
  async createInAppPurchaseOfferCodes(
    document: operations['inAppPurchaseOfferCodes_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['inAppPurchaseOfferCodes_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/inAppPurchaseOfferCodes', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/inAppPurchaseOfferCodes/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-inapppurchaseoffercodes-_id_}
   */
  async getInAppPurchaseOfferCodes(
    resourceId: string,
    query?: operations['inAppPurchaseOfferCodes_getInstance']['parameters']['query'],
  ): Promise<
    operations['inAppPurchaseOfferCodes_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/inAppPurchaseOfferCodes/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/inAppPurchaseOfferCodes/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-inapppurchaseoffercodes-_id_}
   */
  async updateInAppPurchaseOfferCodes(
    resourceId: string,
    document: operations['inAppPurchaseOfferCodes_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['inAppPurchaseOfferCodes_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/inAppPurchaseOfferCodes/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * POST /v1/inAppPurchasePriceSchedules
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-inapppurchasepriceschedules}
   */
  async createInAppPurchasePriceSchedules(
    document: operations['inAppPurchasePriceSchedules_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['inAppPurchasePriceSchedules_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/inAppPurchasePriceSchedules', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/inAppPurchasePriceSchedules/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-inapppurchasepriceschedules-_id_}
   */
  async getInAppPurchasePriceSchedules(
    resourceId: string,
    query?: operations['inAppPurchasePriceSchedules_getInstance']['parameters']['query'],
  ): Promise<
    operations['inAppPurchasePriceSchedules_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/inAppPurchasePriceSchedules/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * POST /v1/inAppPurchaseSubmissions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-inapppurchasesubmissions}
   */
  async createInAppPurchaseSubmissions(
    document: operations['inAppPurchaseSubmissions_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['inAppPurchaseSubmissions_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/inAppPurchaseSubmissions', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * POST /v1/inAppPurchaseVersions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-inapppurchaseversions}
   */
  async createInAppPurchaseVersions(
    document: operations['inAppPurchaseVersions_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['inAppPurchaseVersions_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/inAppPurchaseVersions', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/inAppPurchaseVersions/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-inapppurchaseversions-_id_}
   */
  async getInAppPurchaseVersions(
    resourceId: string,
    query?: operations['inAppPurchaseVersions_getInstance']['parameters']['query'],
  ): Promise<
    operations['inAppPurchaseVersions_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/inAppPurchaseVersions/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/inAppPurchases/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-inapppurchases-_id_}
   */
  async getInAppPurchases(
    resourceId: string,
    query?: operations['inAppPurchases_getInstance']['parameters']['query'],
  ): Promise<
    operations['inAppPurchases_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/inAppPurchases/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * POST /v2/inAppPurchases
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v2-inapppurchases}
   */
  async createInAppPurchasesV2(
    document: operations['inAppPurchasesV2_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['inAppPurchasesV2_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v2/inAppPurchases', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v2/inAppPurchases/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v2-inapppurchases-_id_}
   */
  async getInAppPurchasesV2(
    resourceId: string,
    query?: operations['inAppPurchasesV2_getInstance']['parameters']['query'],
  ): Promise<
    operations['inAppPurchasesV2_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v2/inAppPurchases/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v2/inAppPurchases/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v2-inapppurchases-_id_}
   */
  async updateInAppPurchasesV2(
    resourceId: string,
    document: operations['inAppPurchasesV2_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['inAppPurchasesV2_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v2/inAppPurchases/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v2/inAppPurchases/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v2-inapppurchases-_id_}
   */
  async deleteInAppPurchasesV2(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v2/inAppPurchases/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * POST /v1/marketplaceSearchDetails
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-marketplacesearchdetails}
   */
  async createMarketplaceSearchDetails(
    document: operations['marketplaceSearchDetails_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['marketplaceSearchDetails_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/marketplaceSearchDetails', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * PATCH /v1/marketplaceSearchDetails/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-marketplacesearchdetails-_id_}
   */
  async updateMarketplaceSearchDetails(
    resourceId: string,
    document: operations['marketplaceSearchDetails_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['marketplaceSearchDetails_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/marketplaceSearchDetails/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v1/marketplaceSearchDetails/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-marketplacesearchdetails-_id_}
   */
  async deleteMarketplaceSearchDetails(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/marketplaceSearchDetails/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * GET /v1/marketplaceWebhooks
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-marketplacewebhooks}
   */
  async listMarketplaceWebhooks(
    query?: operations['marketplaceWebhooks_getCollection']['parameters']['query'],
  ): Promise<
    operations['marketplaceWebhooks_getCollection']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/marketplaceWebhooks', undefined, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * POST /v1/marketplaceWebhooks
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-marketplacewebhooks}
   */
  async createMarketplaceWebhooks(
    document: operations['marketplaceWebhooks_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['marketplaceWebhooks_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/marketplaceWebhooks', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * PATCH /v1/marketplaceWebhooks/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-marketplacewebhooks-_id_}
   */
  async updateMarketplaceWebhooks(
    resourceId: string,
    document: operations['marketplaceWebhooks_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['marketplaceWebhooks_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/marketplaceWebhooks/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v1/marketplaceWebhooks/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-marketplacewebhooks-_id_}
   */
  async deleteMarketplaceWebhooks(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/marketplaceWebhooks/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * GET /v1/merchantIds
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-merchantids}
   */
  async listMerchantIds(
    query?: operations['merchantIds_getCollection']['parameters']['query'],
  ): Promise<
    operations['merchantIds_getCollection']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/merchantIds', undefined, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * POST /v1/merchantIds
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-merchantids}
   */
  async createMerchantIds(
    document: operations['merchantIds_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['merchantIds_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/merchantIds', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/merchantIds/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-merchantids-_id_}
   */
  async getMerchantIds(
    resourceId: string,
    query?: operations['merchantIds_getInstance']['parameters']['query'],
  ): Promise<
    operations['merchantIds_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/merchantIds/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/merchantIds/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-merchantids-_id_}
   */
  async updateMerchantIds(
    resourceId: string,
    document: operations['merchantIds_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['merchantIds_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/merchantIds/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v1/merchantIds/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-merchantids-_id_}
   */
  async deleteMerchantIds(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/merchantIds/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * GET /v1/nominations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-nominations}
   */
  async listNominations(
    query?: operations['nominations_getCollection']['parameters']['query'],
  ): Promise<
    operations['nominations_getCollection']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/nominations', undefined, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * POST /v1/nominations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-nominations}
   */
  async createNominations(
    document: operations['nominations_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['nominations_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/nominations', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/nominations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-nominations-_id_}
   */
  async getNominations(
    resourceId: string,
    query?: operations['nominations_getInstance']['parameters']['query'],
  ): Promise<
    operations['nominations_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/nominations/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/nominations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-nominations-_id_}
   */
  async updateNominations(
    resourceId: string,
    document: operations['nominations_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['nominations_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/nominations/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v1/nominations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-nominations-_id_}
   */
  async deleteNominations(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/nominations/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * GET /v1/passTypeIds
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-passtypeids}
   */
  async listPassTypeIds(
    query?: operations['passTypeIds_getCollection']['parameters']['query'],
  ): Promise<
    operations['passTypeIds_getCollection']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/passTypeIds', undefined, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * POST /v1/passTypeIds
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-passtypeids}
   */
  async createPassTypeIds(
    document: operations['passTypeIds_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['passTypeIds_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/passTypeIds', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/passTypeIds/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-passtypeids-_id_}
   */
  async getPassTypeIds(
    resourceId: string,
    query?: operations['passTypeIds_getInstance']['parameters']['query'],
  ): Promise<
    operations['passTypeIds_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/passTypeIds/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/passTypeIds/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-passtypeids-_id_}
   */
  async updatePassTypeIds(
    resourceId: string,
    document: operations['passTypeIds_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['passTypeIds_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/passTypeIds/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v1/passTypeIds/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-passtypeids-_id_}
   */
  async deletePassTypeIds(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/passTypeIds/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * GET /v1/preReleaseVersions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-prereleaseversions}
   */
  async listPreReleaseVersions(
    query?: operations['preReleaseVersions_getCollection']['parameters']['query'],
  ): Promise<
    operations['preReleaseVersions_getCollection']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/preReleaseVersions', undefined, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/preReleaseVersions/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-prereleaseversions-_id_}
   */
  async getPreReleaseVersions(
    resourceId: string,
    query?: operations['preReleaseVersions_getInstance']['parameters']['query'],
  ): Promise<
    operations['preReleaseVersions_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/preReleaseVersions/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/profiles
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-profiles}
   */
  async listProfiles(
    query?: operations['profiles_getCollection']['parameters']['query'],
  ): Promise<
    operations['profiles_getCollection']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/profiles', undefined, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * POST /v1/profiles
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-profiles}
   */
  async createProfiles(
    document: operations['profiles_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['profiles_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/profiles', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/profiles/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-profiles-_id_}
   */
  async getProfiles(
    resourceId: string,
    query?: operations['profiles_getInstance']['parameters']['query'],
  ): Promise<operations['profiles_getInstance']['responses'][200]['content']['application/json']> {
    const url = appleRequestUrl('/v1/profiles/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * DELETE /v1/profiles/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-profiles-_id_}
   */
  async deleteProfiles(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/profiles/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * POST /v1/promotedPurchases
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-promotedpurchases}
   */
  async createPromotedPurchases(
    document: operations['promotedPurchases_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['promotedPurchases_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/promotedPurchases', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/promotedPurchases/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-promotedpurchases-_id_}
   */
  async getPromotedPurchases(
    resourceId: string,
    query?: operations['promotedPurchases_getInstance']['parameters']['query'],
  ): Promise<
    operations['promotedPurchases_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/promotedPurchases/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/promotedPurchases/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-promotedpurchases-_id_}
   */
  async updatePromotedPurchases(
    resourceId: string,
    document: operations['promotedPurchases_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['promotedPurchases_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/promotedPurchases/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v1/promotedPurchases/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-promotedpurchases-_id_}
   */
  async deletePromotedPurchases(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/promotedPurchases/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * POST /v1/retentionMessageLocalizations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-retentionmessagelocalizations}
   */
  async createRetentionMessageLocalizations(
    document: operations['retentionMessageLocalizations_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['retentionMessageLocalizations_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/retentionMessageLocalizations', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/retentionMessageLocalizations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-retentionmessagelocalizations-_id_}
   */
  async getRetentionMessageLocalizations(
    resourceId: string,
    query?: operations['retentionMessageLocalizations_getInstance']['parameters']['query'],
  ): Promise<
    operations['retentionMessageLocalizations_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/retentionMessageLocalizations/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/retentionMessageLocalizations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-retentionmessagelocalizations-_id_}
   */
  async updateRetentionMessageLocalizations(
    resourceId: string,
    document: operations['retentionMessageLocalizations_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['retentionMessageLocalizations_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/retentionMessageLocalizations/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v1/retentionMessageLocalizations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-retentionmessagelocalizations-_id_}
   */
  async deleteRetentionMessageLocalizations(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/retentionMessageLocalizations/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * POST /v1/retentionMessageVersions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-retentionmessageversions}
   */
  async createRetentionMessageVersions(
    document: operations['retentionMessageVersions_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['retentionMessageVersions_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/retentionMessageVersions', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/retentionMessageVersions/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-retentionmessageversions-_id_}
   */
  async getRetentionMessageVersions(
    resourceId: string,
    query?: operations['retentionMessageVersions_getInstance']['parameters']['query'],
  ): Promise<
    operations['retentionMessageVersions_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/retentionMessageVersions/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * POST /v1/retentionMessages
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-retentionmessages}
   */
  async createRetentionMessages(
    document: operations['retentionMessages_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['retentionMessages_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/retentionMessages', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/retentionMessages/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-retentionmessages-_id_}
   */
  async getRetentionMessages(
    resourceId: string,
    query?: operations['retentionMessages_getInstance']['parameters']['query'],
  ): Promise<
    operations['retentionMessages_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/retentionMessages/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * DELETE /v1/retentionMessages/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-retentionmessages-_id_}
   */
  async deleteRetentionMessages(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/retentionMessages/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * POST /v1/retentionOffers
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-retentionoffers}
   */
  async createRetentionOffers(
    document: operations['retentionOffers_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['retentionOffers_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/retentionOffers', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/retentionOffers/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-retentionoffers-_id_}
   */
  async getRetentionOffers(
    resourceId: string,
    query?: operations['retentionOffers_getInstance']['parameters']['query'],
  ): Promise<
    operations['retentionOffers_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/retentionOffers/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/retentionOffers/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-retentionoffers-_id_}
   */
  async updateRetentionOffers(
    resourceId: string,
    document: operations['retentionOffers_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['retentionOffers_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/retentionOffers/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v1/retentionOffers/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-retentionoffers-_id_}
   */
  async deleteRetentionOffers(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/retentionOffers/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * POST /v1/reviewSubmissionItems
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-reviewsubmissionitems}
   */
  async createReviewSubmissionItems(
    document: operations['reviewSubmissionItems_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['reviewSubmissionItems_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/reviewSubmissionItems', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * PATCH /v1/reviewSubmissionItems/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-reviewsubmissionitems-_id_}
   */
  async updateReviewSubmissionItems(
    resourceId: string,
    document: operations['reviewSubmissionItems_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['reviewSubmissionItems_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/reviewSubmissionItems/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v1/reviewSubmissionItems/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-reviewsubmissionitems-_id_}
   */
  async deleteReviewSubmissionItems(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/reviewSubmissionItems/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * GET /v1/reviewSubmissions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-reviewsubmissions}
   */
  async listReviewSubmissions(
    query?: operations['reviewSubmissions_getCollection']['parameters']['query'],
  ): Promise<
    operations['reviewSubmissions_getCollection']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/reviewSubmissions', undefined, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * POST /v1/reviewSubmissions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-reviewsubmissions}
   */
  async createReviewSubmissions(
    document: operations['reviewSubmissions_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['reviewSubmissions_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/reviewSubmissions', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/reviewSubmissions/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-reviewsubmissions-_id_}
   */
  async getReviewSubmissions(
    resourceId: string,
    query?: operations['reviewSubmissions_getInstance']['parameters']['query'],
  ): Promise<
    operations['reviewSubmissions_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/reviewSubmissions/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/reviewSubmissions/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-reviewsubmissions-_id_}
   */
  async updateReviewSubmissions(
    resourceId: string,
    document: operations['reviewSubmissions_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['reviewSubmissions_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/reviewSubmissions/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * POST /v1/routingAppCoverages
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-routingappcoverages}
   */
  async createRoutingAppCoverages(
    document: operations['routingAppCoverages_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['routingAppCoverages_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/routingAppCoverages', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/routingAppCoverages/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-routingappcoverages-_id_}
   */
  async getRoutingAppCoverages(
    resourceId: string,
    query?: operations['routingAppCoverages_getInstance']['parameters']['query'],
  ): Promise<
    operations['routingAppCoverages_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/routingAppCoverages/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/routingAppCoverages/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-routingappcoverages-_id_}
   */
  async updateRoutingAppCoverages(
    resourceId: string,
    document: operations['routingAppCoverages_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['routingAppCoverages_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/routingAppCoverages/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v1/routingAppCoverages/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-routingappcoverages-_id_}
   */
  async deleteRoutingAppCoverages(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/routingAppCoverages/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * GET /v1/salesReports
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-salesreports}
   */
  async listSalesReports(
    query?: operations['salesReports_getCollection']['parameters']['query'],
  ): Promise<Buffer> {
    const url = appleRequestUrl('/v1/salesReports', undefined, query);
    return this.apple.sendBytes('GET', url, 'application/a-gzip');
  }

  /**
   * GET /v2/sandboxTesters
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v2-sandboxtesters}
   */
  async listSandboxTestersV2(
    query?: operations['sandboxTestersV2_getCollection']['parameters']['query'],
  ): Promise<
    operations['sandboxTestersV2_getCollection']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v2/sandboxTesters', undefined, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v2/sandboxTesters/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v2-sandboxtesters-_id_}
   */
  async updateSandboxTestersV2(
    resourceId: string,
    document: operations['sandboxTestersV2_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['sandboxTestersV2_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v2/sandboxTesters/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * POST /v2/sandboxTestersClearPurchaseHistoryRequest
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v2-sandboxtestersclearpurchasehistoryrequest}
   */
  async createSandboxTestersClearPurchaseHistoryRequestV2(
    document: operations['sandboxTestersClearPurchaseHistoryRequestV2_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['sandboxTestersClearPurchaseHistoryRequestV2_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v2/sandboxTestersClearPurchaseHistoryRequest',
      undefined,
      undefined,
    );
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/scmGitReferences/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-scmgitreferences-_id_}
   */
  async getScmGitReferences(
    resourceId: string,
    query?: operations['scmGitReferences_getInstance']['parameters']['query'],
  ): Promise<
    operations['scmGitReferences_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/scmGitReferences/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/scmProviders
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-scmproviders}
   */
  async listScmProviders(
    query?: operations['scmProviders_getCollection']['parameters']['query'],
  ): Promise<
    operations['scmProviders_getCollection']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/scmProviders', undefined, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/scmProviders/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-scmproviders-_id_}
   */
  async getScmProviders(
    resourceId: string,
    query?: operations['scmProviders_getInstance']['parameters']['query'],
  ): Promise<
    operations['scmProviders_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/scmProviders/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/scmPullRequests/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-scmpullrequests-_id_}
   */
  async getScmPullRequests(
    resourceId: string,
    query?: operations['scmPullRequests_getInstance']['parameters']['query'],
  ): Promise<
    operations['scmPullRequests_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/scmPullRequests/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/scmRepositories
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-scmrepositories}
   */
  async listScmRepositories(
    query?: operations['scmRepositories_getCollection']['parameters']['query'],
  ): Promise<
    operations['scmRepositories_getCollection']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/scmRepositories', undefined, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/scmRepositories/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-scmrepositories-_id_}
   */
  async getScmRepositories(
    resourceId: string,
    query?: operations['scmRepositories_getInstance']['parameters']['query'],
  ): Promise<
    operations['scmRepositories_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/scmRepositories/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * POST /v1/subscriptionAppStoreReviewScreenshots
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-subscriptionappstorereviewscreenshots}
   */
  async createSubscriptionAppStoreReviewScreenshots(
    document: operations['subscriptionAppStoreReviewScreenshots_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['subscriptionAppStoreReviewScreenshots_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/subscriptionAppStoreReviewScreenshots', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/subscriptionAppStoreReviewScreenshots/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptionappstorereviewscreenshots-_id_}
   */
  async getSubscriptionAppStoreReviewScreenshots(
    resourceId: string,
    query?: operations['subscriptionAppStoreReviewScreenshots_getInstance']['parameters']['query'],
  ): Promise<
    operations['subscriptionAppStoreReviewScreenshots_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/subscriptionAppStoreReviewScreenshots/{id}',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/subscriptionAppStoreReviewScreenshots/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-subscriptionappstorereviewscreenshots-_id_}
   */
  async updateSubscriptionAppStoreReviewScreenshots(
    resourceId: string,
    document: operations['subscriptionAppStoreReviewScreenshots_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['subscriptionAppStoreReviewScreenshots_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/subscriptionAppStoreReviewScreenshots/{id}',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v1/subscriptionAppStoreReviewScreenshots/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-subscriptionappstorereviewscreenshots-_id_}
   */
  async deleteSubscriptionAppStoreReviewScreenshots(resourceId: string): Promise<void> {
    const url = appleRequestUrl(
      '/v1/subscriptionAppStoreReviewScreenshots/{id}',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * POST /v1/subscriptionAvailabilities
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-subscriptionavailabilities}
   */
  async createSubscriptionAvailabilities(
    document: operations['subscriptionAvailabilities_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['subscriptionAvailabilities_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/subscriptionAvailabilities', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/subscriptionAvailabilities/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptionavailabilities-_id_}
   */
  async getSubscriptionAvailabilities(
    resourceId: string,
    query?: operations['subscriptionAvailabilities_getInstance']['parameters']['query'],
  ): Promise<
    operations['subscriptionAvailabilities_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/subscriptionAvailabilities/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/subscriptionGracePeriods/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptiongraceperiods-_id_}
   */
  async getSubscriptionGracePeriods(
    resourceId: string,
    query?: operations['subscriptionGracePeriods_getInstance']['parameters']['query'],
  ): Promise<
    operations['subscriptionGracePeriods_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/subscriptionGracePeriods/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/subscriptionGracePeriods/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-subscriptiongraceperiods-_id_}
   */
  async updateSubscriptionGracePeriods(
    resourceId: string,
    document: operations['subscriptionGracePeriods_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['subscriptionGracePeriods_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/subscriptionGracePeriods/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * POST /v2/subscriptionGroupLocalizations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v2-subscriptiongrouplocalizations}
   */
  async createSubscriptionGroupLocalizationsV2(
    document: operations['subscriptionGroupLocalizationsV2_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['subscriptionGroupLocalizationsV2_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v2/subscriptionGroupLocalizations', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v2/subscriptionGroupLocalizations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v2-subscriptiongrouplocalizations-_id_}
   */
  async getSubscriptionGroupLocalizationsV2(
    resourceId: string,
    query?: operations['subscriptionGroupLocalizationsV2_getInstance']['parameters']['query'],
  ): Promise<
    operations['subscriptionGroupLocalizationsV2_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v2/subscriptionGroupLocalizations/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v2/subscriptionGroupLocalizations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v2-subscriptiongrouplocalizations-_id_}
   */
  async updateSubscriptionGroupLocalizationsV2(
    resourceId: string,
    document: operations['subscriptionGroupLocalizationsV2_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['subscriptionGroupLocalizationsV2_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v2/subscriptionGroupLocalizations/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v2/subscriptionGroupLocalizations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v2-subscriptiongrouplocalizations-_id_}
   */
  async deleteSubscriptionGroupLocalizationsV2(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v2/subscriptionGroupLocalizations/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * POST /v1/subscriptionGroupLocalizations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-subscriptiongrouplocalizations}
   */
  async createSubscriptionGroupLocalizations(
    document: operations['subscriptionGroupLocalizations_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['subscriptionGroupLocalizations_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/subscriptionGroupLocalizations', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/subscriptionGroupLocalizations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptiongrouplocalizations-_id_}
   */
  async getSubscriptionGroupLocalizations(
    resourceId: string,
    query?: operations['subscriptionGroupLocalizations_getInstance']['parameters']['query'],
  ): Promise<
    operations['subscriptionGroupLocalizations_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/subscriptionGroupLocalizations/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/subscriptionGroupLocalizations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-subscriptiongrouplocalizations-_id_}
   */
  async updateSubscriptionGroupLocalizations(
    resourceId: string,
    document: operations['subscriptionGroupLocalizations_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['subscriptionGroupLocalizations_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/subscriptionGroupLocalizations/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v1/subscriptionGroupLocalizations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-subscriptiongrouplocalizations-_id_}
   */
  async deleteSubscriptionGroupLocalizations(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/subscriptionGroupLocalizations/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * POST /v1/subscriptionGroupSubmissions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-subscriptiongroupsubmissions}
   */
  async createSubscriptionGroupSubmissions(
    document: operations['subscriptionGroupSubmissions_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['subscriptionGroupSubmissions_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/subscriptionGroupSubmissions', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * POST /v1/subscriptionGroupVersions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-subscriptiongroupversions}
   */
  async createSubscriptionGroupVersions(
    document: operations['subscriptionGroupVersions_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['subscriptionGroupVersions_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/subscriptionGroupVersions', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/subscriptionGroupVersions/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptiongroupversions-_id_}
   */
  async getSubscriptionGroupVersions(
    resourceId: string,
    query?: operations['subscriptionGroupVersions_getInstance']['parameters']['query'],
  ): Promise<
    operations['subscriptionGroupVersions_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/subscriptionGroupVersions/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * POST /v1/subscriptionGroups
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-subscriptiongroups}
   */
  async createSubscriptionGroups(
    document: operations['subscriptionGroups_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['subscriptionGroups_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/subscriptionGroups', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/subscriptionGroups/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptiongroups-_id_}
   */
  async getSubscriptionGroups(
    resourceId: string,
    query?: operations['subscriptionGroups_getInstance']['parameters']['query'],
  ): Promise<
    operations['subscriptionGroups_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/subscriptionGroups/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/subscriptionGroups/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-subscriptiongroups-_id_}
   */
  async updateSubscriptionGroups(
    resourceId: string,
    document: operations['subscriptionGroups_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['subscriptionGroups_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/subscriptionGroups/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v1/subscriptionGroups/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-subscriptiongroups-_id_}
   */
  async deleteSubscriptionGroups(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/subscriptionGroups/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * POST /v1/subscriptionImages
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-subscriptionimages}
   */
  async createSubscriptionImages(
    document: operations['subscriptionImages_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['subscriptionImages_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/subscriptionImages', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/subscriptionImages/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptionimages-_id_}
   */
  async getSubscriptionImages(
    resourceId: string,
    query?: operations['subscriptionImages_getInstance']['parameters']['query'],
  ): Promise<
    operations['subscriptionImages_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/subscriptionImages/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/subscriptionImages/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-subscriptionimages-_id_}
   */
  async updateSubscriptionImages(
    resourceId: string,
    document: operations['subscriptionImages_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['subscriptionImages_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/subscriptionImages/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v1/subscriptionImages/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-subscriptionimages-_id_}
   */
  async deleteSubscriptionImages(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/subscriptionImages/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * POST /v2/subscriptionImages
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v2-subscriptionimages}
   */
  async createSubscriptionImagesV2(
    document: operations['subscriptionImagesV2_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['subscriptionImagesV2_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v2/subscriptionImages', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v2/subscriptionImages/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v2-subscriptionimages-_id_}
   */
  async getSubscriptionImagesV2(
    resourceId: string,
    query?: operations['subscriptionImagesV2_getInstance']['parameters']['query'],
  ): Promise<
    operations['subscriptionImagesV2_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v2/subscriptionImages/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v2/subscriptionImages/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v2-subscriptionimages-_id_}
   */
  async updateSubscriptionImagesV2(
    resourceId: string,
    document: operations['subscriptionImagesV2_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['subscriptionImagesV2_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v2/subscriptionImages/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v2/subscriptionImages/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v2-subscriptionimages-_id_}
   */
  async deleteSubscriptionImagesV2(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v2/subscriptionImages/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * POST /v1/subscriptionIntroductoryOffers
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-subscriptionintroductoryoffers}
   */
  async createSubscriptionIntroductoryOffers(
    document: operations['subscriptionIntroductoryOffers_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['subscriptionIntroductoryOffers_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/subscriptionIntroductoryOffers', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * PATCH /v1/subscriptionIntroductoryOffers/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-subscriptionintroductoryoffers-_id_}
   */
  async updateSubscriptionIntroductoryOffers(
    resourceId: string,
    document: operations['subscriptionIntroductoryOffers_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['subscriptionIntroductoryOffers_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/subscriptionIntroductoryOffers/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v1/subscriptionIntroductoryOffers/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-subscriptionintroductoryoffers-_id_}
   */
  async deleteSubscriptionIntroductoryOffers(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/subscriptionIntroductoryOffers/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * POST /v2/subscriptionLocalizations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v2-subscriptionlocalizations}
   */
  async createSubscriptionLocalizationsV2(
    document: operations['subscriptionLocalizationsV2_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['subscriptionLocalizationsV2_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v2/subscriptionLocalizations', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v2/subscriptionLocalizations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v2-subscriptionlocalizations-_id_}
   */
  async getSubscriptionLocalizationsV2(
    resourceId: string,
    query?: operations['subscriptionLocalizationsV2_getInstance']['parameters']['query'],
  ): Promise<
    operations['subscriptionLocalizationsV2_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v2/subscriptionLocalizations/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v2/subscriptionLocalizations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v2-subscriptionlocalizations-_id_}
   */
  async updateSubscriptionLocalizationsV2(
    resourceId: string,
    document: operations['subscriptionLocalizationsV2_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['subscriptionLocalizationsV2_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v2/subscriptionLocalizations/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v2/subscriptionLocalizations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v2-subscriptionlocalizations-_id_}
   */
  async deleteSubscriptionLocalizationsV2(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v2/subscriptionLocalizations/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * POST /v1/subscriptionLocalizations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-subscriptionlocalizations}
   */
  async createSubscriptionLocalizations(
    document: operations['subscriptionLocalizations_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['subscriptionLocalizations_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/subscriptionLocalizations', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/subscriptionLocalizations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptionlocalizations-_id_}
   */
  async getSubscriptionLocalizations(
    resourceId: string,
    query?: operations['subscriptionLocalizations_getInstance']['parameters']['query'],
  ): Promise<
    operations['subscriptionLocalizations_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/subscriptionLocalizations/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/subscriptionLocalizations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-subscriptionlocalizations-_id_}
   */
  async updateSubscriptionLocalizations(
    resourceId: string,
    document: operations['subscriptionLocalizations_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['subscriptionLocalizations_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/subscriptionLocalizations/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v1/subscriptionLocalizations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-subscriptionlocalizations-_id_}
   */
  async deleteSubscriptionLocalizations(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/subscriptionLocalizations/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * POST /v1/subscriptionOfferCodeCustomCodes
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-subscriptionoffercodecustomcodes}
   */
  async createSubscriptionOfferCodeCustomCodes(
    document: operations['subscriptionOfferCodeCustomCodes_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['subscriptionOfferCodeCustomCodes_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/subscriptionOfferCodeCustomCodes', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/subscriptionOfferCodeCustomCodes/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptionoffercodecustomcodes-_id_}
   */
  async getSubscriptionOfferCodeCustomCodes(
    resourceId: string,
    query?: operations['subscriptionOfferCodeCustomCodes_getInstance']['parameters']['query'],
  ): Promise<
    operations['subscriptionOfferCodeCustomCodes_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/subscriptionOfferCodeCustomCodes/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/subscriptionOfferCodeCustomCodes/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-subscriptionoffercodecustomcodes-_id_}
   */
  async updateSubscriptionOfferCodeCustomCodes(
    resourceId: string,
    document: operations['subscriptionOfferCodeCustomCodes_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['subscriptionOfferCodeCustomCodes_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/subscriptionOfferCodeCustomCodes/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * POST /v1/subscriptionOfferCodeOneTimeUseCodes
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-subscriptionoffercodeonetimeusecodes}
   */
  async createSubscriptionOfferCodeOneTimeUseCodes(
    document: operations['subscriptionOfferCodeOneTimeUseCodes_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['subscriptionOfferCodeOneTimeUseCodes_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/subscriptionOfferCodeOneTimeUseCodes', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/subscriptionOfferCodeOneTimeUseCodes/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptionoffercodeonetimeusecodes-_id_}
   */
  async getSubscriptionOfferCodeOneTimeUseCodes(
    resourceId: string,
    query?: operations['subscriptionOfferCodeOneTimeUseCodes_getInstance']['parameters']['query'],
  ): Promise<
    operations['subscriptionOfferCodeOneTimeUseCodes_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/subscriptionOfferCodeOneTimeUseCodes/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/subscriptionOfferCodeOneTimeUseCodes/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-subscriptionoffercodeonetimeusecodes-_id_}
   */
  async updateSubscriptionOfferCodeOneTimeUseCodes(
    resourceId: string,
    document: operations['subscriptionOfferCodeOneTimeUseCodes_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['subscriptionOfferCodeOneTimeUseCodes_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/subscriptionOfferCodeOneTimeUseCodes/{id}',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * POST /v1/subscriptionOfferCodes
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-subscriptionoffercodes}
   */
  async createSubscriptionOfferCodes(
    document: operations['subscriptionOfferCodes_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['subscriptionOfferCodes_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/subscriptionOfferCodes', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/subscriptionOfferCodes/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptionoffercodes-_id_}
   */
  async getSubscriptionOfferCodes(
    resourceId: string,
    query?: operations['subscriptionOfferCodes_getInstance']['parameters']['query'],
  ): Promise<
    operations['subscriptionOfferCodes_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/subscriptionOfferCodes/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/subscriptionOfferCodes/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-subscriptionoffercodes-_id_}
   */
  async updateSubscriptionOfferCodes(
    resourceId: string,
    document: operations['subscriptionOfferCodes_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['subscriptionOfferCodes_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/subscriptionOfferCodes/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * POST /v1/subscriptionPlanAvailabilities
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-subscriptionplanavailabilities}
   */
  async createSubscriptionPlanAvailabilities(
    document: operations['subscriptionPlanAvailabilities_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['subscriptionPlanAvailabilities_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/subscriptionPlanAvailabilities', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/subscriptionPlanAvailabilities/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptionplanavailabilities-_id_}
   */
  async getSubscriptionPlanAvailabilities(
    resourceId: string,
    query?: operations['subscriptionPlanAvailabilities_getInstance']['parameters']['query'],
  ): Promise<
    operations['subscriptionPlanAvailabilities_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/subscriptionPlanAvailabilities/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/subscriptionPlanAvailabilities/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-subscriptionplanavailabilities-_id_}
   */
  async updateSubscriptionPlanAvailabilities(
    resourceId: string,
    document: operations['subscriptionPlanAvailabilities_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['subscriptionPlanAvailabilities_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/subscriptionPlanAvailabilities/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * POST /v1/subscriptionPriceChangePreviews
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-subscriptionpricechangepreviews}
   */
  async createSubscriptionPriceChangePreviews(
    document: operations['subscriptionPriceChangePreviews_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['subscriptionPriceChangePreviews_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/subscriptionPriceChangePreviews', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/subscriptionPricePoints/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptionpricepoints-_id_}
   */
  async getSubscriptionPricePoints(
    resourceId: string,
    query?: operations['subscriptionPricePoints_getInstance']['parameters']['query'],
  ): Promise<
    operations['subscriptionPricePoints_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/subscriptionPricePoints/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * POST /v1/subscriptionPriceTierEqualizations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-subscriptionpricetierequalizations}
   */
  async createSubscriptionPriceTierEqualizations(
    document: operations['subscriptionPriceTierEqualizations_createInstance']['requestBody']['content']['application/json'],
    query?: operations['subscriptionPriceTierEqualizations_createInstance']['parameters']['query'],
  ): Promise<
    operations['subscriptionPriceTierEqualizations_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/subscriptionPriceTierEqualizations', undefined, query);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/subscriptionPriceTiers
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptionpricetiers}
   */
  async listSubscriptionPriceTiers(
    query?: operations['subscriptionPriceTiers_getCollection']['parameters']['query'],
  ): Promise<
    operations['subscriptionPriceTiers_getCollection']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/subscriptionPriceTiers', undefined, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * POST /v1/subscriptionPrices
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-subscriptionprices}
   */
  async createSubscriptionPrices(
    document: operations['subscriptionPrices_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['subscriptionPrices_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/subscriptionPrices', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * DELETE /v1/subscriptionPrices/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-subscriptionprices-_id_}
   */
  async deleteSubscriptionPrices(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/subscriptionPrices/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * POST /v1/subscriptionPromotionalOffers
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-subscriptionpromotionaloffers}
   */
  async createSubscriptionPromotionalOffers(
    document: operations['subscriptionPromotionalOffers_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['subscriptionPromotionalOffers_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/subscriptionPromotionalOffers', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/subscriptionPromotionalOffers/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptionpromotionaloffers-_id_}
   */
  async getSubscriptionPromotionalOffers(
    resourceId: string,
    query?: operations['subscriptionPromotionalOffers_getInstance']['parameters']['query'],
  ): Promise<
    operations['subscriptionPromotionalOffers_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/subscriptionPromotionalOffers/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/subscriptionPromotionalOffers/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-subscriptionpromotionaloffers-_id_}
   */
  async updateSubscriptionPromotionalOffers(
    resourceId: string,
    document: operations['subscriptionPromotionalOffers_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['subscriptionPromotionalOffers_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/subscriptionPromotionalOffers/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v1/subscriptionPromotionalOffers/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-subscriptionpromotionaloffers-_id_}
   */
  async deleteSubscriptionPromotionalOffers(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/subscriptionPromotionalOffers/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * POST /v1/subscriptionSubmissions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-subscriptionsubmissions}
   */
  async createSubscriptionSubmissions(
    document: operations['subscriptionSubmissions_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['subscriptionSubmissions_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/subscriptionSubmissions', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * POST /v1/subscriptionVersions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-subscriptionversions}
   */
  async createSubscriptionVersions(
    document: operations['subscriptionVersions_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['subscriptionVersions_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/subscriptionVersions', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/subscriptionVersions/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptionversions-_id_}
   */
  async getSubscriptionVersions(
    resourceId: string,
    query?: operations['subscriptionVersions_getInstance']['parameters']['query'],
  ): Promise<
    operations['subscriptionVersions_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/subscriptionVersions/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * POST /v1/subscriptions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-subscriptions}
   */
  async createSubscriptions(
    document: operations['subscriptions_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['subscriptions_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/subscriptions', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/subscriptions/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptions-_id_}
   */
  async getSubscriptions(
    resourceId: string,
    query?: operations['subscriptions_getInstance']['parameters']['query'],
  ): Promise<
    operations['subscriptions_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/subscriptions/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/subscriptions/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-subscriptions-_id_}
   */
  async updateSubscriptions(
    resourceId: string,
    document: operations['subscriptions_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['subscriptions_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/subscriptions/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v1/subscriptions/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-subscriptions-_id_}
   */
  async deleteSubscriptions(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/subscriptions/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * GET /v1/territories
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-territories}
   */
  async listTerritories(
    query?: operations['territories_getCollection']['parameters']['query'],
  ): Promise<
    operations['territories_getCollection']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/territories', undefined, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/territoryAvailabilities/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-territoryavailabilities-_id_}
   */
  async updateTerritoryAvailabilities(
    resourceId: string,
    document: operations['territoryAvailabilities_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['territoryAvailabilities_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/territoryAvailabilities/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * GET /v1/userInvitations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-userinvitations}
   */
  async listUserInvitations(
    query?: operations['userInvitations_getCollection']['parameters']['query'],
  ): Promise<
    operations['userInvitations_getCollection']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/userInvitations', undefined, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * POST /v1/userInvitations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-userinvitations}
   */
  async createUserInvitations(
    document: operations['userInvitations_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['userInvitations_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/userInvitations', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/userInvitations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-userinvitations-_id_}
   */
  async getUserInvitations(
    resourceId: string,
    query?: operations['userInvitations_getInstance']['parameters']['query'],
  ): Promise<
    operations['userInvitations_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/userInvitations/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * DELETE /v1/userInvitations/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-userinvitations-_id_}
   */
  async deleteUserInvitations(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/userInvitations/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * GET /v1/users
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-users}
   */
  async listUsers(
    query?: operations['users_getCollection']['parameters']['query'],
  ): Promise<operations['users_getCollection']['responses'][200]['content']['application/json']> {
    const url = appleRequestUrl('/v1/users', undefined, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/users/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-users-_id_}
   */
  async getUsers(
    resourceId: string,
    query?: operations['users_getInstance']['parameters']['query'],
  ): Promise<operations['users_getInstance']['responses'][200]['content']['application/json']> {
    const url = appleRequestUrl('/v1/users/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/users/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-users-_id_}
   */
  async updateUsers(
    resourceId: string,
    document: operations['users_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<operations['users_updateInstance']['responses'][200]['content']['application/json']> {
    const url = appleRequestUrl('/v1/users/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v1/users/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-users-_id_}
   */
  async deleteUsers(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/users/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * POST /v1/webhookDeliveries
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-webhookdeliveries}
   */
  async createWebhookDeliveries(
    document: operations['webhookDeliveries_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['webhookDeliveries_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/webhookDeliveries', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * POST /v1/webhookPings
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-webhookpings}
   */
  async createWebhookPings(
    document: operations['webhookPings_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['webhookPings_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/webhookPings', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * POST /v1/webhooks
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-webhooks}
   */
  async createWebhooks(
    document: operations['webhooks_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['webhooks_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/webhooks', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/webhooks/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-webhooks-_id_}
   */
  async getWebhooks(
    resourceId: string,
    query?: operations['webhooks_getInstance']['parameters']['query'],
  ): Promise<operations['webhooks_getInstance']['responses'][200]['content']['application/json']> {
    const url = appleRequestUrl('/v1/webhooks/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/webhooks/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-webhooks-_id_}
   */
  async updateWebhooks(
    resourceId: string,
    document: operations['webhooks_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['webhooks_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/webhooks/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v1/webhooks/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-webhooks-_id_}
   */
  async deleteWebhooks(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/webhooks/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * POST /v1/winBackOffers
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-winbackoffers}
   */
  async createWinBackOffers(
    document: operations['winBackOffers_createInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['winBackOffers_createInstance']['responses'][201]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/winBackOffers', undefined, undefined);
    return this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/winBackOffers/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-winbackoffers-_id_}
   */
  async getWinBackOffers(
    resourceId: string,
    query?: operations['winBackOffers_getInstance']['parameters']['query'],
  ): Promise<
    operations['winBackOffers_getInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/winBackOffers/{id}', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/winBackOffers/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-winbackoffers-_id_}
   */
  async updateWinBackOffers(
    resourceId: string,
    document: operations['winBackOffers_updateInstance']['requestBody']['content']['application/json'],
  ): Promise<
    operations['winBackOffers_updateInstance']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/winBackOffers/{id}', resourceId, undefined);
    return this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v1/winBackOffers/{id}
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-winbackoffers-_id_}
   */
  async deleteWinBackOffers(resourceId: string): Promise<void> {
    const url = appleRequestUrl('/v1/winBackOffers/{id}', resourceId, undefined);
    await this.apple.sendJson('DELETE', url);
  }

  /**
   * GET /v1/alternativeDistributionPackageVersions/{id}/relationships/deltas
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-alternativedistributionpackageversions-_id_-relationships-deltas}
   */
  async listAlternativeDistributionPackageVersionsDeltasLinkage(
    resourceId: string,
    query?: operations['alternativeDistributionPackageVersions_deltas_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['alternativeDistributionPackageVersions_deltas_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/alternativeDistributionPackageVersions/{id}/relationships/deltas',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/alternativeDistributionPackageVersions/{id}/deltas
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-alternativedistributionpackageversions-_id_-deltas}
   */
  async listAlternativeDistributionPackageVersionsDeltas(
    resourceId: string,
    query?: operations['alternativeDistributionPackageVersions_deltas_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['alternativeDistributionPackageVersions_deltas_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/alternativeDistributionPackageVersions/{id}/deltas',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/alternativeDistributionPackageVersions/{id}/relationships/variants
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-alternativedistributionpackageversions-_id_-relationships-variants}
   */
  async listAlternativeDistributionPackageVersionsVariantsLinkage(
    resourceId: string,
    query?: operations['alternativeDistributionPackageVersions_variants_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['alternativeDistributionPackageVersions_variants_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/alternativeDistributionPackageVersions/{id}/relationships/variants',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/alternativeDistributionPackageVersions/{id}/variants
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-alternativedistributionpackageversions-_id_-variants}
   */
  async listAlternativeDistributionPackageVersionsVariants(
    resourceId: string,
    query?: operations['alternativeDistributionPackageVersions_variants_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['alternativeDistributionPackageVersions_variants_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/alternativeDistributionPackageVersions/{id}/variants',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/alternativeDistributionPackages/{id}/relationships/versions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-alternativedistributionpackages-_id_-relationships-versions}
   */
  async listAlternativeDistributionPackagesVersionsLinkage(
    resourceId: string,
    query?: operations['alternativeDistributionPackages_versions_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['alternativeDistributionPackages_versions_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/alternativeDistributionPackages/{id}/relationships/versions',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/alternativeDistributionPackages/{id}/versions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-alternativedistributionpackages-_id_-versions}
   */
  async listAlternativeDistributionPackagesVersions(
    resourceId: string,
    query?: operations['alternativeDistributionPackages_versions_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['alternativeDistributionPackages_versions_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/alternativeDistributionPackages/{id}/versions',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/analyticsReportInstances/{id}/relationships/segments
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-analyticsreportinstances-_id_-relationships-segments}
   */
  async listAnalyticsReportInstancesSegmentsLinkage(
    resourceId: string,
    query?: operations['analyticsReportInstances_segments_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['analyticsReportInstances_segments_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/analyticsReportInstances/{id}/relationships/segments',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/analyticsReportInstances/{id}/segments
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-analyticsreportinstances-_id_-segments}
   */
  async listAnalyticsReportInstancesSegments(
    resourceId: string,
    query?: operations['analyticsReportInstances_segments_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['analyticsReportInstances_segments_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/analyticsReportInstances/{id}/segments', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/analyticsReportRequests/{id}/relationships/reports
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-analyticsreportrequests-_id_-relationships-reports}
   */
  async listAnalyticsReportRequestsReportsLinkage(
    resourceId: string,
    query?: operations['analyticsReportRequests_reports_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['analyticsReportRequests_reports_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/analyticsReportRequests/{id}/relationships/reports',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/analyticsReportRequests/{id}/reports
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-analyticsreportrequests-_id_-reports}
   */
  async listAnalyticsReportRequestsReports(
    resourceId: string,
    query?: operations['analyticsReportRequests_reports_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['analyticsReportRequests_reports_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/analyticsReportRequests/{id}/reports', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/analyticsReports/{id}/relationships/instances
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-analyticsreports-_id_-relationships-instances}
   */
  async listAnalyticsReportsInstancesLinkage(
    resourceId: string,
    query?: operations['analyticsReports_instances_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['analyticsReports_instances_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/analyticsReports/{id}/relationships/instances',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/analyticsReports/{id}/instances
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-analyticsreports-_id_-instances}
   */
  async listAnalyticsReportsInstances(
    resourceId: string,
    query?: operations['analyticsReports_instances_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['analyticsReports_instances_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/analyticsReports/{id}/instances', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appAssetLibraries/{id}/relationships/images
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appassetlibraries-_id_-relationships-images}
   */
  async listAppAssetLibrariesImagesLinkage(
    resourceId: string,
    query?: operations['appAssetLibraries_images_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['appAssetLibraries_images_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appAssetLibraries/{id}/relationships/images',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appAssetLibraries/{id}/images
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appassetlibraries-_id_-images}
   */
  async listAppAssetLibrariesImages(
    resourceId: string,
    query?: operations['appAssetLibraries_images_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['appAssetLibraries_images_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appAssetLibraries/{id}/images', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appAssetLibraries/{id}/relationships/videos
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appassetlibraries-_id_-relationships-videos}
   */
  async listAppAssetLibrariesVideosLinkage(
    resourceId: string,
    query?: operations['appAssetLibraries_videos_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['appAssetLibraries_videos_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appAssetLibraries/{id}/relationships/videos',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appAssetLibraries/{id}/videos
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appassetlibraries-_id_-videos}
   */
  async listAppAssetLibrariesVideos(
    resourceId: string,
    query?: operations['appAssetLibraries_videos_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['appAssetLibraries_videos_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appAssetLibraries/{id}/videos', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appAssetLibraryImages/{id}/relationships/placements
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appassetlibraryimages-_id_-relationships-placements}
   */
  async listAppAssetLibraryImagesPlacementsLinkage(
    resourceId: string,
    query?: operations['appAssetLibraryImages_placements_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['appAssetLibraryImages_placements_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appAssetLibraryImages/{id}/relationships/placements',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appAssetLibraryImages/{id}/placements
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appassetlibraryimages-_id_-placements}
   */
  async listAppAssetLibraryImagesPlacements(
    resourceId: string,
    query?: operations['appAssetLibraryImages_placements_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['appAssetLibraryImages_placements_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appAssetLibraryImages/{id}/placements', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appAssetLibraryVideos/{id}/relationships/placements
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appassetlibraryvideos-_id_-relationships-placements}
   */
  async listAppAssetLibraryVideosPlacementsLinkage(
    resourceId: string,
    query?: operations['appAssetLibraryVideos_placements_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['appAssetLibraryVideos_placements_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appAssetLibraryVideos/{id}/relationships/placements',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appAssetLibraryVideos/{id}/placements
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appassetlibraryvideos-_id_-placements}
   */
  async listAppAssetLibraryVideosPlacements(
    resourceId: string,
    query?: operations['appAssetLibraryVideos_placements_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['appAssetLibraryVideos_placements_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appAssetLibraryVideos/{id}/placements', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v2/appAvailabilities/{id}/relationships/territoryAvailabilities
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v2-appavailabilities-_id_-relationships-territoryavailabilities}
   */
  async listAppAvailabilitiesV2TerritoryAvailabilitiesLinkage(
    resourceId: string,
    query?: operations['appAvailabilitiesV2_territoryAvailabilities_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['appAvailabilitiesV2_territoryAvailabilities_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v2/appAvailabilities/{id}/relationships/territoryAvailabilities',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v2/appAvailabilities/{id}/territoryAvailabilities
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v2-appavailabilities-_id_-territoryavailabilities}
   */
  async listAppAvailabilitiesV2TerritoryAvailabilities(
    resourceId: string,
    query?: operations['appAvailabilitiesV2_territoryAvailabilities_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['appAvailabilitiesV2_territoryAvailabilities_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v2/appAvailabilities/{id}/territoryAvailabilities',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appCategories/{id}/relationships/parent
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appcategories-_id_-relationships-parent}
   */
  async getAppCategoriesParentLinkage(
    resourceId: string,
  ): Promise<
    operations['appCategories_parent_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appCategories/{id}/relationships/parent',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appCategories/{id}/parent
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appcategories-_id_-parent}
   */
  async getAppCategoriesParent(
    resourceId: string,
    query?: operations['appCategories_parent_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['appCategories_parent_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appCategories/{id}/parent', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appCategories/{id}/relationships/subcategories
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appcategories-_id_-relationships-subcategories}
   */
  async listAppCategoriesSubcategoriesLinkage(
    resourceId: string,
    query?: operations['appCategories_subcategories_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['appCategories_subcategories_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appCategories/{id}/relationships/subcategories',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appCategories/{id}/subcategories
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appcategories-_id_-subcategories}
   */
  async listAppCategoriesSubcategories(
    resourceId: string,
    query?: operations['appCategories_subcategories_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['appCategories_subcategories_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appCategories/{id}/subcategories', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appClipDefaultExperienceLocalizations/{id}/relationships/appClipHeaderImage
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appclipdefaultexperiencelocalizations-_id_-relationships-appclipheaderimage}
   */
  async getAppClipDefaultExperienceLocalizationsAppClipHeaderImageLinkage(
    resourceId: string,
  ): Promise<
    operations['appClipDefaultExperienceLocalizations_appClipHeaderImage_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appClipDefaultExperienceLocalizations/{id}/relationships/appClipHeaderImage',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appClipDefaultExperienceLocalizations/{id}/appClipHeaderImage
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appclipdefaultexperiencelocalizations-_id_-appclipheaderimage}
   */
  async getAppClipDefaultExperienceLocalizationsAppClipHeaderImage(
    resourceId: string,
    query?: operations['appClipDefaultExperienceLocalizations_appClipHeaderImage_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['appClipDefaultExperienceLocalizations_appClipHeaderImage_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appClipDefaultExperienceLocalizations/{id}/appClipHeaderImage',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appClipDefaultExperiences/{id}/relationships/appClipAppStoreReviewDetail
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appclipdefaultexperiences-_id_-relationships-appclipappstorereviewdetail}
   */
  async getAppClipDefaultExperiencesAppClipAppStoreReviewDetailLinkage(
    resourceId: string,
  ): Promise<
    operations['appClipDefaultExperiences_appClipAppStoreReviewDetail_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appClipDefaultExperiences/{id}/relationships/appClipAppStoreReviewDetail',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appClipDefaultExperiences/{id}/appClipAppStoreReviewDetail
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appclipdefaultexperiences-_id_-appclipappstorereviewdetail}
   */
  async getAppClipDefaultExperiencesAppClipAppStoreReviewDetail(
    resourceId: string,
    query?: operations['appClipDefaultExperiences_appClipAppStoreReviewDetail_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['appClipDefaultExperiences_appClipAppStoreReviewDetail_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appClipDefaultExperiences/{id}/appClipAppStoreReviewDetail',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appClipDefaultExperiences/{id}/relationships/appClipDefaultExperienceLocalizations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appclipdefaultexperiences-_id_-relationships-appclipdefaultexperiencelocalizations}
   */
  async listAppClipDefaultExperiencesAppClipDefaultExperienceLocalizationsLinkage(
    resourceId: string,
    query?: operations['appClipDefaultExperiences_appClipDefaultExperienceLocalizations_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['appClipDefaultExperiences_appClipDefaultExperienceLocalizations_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appClipDefaultExperiences/{id}/relationships/appClipDefaultExperienceLocalizations',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appClipDefaultExperiences/{id}/appClipDefaultExperienceLocalizations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appclipdefaultexperiences-_id_-appclipdefaultexperiencelocalizations}
   */
  async listAppClipDefaultExperiencesAppClipDefaultExperienceLocalizations(
    resourceId: string,
    query?: operations['appClipDefaultExperiences_appClipDefaultExperienceLocalizations_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['appClipDefaultExperiences_appClipDefaultExperienceLocalizations_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appClipDefaultExperiences/{id}/appClipDefaultExperienceLocalizations',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appClipDefaultExperiences/{id}/relationships/releaseWithAppStoreVersion
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appclipdefaultexperiences-_id_-relationships-releasewithappstoreversion}
   */
  async getAppClipDefaultExperiencesReleaseWithAppStoreVersionLinkage(
    resourceId: string,
  ): Promise<
    operations['appClipDefaultExperiences_releaseWithAppStoreVersion_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appClipDefaultExperiences/{id}/relationships/releaseWithAppStoreVersion',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/appClipDefaultExperiences/{id}/relationships/releaseWithAppStoreVersion
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-appclipdefaultexperiences-_id_-relationships-releasewithappstoreversion}
   */
  async updateAppClipDefaultExperiencesReleaseWithAppStoreVersionLinkage(
    resourceId: string,
    document: operations['appClipDefaultExperiences_releaseWithAppStoreVersion_updateToOneRelationship']['requestBody']['content']['application/json'],
  ): Promise<void> {
    const url = appleRequestUrl(
      '/v1/appClipDefaultExperiences/{id}/relationships/releaseWithAppStoreVersion',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('PATCH', url, document);
  }

  /**
   * GET /v1/appClipDefaultExperiences/{id}/releaseWithAppStoreVersion
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appclipdefaultexperiences-_id_-releasewithappstoreversion}
   */
  async getAppClipDefaultExperiencesReleaseWithAppStoreVersion(
    resourceId: string,
    query?: operations['appClipDefaultExperiences_releaseWithAppStoreVersion_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['appClipDefaultExperiences_releaseWithAppStoreVersion_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appClipDefaultExperiences/{id}/releaseWithAppStoreVersion',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appClips/{id}/relationships/appClipAdvancedExperiences
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appclips-_id_-relationships-appclipadvancedexperiences}
   */
  async listAppClipsAppClipAdvancedExperiencesLinkage(
    resourceId: string,
    query?: operations['appClips_appClipAdvancedExperiences_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['appClips_appClipAdvancedExperiences_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appClips/{id}/relationships/appClipAdvancedExperiences',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appClips/{id}/appClipAdvancedExperiences
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appclips-_id_-appclipadvancedexperiences}
   */
  async listAppClipsAppClipAdvancedExperiences(
    resourceId: string,
    query?: operations['appClips_appClipAdvancedExperiences_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['appClips_appClipAdvancedExperiences_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appClips/{id}/appClipAdvancedExperiences', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appClips/{id}/relationships/appClipDefaultExperiences
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appclips-_id_-relationships-appclipdefaultexperiences}
   */
  async listAppClipsAppClipDefaultExperiencesLinkage(
    resourceId: string,
    query?: operations['appClips_appClipDefaultExperiences_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['appClips_appClipDefaultExperiences_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appClips/{id}/relationships/appClipDefaultExperiences',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appClips/{id}/appClipDefaultExperiences
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appclips-_id_-appclipdefaultexperiences}
   */
  async listAppClipsAppClipDefaultExperiences(
    resourceId: string,
    query?: operations['appClips_appClipDefaultExperiences_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['appClips_appClipDefaultExperiences_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appClips/{id}/appClipDefaultExperiences', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appCustomProductPageLocalizations/{id}/relationships/appPreviewSets
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appcustomproductpagelocalizations-_id_-relationships-apppreviewsets}
   */
  async listAppCustomProductPageLocalizationsAppPreviewSetsLinkage(
    resourceId: string,
    query?: operations['appCustomProductPageLocalizations_appPreviewSets_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['appCustomProductPageLocalizations_appPreviewSets_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appCustomProductPageLocalizations/{id}/relationships/appPreviewSets',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appCustomProductPageLocalizations/{id}/appPreviewSets
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appcustomproductpagelocalizations-_id_-apppreviewsets}
   */
  async listAppCustomProductPageLocalizationsAppPreviewSets(
    resourceId: string,
    query?: operations['appCustomProductPageLocalizations_appPreviewSets_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['appCustomProductPageLocalizations_appPreviewSets_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appCustomProductPageLocalizations/{id}/appPreviewSets',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appCustomProductPageLocalizations/{id}/relationships/appScreenshotSets
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appcustomproductpagelocalizations-_id_-relationships-appscreenshotsets}
   */
  async listAppCustomProductPageLocalizationsAppScreenshotSetsLinkage(
    resourceId: string,
    query?: operations['appCustomProductPageLocalizations_appScreenshotSets_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['appCustomProductPageLocalizations_appScreenshotSets_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appCustomProductPageLocalizations/{id}/relationships/appScreenshotSets',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appCustomProductPageLocalizations/{id}/appScreenshotSets
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appcustomproductpagelocalizations-_id_-appscreenshotsets}
   */
  async listAppCustomProductPageLocalizationsAppScreenshotSets(
    resourceId: string,
    query?: operations['appCustomProductPageLocalizations_appScreenshotSets_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['appCustomProductPageLocalizations_appScreenshotSets_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appCustomProductPageLocalizations/{id}/appScreenshotSets',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appCustomProductPageLocalizations/{id}/relationships/placements
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appcustomproductpagelocalizations-_id_-relationships-placements}
   */
  async listAppCustomProductPageLocalizationsPlacementsLinkage(
    resourceId: string,
    query?: operations['appCustomProductPageLocalizations_placements_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['appCustomProductPageLocalizations_placements_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appCustomProductPageLocalizations/{id}/relationships/placements',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appCustomProductPageLocalizations/{id}/placements
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appcustomproductpagelocalizations-_id_-placements}
   */
  async listAppCustomProductPageLocalizationsPlacements(
    resourceId: string,
    query?: operations['appCustomProductPageLocalizations_placements_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['appCustomProductPageLocalizations_placements_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appCustomProductPageLocalizations/{id}/placements',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appCustomProductPageLocalizations/{id}/relationships/searchKeywords
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appcustomproductpagelocalizations-_id_-relationships-searchkeywords}
   */
  async listAppCustomProductPageLocalizationsSearchKeywordsLinkage(
    resourceId: string,
    query?: operations['appCustomProductPageLocalizations_searchKeywords_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['appCustomProductPageLocalizations_searchKeywords_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appCustomProductPageLocalizations/{id}/relationships/searchKeywords',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * POST /v1/appCustomProductPageLocalizations/{id}/relationships/searchKeywords
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-appcustomproductpagelocalizations-_id_-relationships-searchkeywords}
   */
  async addAppCustomProductPageLocalizationsSearchKeywordsLinkage(
    resourceId: string,
    document: operations['appCustomProductPageLocalizations_searchKeywords_createToManyRelationship']['requestBody']['content']['application/json'],
  ): Promise<void> {
    const url = appleRequestUrl(
      '/v1/appCustomProductPageLocalizations/{id}/relationships/searchKeywords',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('POST', url, document);
  }

  /**
   * DELETE /v1/appCustomProductPageLocalizations/{id}/relationships/searchKeywords
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-appcustomproductpagelocalizations-_id_-relationships-searchkeywords}
   */
  async removeAppCustomProductPageLocalizationsSearchKeywordsLinkage(
    resourceId: string,
    document: operations['appCustomProductPageLocalizations_searchKeywords_deleteToManyRelationship']['requestBody']['content']['application/json'],
  ): Promise<void> {
    const url = appleRequestUrl(
      '/v1/appCustomProductPageLocalizations/{id}/relationships/searchKeywords',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('DELETE', url, document);
  }

  /**
   * GET /v1/appCustomProductPageLocalizations/{id}/searchKeywords
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appcustomproductpagelocalizations-_id_-searchkeywords}
   */
  async listAppCustomProductPageLocalizationsSearchKeywords(
    resourceId: string,
    query?: operations['appCustomProductPageLocalizations_searchKeywords_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['appCustomProductPageLocalizations_searchKeywords_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appCustomProductPageLocalizations/{id}/searchKeywords',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appCustomProductPageVersions/{id}/relationships/appCustomProductPageLocalizations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appcustomproductpageversions-_id_-relationships-appcustomproductpagelocalizations}
   */
  async listAppCustomProductPageVersionsAppCustomProductPageLocalizationsLinkage(
    resourceId: string,
    query?: operations['appCustomProductPageVersions_appCustomProductPageLocalizations_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['appCustomProductPageVersions_appCustomProductPageLocalizations_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appCustomProductPageVersions/{id}/relationships/appCustomProductPageLocalizations',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appCustomProductPageVersions/{id}/appCustomProductPageLocalizations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appcustomproductpageversions-_id_-appcustomproductpagelocalizations}
   */
  async listAppCustomProductPageVersionsAppCustomProductPageLocalizations(
    resourceId: string,
    query?: operations['appCustomProductPageVersions_appCustomProductPageLocalizations_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['appCustomProductPageVersions_appCustomProductPageLocalizations_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appCustomProductPageVersions/{id}/appCustomProductPageLocalizations',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appCustomProductPages/{id}/relationships/appCustomProductPageVersions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appcustomproductpages-_id_-relationships-appcustomproductpageversions}
   */
  async listAppCustomProductPagesAppCustomProductPageVersionsLinkage(
    resourceId: string,
    query?: operations['appCustomProductPages_appCustomProductPageVersions_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['appCustomProductPages_appCustomProductPageVersions_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appCustomProductPages/{id}/relationships/appCustomProductPageVersions',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appCustomProductPages/{id}/appCustomProductPageVersions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appcustomproductpages-_id_-appcustomproductpageversions}
   */
  async listAppCustomProductPagesAppCustomProductPageVersions(
    resourceId: string,
    query?: operations['appCustomProductPages_appCustomProductPageVersions_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['appCustomProductPages_appCustomProductPageVersions_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appCustomProductPages/{id}/appCustomProductPageVersions',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appEncryptionDeclarations/{id}/relationships/app
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appencryptiondeclarations-_id_-relationships-app}
   */
  async getAppEncryptionDeclarationsAppLinkage(
    resourceId: string,
  ): Promise<
    operations['appEncryptionDeclarations_app_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appEncryptionDeclarations/{id}/relationships/app',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appEncryptionDeclarations/{id}/app
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appencryptiondeclarations-_id_-app}
   */
  async getAppEncryptionDeclarationsApp(
    resourceId: string,
    query?: operations['appEncryptionDeclarations_app_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['appEncryptionDeclarations_app_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appEncryptionDeclarations/{id}/app', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appEncryptionDeclarations/{id}/relationships/appEncryptionDeclarationDocument
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appencryptiondeclarations-_id_-relationships-appencryptiondeclarationdocument}
   */
  async getAppEncryptionDeclarationsAppEncryptionDeclarationDocumentLinkage(
    resourceId: string,
  ): Promise<
    operations['appEncryptionDeclarations_appEncryptionDeclarationDocument_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appEncryptionDeclarations/{id}/relationships/appEncryptionDeclarationDocument',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appEncryptionDeclarations/{id}/appEncryptionDeclarationDocument
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appencryptiondeclarations-_id_-appencryptiondeclarationdocument}
   */
  async getAppEncryptionDeclarationsAppEncryptionDeclarationDocument(
    resourceId: string,
    query?: operations['appEncryptionDeclarations_appEncryptionDeclarationDocument_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['appEncryptionDeclarations_appEncryptionDeclarationDocument_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appEncryptionDeclarations/{id}/appEncryptionDeclarationDocument',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * POST /v1/appEncryptionDeclarations/{id}/relationships/builds
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-appencryptiondeclarations-_id_-relationships-builds}
   */
  async addAppEncryptionDeclarationsBuildsLinkage(
    resourceId: string,
    document: operations['appEncryptionDeclarations_builds_createToManyRelationship']['requestBody']['content']['application/json'],
  ): Promise<void> {
    const url = appleRequestUrl(
      '/v1/appEncryptionDeclarations/{id}/relationships/builds',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('POST', url, document);
  }

  /**
   * GET /v1/appEventLocalizations/{id}/relationships/appEventScreenshots
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appeventlocalizations-_id_-relationships-appeventscreenshots}
   */
  async listAppEventLocalizationsAppEventScreenshotsLinkage(
    resourceId: string,
    query?: operations['appEventLocalizations_appEventScreenshots_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['appEventLocalizations_appEventScreenshots_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appEventLocalizations/{id}/relationships/appEventScreenshots',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appEventLocalizations/{id}/appEventScreenshots
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appeventlocalizations-_id_-appeventscreenshots}
   */
  async listAppEventLocalizationsAppEventScreenshots(
    resourceId: string,
    query?: operations['appEventLocalizations_appEventScreenshots_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['appEventLocalizations_appEventScreenshots_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appEventLocalizations/{id}/appEventScreenshots',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appEventLocalizations/{id}/relationships/appEventVideoClips
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appeventlocalizations-_id_-relationships-appeventvideoclips}
   */
  async listAppEventLocalizationsAppEventVideoClipsLinkage(
    resourceId: string,
    query?: operations['appEventLocalizations_appEventVideoClips_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['appEventLocalizations_appEventVideoClips_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appEventLocalizations/{id}/relationships/appEventVideoClips',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appEventLocalizations/{id}/appEventVideoClips
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appeventlocalizations-_id_-appeventvideoclips}
   */
  async listAppEventLocalizationsAppEventVideoClips(
    resourceId: string,
    query?: operations['appEventLocalizations_appEventVideoClips_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['appEventLocalizations_appEventVideoClips_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appEventLocalizations/{id}/appEventVideoClips',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appEventLocalizations/{id}/relationships/placements
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appeventlocalizations-_id_-relationships-placements}
   */
  async listAppEventLocalizationsPlacementsLinkage(
    resourceId: string,
    query?: operations['appEventLocalizations_placements_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['appEventLocalizations_placements_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appEventLocalizations/{id}/relationships/placements',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appEventLocalizations/{id}/placements
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appeventlocalizations-_id_-placements}
   */
  async listAppEventLocalizationsPlacements(
    resourceId: string,
    query?: operations['appEventLocalizations_placements_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['appEventLocalizations_placements_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appEventLocalizations/{id}/placements', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appEvents/{id}/relationships/localizations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appevents-_id_-relationships-localizations}
   */
  async listAppEventsLocalizationsLinkage(
    resourceId: string,
    query?: operations['appEvents_localizations_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['appEvents_localizations_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appEvents/{id}/relationships/localizations',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appEvents/{id}/localizations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appevents-_id_-localizations}
   */
  async listAppEventsLocalizations(
    resourceId: string,
    query?: operations['appEvents_localizations_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['appEvents_localizations_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appEvents/{id}/localizations', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appInfos/{id}/relationships/ageRatingDeclaration
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appinfos-_id_-relationships-ageratingdeclaration}
   */
  async getAppInfosAgeRatingDeclarationLinkage(
    resourceId: string,
  ): Promise<
    operations['appInfos_ageRatingDeclaration_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appInfos/{id}/relationships/ageRatingDeclaration',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appInfos/{id}/ageRatingDeclaration
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appinfos-_id_-ageratingdeclaration}
   */
  async getAppInfosAgeRatingDeclaration(
    resourceId: string,
    query?: operations['appInfos_ageRatingDeclaration_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['appInfos_ageRatingDeclaration_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appInfos/{id}/ageRatingDeclaration', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appInfos/{id}/relationships/appInfoLocalizations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appinfos-_id_-relationships-appinfolocalizations}
   */
  async listAppInfosAppInfoLocalizationsLinkage(
    resourceId: string,
    query?: operations['appInfos_appInfoLocalizations_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['appInfos_appInfoLocalizations_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appInfos/{id}/relationships/appInfoLocalizations',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appInfos/{id}/appInfoLocalizations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appinfos-_id_-appinfolocalizations}
   */
  async listAppInfosAppInfoLocalizations(
    resourceId: string,
    query?: operations['appInfos_appInfoLocalizations_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['appInfos_appInfoLocalizations_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appInfos/{id}/appInfoLocalizations', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appInfos/{id}/relationships/primaryCategory
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appinfos-_id_-relationships-primarycategory}
   */
  async getAppInfosPrimaryCategoryLinkage(
    resourceId: string,
  ): Promise<
    operations['appInfos_primaryCategory_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appInfos/{id}/relationships/primaryCategory',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appInfos/{id}/primaryCategory
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appinfos-_id_-primarycategory}
   */
  async getAppInfosPrimaryCategory(
    resourceId: string,
    query?: operations['appInfos_primaryCategory_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['appInfos_primaryCategory_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appInfos/{id}/primaryCategory', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appInfos/{id}/relationships/primarySubcategoryOne
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appinfos-_id_-relationships-primarysubcategoryone}
   */
  async getAppInfosPrimarySubcategoryOneLinkage(
    resourceId: string,
  ): Promise<
    operations['appInfos_primarySubcategoryOne_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appInfos/{id}/relationships/primarySubcategoryOne',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appInfos/{id}/primarySubcategoryOne
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appinfos-_id_-primarysubcategoryone}
   */
  async getAppInfosPrimarySubcategoryOne(
    resourceId: string,
    query?: operations['appInfos_primarySubcategoryOne_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['appInfos_primarySubcategoryOne_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appInfos/{id}/primarySubcategoryOne', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appInfos/{id}/relationships/primarySubcategoryTwo
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appinfos-_id_-relationships-primarysubcategorytwo}
   */
  async getAppInfosPrimarySubcategoryTwoLinkage(
    resourceId: string,
  ): Promise<
    operations['appInfos_primarySubcategoryTwo_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appInfos/{id}/relationships/primarySubcategoryTwo',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appInfos/{id}/primarySubcategoryTwo
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appinfos-_id_-primarysubcategorytwo}
   */
  async getAppInfosPrimarySubcategoryTwo(
    resourceId: string,
    query?: operations['appInfos_primarySubcategoryTwo_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['appInfos_primarySubcategoryTwo_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appInfos/{id}/primarySubcategoryTwo', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appInfos/{id}/relationships/secondaryCategory
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appinfos-_id_-relationships-secondarycategory}
   */
  async getAppInfosSecondaryCategoryLinkage(
    resourceId: string,
  ): Promise<
    operations['appInfos_secondaryCategory_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appInfos/{id}/relationships/secondaryCategory',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appInfos/{id}/secondaryCategory
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appinfos-_id_-secondarycategory}
   */
  async getAppInfosSecondaryCategory(
    resourceId: string,
    query?: operations['appInfos_secondaryCategory_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['appInfos_secondaryCategory_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appInfos/{id}/secondaryCategory', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appInfos/{id}/relationships/secondarySubcategoryOne
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appinfos-_id_-relationships-secondarysubcategoryone}
   */
  async getAppInfosSecondarySubcategoryOneLinkage(
    resourceId: string,
  ): Promise<
    operations['appInfos_secondarySubcategoryOne_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appInfos/{id}/relationships/secondarySubcategoryOne',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appInfos/{id}/secondarySubcategoryOne
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appinfos-_id_-secondarysubcategoryone}
   */
  async getAppInfosSecondarySubcategoryOne(
    resourceId: string,
    query?: operations['appInfos_secondarySubcategoryOne_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['appInfos_secondarySubcategoryOne_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appInfos/{id}/secondarySubcategoryOne', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appInfos/{id}/relationships/secondarySubcategoryTwo
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appinfos-_id_-relationships-secondarysubcategorytwo}
   */
  async getAppInfosSecondarySubcategoryTwoLinkage(
    resourceId: string,
  ): Promise<
    operations['appInfos_secondarySubcategoryTwo_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appInfos/{id}/relationships/secondarySubcategoryTwo',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appInfos/{id}/secondarySubcategoryTwo
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appinfos-_id_-secondarysubcategorytwo}
   */
  async getAppInfosSecondarySubcategoryTwo(
    resourceId: string,
    query?: operations['appInfos_secondarySubcategoryTwo_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['appInfos_secondarySubcategoryTwo_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appInfos/{id}/secondarySubcategoryTwo', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appInfos/{id}/relationships/territoryAgeRatings
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appinfos-_id_-relationships-territoryageratings}
   */
  async listAppInfosTerritoryAgeRatingsLinkage(
    resourceId: string,
    query?: operations['appInfos_territoryAgeRatings_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['appInfos_territoryAgeRatings_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appInfos/{id}/relationships/territoryAgeRatings',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appInfos/{id}/territoryAgeRatings
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appinfos-_id_-territoryageratings}
   */
  async listAppInfosTerritoryAgeRatings(
    resourceId: string,
    query?: operations['appInfos_territoryAgeRatings_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['appInfos_territoryAgeRatings_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appInfos/{id}/territoryAgeRatings', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appPreviewSets/{id}/relationships/appPreviews
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apppreviewsets-_id_-relationships-apppreviews}
   */
  async listAppPreviewSetsAppPreviewsLinkage(
    resourceId: string,
    query?: operations['appPreviewSets_appPreviews_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['appPreviewSets_appPreviews_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appPreviewSets/{id}/relationships/appPreviews',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/appPreviewSets/{id}/relationships/appPreviews
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-apppreviewsets-_id_-relationships-apppreviews}
   */
  async replaceAppPreviewSetsAppPreviewsLinkage(
    resourceId: string,
    document: operations['appPreviewSets_appPreviews_replaceToManyRelationship']['requestBody']['content']['application/json'],
  ): Promise<void> {
    const url = appleRequestUrl(
      '/v1/appPreviewSets/{id}/relationships/appPreviews',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('PATCH', url, document);
  }

  /**
   * GET /v1/appPreviewSets/{id}/appPreviews
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apppreviewsets-_id_-apppreviews}
   */
  async listAppPreviewSetsAppPreviews(
    resourceId: string,
    query?: operations['appPreviewSets_appPreviews_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['appPreviewSets_appPreviews_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appPreviewSets/{id}/appPreviews', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v3/appPricePoints/{id}/relationships/equalizations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v3-apppricepoints-_id_-relationships-equalizations}
   */
  async listAppPricePointsV3EqualizationsLinkage(
    resourceId: string,
    query?: operations['appPricePointsV3_equalizations_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['appPricePointsV3_equalizations_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v3/appPricePoints/{id}/relationships/equalizations',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v3/appPricePoints/{id}/equalizations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v3-apppricepoints-_id_-equalizations}
   */
  async listAppPricePointsV3Equalizations(
    resourceId: string,
    query?: operations['appPricePointsV3_equalizations_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['appPricePointsV3_equalizations_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v3/appPricePoints/{id}/equalizations', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appPriceSchedules/{id}/relationships/automaticPrices
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apppriceschedules-_id_-relationships-automaticprices}
   */
  async listAppPriceSchedulesAutomaticPricesLinkage(
    resourceId: string,
    query?: operations['appPriceSchedules_automaticPrices_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['appPriceSchedules_automaticPrices_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appPriceSchedules/{id}/relationships/automaticPrices',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appPriceSchedules/{id}/automaticPrices
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apppriceschedules-_id_-automaticprices}
   */
  async listAppPriceSchedulesAutomaticPrices(
    resourceId: string,
    query?: operations['appPriceSchedules_automaticPrices_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['appPriceSchedules_automaticPrices_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appPriceSchedules/{id}/automaticPrices', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appPriceSchedules/{id}/relationships/baseTerritory
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apppriceschedules-_id_-relationships-baseterritory}
   */
  async getAppPriceSchedulesBaseTerritoryLinkage(
    resourceId: string,
  ): Promise<
    operations['appPriceSchedules_baseTerritory_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appPriceSchedules/{id}/relationships/baseTerritory',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appPriceSchedules/{id}/baseTerritory
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apppriceschedules-_id_-baseterritory}
   */
  async getAppPriceSchedulesBaseTerritory(
    resourceId: string,
    query?: operations['appPriceSchedules_baseTerritory_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['appPriceSchedules_baseTerritory_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appPriceSchedules/{id}/baseTerritory', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appPriceSchedules/{id}/relationships/manualPrices
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apppriceschedules-_id_-relationships-manualprices}
   */
  async listAppPriceSchedulesManualPricesLinkage(
    resourceId: string,
    query?: operations['appPriceSchedules_manualPrices_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['appPriceSchedules_manualPrices_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appPriceSchedules/{id}/relationships/manualPrices',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appPriceSchedules/{id}/manualPrices
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apppriceschedules-_id_-manualprices}
   */
  async listAppPriceSchedulesManualPrices(
    resourceId: string,
    query?: operations['appPriceSchedules_manualPrices_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['appPriceSchedules_manualPrices_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appPriceSchedules/{id}/manualPrices', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appScreenshotSets/{id}/relationships/appScreenshots
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appscreenshotsets-_id_-relationships-appscreenshots}
   */
  async listAppScreenshotSetsAppScreenshotsLinkage(
    resourceId: string,
    query?: operations['appScreenshotSets_appScreenshots_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['appScreenshotSets_appScreenshots_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appScreenshotSets/{id}/relationships/appScreenshots',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/appScreenshotSets/{id}/relationships/appScreenshots
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-appscreenshotsets-_id_-relationships-appscreenshots}
   */
  async replaceAppScreenshotSetsAppScreenshotsLinkage(
    resourceId: string,
    document: operations['appScreenshotSets_appScreenshots_replaceToManyRelationship']['requestBody']['content']['application/json'],
  ): Promise<void> {
    const url = appleRequestUrl(
      '/v1/appScreenshotSets/{id}/relationships/appScreenshots',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('PATCH', url, document);
  }

  /**
   * GET /v1/appScreenshotSets/{id}/appScreenshots
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appscreenshotsets-_id_-appscreenshots}
   */
  async listAppScreenshotSetsAppScreenshots(
    resourceId: string,
    query?: operations['appScreenshotSets_appScreenshots_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['appScreenshotSets_appScreenshots_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appScreenshotSets/{id}/appScreenshots', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appStoreReviewDetails/{id}/relationships/appStoreReviewAttachments
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appstorereviewdetails-_id_-relationships-appstorereviewattachments}
   */
  async listAppStoreReviewDetailsAppStoreReviewAttachmentsLinkage(
    resourceId: string,
    query?: operations['appStoreReviewDetails_appStoreReviewAttachments_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['appStoreReviewDetails_appStoreReviewAttachments_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appStoreReviewDetails/{id}/relationships/appStoreReviewAttachments',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appStoreReviewDetails/{id}/appStoreReviewAttachments
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appstorereviewdetails-_id_-appstorereviewattachments}
   */
  async listAppStoreReviewDetailsAppStoreReviewAttachments(
    resourceId: string,
    query?: operations['appStoreReviewDetails_appStoreReviewAttachments_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['appStoreReviewDetails_appStoreReviewAttachments_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appStoreReviewDetails/{id}/appStoreReviewAttachments',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appStoreVersionExperimentTreatmentLocalizations/{id}/relationships/appPreviewSets
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appstoreversionexperimenttreatmentlocalizations-_id_-relationships-apppreviewsets}
   */
  async listAppStoreVersionExperimentTreatmentLocalizationsAppPreviewSetsLinkage(
    resourceId: string,
    query?: operations['appStoreVersionExperimentTreatmentLocalizations_appPreviewSets_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['appStoreVersionExperimentTreatmentLocalizations_appPreviewSets_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appStoreVersionExperimentTreatmentLocalizations/{id}/relationships/appPreviewSets',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appStoreVersionExperimentTreatmentLocalizations/{id}/appPreviewSets
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appstoreversionexperimenttreatmentlocalizations-_id_-apppreviewsets}
   */
  async listAppStoreVersionExperimentTreatmentLocalizationsAppPreviewSets(
    resourceId: string,
    query?: operations['appStoreVersionExperimentTreatmentLocalizations_appPreviewSets_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['appStoreVersionExperimentTreatmentLocalizations_appPreviewSets_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appStoreVersionExperimentTreatmentLocalizations/{id}/appPreviewSets',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appStoreVersionExperimentTreatmentLocalizations/{id}/relationships/appScreenshotSets
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appstoreversionexperimenttreatmentlocalizations-_id_-relationships-appscreenshotsets}
   */
  async listAppStoreVersionExperimentTreatmentLocalizationsAppScreenshotSetsLinkage(
    resourceId: string,
    query?: operations['appStoreVersionExperimentTreatmentLocalizations_appScreenshotSets_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['appStoreVersionExperimentTreatmentLocalizations_appScreenshotSets_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appStoreVersionExperimentTreatmentLocalizations/{id}/relationships/appScreenshotSets',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appStoreVersionExperimentTreatmentLocalizations/{id}/appScreenshotSets
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appstoreversionexperimenttreatmentlocalizations-_id_-appscreenshotsets}
   */
  async listAppStoreVersionExperimentTreatmentLocalizationsAppScreenshotSets(
    resourceId: string,
    query?: operations['appStoreVersionExperimentTreatmentLocalizations_appScreenshotSets_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['appStoreVersionExperimentTreatmentLocalizations_appScreenshotSets_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appStoreVersionExperimentTreatmentLocalizations/{id}/appScreenshotSets',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appStoreVersionExperimentTreatmentLocalizations/{id}/relationships/placements
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appstoreversionexperimenttreatmentlocalizations-_id_-relationships-placements}
   */
  async listAppStoreVersionExperimentTreatmentLocalizationsPlacementsLinkage(
    resourceId: string,
    query?: operations['appStoreVersionExperimentTreatmentLocalizations_placements_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['appStoreVersionExperimentTreatmentLocalizations_placements_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appStoreVersionExperimentTreatmentLocalizations/{id}/relationships/placements',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appStoreVersionExperimentTreatmentLocalizations/{id}/placements
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appstoreversionexperimenttreatmentlocalizations-_id_-placements}
   */
  async listAppStoreVersionExperimentTreatmentLocalizationsPlacements(
    resourceId: string,
    query?: operations['appStoreVersionExperimentTreatmentLocalizations_placements_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['appStoreVersionExperimentTreatmentLocalizations_placements_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appStoreVersionExperimentTreatmentLocalizations/{id}/placements',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appStoreVersionExperimentTreatments/{id}/relationships/appStoreVersionExperimentTreatmentLocalizations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appstoreversionexperimenttreatments-_id_-relationships-appstoreversionexperimenttreatmentlocalizations}
   */
  async listAppStoreVersionExperimentTreatmentsAppStoreVersionExperimentTreatmentLocalizationsLinkage(
    resourceId: string,
    query?: operations['appStoreVersionExperimentTreatments_appStoreVersionExperimentTreatmentLocalizations_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['appStoreVersionExperimentTreatments_appStoreVersionExperimentTreatmentLocalizations_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appStoreVersionExperimentTreatments/{id}/relationships/appStoreVersionExperimentTreatmentLocalizations',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appStoreVersionExperimentTreatments/{id}/appStoreVersionExperimentTreatmentLocalizations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appstoreversionexperimenttreatments-_id_-appstoreversionexperimenttreatmentlocalizations}
   */
  async listAppStoreVersionExperimentTreatmentsAppStoreVersionExperimentTreatmentLocalizations(
    resourceId: string,
    query?: operations['appStoreVersionExperimentTreatments_appStoreVersionExperimentTreatmentLocalizations_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['appStoreVersionExperimentTreatments_appStoreVersionExperimentTreatmentLocalizations_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appStoreVersionExperimentTreatments/{id}/appStoreVersionExperimentTreatmentLocalizations',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v2/appStoreVersionExperiments/{id}/relationships/appStoreVersionExperimentTreatments
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v2-appstoreversionexperiments-_id_-relationships-appstoreversionexperimenttreatments}
   */
  async listAppStoreVersionExperimentsV2AppStoreVersionExperimentTreatmentsLinkage(
    resourceId: string,
    query?: operations['appStoreVersionExperimentsV2_appStoreVersionExperimentTreatments_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['appStoreVersionExperimentsV2_appStoreVersionExperimentTreatments_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v2/appStoreVersionExperiments/{id}/relationships/appStoreVersionExperimentTreatments',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v2/appStoreVersionExperiments/{id}/appStoreVersionExperimentTreatments
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v2-appstoreversionexperiments-_id_-appstoreversionexperimenttreatments}
   */
  async listAppStoreVersionExperimentsV2AppStoreVersionExperimentTreatments(
    resourceId: string,
    query?: operations['appStoreVersionExperimentsV2_appStoreVersionExperimentTreatments_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['appStoreVersionExperimentsV2_appStoreVersionExperimentTreatments_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v2/appStoreVersionExperiments/{id}/appStoreVersionExperimentTreatments',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appStoreVersionExperiments/{id}/relationships/appStoreVersionExperimentTreatments
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appstoreversionexperiments-_id_-relationships-appstoreversionexperimenttreatments}
   */
  async listAppStoreVersionExperimentsAppStoreVersionExperimentTreatmentsLinkage(
    resourceId: string,
    query?: operations['appStoreVersionExperiments_appStoreVersionExperimentTreatments_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['appStoreVersionExperiments_appStoreVersionExperimentTreatments_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appStoreVersionExperiments/{id}/relationships/appStoreVersionExperimentTreatments',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appStoreVersionExperiments/{id}/appStoreVersionExperimentTreatments
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appstoreversionexperiments-_id_-appstoreversionexperimenttreatments}
   */
  async listAppStoreVersionExperimentsAppStoreVersionExperimentTreatments(
    resourceId: string,
    query?: operations['appStoreVersionExperiments_appStoreVersionExperimentTreatments_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['appStoreVersionExperiments_appStoreVersionExperimentTreatments_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appStoreVersionExperiments/{id}/appStoreVersionExperimentTreatments',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appStoreVersionLocalizations/{id}/relationships/appPreviewSets
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appstoreversionlocalizations-_id_-relationships-apppreviewsets}
   */
  async listAppStoreVersionLocalizationsAppPreviewSetsLinkage(
    resourceId: string,
    query?: operations['appStoreVersionLocalizations_appPreviewSets_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['appStoreVersionLocalizations_appPreviewSets_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appStoreVersionLocalizations/{id}/relationships/appPreviewSets',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appStoreVersionLocalizations/{id}/appPreviewSets
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appstoreversionlocalizations-_id_-apppreviewsets}
   */
  async listAppStoreVersionLocalizationsAppPreviewSets(
    resourceId: string,
    query?: operations['appStoreVersionLocalizations_appPreviewSets_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['appStoreVersionLocalizations_appPreviewSets_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appStoreVersionLocalizations/{id}/appPreviewSets',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appStoreVersionLocalizations/{id}/relationships/appScreenshotSets
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appstoreversionlocalizations-_id_-relationships-appscreenshotsets}
   */
  async listAppStoreVersionLocalizationsAppScreenshotSetsLinkage(
    resourceId: string,
    query?: operations['appStoreVersionLocalizations_appScreenshotSets_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['appStoreVersionLocalizations_appScreenshotSets_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appStoreVersionLocalizations/{id}/relationships/appScreenshotSets',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appStoreVersionLocalizations/{id}/appScreenshotSets
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appstoreversionlocalizations-_id_-appscreenshotsets}
   */
  async listAppStoreVersionLocalizationsAppScreenshotSets(
    resourceId: string,
    query?: operations['appStoreVersionLocalizations_appScreenshotSets_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['appStoreVersionLocalizations_appScreenshotSets_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appStoreVersionLocalizations/{id}/appScreenshotSets',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appStoreVersionLocalizations/{id}/relationships/placements
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appstoreversionlocalizations-_id_-relationships-placements}
   */
  async listAppStoreVersionLocalizationsPlacementsLinkage(
    resourceId: string,
    query?: operations['appStoreVersionLocalizations_placements_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['appStoreVersionLocalizations_placements_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appStoreVersionLocalizations/{id}/relationships/placements',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appStoreVersionLocalizations/{id}/placements
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appstoreversionlocalizations-_id_-placements}
   */
  async listAppStoreVersionLocalizationsPlacements(
    resourceId: string,
    query?: operations['appStoreVersionLocalizations_placements_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['appStoreVersionLocalizations_placements_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appStoreVersionLocalizations/{id}/placements',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appStoreVersionLocalizations/{id}/relationships/searchKeywords
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appstoreversionlocalizations-_id_-relationships-searchkeywords}
   */
  async listAppStoreVersionLocalizationsSearchKeywordsLinkage(
    resourceId: string,
    query?: operations['appStoreVersionLocalizations_searchKeywords_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['appStoreVersionLocalizations_searchKeywords_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appStoreVersionLocalizations/{id}/relationships/searchKeywords',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * POST /v1/appStoreVersionLocalizations/{id}/relationships/searchKeywords
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-appstoreversionlocalizations-_id_-relationships-searchkeywords}
   */
  async addAppStoreVersionLocalizationsSearchKeywordsLinkage(
    resourceId: string,
    document: operations['appStoreVersionLocalizations_searchKeywords_createToManyRelationship']['requestBody']['content']['application/json'],
  ): Promise<void> {
    const url = appleRequestUrl(
      '/v1/appStoreVersionLocalizations/{id}/relationships/searchKeywords',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('POST', url, document);
  }

  /**
   * DELETE /v1/appStoreVersionLocalizations/{id}/relationships/searchKeywords
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-appstoreversionlocalizations-_id_-relationships-searchkeywords}
   */
  async removeAppStoreVersionLocalizationsSearchKeywordsLinkage(
    resourceId: string,
    document: operations['appStoreVersionLocalizations_searchKeywords_deleteToManyRelationship']['requestBody']['content']['application/json'],
  ): Promise<void> {
    const url = appleRequestUrl(
      '/v1/appStoreVersionLocalizations/{id}/relationships/searchKeywords',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('DELETE', url, document);
  }

  /**
   * GET /v1/appStoreVersionLocalizations/{id}/searchKeywords
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appstoreversionlocalizations-_id_-searchkeywords}
   */
  async listAppStoreVersionLocalizationsSearchKeywords(
    resourceId: string,
    query?: operations['appStoreVersionLocalizations_searchKeywords_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['appStoreVersionLocalizations_searchKeywords_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appStoreVersionLocalizations/{id}/searchKeywords',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appStoreVersions/{id}/relationships/alternativeDistributionPackage
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appstoreversions-_id_-relationships-alternativedistributionpackage}
   */
  async getAppStoreVersionsAlternativeDistributionPackageLinkage(
    resourceId: string,
  ): Promise<
    operations['appStoreVersions_alternativeDistributionPackage_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appStoreVersions/{id}/relationships/alternativeDistributionPackage',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appStoreVersions/{id}/alternativeDistributionPackage
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appstoreversions-_id_-alternativedistributionpackage}
   */
  async getAppStoreVersionsAlternativeDistributionPackage(
    resourceId: string,
    query?: operations['appStoreVersions_alternativeDistributionPackage_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['appStoreVersions_alternativeDistributionPackage_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appStoreVersions/{id}/alternativeDistributionPackage',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appStoreVersions/{id}/relationships/appClipDefaultExperience
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appstoreversions-_id_-relationships-appclipdefaultexperience}
   */
  async getAppStoreVersionsAppClipDefaultExperienceLinkage(
    resourceId: string,
  ): Promise<
    operations['appStoreVersions_appClipDefaultExperience_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appStoreVersions/{id}/relationships/appClipDefaultExperience',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/appStoreVersions/{id}/relationships/appClipDefaultExperience
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-appstoreversions-_id_-relationships-appclipdefaultexperience}
   */
  async updateAppStoreVersionsAppClipDefaultExperienceLinkage(
    resourceId: string,
    document: operations['appStoreVersions_appClipDefaultExperience_updateToOneRelationship']['requestBody']['content']['application/json'],
  ): Promise<void> {
    const url = appleRequestUrl(
      '/v1/appStoreVersions/{id}/relationships/appClipDefaultExperience',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('PATCH', url, document);
  }

  /**
   * GET /v1/appStoreVersions/{id}/appClipDefaultExperience
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appstoreversions-_id_-appclipdefaultexperience}
   */
  async getAppStoreVersionsAppClipDefaultExperience(
    resourceId: string,
    query?: operations['appStoreVersions_appClipDefaultExperience_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['appStoreVersions_appClipDefaultExperience_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appStoreVersions/{id}/appClipDefaultExperience',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appStoreVersions/{id}/relationships/appStoreReviewDetail
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appstoreversions-_id_-relationships-appstorereviewdetail}
   */
  async getAppStoreVersionsAppStoreReviewDetailLinkage(
    resourceId: string,
  ): Promise<
    operations['appStoreVersions_appStoreReviewDetail_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appStoreVersions/{id}/relationships/appStoreReviewDetail',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appStoreVersions/{id}/appStoreReviewDetail
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appstoreversions-_id_-appstorereviewdetail}
   */
  async getAppStoreVersionsAppStoreReviewDetail(
    resourceId: string,
    query?: operations['appStoreVersions_appStoreReviewDetail_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['appStoreVersions_appStoreReviewDetail_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appStoreVersions/{id}/appStoreReviewDetail',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appStoreVersions/{id}/relationships/appStoreVersionExperiments
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appstoreversions-_id_-relationships-appstoreversionexperiments}
   */
  async listAppStoreVersionsAppStoreVersionExperimentsLinkage(
    resourceId: string,
    query?: operations['appStoreVersions_appStoreVersionExperiments_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['appStoreVersions_appStoreVersionExperiments_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appStoreVersions/{id}/relationships/appStoreVersionExperiments',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appStoreVersions/{id}/appStoreVersionExperiments
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appstoreversions-_id_-appstoreversionexperiments}
   */
  async listAppStoreVersionsAppStoreVersionExperiments(
    resourceId: string,
    query?: operations['appStoreVersions_appStoreVersionExperiments_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['appStoreVersions_appStoreVersionExperiments_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appStoreVersions/{id}/appStoreVersionExperiments',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appStoreVersions/{id}/relationships/appStoreVersionExperimentsV2
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appstoreversions-_id_-relationships-appstoreversionexperimentsv2}
   */
  async listAppStoreVersionsAppStoreVersionExperimentsV2Linkage(
    resourceId: string,
    query?: operations['appStoreVersions_appStoreVersionExperimentsV2_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['appStoreVersions_appStoreVersionExperimentsV2_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appStoreVersions/{id}/relationships/appStoreVersionExperimentsV2',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appStoreVersions/{id}/appStoreVersionExperimentsV2
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appstoreversions-_id_-appstoreversionexperimentsv2}
   */
  async listAppStoreVersionsAppStoreVersionExperimentsV2(
    resourceId: string,
    query?: operations['appStoreVersions_appStoreVersionExperimentsV2_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['appStoreVersions_appStoreVersionExperimentsV2_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appStoreVersions/{id}/appStoreVersionExperimentsV2',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appStoreVersions/{id}/relationships/appStoreVersionLocalizations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appstoreversions-_id_-relationships-appstoreversionlocalizations}
   */
  async listAppStoreVersionsAppStoreVersionLocalizationsLinkage(
    resourceId: string,
    query?: operations['appStoreVersions_appStoreVersionLocalizations_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['appStoreVersions_appStoreVersionLocalizations_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appStoreVersions/{id}/relationships/appStoreVersionLocalizations',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appStoreVersions/{id}/appStoreVersionLocalizations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appstoreversions-_id_-appstoreversionlocalizations}
   */
  async listAppStoreVersionsAppStoreVersionLocalizations(
    resourceId: string,
    query?: operations['appStoreVersions_appStoreVersionLocalizations_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['appStoreVersions_appStoreVersionLocalizations_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appStoreVersions/{id}/appStoreVersionLocalizations',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appStoreVersions/{id}/relationships/appStoreVersionPhasedRelease
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appstoreversions-_id_-relationships-appstoreversionphasedrelease}
   */
  async getAppStoreVersionsAppStoreVersionPhasedReleaseLinkage(
    resourceId: string,
  ): Promise<
    operations['appStoreVersions_appStoreVersionPhasedRelease_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appStoreVersions/{id}/relationships/appStoreVersionPhasedRelease',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appStoreVersions/{id}/appStoreVersionPhasedRelease
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appstoreversions-_id_-appstoreversionphasedrelease}
   */
  async getAppStoreVersionsAppStoreVersionPhasedRelease(
    resourceId: string,
    query?: operations['appStoreVersions_appStoreVersionPhasedRelease_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['appStoreVersions_appStoreVersionPhasedRelease_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appStoreVersions/{id}/appStoreVersionPhasedRelease',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appStoreVersions/{id}/relationships/appStoreVersionSubmission
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appstoreversions-_id_-relationships-appstoreversionsubmission}
   */
  async getAppStoreVersionsAppStoreVersionSubmissionLinkage(
    resourceId: string,
  ): Promise<
    operations['appStoreVersions_appStoreVersionSubmission_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appStoreVersions/{id}/relationships/appStoreVersionSubmission',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appStoreVersions/{id}/appStoreVersionSubmission
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appstoreversions-_id_-appstoreversionsubmission}
   */
  async getAppStoreVersionsAppStoreVersionSubmission(
    resourceId: string,
    query?: operations['appStoreVersions_appStoreVersionSubmission_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['appStoreVersions_appStoreVersionSubmission_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appStoreVersions/{id}/appStoreVersionSubmission',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appStoreVersions/{id}/relationships/build
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appstoreversions-_id_-relationships-build}
   */
  async getAppStoreVersionsBuildLinkage(
    resourceId: string,
  ): Promise<
    operations['appStoreVersions_build_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appStoreVersions/{id}/relationships/build',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/appStoreVersions/{id}/relationships/build
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-appstoreversions-_id_-relationships-build}
   */
  async updateAppStoreVersionsBuildLinkage(
    resourceId: string,
    document: operations['appStoreVersions_build_updateToOneRelationship']['requestBody']['content']['application/json'],
  ): Promise<void> {
    const url = appleRequestUrl(
      '/v1/appStoreVersions/{id}/relationships/build',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('PATCH', url, document);
  }

  /**
   * GET /v1/appStoreVersions/{id}/build
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appstoreversions-_id_-build}
   */
  async getAppStoreVersionsBuild(
    resourceId: string,
    query?: operations['appStoreVersions_build_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['appStoreVersions_build_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appStoreVersions/{id}/build', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appStoreVersions/{id}/relationships/customerReviews
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appstoreversions-_id_-relationships-customerreviews}
   */
  async listAppStoreVersionsCustomerReviewsLinkage(
    resourceId: string,
    query?: operations['appStoreVersions_customerReviews_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['appStoreVersions_customerReviews_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appStoreVersions/{id}/relationships/customerReviews',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appStoreVersions/{id}/customerReviews
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appstoreversions-_id_-customerreviews}
   */
  async listAppStoreVersionsCustomerReviews(
    resourceId: string,
    query?: operations['appStoreVersions_customerReviews_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['appStoreVersions_customerReviews_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appStoreVersions/{id}/customerReviews', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appStoreVersions/{id}/relationships/gameCenterAppVersion
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appstoreversions-_id_-relationships-gamecenterappversion}
   */
  async getAppStoreVersionsGameCenterAppVersionLinkage(
    resourceId: string,
  ): Promise<
    operations['appStoreVersions_gameCenterAppVersion_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appStoreVersions/{id}/relationships/gameCenterAppVersion',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appStoreVersions/{id}/gameCenterAppVersion
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appstoreversions-_id_-gamecenterappversion}
   */
  async getAppStoreVersionsGameCenterAppVersion(
    resourceId: string,
    query?: operations['appStoreVersions_gameCenterAppVersion_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['appStoreVersions_gameCenterAppVersion_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appStoreVersions/{id}/gameCenterAppVersion',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appStoreVersions/{id}/relationships/routingAppCoverage
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appstoreversions-_id_-relationships-routingappcoverage}
   */
  async getAppStoreVersionsRoutingAppCoverageLinkage(
    resourceId: string,
  ): Promise<
    operations['appStoreVersions_routingAppCoverage_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/appStoreVersions/{id}/relationships/routingAppCoverage',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appStoreVersions/{id}/routingAppCoverage
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appstoreversions-_id_-routingappcoverage}
   */
  async getAppStoreVersionsRoutingAppCoverage(
    resourceId: string,
    query?: operations['appStoreVersions_routingAppCoverage_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['appStoreVersions_routingAppCoverage_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appStoreVersions/{id}/routingAppCoverage', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appTags/{id}/relationships/territories
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apptags-_id_-relationships-territories}
   */
  async listAppTagsTerritoriesLinkage(
    resourceId: string,
    query?: operations['appTags_territories_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['appTags_territories_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appTags/{id}/relationships/territories', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/appTags/{id}/territories
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apptags-_id_-territories}
   */
  async listAppTagsTerritories(
    resourceId: string,
    query?: operations['appTags_territories_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['appTags_territories_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/appTags/{id}/territories', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/relationships/accessibilityDeclarations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-relationships-accessibilitydeclarations}
   */
  async listAppsAccessibilityDeclarationsLinkage(
    resourceId: string,
    query?: operations['apps_accessibilityDeclarations_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['apps_accessibilityDeclarations_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/apps/{id}/relationships/accessibilityDeclarations',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/accessibilityDeclarations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-accessibilitydeclarations}
   */
  async listAppsAccessibilityDeclarations(
    resourceId: string,
    query?: operations['apps_accessibilityDeclarations_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['apps_accessibilityDeclarations_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/apps/{id}/accessibilityDeclarations', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/relationships/alternativeDistributionKey
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-relationships-alternativedistributionkey}
   */
  async getAppsAlternativeDistributionKeyLinkage(
    resourceId: string,
  ): Promise<
    operations['apps_alternativeDistributionKey_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/apps/{id}/relationships/alternativeDistributionKey',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/alternativeDistributionKey
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-alternativedistributionkey}
   */
  async getAppsAlternativeDistributionKey(
    resourceId: string,
    query?: operations['apps_alternativeDistributionKey_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['apps_alternativeDistributionKey_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/apps/{id}/alternativeDistributionKey', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/relationships/analyticsReportRequests
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-relationships-analyticsreportrequests}
   */
  async listAppsAnalyticsReportRequestsLinkage(
    resourceId: string,
    query?: operations['apps_analyticsReportRequests_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['apps_analyticsReportRequests_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/apps/{id}/relationships/analyticsReportRequests',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/analyticsReportRequests
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-analyticsreportrequests}
   */
  async listAppsAnalyticsReportRequests(
    resourceId: string,
    query?: operations['apps_analyticsReportRequests_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['apps_analyticsReportRequests_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/apps/{id}/analyticsReportRequests', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/relationships/androidToIosAppMappingDetails
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-relationships-androidtoiosappmappingdetails}
   */
  async listAppsAndroidToIosAppMappingDetailsLinkage(
    resourceId: string,
    query?: operations['apps_androidToIosAppMappingDetails_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['apps_androidToIosAppMappingDetails_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/apps/{id}/relationships/androidToIosAppMappingDetails',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/androidToIosAppMappingDetails
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-androidtoiosappmappingdetails}
   */
  async listAppsAndroidToIosAppMappingDetails(
    resourceId: string,
    query?: operations['apps_androidToIosAppMappingDetails_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['apps_androidToIosAppMappingDetails_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/apps/{id}/androidToIosAppMappingDetails', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/relationships/appAvailabilityV2
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-relationships-appavailabilityv2}
   */
  async getAppsAppAvailabilityV2Linkage(
    resourceId: string,
  ): Promise<
    operations['apps_appAvailabilityV2_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/apps/{id}/relationships/appAvailabilityV2',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/appAvailabilityV2
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-appavailabilityv2}
   */
  async getAppsAppAvailabilityV2(
    resourceId: string,
    query?: operations['apps_appAvailabilityV2_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['apps_appAvailabilityV2_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/apps/{id}/appAvailabilityV2', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/relationships/appClips
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-relationships-appclips}
   */
  async listAppsAppClipsLinkage(
    resourceId: string,
    query?: operations['apps_appClips_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['apps_appClips_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/apps/{id}/relationships/appClips', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/appClips
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-appclips}
   */
  async listAppsAppClips(
    resourceId: string,
    query?: operations['apps_appClips_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['apps_appClips_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/apps/{id}/appClips', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/relationships/appCustomProductPages
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-relationships-appcustomproductpages}
   */
  async listAppsAppCustomProductPagesLinkage(
    resourceId: string,
    query?: operations['apps_appCustomProductPages_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['apps_appCustomProductPages_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/apps/{id}/relationships/appCustomProductPages',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/appCustomProductPages
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-appcustomproductpages}
   */
  async listAppsAppCustomProductPages(
    resourceId: string,
    query?: operations['apps_appCustomProductPages_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['apps_appCustomProductPages_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/apps/{id}/appCustomProductPages', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/relationships/appEncryptionDeclarations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-relationships-appencryptiondeclarations}
   */
  async listAppsAppEncryptionDeclarationsLinkage(
    resourceId: string,
    query?: operations['apps_appEncryptionDeclarations_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['apps_appEncryptionDeclarations_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/apps/{id}/relationships/appEncryptionDeclarations',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/appEncryptionDeclarations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-appencryptiondeclarations}
   */
  async listAppsAppEncryptionDeclarations(
    resourceId: string,
    query?: operations['apps_appEncryptionDeclarations_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['apps_appEncryptionDeclarations_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/apps/{id}/appEncryptionDeclarations', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/relationships/appEvents
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-relationships-appevents}
   */
  async listAppsAppEventsLinkage(
    resourceId: string,
    query?: operations['apps_appEvents_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['apps_appEvents_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/apps/{id}/relationships/appEvents', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/appEvents
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-appevents}
   */
  async listAppsAppEvents(
    resourceId: string,
    query?: operations['apps_appEvents_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['apps_appEvents_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/apps/{id}/appEvents', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/relationships/appInfos
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-relationships-appinfos}
   */
  async listAppsAppInfosLinkage(
    resourceId: string,
    query?: operations['apps_appInfos_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['apps_appInfos_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/apps/{id}/relationships/appInfos', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/appInfos
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-appinfos}
   */
  async listAppsAppInfos(
    resourceId: string,
    query?: operations['apps_appInfos_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['apps_appInfos_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/apps/{id}/appInfos', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/relationships/appPricePoints
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-relationships-apppricepoints}
   */
  async listAppsAppPricePointsLinkage(
    resourceId: string,
    query?: operations['apps_appPricePoints_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['apps_appPricePoints_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/apps/{id}/relationships/appPricePoints', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/appPricePoints
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-apppricepoints}
   */
  async listAppsAppPricePoints(
    resourceId: string,
    query?: operations['apps_appPricePoints_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['apps_appPricePoints_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/apps/{id}/appPricePoints', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/relationships/appPriceSchedule
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-relationships-apppriceschedule}
   */
  async getAppsAppPriceScheduleLinkage(
    resourceId: string,
  ): Promise<
    operations['apps_appPriceSchedule_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/apps/{id}/relationships/appPriceSchedule',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/appPriceSchedule
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-apppriceschedule}
   */
  async getAppsAppPriceSchedule(
    resourceId: string,
    query?: operations['apps_appPriceSchedule_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['apps_appPriceSchedule_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/apps/{id}/appPriceSchedule', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/relationships/appStoreVersionExperimentsV2
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-relationships-appstoreversionexperimentsv2}
   */
  async listAppsAppStoreVersionExperimentsV2Linkage(
    resourceId: string,
    query?: operations['apps_appStoreVersionExperimentsV2_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['apps_appStoreVersionExperimentsV2_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/apps/{id}/relationships/appStoreVersionExperimentsV2',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/appStoreVersionExperimentsV2
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-appstoreversionexperimentsv2}
   */
  async listAppsAppStoreVersionExperimentsV2(
    resourceId: string,
    query?: operations['apps_appStoreVersionExperimentsV2_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['apps_appStoreVersionExperimentsV2_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/apps/{id}/appStoreVersionExperimentsV2', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/relationships/appStoreVersions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-relationships-appstoreversions}
   */
  async listAppsAppStoreVersionsLinkage(
    resourceId: string,
    query?: operations['apps_appStoreVersions_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['apps_appStoreVersions_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/apps/{id}/relationships/appStoreVersions', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/appStoreVersions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-appstoreversions}
   */
  async listAppsAppStoreVersions(
    resourceId: string,
    query?: operations['apps_appStoreVersions_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['apps_appStoreVersions_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/apps/{id}/appStoreVersions', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/relationships/appTags
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-relationships-apptags}
   */
  async listAppsAppTagsLinkage(
    resourceId: string,
    query?: operations['apps_appTags_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['apps_appTags_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/apps/{id}/relationships/appTags', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/appTags
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-apptags}
   */
  async listAppsAppTags(
    resourceId: string,
    query?: operations['apps_appTags_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['apps_appTags_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/apps/{id}/appTags', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/relationships/assetLibrary
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-relationships-assetlibrary}
   */
  async getAppsAssetLibraryLinkage(
    resourceId: string,
  ): Promise<
    operations['apps_assetLibrary_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/apps/{id}/relationships/assetLibrary', resourceId, undefined);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/assetLibrary
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-assetlibrary}
   */
  async getAppsAssetLibrary(
    resourceId: string,
    query?: operations['apps_assetLibrary_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['apps_assetLibrary_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/apps/{id}/assetLibrary', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/relationships/backgroundAssets
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-relationships-backgroundassets}
   */
  async listAppsBackgroundAssetsLinkage(
    resourceId: string,
    query?: operations['apps_backgroundAssets_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['apps_backgroundAssets_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/apps/{id}/relationships/backgroundAssets', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/backgroundAssets
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-backgroundassets}
   */
  async listAppsBackgroundAssets(
    resourceId: string,
    query?: operations['apps_backgroundAssets_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['apps_backgroundAssets_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/apps/{id}/backgroundAssets', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/relationships/betaAppLocalizations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-relationships-betaapplocalizations}
   */
  async listAppsBetaAppLocalizationsLinkage(
    resourceId: string,
    query?: operations['apps_betaAppLocalizations_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['apps_betaAppLocalizations_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/apps/{id}/relationships/betaAppLocalizations',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/betaAppLocalizations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-betaapplocalizations}
   */
  async listAppsBetaAppLocalizations(
    resourceId: string,
    query?: operations['apps_betaAppLocalizations_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['apps_betaAppLocalizations_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/apps/{id}/betaAppLocalizations', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/relationships/betaAppReviewDetail
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-relationships-betaappreviewdetail}
   */
  async getAppsBetaAppReviewDetailLinkage(
    resourceId: string,
  ): Promise<
    operations['apps_betaAppReviewDetail_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/apps/{id}/relationships/betaAppReviewDetail',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/betaAppReviewDetail
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-betaappreviewdetail}
   */
  async getAppsBetaAppReviewDetail(
    resourceId: string,
    query?: operations['apps_betaAppReviewDetail_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['apps_betaAppReviewDetail_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/apps/{id}/betaAppReviewDetail', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/relationships/betaFeedbackCrashSubmissions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-relationships-betafeedbackcrashsubmissions}
   */
  async listAppsBetaFeedbackCrashSubmissionsLinkage(
    resourceId: string,
    query?: operations['apps_betaFeedbackCrashSubmissions_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['apps_betaFeedbackCrashSubmissions_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/apps/{id}/relationships/betaFeedbackCrashSubmissions',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/betaFeedbackCrashSubmissions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-betafeedbackcrashsubmissions}
   */
  async listAppsBetaFeedbackCrashSubmissions(
    resourceId: string,
    query?: operations['apps_betaFeedbackCrashSubmissions_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['apps_betaFeedbackCrashSubmissions_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/apps/{id}/betaFeedbackCrashSubmissions', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/relationships/betaFeedbackScreenshotSubmissions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-relationships-betafeedbackscreenshotsubmissions}
   */
  async listAppsBetaFeedbackScreenshotSubmissionsLinkage(
    resourceId: string,
    query?: operations['apps_betaFeedbackScreenshotSubmissions_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['apps_betaFeedbackScreenshotSubmissions_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/apps/{id}/relationships/betaFeedbackScreenshotSubmissions',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/betaFeedbackScreenshotSubmissions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-betafeedbackscreenshotsubmissions}
   */
  async listAppsBetaFeedbackScreenshotSubmissions(
    resourceId: string,
    query?: operations['apps_betaFeedbackScreenshotSubmissions_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['apps_betaFeedbackScreenshotSubmissions_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/apps/{id}/betaFeedbackScreenshotSubmissions',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/relationships/betaGroups
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-relationships-betagroups}
   */
  async listAppsBetaGroupsLinkage(
    resourceId: string,
    query?: operations['apps_betaGroups_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['apps_betaGroups_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/apps/{id}/relationships/betaGroups', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/betaGroups
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-betagroups}
   */
  async listAppsBetaGroups(
    resourceId: string,
    query?: operations['apps_betaGroups_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['apps_betaGroups_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/apps/{id}/betaGroups', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/relationships/betaLicenseAgreement
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-relationships-betalicenseagreement}
   */
  async getAppsBetaLicenseAgreementLinkage(
    resourceId: string,
  ): Promise<
    operations['apps_betaLicenseAgreement_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/apps/{id}/relationships/betaLicenseAgreement',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/betaLicenseAgreement
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-betalicenseagreement}
   */
  async getAppsBetaLicenseAgreement(
    resourceId: string,
    query?: operations['apps_betaLicenseAgreement_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['apps_betaLicenseAgreement_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/apps/{id}/betaLicenseAgreement', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * DELETE /v1/apps/{id}/relationships/betaTesters
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-apps-_id_-relationships-betatesters}
   */
  async removeAppsBetaTestersLinkage(
    resourceId: string,
    document: operations['apps_betaTesters_deleteToManyRelationship']['requestBody']['content']['application/json'],
  ): Promise<void> {
    const url = appleRequestUrl('/v1/apps/{id}/relationships/betaTesters', resourceId, undefined);
    await this.apple.sendJson('DELETE', url, document);
  }

  /**
   * GET /v1/apps/{id}/relationships/buildUploads
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-relationships-builduploads}
   */
  async listAppsBuildUploadsLinkage(
    resourceId: string,
    query?: operations['apps_buildUploads_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['apps_buildUploads_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/apps/{id}/relationships/buildUploads', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/buildUploads
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-builduploads}
   */
  async listAppsBuildUploads(
    resourceId: string,
    query?: operations['apps_buildUploads_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['apps_buildUploads_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/apps/{id}/buildUploads', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/relationships/builds
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-relationships-builds}
   */
  async listAppsBuildsLinkage(
    resourceId: string,
    query?: operations['apps_builds_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['apps_builds_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/apps/{id}/relationships/builds', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/builds
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-builds}
   */
  async listAppsBuilds(
    resourceId: string,
    query?: operations['apps_builds_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['apps_builds_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/apps/{id}/builds', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/relationships/ciProduct
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-relationships-ciproduct}
   */
  async getAppsCiProductLinkage(
    resourceId: string,
  ): Promise<
    operations['apps_ciProduct_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/apps/{id}/relationships/ciProduct', resourceId, undefined);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/ciProduct
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-ciproduct}
   */
  async getAppsCiProduct(
    resourceId: string,
    query?: operations['apps_ciProduct_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['apps_ciProduct_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/apps/{id}/ciProduct', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/customerReviewSummarizations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-customerreviewsummarizations}
   */
  async listAppsCustomerReviewSummarizations(
    resourceId: string,
    query?: operations['apps_customerReviewSummarizations_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['apps_customerReviewSummarizations_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/apps/{id}/customerReviewSummarizations', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/relationships/customerReviews
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-relationships-customerreviews}
   */
  async listAppsCustomerReviewsLinkage(
    resourceId: string,
    query?: operations['apps_customerReviews_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['apps_customerReviews_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/apps/{id}/relationships/customerReviews', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/customerReviews
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-customerreviews}
   */
  async listAppsCustomerReviews(
    resourceId: string,
    query?: operations['apps_customerReviews_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['apps_customerReviews_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/apps/{id}/customerReviews', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/relationships/endUserLicenseAgreement
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-relationships-enduserlicenseagreement}
   */
  async getAppsEndUserLicenseAgreementLinkage(
    resourceId: string,
  ): Promise<
    operations['apps_endUserLicenseAgreement_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/apps/{id}/relationships/endUserLicenseAgreement',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/endUserLicenseAgreement
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-enduserlicenseagreement}
   */
  async getAppsEndUserLicenseAgreement(
    resourceId: string,
    query?: operations['apps_endUserLicenseAgreement_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['apps_endUserLicenseAgreement_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/apps/{id}/endUserLicenseAgreement', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/relationships/gameCenterDetail
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-relationships-gamecenterdetail}
   */
  async getAppsGameCenterDetailLinkage(
    resourceId: string,
  ): Promise<
    operations['apps_gameCenterDetail_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/apps/{id}/relationships/gameCenterDetail',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/gameCenterDetail
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-gamecenterdetail}
   */
  async getAppsGameCenterDetail(
    resourceId: string,
    query?: operations['apps_gameCenterDetail_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['apps_gameCenterDetail_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/apps/{id}/gameCenterDetail', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/relationships/gameCenterEnabledVersions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-relationships-gamecenterenabledversions}
   */
  async listAppsGameCenterEnabledVersionsLinkage(
    resourceId: string,
    query?: operations['apps_gameCenterEnabledVersions_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['apps_gameCenterEnabledVersions_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/apps/{id}/relationships/gameCenterEnabledVersions',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/gameCenterEnabledVersions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-gamecenterenabledversions}
   */
  async listAppsGameCenterEnabledVersions(
    resourceId: string,
    query?: operations['apps_gameCenterEnabledVersions_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['apps_gameCenterEnabledVersions_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/apps/{id}/gameCenterEnabledVersions', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/relationships/inAppPurchases
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-relationships-inapppurchases}
   */
  async listAppsInAppPurchasesLinkage(
    resourceId: string,
    query?: operations['apps_inAppPurchases_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['apps_inAppPurchases_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/apps/{id}/relationships/inAppPurchases', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/inAppPurchases
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-inapppurchases}
   */
  async listAppsInAppPurchases(
    resourceId: string,
    query?: operations['apps_inAppPurchases_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['apps_inAppPurchases_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/apps/{id}/inAppPurchases', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/relationships/inAppPurchasesV2
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-relationships-inapppurchasesv2}
   */
  async listAppsInAppPurchasesV2Linkage(
    resourceId: string,
    query?: operations['apps_inAppPurchasesV2_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['apps_inAppPurchasesV2_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/apps/{id}/relationships/inAppPurchasesV2', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/inAppPurchasesV2
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-inapppurchasesv2}
   */
  async listAppsInAppPurchasesV2(
    resourceId: string,
    query?: operations['apps_inAppPurchasesV2_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['apps_inAppPurchasesV2_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/apps/{id}/inAppPurchasesV2', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/relationships/marketplaceSearchDetail
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-relationships-marketplacesearchdetail}
   */
  async getAppsMarketplaceSearchDetailLinkage(
    resourceId: string,
  ): Promise<
    operations['apps_marketplaceSearchDetail_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/apps/{id}/relationships/marketplaceSearchDetail',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/marketplaceSearchDetail
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-marketplacesearchdetail}
   */
  async getAppsMarketplaceSearchDetail(
    resourceId: string,
    query?: operations['apps_marketplaceSearchDetail_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['apps_marketplaceSearchDetail_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/apps/{id}/marketplaceSearchDetail', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/perfPowerMetrics
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-perfpowermetrics}
   */
  async listAppsPerfPowerMetrics(
    resourceId: string,
    query?: operations['apps_perfPowerMetrics_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['apps_perfPowerMetrics_getToManyRelated']['responses'][200]['content']['application/vnd.apple.xcode-metrics+json']
  > {
    const url = appleRequestUrl('/v1/apps/{id}/perfPowerMetrics', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/performanceOverviews
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-performanceoverviews}
   */
  async listAppsPerformanceOverviews(
    resourceId: string,
    query?: operations['apps_performanceOverviews_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['apps_performanceOverviews_getToManyRelated']['responses'][200]['content']['application/vnd.apple.xcode-overview+json']
  > {
    const url = appleRequestUrl('/v1/apps/{id}/performanceOverviews', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/relationships/preReleaseVersions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-relationships-prereleaseversions}
   */
  async listAppsPreReleaseVersionsLinkage(
    resourceId: string,
    query?: operations['apps_preReleaseVersions_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['apps_preReleaseVersions_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/apps/{id}/relationships/preReleaseVersions',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/preReleaseVersions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-prereleaseversions}
   */
  async listAppsPreReleaseVersions(
    resourceId: string,
    query?: operations['apps_preReleaseVersions_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['apps_preReleaseVersions_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/apps/{id}/preReleaseVersions', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/relationships/promotedPurchases
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-relationships-promotedpurchases}
   */
  async listAppsPromotedPurchasesLinkage(
    resourceId: string,
    query?: operations['apps_promotedPurchases_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['apps_promotedPurchases_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/apps/{id}/relationships/promotedPurchases', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/apps/{id}/relationships/promotedPurchases
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-apps-_id_-relationships-promotedpurchases}
   */
  async replaceAppsPromotedPurchasesLinkage(
    resourceId: string,
    document: operations['apps_promotedPurchases_replaceToManyRelationship']['requestBody']['content']['application/json'],
  ): Promise<void> {
    const url = appleRequestUrl(
      '/v1/apps/{id}/relationships/promotedPurchases',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('PATCH', url, document);
  }

  /**
   * GET /v1/apps/{id}/promotedPurchases
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-promotedpurchases}
   */
  async listAppsPromotedPurchases(
    resourceId: string,
    query?: operations['apps_promotedPurchases_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['apps_promotedPurchases_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/apps/{id}/promotedPurchases', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/relationships/retentionMessages
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-relationships-retentionmessages}
   */
  async listAppsRetentionMessagesLinkage(
    resourceId: string,
    query?: operations['apps_retentionMessages_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['apps_retentionMessages_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/apps/{id}/relationships/retentionMessages', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/retentionMessages
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-retentionmessages}
   */
  async listAppsRetentionMessages(
    resourceId: string,
    query?: operations['apps_retentionMessages_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['apps_retentionMessages_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/apps/{id}/retentionMessages', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/relationships/reviewSubmissions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-relationships-reviewsubmissions}
   */
  async listAppsReviewSubmissionsLinkage(
    resourceId: string,
    query?: operations['apps_reviewSubmissions_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['apps_reviewSubmissions_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/apps/{id}/relationships/reviewSubmissions', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/reviewSubmissions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-reviewsubmissions}
   */
  async listAppsReviewSubmissions(
    resourceId: string,
    query?: operations['apps_reviewSubmissions_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['apps_reviewSubmissions_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/apps/{id}/reviewSubmissions', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/relationships/searchKeywords
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-relationships-searchkeywords}
   */
  async listAppsSearchKeywordsLinkage(
    resourceId: string,
    query?: operations['apps_searchKeywords_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['apps_searchKeywords_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/apps/{id}/relationships/searchKeywords', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/searchKeywords
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-searchkeywords}
   */
  async listAppsSearchKeywords(
    resourceId: string,
    query?: operations['apps_searchKeywords_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['apps_searchKeywords_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/apps/{id}/searchKeywords', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/relationships/subscriptionGracePeriod
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-relationships-subscriptiongraceperiod}
   */
  async getAppsSubscriptionGracePeriodLinkage(
    resourceId: string,
  ): Promise<
    operations['apps_subscriptionGracePeriod_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/apps/{id}/relationships/subscriptionGracePeriod',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/subscriptionGracePeriod
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-subscriptiongraceperiod}
   */
  async getAppsSubscriptionGracePeriod(
    resourceId: string,
    query?: operations['apps_subscriptionGracePeriod_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['apps_subscriptionGracePeriod_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/apps/{id}/subscriptionGracePeriod', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/relationships/subscriptionGroups
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-relationships-subscriptiongroups}
   */
  async listAppsSubscriptionGroupsLinkage(
    resourceId: string,
    query?: operations['apps_subscriptionGroups_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['apps_subscriptionGroups_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/apps/{id}/relationships/subscriptionGroups',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/subscriptionGroups
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-subscriptiongroups}
   */
  async listAppsSubscriptionGroups(
    resourceId: string,
    query?: operations['apps_subscriptionGroups_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['apps_subscriptionGroups_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/apps/{id}/subscriptionGroups', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/relationships/webhooks
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-relationships-webhooks}
   */
  async listAppsWebhooksLinkage(
    resourceId: string,
    query?: operations['apps_webhooks_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['apps_webhooks_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/apps/{id}/relationships/webhooks', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/webhooks
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-webhooks}
   */
  async listAppsWebhooks(
    resourceId: string,
    query?: operations['apps_webhooks_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['apps_webhooks_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/apps/{id}/webhooks', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/backgroundAssetVersions/{id}/relationships/backgroundAssetUploadFiles
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-backgroundassetversions-_id_-relationships-backgroundassetuploadfiles}
   */
  async listBackgroundAssetVersionsBackgroundAssetUploadFilesLinkage(
    resourceId: string,
    query?: operations['backgroundAssetVersions_backgroundAssetUploadFiles_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['backgroundAssetVersions_backgroundAssetUploadFiles_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/backgroundAssetVersions/{id}/relationships/backgroundAssetUploadFiles',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/backgroundAssetVersions/{id}/backgroundAssetUploadFiles
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-backgroundassetversions-_id_-backgroundassetuploadfiles}
   */
  async listBackgroundAssetVersionsBackgroundAssetUploadFiles(
    resourceId: string,
    query?: operations['backgroundAssetVersions_backgroundAssetUploadFiles_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['backgroundAssetVersions_backgroundAssetUploadFiles_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/backgroundAssetVersions/{id}/backgroundAssetUploadFiles',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/backgroundAssets/{id}/relationships/versions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-backgroundassets-_id_-relationships-versions}
   */
  async listBackgroundAssetsVersionsLinkage(
    resourceId: string,
    query?: operations['backgroundAssets_versions_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['backgroundAssets_versions_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/backgroundAssets/{id}/relationships/versions',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/backgroundAssets/{id}/versions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-backgroundassets-_id_-versions}
   */
  async listBackgroundAssetsVersions(
    resourceId: string,
    query?: operations['backgroundAssets_versions_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['backgroundAssets_versions_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/backgroundAssets/{id}/versions', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/betaAppLocalizations/{id}/relationships/app
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-betaapplocalizations-_id_-relationships-app}
   */
  async getBetaAppLocalizationsAppLinkage(
    resourceId: string,
  ): Promise<
    operations['betaAppLocalizations_app_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/betaAppLocalizations/{id}/relationships/app',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/betaAppLocalizations/{id}/app
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-betaapplocalizations-_id_-app}
   */
  async getBetaAppLocalizationsApp(
    resourceId: string,
    query?: operations['betaAppLocalizations_app_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['betaAppLocalizations_app_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/betaAppLocalizations/{id}/app', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/betaAppReviewDetails/{id}/relationships/app
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-betaappreviewdetails-_id_-relationships-app}
   */
  async getBetaAppReviewDetailsAppLinkage(
    resourceId: string,
  ): Promise<
    operations['betaAppReviewDetails_app_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/betaAppReviewDetails/{id}/relationships/app',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/betaAppReviewDetails/{id}/app
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-betaappreviewdetails-_id_-app}
   */
  async getBetaAppReviewDetailsApp(
    resourceId: string,
    query?: operations['betaAppReviewDetails_app_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['betaAppReviewDetails_app_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/betaAppReviewDetails/{id}/app', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/betaAppReviewSubmissions/{id}/relationships/build
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-betaappreviewsubmissions-_id_-relationships-build}
   */
  async getBetaAppReviewSubmissionsBuildLinkage(
    resourceId: string,
  ): Promise<
    operations['betaAppReviewSubmissions_build_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/betaAppReviewSubmissions/{id}/relationships/build',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/betaAppReviewSubmissions/{id}/build
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-betaappreviewsubmissions-_id_-build}
   */
  async getBetaAppReviewSubmissionsBuild(
    resourceId: string,
    query?: operations['betaAppReviewSubmissions_build_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['betaAppReviewSubmissions_build_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/betaAppReviewSubmissions/{id}/build', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/betaBuildLocalizations/{id}/relationships/build
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-betabuildlocalizations-_id_-relationships-build}
   */
  async getBetaBuildLocalizationsBuildLinkage(
    resourceId: string,
  ): Promise<
    operations['betaBuildLocalizations_build_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/betaBuildLocalizations/{id}/relationships/build',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/betaBuildLocalizations/{id}/build
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-betabuildlocalizations-_id_-build}
   */
  async getBetaBuildLocalizationsBuild(
    resourceId: string,
    query?: operations['betaBuildLocalizations_build_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['betaBuildLocalizations_build_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/betaBuildLocalizations/{id}/build', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/betaFeedbackCrashSubmissions/{id}/relationships/crashLog
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-betafeedbackcrashsubmissions-_id_-relationships-crashlog}
   */
  async getBetaFeedbackCrashSubmissionsCrashLogLinkage(
    resourceId: string,
  ): Promise<
    operations['betaFeedbackCrashSubmissions_crashLog_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/betaFeedbackCrashSubmissions/{id}/relationships/crashLog',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/betaFeedbackCrashSubmissions/{id}/crashLog
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-betafeedbackcrashsubmissions-_id_-crashlog}
   */
  async getBetaFeedbackCrashSubmissionsCrashLog(
    resourceId: string,
    query?: operations['betaFeedbackCrashSubmissions_crashLog_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['betaFeedbackCrashSubmissions_crashLog_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/betaFeedbackCrashSubmissions/{id}/crashLog',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/betaGroups/{id}/relationships/app
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-betagroups-_id_-relationships-app}
   */
  async getBetaGroupsAppLinkage(
    resourceId: string,
  ): Promise<
    operations['betaGroups_app_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/betaGroups/{id}/relationships/app', resourceId, undefined);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/betaGroups/{id}/app
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-betagroups-_id_-app}
   */
  async getBetaGroupsApp(
    resourceId: string,
    query?: operations['betaGroups_app_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['betaGroups_app_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/betaGroups/{id}/app', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/betaGroups/{id}/relationships/betaRecruitmentCriteria
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-betagroups-_id_-relationships-betarecruitmentcriteria}
   */
  async getBetaGroupsBetaRecruitmentCriteriaLinkage(
    resourceId: string,
  ): Promise<
    operations['betaGroups_betaRecruitmentCriteria_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/betaGroups/{id}/relationships/betaRecruitmentCriteria',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/betaGroups/{id}/betaRecruitmentCriteria
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-betagroups-_id_-betarecruitmentcriteria}
   */
  async getBetaGroupsBetaRecruitmentCriteria(
    resourceId: string,
    query?: operations['betaGroups_betaRecruitmentCriteria_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['betaGroups_betaRecruitmentCriteria_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/betaGroups/{id}/betaRecruitmentCriteria', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/betaGroups/{id}/relationships/betaRecruitmentCriterionCompatibleBuildCheck
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-betagroups-_id_-relationships-betarecruitmentcriterioncompatiblebuildcheck}
   */
  async getBetaGroupsBetaRecruitmentCriterionCompatibleBuildCheckLinkage(
    resourceId: string,
  ): Promise<
    operations['betaGroups_betaRecruitmentCriterionCompatibleBuildCheck_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/betaGroups/{id}/relationships/betaRecruitmentCriterionCompatibleBuildCheck',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/betaGroups/{id}/betaRecruitmentCriterionCompatibleBuildCheck
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-betagroups-_id_-betarecruitmentcriterioncompatiblebuildcheck}
   */
  async getBetaGroupsBetaRecruitmentCriterionCompatibleBuildCheck(
    resourceId: string,
    query?: operations['betaGroups_betaRecruitmentCriterionCompatibleBuildCheck_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['betaGroups_betaRecruitmentCriterionCompatibleBuildCheck_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/betaGroups/{id}/betaRecruitmentCriterionCompatibleBuildCheck',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/betaGroups/{id}/relationships/betaTesters
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-betagroups-_id_-relationships-betatesters}
   */
  async listBetaGroupsBetaTestersLinkage(
    resourceId: string,
    query?: operations['betaGroups_betaTesters_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['betaGroups_betaTesters_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/betaGroups/{id}/relationships/betaTesters', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * POST /v1/betaGroups/{id}/relationships/betaTesters
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-betagroups-_id_-relationships-betatesters}
   */
  async addBetaGroupsBetaTestersLinkage(
    resourceId: string,
    document: operations['betaGroups_betaTesters_createToManyRelationship']['requestBody']['content']['application/json'],
  ): Promise<void> {
    const url = appleRequestUrl(
      '/v1/betaGroups/{id}/relationships/betaTesters',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('POST', url, document);
  }

  /**
   * DELETE /v1/betaGroups/{id}/relationships/betaTesters
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-betagroups-_id_-relationships-betatesters}
   */
  async removeBetaGroupsBetaTestersLinkage(
    resourceId: string,
    document: operations['betaGroups_betaTesters_deleteToManyRelationship']['requestBody']['content']['application/json'],
  ): Promise<void> {
    const url = appleRequestUrl(
      '/v1/betaGroups/{id}/relationships/betaTesters',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('DELETE', url, document);
  }

  /**
   * GET /v1/betaGroups/{id}/betaTesters
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-betagroups-_id_-betatesters}
   */
  async listBetaGroupsBetaTesters(
    resourceId: string,
    query?: operations['betaGroups_betaTesters_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['betaGroups_betaTesters_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/betaGroups/{id}/betaTesters', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/betaGroups/{id}/relationships/builds
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-betagroups-_id_-relationships-builds}
   */
  async listBetaGroupsBuildsLinkage(
    resourceId: string,
    query?: operations['betaGroups_builds_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['betaGroups_builds_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/betaGroups/{id}/relationships/builds', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * POST /v1/betaGroups/{id}/relationships/builds
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-betagroups-_id_-relationships-builds}
   */
  async addBetaGroupsBuildsLinkage(
    resourceId: string,
    document: operations['betaGroups_builds_createToManyRelationship']['requestBody']['content']['application/json'],
  ): Promise<void> {
    const url = appleRequestUrl('/v1/betaGroups/{id}/relationships/builds', resourceId, undefined);
    await this.apple.sendJson('POST', url, document);
  }

  /**
   * DELETE /v1/betaGroups/{id}/relationships/builds
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-betagroups-_id_-relationships-builds}
   */
  async removeBetaGroupsBuildsLinkage(
    resourceId: string,
    document: operations['betaGroups_builds_deleteToManyRelationship']['requestBody']['content']['application/json'],
  ): Promise<void> {
    const url = appleRequestUrl('/v1/betaGroups/{id}/relationships/builds', resourceId, undefined);
    await this.apple.sendJson('DELETE', url, document);
  }

  /**
   * GET /v1/betaGroups/{id}/builds
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-betagroups-_id_-builds}
   */
  async listBetaGroupsBuilds(
    resourceId: string,
    query?: operations['betaGroups_builds_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['betaGroups_builds_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/betaGroups/{id}/builds', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/betaLicenseAgreements/{id}/relationships/app
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-betalicenseagreements-_id_-relationships-app}
   */
  async getBetaLicenseAgreementsAppLinkage(
    resourceId: string,
  ): Promise<
    operations['betaLicenseAgreements_app_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/betaLicenseAgreements/{id}/relationships/app',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/betaLicenseAgreements/{id}/app
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-betalicenseagreements-_id_-app}
   */
  async getBetaLicenseAgreementsApp(
    resourceId: string,
    query?: operations['betaLicenseAgreements_app_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['betaLicenseAgreements_app_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/betaLicenseAgreements/{id}/app', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/betaTesters/{id}/relationships/apps
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-betatesters-_id_-relationships-apps}
   */
  async listBetaTestersAppsLinkage(
    resourceId: string,
    query?: operations['betaTesters_apps_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['betaTesters_apps_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/betaTesters/{id}/relationships/apps', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * DELETE /v1/betaTesters/{id}/relationships/apps
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-betatesters-_id_-relationships-apps}
   */
  async removeBetaTestersAppsLinkage(
    resourceId: string,
    document: operations['betaTesters_apps_deleteToManyRelationship']['requestBody']['content']['application/json'],
  ): Promise<void> {
    const url = appleRequestUrl('/v1/betaTesters/{id}/relationships/apps', resourceId, undefined);
    await this.apple.sendJson('DELETE', url, document);
  }

  /**
   * GET /v1/betaTesters/{id}/apps
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-betatesters-_id_-apps}
   */
  async listBetaTestersApps(
    resourceId: string,
    query?: operations['betaTesters_apps_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['betaTesters_apps_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/betaTesters/{id}/apps', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/betaTesters/{id}/relationships/betaGroups
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-betatesters-_id_-relationships-betagroups}
   */
  async listBetaTestersBetaGroupsLinkage(
    resourceId: string,
    query?: operations['betaTesters_betaGroups_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['betaTesters_betaGroups_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/betaTesters/{id}/relationships/betaGroups', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * POST /v1/betaTesters/{id}/relationships/betaGroups
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-betatesters-_id_-relationships-betagroups}
   */
  async addBetaTestersBetaGroupsLinkage(
    resourceId: string,
    document: operations['betaTesters_betaGroups_createToManyRelationship']['requestBody']['content']['application/json'],
  ): Promise<void> {
    const url = appleRequestUrl(
      '/v1/betaTesters/{id}/relationships/betaGroups',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('POST', url, document);
  }

  /**
   * DELETE /v1/betaTesters/{id}/relationships/betaGroups
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-betatesters-_id_-relationships-betagroups}
   */
  async removeBetaTestersBetaGroupsLinkage(
    resourceId: string,
    document: operations['betaTesters_betaGroups_deleteToManyRelationship']['requestBody']['content']['application/json'],
  ): Promise<void> {
    const url = appleRequestUrl(
      '/v1/betaTesters/{id}/relationships/betaGroups',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('DELETE', url, document);
  }

  /**
   * GET /v1/betaTesters/{id}/betaGroups
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-betatesters-_id_-betagroups}
   */
  async listBetaTestersBetaGroups(
    resourceId: string,
    query?: operations['betaTesters_betaGroups_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['betaTesters_betaGroups_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/betaTesters/{id}/betaGroups', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/betaTesters/{id}/relationships/builds
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-betatesters-_id_-relationships-builds}
   */
  async listBetaTestersBuildsLinkage(
    resourceId: string,
    query?: operations['betaTesters_builds_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['betaTesters_builds_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/betaTesters/{id}/relationships/builds', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * POST /v1/betaTesters/{id}/relationships/builds
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-betatesters-_id_-relationships-builds}
   */
  async addBetaTestersBuildsLinkage(
    resourceId: string,
    document: operations['betaTesters_builds_createToManyRelationship']['requestBody']['content']['application/json'],
  ): Promise<void> {
    const url = appleRequestUrl('/v1/betaTesters/{id}/relationships/builds', resourceId, undefined);
    await this.apple.sendJson('POST', url, document);
  }

  /**
   * DELETE /v1/betaTesters/{id}/relationships/builds
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-betatesters-_id_-relationships-builds}
   */
  async removeBetaTestersBuildsLinkage(
    resourceId: string,
    document: operations['betaTesters_builds_deleteToManyRelationship']['requestBody']['content']['application/json'],
  ): Promise<void> {
    const url = appleRequestUrl('/v1/betaTesters/{id}/relationships/builds', resourceId, undefined);
    await this.apple.sendJson('DELETE', url, document);
  }

  /**
   * GET /v1/betaTesters/{id}/builds
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-betatesters-_id_-builds}
   */
  async listBetaTestersBuilds(
    resourceId: string,
    query?: operations['betaTesters_builds_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['betaTesters_builds_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/betaTesters/{id}/builds', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/buildBetaDetails/{id}/relationships/build
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-buildbetadetails-_id_-relationships-build}
   */
  async getBuildBetaDetailsBuildLinkage(
    resourceId: string,
  ): Promise<
    operations['buildBetaDetails_build_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/buildBetaDetails/{id}/relationships/build',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/buildBetaDetails/{id}/build
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-buildbetadetails-_id_-build}
   */
  async getBuildBetaDetailsBuild(
    resourceId: string,
    query?: operations['buildBetaDetails_build_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['buildBetaDetails_build_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/buildBetaDetails/{id}/build', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/buildBundles/{id}/relationships/appClipDomainCacheStatus
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-buildbundles-_id_-relationships-appclipdomaincachestatus}
   */
  async getBuildBundlesAppClipDomainCacheStatusLinkage(
    resourceId: string,
  ): Promise<
    operations['buildBundles_appClipDomainCacheStatus_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/buildBundles/{id}/relationships/appClipDomainCacheStatus',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/buildBundles/{id}/appClipDomainCacheStatus
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-buildbundles-_id_-appclipdomaincachestatus}
   */
  async getBuildBundlesAppClipDomainCacheStatus(
    resourceId: string,
    query?: operations['buildBundles_appClipDomainCacheStatus_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['buildBundles_appClipDomainCacheStatus_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/buildBundles/{id}/appClipDomainCacheStatus',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/buildBundles/{id}/relationships/appClipDomainDebugStatus
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-buildbundles-_id_-relationships-appclipdomaindebugstatus}
   */
  async getBuildBundlesAppClipDomainDebugStatusLinkage(
    resourceId: string,
  ): Promise<
    operations['buildBundles_appClipDomainDebugStatus_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/buildBundles/{id}/relationships/appClipDomainDebugStatus',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/buildBundles/{id}/appClipDomainDebugStatus
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-buildbundles-_id_-appclipdomaindebugstatus}
   */
  async getBuildBundlesAppClipDomainDebugStatus(
    resourceId: string,
    query?: operations['buildBundles_appClipDomainDebugStatus_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['buildBundles_appClipDomainDebugStatus_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/buildBundles/{id}/appClipDomainDebugStatus',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/buildBundles/{id}/relationships/betaAppClipInvocations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-buildbundles-_id_-relationships-betaappclipinvocations}
   */
  async listBuildBundlesBetaAppClipInvocationsLinkage(
    resourceId: string,
    query?: operations['buildBundles_betaAppClipInvocations_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['buildBundles_betaAppClipInvocations_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/buildBundles/{id}/relationships/betaAppClipInvocations',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/buildBundles/{id}/betaAppClipInvocations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-buildbundles-_id_-betaappclipinvocations}
   */
  async listBuildBundlesBetaAppClipInvocations(
    resourceId: string,
    query?: operations['buildBundles_betaAppClipInvocations_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['buildBundles_betaAppClipInvocations_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/buildBundles/{id}/betaAppClipInvocations', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/buildBundles/{id}/relationships/buildBundleFileSizes
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-buildbundles-_id_-relationships-buildbundlefilesizes}
   */
  async listBuildBundlesBuildBundleFileSizesLinkage(
    resourceId: string,
    query?: operations['buildBundles_buildBundleFileSizes_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['buildBundles_buildBundleFileSizes_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/buildBundles/{id}/relationships/buildBundleFileSizes',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/buildBundles/{id}/buildBundleFileSizes
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-buildbundles-_id_-buildbundlefilesizes}
   */
  async listBuildBundlesBuildBundleFileSizes(
    resourceId: string,
    query?: operations['buildBundles_buildBundleFileSizes_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['buildBundles_buildBundleFileSizes_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/buildBundles/{id}/buildBundleFileSizes', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/buildUploads/{id}/relationships/buildUploadFiles
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-builduploads-_id_-relationships-builduploadfiles}
   */
  async listBuildUploadsBuildUploadFilesLinkage(
    resourceId: string,
    query?: operations['buildUploads_buildUploadFiles_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['buildUploads_buildUploadFiles_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/buildUploads/{id}/relationships/buildUploadFiles',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/buildUploads/{id}/buildUploadFiles
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-builduploads-_id_-builduploadfiles}
   */
  async listBuildUploadsBuildUploadFiles(
    resourceId: string,
    query?: operations['buildUploads_buildUploadFiles_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['buildUploads_buildUploadFiles_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/buildUploads/{id}/buildUploadFiles', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/builds/{id}/relationships/app
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-builds-_id_-relationships-app}
   */
  async getBuildsAppLinkage(
    resourceId: string,
  ): Promise<
    operations['builds_app_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/builds/{id}/relationships/app', resourceId, undefined);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/builds/{id}/app
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-builds-_id_-app}
   */
  async getBuildsApp(
    resourceId: string,
    query?: operations['builds_app_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['builds_app_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/builds/{id}/app', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/builds/{id}/relationships/appEncryptionDeclaration
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-builds-_id_-relationships-appencryptiondeclaration}
   */
  async getBuildsAppEncryptionDeclarationLinkage(
    resourceId: string,
  ): Promise<
    operations['builds_appEncryptionDeclaration_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/builds/{id}/relationships/appEncryptionDeclaration',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/builds/{id}/relationships/appEncryptionDeclaration
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-builds-_id_-relationships-appencryptiondeclaration}
   */
  async updateBuildsAppEncryptionDeclarationLinkage(
    resourceId: string,
    document: operations['builds_appEncryptionDeclaration_updateToOneRelationship']['requestBody']['content']['application/json'],
  ): Promise<void> {
    const url = appleRequestUrl(
      '/v1/builds/{id}/relationships/appEncryptionDeclaration',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('PATCH', url, document);
  }

  /**
   * GET /v1/builds/{id}/appEncryptionDeclaration
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-builds-_id_-appencryptiondeclaration}
   */
  async getBuildsAppEncryptionDeclaration(
    resourceId: string,
    query?: operations['builds_appEncryptionDeclaration_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['builds_appEncryptionDeclaration_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/builds/{id}/appEncryptionDeclaration', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/builds/{id}/relationships/appStoreVersion
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-builds-_id_-relationships-appstoreversion}
   */
  async getBuildsAppStoreVersionLinkage(
    resourceId: string,
  ): Promise<
    operations['builds_appStoreVersion_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/builds/{id}/relationships/appStoreVersion',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/builds/{id}/appStoreVersion
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-builds-_id_-appstoreversion}
   */
  async getBuildsAppStoreVersion(
    resourceId: string,
    query?: operations['builds_appStoreVersion_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['builds_appStoreVersion_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/builds/{id}/appStoreVersion', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/builds/{id}/relationships/betaAppReviewSubmission
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-builds-_id_-relationships-betaappreviewsubmission}
   */
  async getBuildsBetaAppReviewSubmissionLinkage(
    resourceId: string,
  ): Promise<
    operations['builds_betaAppReviewSubmission_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/builds/{id}/relationships/betaAppReviewSubmission',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/builds/{id}/betaAppReviewSubmission
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-builds-_id_-betaappreviewsubmission}
   */
  async getBuildsBetaAppReviewSubmission(
    resourceId: string,
    query?: operations['builds_betaAppReviewSubmission_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['builds_betaAppReviewSubmission_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/builds/{id}/betaAppReviewSubmission', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/builds/{id}/relationships/betaBuildLocalizations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-builds-_id_-relationships-betabuildlocalizations}
   */
  async listBuildsBetaBuildLocalizationsLinkage(
    resourceId: string,
    query?: operations['builds_betaBuildLocalizations_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['builds_betaBuildLocalizations_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/builds/{id}/relationships/betaBuildLocalizations',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/builds/{id}/betaBuildLocalizations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-builds-_id_-betabuildlocalizations}
   */
  async listBuildsBetaBuildLocalizations(
    resourceId: string,
    query?: operations['builds_betaBuildLocalizations_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['builds_betaBuildLocalizations_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/builds/{id}/betaBuildLocalizations', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * POST /v1/builds/{id}/relationships/betaGroups
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-builds-_id_-relationships-betagroups}
   */
  async addBuildsBetaGroupsLinkage(
    resourceId: string,
    document: operations['builds_betaGroups_createToManyRelationship']['requestBody']['content']['application/json'],
  ): Promise<void> {
    const url = appleRequestUrl('/v1/builds/{id}/relationships/betaGroups', resourceId, undefined);
    await this.apple.sendJson('POST', url, document);
  }

  /**
   * DELETE /v1/builds/{id}/relationships/betaGroups
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-builds-_id_-relationships-betagroups}
   */
  async removeBuildsBetaGroupsLinkage(
    resourceId: string,
    document: operations['builds_betaGroups_deleteToManyRelationship']['requestBody']['content']['application/json'],
  ): Promise<void> {
    const url = appleRequestUrl('/v1/builds/{id}/relationships/betaGroups', resourceId, undefined);
    await this.apple.sendJson('DELETE', url, document);
  }

  /**
   * GET /v1/builds/{id}/relationships/buildBetaDetail
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-builds-_id_-relationships-buildbetadetail}
   */
  async getBuildsBuildBetaDetailLinkage(
    resourceId: string,
  ): Promise<
    operations['builds_buildBetaDetail_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/builds/{id}/relationships/buildBetaDetail',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/builds/{id}/buildBetaDetail
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-builds-_id_-buildbetadetail}
   */
  async getBuildsBuildBetaDetail(
    resourceId: string,
    query?: operations['builds_buildBetaDetail_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['builds_buildBetaDetail_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/builds/{id}/buildBetaDetail', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/builds/{id}/relationships/diagnosticSignatures
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-builds-_id_-relationships-diagnosticsignatures}
   */
  async listBuildsDiagnosticSignaturesLinkage(
    resourceId: string,
    query?: operations['builds_diagnosticSignatures_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['builds_diagnosticSignatures_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/builds/{id}/relationships/diagnosticSignatures',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/builds/{id}/diagnosticSignatures
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-builds-_id_-diagnosticsignatures}
   */
  async listBuildsDiagnosticSignatures(
    resourceId: string,
    query?: operations['builds_diagnosticSignatures_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['builds_diagnosticSignatures_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/builds/{id}/diagnosticSignatures', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/builds/{id}/relationships/icons
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-builds-_id_-relationships-icons}
   */
  async listBuildsIconsLinkage(
    resourceId: string,
    query?: operations['builds_icons_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['builds_icons_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/builds/{id}/relationships/icons', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/builds/{id}/icons
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-builds-_id_-icons}
   */
  async listBuildsIcons(
    resourceId: string,
    query?: operations['builds_icons_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['builds_icons_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/builds/{id}/icons', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/builds/{id}/relationships/individualTesters
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-builds-_id_-relationships-individualtesters}
   */
  async listBuildsIndividualTestersLinkage(
    resourceId: string,
    query?: operations['builds_individualTesters_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['builds_individualTesters_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/builds/{id}/relationships/individualTesters',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * POST /v1/builds/{id}/relationships/individualTesters
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-builds-_id_-relationships-individualtesters}
   */
  async addBuildsIndividualTestersLinkage(
    resourceId: string,
    document: operations['builds_individualTesters_createToManyRelationship']['requestBody']['content']['application/json'],
  ): Promise<void> {
    const url = appleRequestUrl(
      '/v1/builds/{id}/relationships/individualTesters',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('POST', url, document);
  }

  /**
   * DELETE /v1/builds/{id}/relationships/individualTesters
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-builds-_id_-relationships-individualtesters}
   */
  async removeBuildsIndividualTestersLinkage(
    resourceId: string,
    document: operations['builds_individualTesters_deleteToManyRelationship']['requestBody']['content']['application/json'],
  ): Promise<void> {
    const url = appleRequestUrl(
      '/v1/builds/{id}/relationships/individualTesters',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('DELETE', url, document);
  }

  /**
   * GET /v1/builds/{id}/individualTesters
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-builds-_id_-individualtesters}
   */
  async listBuildsIndividualTesters(
    resourceId: string,
    query?: operations['builds_individualTesters_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['builds_individualTesters_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/builds/{id}/individualTesters', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/builds/{id}/perfPowerMetrics
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-builds-_id_-perfpowermetrics}
   */
  async listBuildsPerfPowerMetrics(
    resourceId: string,
    query?: operations['builds_perfPowerMetrics_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['builds_perfPowerMetrics_getToManyRelated']['responses'][200]['content']['application/vnd.apple.xcode-metrics+json']
  > {
    const url = appleRequestUrl('/v1/builds/{id}/perfPowerMetrics', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/builds/{id}/relationships/preReleaseVersion
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-builds-_id_-relationships-prereleaseversion}
   */
  async getBuildsPreReleaseVersionLinkage(
    resourceId: string,
  ): Promise<
    operations['builds_preReleaseVersion_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/builds/{id}/relationships/preReleaseVersion',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/builds/{id}/preReleaseVersion
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-builds-_id_-prereleaseversion}
   */
  async getBuildsPreReleaseVersion(
    resourceId: string,
    query?: operations['builds_preReleaseVersion_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['builds_preReleaseVersion_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/builds/{id}/preReleaseVersion', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/bundleIds/{id}/relationships/app
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-bundleids-_id_-relationships-app}
   */
  async getBundleIdsAppLinkage(
    resourceId: string,
  ): Promise<
    operations['bundleIds_app_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/bundleIds/{id}/relationships/app', resourceId, undefined);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/bundleIds/{id}/app
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-bundleids-_id_-app}
   */
  async getBundleIdsApp(
    resourceId: string,
    query?: operations['bundleIds_app_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['bundleIds_app_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/bundleIds/{id}/app', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/bundleIds/{id}/relationships/bundleIdCapabilities
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-bundleids-_id_-relationships-bundleidcapabilities}
   */
  async listBundleIdsBundleIdCapabilitiesLinkage(
    resourceId: string,
    query?: operations['bundleIds_bundleIdCapabilities_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['bundleIds_bundleIdCapabilities_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/bundleIds/{id}/relationships/bundleIdCapabilities',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/bundleIds/{id}/bundleIdCapabilities
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-bundleids-_id_-bundleidcapabilities}
   */
  async listBundleIdsBundleIdCapabilities(
    resourceId: string,
    query?: operations['bundleIds_bundleIdCapabilities_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['bundleIds_bundleIdCapabilities_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/bundleIds/{id}/bundleIdCapabilities', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/bundleIds/{id}/relationships/profiles
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-bundleids-_id_-relationships-profiles}
   */
  async listBundleIdsProfilesLinkage(
    resourceId: string,
    query?: operations['bundleIds_profiles_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['bundleIds_profiles_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/bundleIds/{id}/relationships/profiles', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/bundleIds/{id}/profiles
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-bundleids-_id_-profiles}
   */
  async listBundleIdsProfiles(
    resourceId: string,
    query?: operations['bundleIds_profiles_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['bundleIds_profiles_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/bundleIds/{id}/profiles', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/certificates/{id}/relationships/passTypeId
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-certificates-_id_-relationships-passtypeid}
   */
  async getCertificatesPassTypeIdLinkage(
    resourceId: string,
  ): Promise<
    operations['certificates_passTypeId_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/certificates/{id}/relationships/passTypeId',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/certificates/{id}/passTypeId
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-certificates-_id_-passtypeid}
   */
  async getCertificatesPassTypeId(
    resourceId: string,
    query?: operations['certificates_passTypeId_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['certificates_passTypeId_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/certificates/{id}/passTypeId', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/ciBuildActions/{id}/relationships/artifacts
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-cibuildactions-_id_-relationships-artifacts}
   */
  async listCiBuildActionsArtifactsLinkage(
    resourceId: string,
    query?: operations['ciBuildActions_artifacts_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['ciBuildActions_artifacts_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/ciBuildActions/{id}/relationships/artifacts',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/ciBuildActions/{id}/artifacts
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-cibuildactions-_id_-artifacts}
   */
  async listCiBuildActionsArtifacts(
    resourceId: string,
    query?: operations['ciBuildActions_artifacts_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['ciBuildActions_artifacts_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/ciBuildActions/{id}/artifacts', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/ciBuildActions/{id}/relationships/buildRun
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-cibuildactions-_id_-relationships-buildrun}
   */
  async getCiBuildActionsBuildRunLinkage(
    resourceId: string,
  ): Promise<
    operations['ciBuildActions_buildRun_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/ciBuildActions/{id}/relationships/buildRun',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/ciBuildActions/{id}/buildRun
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-cibuildactions-_id_-buildrun}
   */
  async getCiBuildActionsBuildRun(
    resourceId: string,
    query?: operations['ciBuildActions_buildRun_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['ciBuildActions_buildRun_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/ciBuildActions/{id}/buildRun', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/ciBuildActions/{id}/relationships/issues
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-cibuildactions-_id_-relationships-issues}
   */
  async listCiBuildActionsIssuesLinkage(
    resourceId: string,
    query?: operations['ciBuildActions_issues_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['ciBuildActions_issues_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/ciBuildActions/{id}/relationships/issues', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/ciBuildActions/{id}/issues
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-cibuildactions-_id_-issues}
   */
  async listCiBuildActionsIssues(
    resourceId: string,
    query?: operations['ciBuildActions_issues_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['ciBuildActions_issues_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/ciBuildActions/{id}/issues', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/ciBuildActions/{id}/relationships/testResults
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-cibuildactions-_id_-relationships-testresults}
   */
  async listCiBuildActionsTestResultsLinkage(
    resourceId: string,
    query?: operations['ciBuildActions_testResults_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['ciBuildActions_testResults_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/ciBuildActions/{id}/relationships/testResults',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/ciBuildActions/{id}/testResults
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-cibuildactions-_id_-testresults}
   */
  async listCiBuildActionsTestResults(
    resourceId: string,
    query?: operations['ciBuildActions_testResults_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['ciBuildActions_testResults_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/ciBuildActions/{id}/testResults', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/ciBuildRuns/{id}/relationships/actions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-cibuildruns-_id_-relationships-actions}
   */
  async listCiBuildRunsActionsLinkage(
    resourceId: string,
    query?: operations['ciBuildRuns_actions_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['ciBuildRuns_actions_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/ciBuildRuns/{id}/relationships/actions', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/ciBuildRuns/{id}/actions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-cibuildruns-_id_-actions}
   */
  async listCiBuildRunsActions(
    resourceId: string,
    query?: operations['ciBuildRuns_actions_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['ciBuildRuns_actions_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/ciBuildRuns/{id}/actions', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/ciBuildRuns/{id}/relationships/builds
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-cibuildruns-_id_-relationships-builds}
   */
  async listCiBuildRunsBuildsLinkage(
    resourceId: string,
    query?: operations['ciBuildRuns_builds_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['ciBuildRuns_builds_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/ciBuildRuns/{id}/relationships/builds', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/ciBuildRuns/{id}/builds
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-cibuildruns-_id_-builds}
   */
  async listCiBuildRunsBuilds(
    resourceId: string,
    query?: operations['ciBuildRuns_builds_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['ciBuildRuns_builds_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/ciBuildRuns/{id}/builds', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/ciMacOsVersions/{id}/relationships/xcodeVersions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-cimacosversions-_id_-relationships-xcodeversions}
   */
  async listCiMacOsVersionsXcodeVersionsLinkage(
    resourceId: string,
    query?: operations['ciMacOsVersions_xcodeVersions_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['ciMacOsVersions_xcodeVersions_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/ciMacOsVersions/{id}/relationships/xcodeVersions',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/ciMacOsVersions/{id}/xcodeVersions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-cimacosversions-_id_-xcodeversions}
   */
  async listCiMacOsVersionsXcodeVersions(
    resourceId: string,
    query?: operations['ciMacOsVersions_xcodeVersions_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['ciMacOsVersions_xcodeVersions_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/ciMacOsVersions/{id}/xcodeVersions', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/ciProducts/{id}/relationships/additionalRepositories
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-ciproducts-_id_-relationships-additionalrepositories}
   */
  async listCiProductsAdditionalRepositoriesLinkage(
    resourceId: string,
    query?: operations['ciProducts_additionalRepositories_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['ciProducts_additionalRepositories_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/ciProducts/{id}/relationships/additionalRepositories',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/ciProducts/{id}/additionalRepositories
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-ciproducts-_id_-additionalrepositories}
   */
  async listCiProductsAdditionalRepositories(
    resourceId: string,
    query?: operations['ciProducts_additionalRepositories_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['ciProducts_additionalRepositories_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/ciProducts/{id}/additionalRepositories', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/ciProducts/{id}/relationships/app
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-ciproducts-_id_-relationships-app}
   */
  async getCiProductsAppLinkage(
    resourceId: string,
  ): Promise<
    operations['ciProducts_app_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/ciProducts/{id}/relationships/app', resourceId, undefined);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/ciProducts/{id}/app
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-ciproducts-_id_-app}
   */
  async getCiProductsApp(
    resourceId: string,
    query?: operations['ciProducts_app_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['ciProducts_app_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/ciProducts/{id}/app', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/ciProducts/{id}/relationships/buildRuns
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-ciproducts-_id_-relationships-buildruns}
   */
  async listCiProductsBuildRunsLinkage(
    resourceId: string,
    query?: operations['ciProducts_buildRuns_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['ciProducts_buildRuns_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/ciProducts/{id}/relationships/buildRuns', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/ciProducts/{id}/buildRuns
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-ciproducts-_id_-buildruns}
   */
  async listCiProductsBuildRuns(
    resourceId: string,
    query?: operations['ciProducts_buildRuns_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['ciProducts_buildRuns_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/ciProducts/{id}/buildRuns', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/ciProducts/{id}/relationships/primaryRepositories
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-ciproducts-_id_-relationships-primaryrepositories}
   */
  async listCiProductsPrimaryRepositoriesLinkage(
    resourceId: string,
    query?: operations['ciProducts_primaryRepositories_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['ciProducts_primaryRepositories_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/ciProducts/{id}/relationships/primaryRepositories',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/ciProducts/{id}/primaryRepositories
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-ciproducts-_id_-primaryrepositories}
   */
  async listCiProductsPrimaryRepositories(
    resourceId: string,
    query?: operations['ciProducts_primaryRepositories_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['ciProducts_primaryRepositories_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/ciProducts/{id}/primaryRepositories', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/ciProducts/{id}/relationships/workflows
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-ciproducts-_id_-relationships-workflows}
   */
  async listCiProductsWorkflowsLinkage(
    resourceId: string,
    query?: operations['ciProducts_workflows_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['ciProducts_workflows_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/ciProducts/{id}/relationships/workflows', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/ciProducts/{id}/workflows
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-ciproducts-_id_-workflows}
   */
  async listCiProductsWorkflows(
    resourceId: string,
    query?: operations['ciProducts_workflows_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['ciProducts_workflows_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/ciProducts/{id}/workflows', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/ciWorkflows/{id}/relationships/buildRuns
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-ciworkflows-_id_-relationships-buildruns}
   */
  async listCiWorkflowsBuildRunsLinkage(
    resourceId: string,
    query?: operations['ciWorkflows_buildRuns_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['ciWorkflows_buildRuns_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/ciWorkflows/{id}/relationships/buildRuns', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/ciWorkflows/{id}/buildRuns
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-ciworkflows-_id_-buildruns}
   */
  async listCiWorkflowsBuildRuns(
    resourceId: string,
    query?: operations['ciWorkflows_buildRuns_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['ciWorkflows_buildRuns_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/ciWorkflows/{id}/buildRuns', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/ciWorkflows/{id}/relationships/repository
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-ciworkflows-_id_-relationships-repository}
   */
  async getCiWorkflowsRepositoryLinkage(
    resourceId: string,
  ): Promise<
    operations['ciWorkflows_repository_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/ciWorkflows/{id}/relationships/repository',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/ciWorkflows/{id}/repository
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-ciworkflows-_id_-repository}
   */
  async getCiWorkflowsRepository(
    resourceId: string,
    query?: operations['ciWorkflows_repository_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['ciWorkflows_repository_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/ciWorkflows/{id}/repository', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/ciXcodeVersions/{id}/relationships/macOsVersions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-cixcodeversions-_id_-relationships-macosversions}
   */
  async listCiXcodeVersionsMacOsVersionsLinkage(
    resourceId: string,
    query?: operations['ciXcodeVersions_macOsVersions_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['ciXcodeVersions_macOsVersions_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/ciXcodeVersions/{id}/relationships/macOsVersions',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/ciXcodeVersions/{id}/macOsVersions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-cixcodeversions-_id_-macosversions}
   */
  async listCiXcodeVersionsMacOsVersions(
    resourceId: string,
    query?: operations['ciXcodeVersions_macOsVersions_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['ciXcodeVersions_macOsVersions_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/ciXcodeVersions/{id}/macOsVersions', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/customerReviews/{id}/relationships/response
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-customerreviews-_id_-relationships-response}
   */
  async getCustomerReviewsResponseLinkage(
    resourceId: string,
  ): Promise<
    operations['customerReviews_response_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/customerReviews/{id}/relationships/response',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/customerReviews/{id}/response
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-customerreviews-_id_-response}
   */
  async getCustomerReviewsResponse(
    resourceId: string,
    query?: operations['customerReviews_response_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['customerReviews_response_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/customerReviews/{id}/response', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/diagnosticSignatures/{id}/logs
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-diagnosticsignatures-_id_-logs}
   */
  async listDiagnosticSignaturesLogs(
    resourceId: string,
    query?: operations['diagnosticSignatures_logs_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['diagnosticSignatures_logs_getToManyRelated']['responses'][200]['content']['application/vnd.apple.diagnostic-logs+json']
  > {
    const url = appleRequestUrl('/v1/diagnosticSignatures/{id}/logs', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/endUserLicenseAgreements/{id}/relationships/territories
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-enduserlicenseagreements-_id_-relationships-territories}
   */
  async listEndUserLicenseAgreementsTerritoriesLinkage(
    resourceId: string,
    query?: operations['endUserLicenseAgreements_territories_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['endUserLicenseAgreements_territories_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/endUserLicenseAgreements/{id}/relationships/territories',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/endUserLicenseAgreements/{id}/territories
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-enduserlicenseagreements-_id_-territories}
   */
  async listEndUserLicenseAgreementsTerritories(
    resourceId: string,
    query?: operations['endUserLicenseAgreements_territories_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['endUserLicenseAgreements_territories_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/endUserLicenseAgreements/{id}/territories', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v2/gameCenterAchievementLocalizations/{id}/relationships/image
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v2-gamecenterachievementlocalizations-_id_-relationships-image}
   */
  async getGameCenterAchievementLocalizationsV2ImageLinkage(
    resourceId: string,
  ): Promise<
    operations['gameCenterAchievementLocalizationsV2_image_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v2/gameCenterAchievementLocalizations/{id}/relationships/image',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v2/gameCenterAchievementLocalizations/{id}/image
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v2-gamecenterachievementlocalizations-_id_-image}
   */
  async getGameCenterAchievementLocalizationsV2Image(
    resourceId: string,
    query?: operations['gameCenterAchievementLocalizationsV2_image_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['gameCenterAchievementLocalizationsV2_image_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v2/gameCenterAchievementLocalizations/{id}/image',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterAchievementLocalizations/{id}/relationships/gameCenterAchievement
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterachievementlocalizations-_id_-relationships-gamecenterachievement}
   */
  async getGameCenterAchievementLocalizationsGameCenterAchievementLinkage(
    resourceId: string,
  ): Promise<
    operations['gameCenterAchievementLocalizations_gameCenterAchievement_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterAchievementLocalizations/{id}/relationships/gameCenterAchievement',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterAchievementLocalizations/{id}/gameCenterAchievement
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterachievementlocalizations-_id_-gamecenterachievement}
   */
  async getGameCenterAchievementLocalizationsGameCenterAchievement(
    resourceId: string,
    query?: operations['gameCenterAchievementLocalizations_gameCenterAchievement_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['gameCenterAchievementLocalizations_gameCenterAchievement_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterAchievementLocalizations/{id}/gameCenterAchievement',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterAchievementLocalizations/{id}/relationships/gameCenterAchievementImage
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterachievementlocalizations-_id_-relationships-gamecenterachievementimage}
   */
  async getGameCenterAchievementLocalizationsGameCenterAchievementImageLinkage(
    resourceId: string,
  ): Promise<
    operations['gameCenterAchievementLocalizations_gameCenterAchievementImage_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterAchievementLocalizations/{id}/relationships/gameCenterAchievementImage',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterAchievementLocalizations/{id}/gameCenterAchievementImage
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterachievementlocalizations-_id_-gamecenterachievementimage}
   */
  async getGameCenterAchievementLocalizationsGameCenterAchievementImage(
    resourceId: string,
    query?: operations['gameCenterAchievementLocalizations_gameCenterAchievementImage_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['gameCenterAchievementLocalizations_gameCenterAchievementImage_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterAchievementLocalizations/{id}/gameCenterAchievementImage',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v2/gameCenterAchievementVersions/{id}/relationships/localizations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v2-gamecenterachievementversions-_id_-relationships-localizations}
   */
  async listGameCenterAchievementVersionsV2LocalizationsLinkage(
    resourceId: string,
    query?: operations['gameCenterAchievementVersionsV2_localizations_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['gameCenterAchievementVersionsV2_localizations_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v2/gameCenterAchievementVersions/{id}/relationships/localizations',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v2/gameCenterAchievementVersions/{id}/localizations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v2-gamecenterachievementversions-_id_-localizations}
   */
  async listGameCenterAchievementVersionsV2Localizations(
    resourceId: string,
    query?: operations['gameCenterAchievementVersionsV2_localizations_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['gameCenterAchievementVersionsV2_localizations_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v2/gameCenterAchievementVersions/{id}/localizations',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v2/gameCenterAchievements/{id}/relationships/activity
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v2-gamecenterachievements-_id_-relationships-activity}
   */
  async updateGameCenterAchievementsV2ActivityLinkage(
    resourceId: string,
    document: operations['gameCenterAchievementsV2_activity_updateToOneRelationship']['requestBody']['content']['application/json'],
  ): Promise<void> {
    const url = appleRequestUrl(
      '/v2/gameCenterAchievements/{id}/relationships/activity',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('PATCH', url, document);
  }

  /**
   * GET /v2/gameCenterAchievements/{id}/relationships/versions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v2-gamecenterachievements-_id_-relationships-versions}
   */
  async listGameCenterAchievementsV2VersionsLinkage(
    resourceId: string,
    query?: operations['gameCenterAchievementsV2_versions_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['gameCenterAchievementsV2_versions_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v2/gameCenterAchievements/{id}/relationships/versions',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v2/gameCenterAchievements/{id}/versions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v2-gamecenterachievements-_id_-versions}
   */
  async listGameCenterAchievementsV2Versions(
    resourceId: string,
    query?: operations['gameCenterAchievementsV2_versions_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['gameCenterAchievementsV2_versions_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v2/gameCenterAchievements/{id}/versions', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/gameCenterAchievements/{id}/relationships/activity
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-gamecenterachievements-_id_-relationships-activity}
   */
  async updateGameCenterAchievementsActivityLinkage(
    resourceId: string,
    document: operations['gameCenterAchievements_activity_updateToOneRelationship']['requestBody']['content']['application/json'],
  ): Promise<void> {
    const url = appleRequestUrl(
      '/v1/gameCenterAchievements/{id}/relationships/activity',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('PATCH', url, document);
  }

  /**
   * GET /v1/gameCenterAchievements/{id}/relationships/groupAchievement
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterachievements-_id_-relationships-groupachievement}
   */
  async getGameCenterAchievementsGroupAchievementLinkage(
    resourceId: string,
  ): Promise<
    operations['gameCenterAchievements_groupAchievement_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterAchievements/{id}/relationships/groupAchievement',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/gameCenterAchievements/{id}/relationships/groupAchievement
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-gamecenterachievements-_id_-relationships-groupachievement}
   */
  async updateGameCenterAchievementsGroupAchievementLinkage(
    resourceId: string,
    document: operations['gameCenterAchievements_groupAchievement_updateToOneRelationship']['requestBody']['content']['application/json'],
  ): Promise<void> {
    const url = appleRequestUrl(
      '/v1/gameCenterAchievements/{id}/relationships/groupAchievement',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('PATCH', url, document);
  }

  /**
   * GET /v1/gameCenterAchievements/{id}/groupAchievement
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterachievements-_id_-groupachievement}
   */
  async getGameCenterAchievementsGroupAchievement(
    resourceId: string,
    query?: operations['gameCenterAchievements_groupAchievement_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['gameCenterAchievements_groupAchievement_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterAchievements/{id}/groupAchievement',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterAchievements/{id}/relationships/localizations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterachievements-_id_-relationships-localizations}
   */
  async listGameCenterAchievementsLocalizationsLinkage(
    resourceId: string,
    query?: operations['gameCenterAchievements_localizations_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['gameCenterAchievements_localizations_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterAchievements/{id}/relationships/localizations',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterAchievements/{id}/localizations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterachievements-_id_-localizations}
   */
  async listGameCenterAchievementsLocalizations(
    resourceId: string,
    query?: operations['gameCenterAchievements_localizations_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['gameCenterAchievements_localizations_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterAchievements/{id}/localizations', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterAchievements/{id}/relationships/releases
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterachievements-_id_-relationships-releases}
   */
  async listGameCenterAchievementsReleasesLinkage(
    resourceId: string,
    query?: operations['gameCenterAchievements_releases_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['gameCenterAchievements_releases_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterAchievements/{id}/relationships/releases',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterAchievements/{id}/releases
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterachievements-_id_-releases}
   */
  async listGameCenterAchievementsReleases(
    resourceId: string,
    query?: operations['gameCenterAchievements_releases_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['gameCenterAchievements_releases_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterAchievements/{id}/releases', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * POST /v1/gameCenterActivities/{id}/relationships/achievements
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-gamecenteractivities-_id_-relationships-achievements}
   */
  async addGameCenterActivitiesAchievementsLinkage(
    resourceId: string,
    document: operations['gameCenterActivities_achievements_createToManyRelationship']['requestBody']['content']['application/json'],
  ): Promise<void> {
    const url = appleRequestUrl(
      '/v1/gameCenterActivities/{id}/relationships/achievements',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('POST', url, document);
  }

  /**
   * DELETE /v1/gameCenterActivities/{id}/relationships/achievements
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-gamecenteractivities-_id_-relationships-achievements}
   */
  async removeGameCenterActivitiesAchievementsLinkage(
    resourceId: string,
    document: operations['gameCenterActivities_achievements_deleteToManyRelationship']['requestBody']['content']['application/json'],
  ): Promise<void> {
    const url = appleRequestUrl(
      '/v1/gameCenterActivities/{id}/relationships/achievements',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('DELETE', url, document);
  }

  /**
   * POST /v1/gameCenterActivities/{id}/relationships/achievementsV2
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-gamecenteractivities-_id_-relationships-achievementsv2}
   */
  async addGameCenterActivitiesAchievementsV2Linkage(
    resourceId: string,
    document: operations['gameCenterActivities_achievementsV2_createToManyRelationship']['requestBody']['content']['application/json'],
  ): Promise<void> {
    const url = appleRequestUrl(
      '/v1/gameCenterActivities/{id}/relationships/achievementsV2',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('POST', url, document);
  }

  /**
   * DELETE /v1/gameCenterActivities/{id}/relationships/achievementsV2
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-gamecenteractivities-_id_-relationships-achievementsv2}
   */
  async removeGameCenterActivitiesAchievementsV2Linkage(
    resourceId: string,
    document: operations['gameCenterActivities_achievementsV2_deleteToManyRelationship']['requestBody']['content']['application/json'],
  ): Promise<void> {
    const url = appleRequestUrl(
      '/v1/gameCenterActivities/{id}/relationships/achievementsV2',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('DELETE', url, document);
  }

  /**
   * POST /v1/gameCenterActivities/{id}/relationships/leaderboards
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-gamecenteractivities-_id_-relationships-leaderboards}
   */
  async addGameCenterActivitiesLeaderboardsLinkage(
    resourceId: string,
    document: operations['gameCenterActivities_leaderboards_createToManyRelationship']['requestBody']['content']['application/json'],
  ): Promise<void> {
    const url = appleRequestUrl(
      '/v1/gameCenterActivities/{id}/relationships/leaderboards',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('POST', url, document);
  }

  /**
   * DELETE /v1/gameCenterActivities/{id}/relationships/leaderboards
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-gamecenteractivities-_id_-relationships-leaderboards}
   */
  async removeGameCenterActivitiesLeaderboardsLinkage(
    resourceId: string,
    document: operations['gameCenterActivities_leaderboards_deleteToManyRelationship']['requestBody']['content']['application/json'],
  ): Promise<void> {
    const url = appleRequestUrl(
      '/v1/gameCenterActivities/{id}/relationships/leaderboards',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('DELETE', url, document);
  }

  /**
   * POST /v1/gameCenterActivities/{id}/relationships/leaderboardsV2
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-gamecenteractivities-_id_-relationships-leaderboardsv2}
   */
  async addGameCenterActivitiesLeaderboardsV2Linkage(
    resourceId: string,
    document: operations['gameCenterActivities_leaderboardsV2_createToManyRelationship']['requestBody']['content']['application/json'],
  ): Promise<void> {
    const url = appleRequestUrl(
      '/v1/gameCenterActivities/{id}/relationships/leaderboardsV2',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('POST', url, document);
  }

  /**
   * DELETE /v1/gameCenterActivities/{id}/relationships/leaderboardsV2
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-gamecenteractivities-_id_-relationships-leaderboardsv2}
   */
  async removeGameCenterActivitiesLeaderboardsV2Linkage(
    resourceId: string,
    document: operations['gameCenterActivities_leaderboardsV2_deleteToManyRelationship']['requestBody']['content']['application/json'],
  ): Promise<void> {
    const url = appleRequestUrl(
      '/v1/gameCenterActivities/{id}/relationships/leaderboardsV2',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('DELETE', url, document);
  }

  /**
   * GET /v1/gameCenterActivities/{id}/relationships/versions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenteractivities-_id_-relationships-versions}
   */
  async listGameCenterActivitiesVersionsLinkage(
    resourceId: string,
    query?: operations['gameCenterActivities_versions_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['gameCenterActivities_versions_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterActivities/{id}/relationships/versions',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterActivities/{id}/versions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenteractivities-_id_-versions}
   */
  async listGameCenterActivitiesVersions(
    resourceId: string,
    query?: operations['gameCenterActivities_versions_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['gameCenterActivities_versions_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterActivities/{id}/versions', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterActivityLocalizations/{id}/relationships/image
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenteractivitylocalizations-_id_-relationships-image}
   */
  async getGameCenterActivityLocalizationsImageLinkage(
    resourceId: string,
  ): Promise<
    operations['gameCenterActivityLocalizations_image_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterActivityLocalizations/{id}/relationships/image',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterActivityLocalizations/{id}/image
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenteractivitylocalizations-_id_-image}
   */
  async getGameCenterActivityLocalizationsImage(
    resourceId: string,
    query?: operations['gameCenterActivityLocalizations_image_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['gameCenterActivityLocalizations_image_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterActivityLocalizations/{id}/image',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterActivityVersions/{id}/relationships/defaultImage
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenteractivityversions-_id_-relationships-defaultimage}
   */
  async getGameCenterActivityVersionsDefaultImageLinkage(
    resourceId: string,
  ): Promise<
    operations['gameCenterActivityVersions_defaultImage_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterActivityVersions/{id}/relationships/defaultImage',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterActivityVersions/{id}/defaultImage
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenteractivityversions-_id_-defaultimage}
   */
  async getGameCenterActivityVersionsDefaultImage(
    resourceId: string,
    query?: operations['gameCenterActivityVersions_defaultImage_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['gameCenterActivityVersions_defaultImage_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterActivityVersions/{id}/defaultImage',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterActivityVersions/{id}/relationships/localizations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenteractivityversions-_id_-relationships-localizations}
   */
  async listGameCenterActivityVersionsLocalizationsLinkage(
    resourceId: string,
    query?: operations['gameCenterActivityVersions_localizations_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['gameCenterActivityVersions_localizations_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterActivityVersions/{id}/relationships/localizations',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterActivityVersions/{id}/localizations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenteractivityversions-_id_-localizations}
   */
  async listGameCenterActivityVersionsLocalizations(
    resourceId: string,
    query?: operations['gameCenterActivityVersions_localizations_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['gameCenterActivityVersions_localizations_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterActivityVersions/{id}/localizations',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterAppVersions/{id}/relationships/appStoreVersion
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterappversions-_id_-relationships-appstoreversion}
   */
  async getGameCenterAppVersionsAppStoreVersionLinkage(
    resourceId: string,
  ): Promise<
    operations['gameCenterAppVersions_appStoreVersion_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterAppVersions/{id}/relationships/appStoreVersion',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterAppVersions/{id}/appStoreVersion
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterappversions-_id_-appstoreversion}
   */
  async getGameCenterAppVersionsAppStoreVersion(
    resourceId: string,
    query?: operations['gameCenterAppVersions_appStoreVersion_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['gameCenterAppVersions_appStoreVersion_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterAppVersions/{id}/appStoreVersion',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterAppVersions/{id}/relationships/compatibilityVersions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterappversions-_id_-relationships-compatibilityversions}
   */
  async listGameCenterAppVersionsCompatibilityVersionsLinkage(
    resourceId: string,
    query?: operations['gameCenterAppVersions_compatibilityVersions_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['gameCenterAppVersions_compatibilityVersions_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterAppVersions/{id}/relationships/compatibilityVersions',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * POST /v1/gameCenterAppVersions/{id}/relationships/compatibilityVersions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-gamecenterappversions-_id_-relationships-compatibilityversions}
   */
  async addGameCenterAppVersionsCompatibilityVersionsLinkage(
    resourceId: string,
    document: operations['gameCenterAppVersions_compatibilityVersions_createToManyRelationship']['requestBody']['content']['application/json'],
  ): Promise<void> {
    const url = appleRequestUrl(
      '/v1/gameCenterAppVersions/{id}/relationships/compatibilityVersions',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('POST', url, document);
  }

  /**
   * DELETE /v1/gameCenterAppVersions/{id}/relationships/compatibilityVersions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-gamecenterappversions-_id_-relationships-compatibilityversions}
   */
  async removeGameCenterAppVersionsCompatibilityVersionsLinkage(
    resourceId: string,
    document: operations['gameCenterAppVersions_compatibilityVersions_deleteToManyRelationship']['requestBody']['content']['application/json'],
  ): Promise<void> {
    const url = appleRequestUrl(
      '/v1/gameCenterAppVersions/{id}/relationships/compatibilityVersions',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('DELETE', url, document);
  }

  /**
   * GET /v1/gameCenterAppVersions/{id}/compatibilityVersions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterappversions-_id_-compatibilityversions}
   */
  async listGameCenterAppVersionsCompatibilityVersions(
    resourceId: string,
    query?: operations['gameCenterAppVersions_compatibilityVersions_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['gameCenterAppVersions_compatibilityVersions_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterAppVersions/{id}/compatibilityVersions',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterChallengeLocalizations/{id}/relationships/image
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterchallengelocalizations-_id_-relationships-image}
   */
  async getGameCenterChallengeLocalizationsImageLinkage(
    resourceId: string,
  ): Promise<
    operations['gameCenterChallengeLocalizations_image_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterChallengeLocalizations/{id}/relationships/image',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterChallengeLocalizations/{id}/image
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterchallengelocalizations-_id_-image}
   */
  async getGameCenterChallengeLocalizationsImage(
    resourceId: string,
    query?: operations['gameCenterChallengeLocalizations_image_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['gameCenterChallengeLocalizations_image_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterChallengeLocalizations/{id}/image',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterChallengeVersions/{id}/relationships/defaultImage
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterchallengeversions-_id_-relationships-defaultimage}
   */
  async getGameCenterChallengeVersionsDefaultImageLinkage(
    resourceId: string,
  ): Promise<
    operations['gameCenterChallengeVersions_defaultImage_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterChallengeVersions/{id}/relationships/defaultImage',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterChallengeVersions/{id}/defaultImage
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterchallengeversions-_id_-defaultimage}
   */
  async getGameCenterChallengeVersionsDefaultImage(
    resourceId: string,
    query?: operations['gameCenterChallengeVersions_defaultImage_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['gameCenterChallengeVersions_defaultImage_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterChallengeVersions/{id}/defaultImage',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterChallengeVersions/{id}/relationships/localizations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterchallengeversions-_id_-relationships-localizations}
   */
  async listGameCenterChallengeVersionsLocalizationsLinkage(
    resourceId: string,
    query?: operations['gameCenterChallengeVersions_localizations_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['gameCenterChallengeVersions_localizations_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterChallengeVersions/{id}/relationships/localizations',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterChallengeVersions/{id}/localizations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterchallengeversions-_id_-localizations}
   */
  async listGameCenterChallengeVersionsLocalizations(
    resourceId: string,
    query?: operations['gameCenterChallengeVersions_localizations_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['gameCenterChallengeVersions_localizations_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterChallengeVersions/{id}/localizations',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/gameCenterChallenges/{id}/relationships/leaderboard
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-gamecenterchallenges-_id_-relationships-leaderboard}
   */
  async updateGameCenterChallengesLeaderboardLinkage(
    resourceId: string,
    document: operations['gameCenterChallenges_leaderboard_updateToOneRelationship']['requestBody']['content']['application/json'],
  ): Promise<void> {
    const url = appleRequestUrl(
      '/v1/gameCenterChallenges/{id}/relationships/leaderboard',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('PATCH', url, document);
  }

  /**
   * PATCH /v1/gameCenterChallenges/{id}/relationships/leaderboardV2
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-gamecenterchallenges-_id_-relationships-leaderboardv2}
   */
  async updateGameCenterChallengesLeaderboardV2Linkage(
    resourceId: string,
    document: operations['gameCenterChallenges_leaderboardV2_updateToOneRelationship']['requestBody']['content']['application/json'],
  ): Promise<void> {
    const url = appleRequestUrl(
      '/v1/gameCenterChallenges/{id}/relationships/leaderboardV2',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('PATCH', url, document);
  }

  /**
   * GET /v1/gameCenterChallenges/{id}/relationships/versions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterchallenges-_id_-relationships-versions}
   */
  async listGameCenterChallengesVersionsLinkage(
    resourceId: string,
    query?: operations['gameCenterChallenges_versions_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['gameCenterChallenges_versions_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterChallenges/{id}/relationships/versions',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterChallenges/{id}/versions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterchallenges-_id_-versions}
   */
  async listGameCenterChallengesVersions(
    resourceId: string,
    query?: operations['gameCenterChallenges_versions_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['gameCenterChallenges_versions_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterChallenges/{id}/versions', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterDetails/{id}/relationships/achievementReleases
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterdetails-_id_-relationships-achievementreleases}
   */
  async listGameCenterDetailsAchievementReleasesLinkage(
    resourceId: string,
    query?: operations['gameCenterDetails_achievementReleases_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['gameCenterDetails_achievementReleases_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterDetails/{id}/relationships/achievementReleases',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterDetails/{id}/achievementReleases
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterdetails-_id_-achievementreleases}
   */
  async listGameCenterDetailsAchievementReleases(
    resourceId: string,
    query?: operations['gameCenterDetails_achievementReleases_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['gameCenterDetails_achievementReleases_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterDetails/{id}/achievementReleases',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterDetails/{id}/relationships/activityReleases
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterdetails-_id_-relationships-activityreleases}
   */
  async listGameCenterDetailsActivityReleasesLinkage(
    resourceId: string,
    query?: operations['gameCenterDetails_activityReleases_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['gameCenterDetails_activityReleases_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterDetails/{id}/relationships/activityReleases',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterDetails/{id}/activityReleases
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterdetails-_id_-activityreleases}
   */
  async listGameCenterDetailsActivityReleases(
    resourceId: string,
    query?: operations['gameCenterDetails_activityReleases_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['gameCenterDetails_activityReleases_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterDetails/{id}/activityReleases', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterDetails/{id}/relationships/blockedPlayers
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterdetails-_id_-relationships-blockedplayers}
   */
  async listGameCenterDetailsBlockedPlayersLinkage(
    resourceId: string,
    query?: operations['gameCenterDetails_blockedPlayers_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['gameCenterDetails_blockedPlayers_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterDetails/{id}/relationships/blockedPlayers',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterDetails/{id}/blockedPlayers
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterdetails-_id_-blockedplayers}
   */
  async listGameCenterDetailsBlockedPlayers(
    resourceId: string,
    query?: operations['gameCenterDetails_blockedPlayers_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['gameCenterDetails_blockedPlayers_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterDetails/{id}/blockedPlayers', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterDetails/{id}/relationships/challengeReleases
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterdetails-_id_-relationships-challengereleases}
   */
  async listGameCenterDetailsChallengeReleasesLinkage(
    resourceId: string,
    query?: operations['gameCenterDetails_challengeReleases_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['gameCenterDetails_challengeReleases_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterDetails/{id}/relationships/challengeReleases',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterDetails/{id}/challengeReleases
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterdetails-_id_-challengereleases}
   */
  async listGameCenterDetailsChallengeReleases(
    resourceId: string,
    query?: operations['gameCenterDetails_challengeReleases_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['gameCenterDetails_challengeReleases_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterDetails/{id}/challengeReleases', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/gameCenterDetails/{id}/relationships/challengesMinimumPlatformVersions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-gamecenterdetails-_id_-relationships-challengesminimumplatformversions}
   */
  async replaceGameCenterDetailsChallengesMinimumPlatformVersionsLinkage(
    resourceId: string,
    document: operations['gameCenterDetails_challengesMinimumPlatformVersions_replaceToManyRelationship']['requestBody']['content']['application/json'],
  ): Promise<void> {
    const url = appleRequestUrl(
      '/v1/gameCenterDetails/{id}/relationships/challengesMinimumPlatformVersions',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('PATCH', url, document);
  }

  /**
   * GET /v1/gameCenterDetails/{id}/relationships/gameCenterAchievements
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterdetails-_id_-relationships-gamecenterachievements}
   */
  async listGameCenterDetailsGameCenterAchievementsLinkage(
    resourceId: string,
    query?: operations['gameCenterDetails_gameCenterAchievements_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['gameCenterDetails_gameCenterAchievements_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterDetails/{id}/relationships/gameCenterAchievements',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/gameCenterDetails/{id}/relationships/gameCenterAchievements
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-gamecenterdetails-_id_-relationships-gamecenterachievements}
   */
  async replaceGameCenterDetailsGameCenterAchievementsLinkage(
    resourceId: string,
    document: operations['gameCenterDetails_gameCenterAchievements_replaceToManyRelationship']['requestBody']['content']['application/json'],
  ): Promise<void> {
    const url = appleRequestUrl(
      '/v1/gameCenterDetails/{id}/relationships/gameCenterAchievements',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('PATCH', url, document);
  }

  /**
   * GET /v1/gameCenterDetails/{id}/gameCenterAchievements
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterdetails-_id_-gamecenterachievements}
   */
  async listGameCenterDetailsGameCenterAchievements(
    resourceId: string,
    query?: operations['gameCenterDetails_gameCenterAchievements_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['gameCenterDetails_gameCenterAchievements_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterDetails/{id}/gameCenterAchievements',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterDetails/{id}/relationships/gameCenterAchievementsV2
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterdetails-_id_-relationships-gamecenterachievementsv2}
   */
  async listGameCenterDetailsGameCenterAchievementsV2Linkage(
    resourceId: string,
    query?: operations['gameCenterDetails_gameCenterAchievementsV2_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['gameCenterDetails_gameCenterAchievementsV2_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterDetails/{id}/relationships/gameCenterAchievementsV2',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/gameCenterDetails/{id}/relationships/gameCenterAchievementsV2
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-gamecenterdetails-_id_-relationships-gamecenterachievementsv2}
   */
  async replaceGameCenterDetailsGameCenterAchievementsV2Linkage(
    resourceId: string,
    document: operations['gameCenterDetails_gameCenterAchievementsV2_replaceToManyRelationship']['requestBody']['content']['application/json'],
  ): Promise<void> {
    const url = appleRequestUrl(
      '/v1/gameCenterDetails/{id}/relationships/gameCenterAchievementsV2',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('PATCH', url, document);
  }

  /**
   * GET /v1/gameCenterDetails/{id}/gameCenterAchievementsV2
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterdetails-_id_-gamecenterachievementsv2}
   */
  async listGameCenterDetailsGameCenterAchievementsV2(
    resourceId: string,
    query?: operations['gameCenterDetails_gameCenterAchievementsV2_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['gameCenterDetails_gameCenterAchievementsV2_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterDetails/{id}/gameCenterAchievementsV2',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterDetails/{id}/relationships/gameCenterActivities
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterdetails-_id_-relationships-gamecenteractivities}
   */
  async listGameCenterDetailsGameCenterActivitiesLinkage(
    resourceId: string,
    query?: operations['gameCenterDetails_gameCenterActivities_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['gameCenterDetails_gameCenterActivities_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterDetails/{id}/relationships/gameCenterActivities',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterDetails/{id}/gameCenterActivities
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterdetails-_id_-gamecenteractivities}
   */
  async listGameCenterDetailsGameCenterActivities(
    resourceId: string,
    query?: operations['gameCenterDetails_gameCenterActivities_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['gameCenterDetails_gameCenterActivities_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterDetails/{id}/gameCenterActivities',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterDetails/{id}/relationships/gameCenterAppVersions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterdetails-_id_-relationships-gamecenterappversions}
   */
  async listGameCenterDetailsGameCenterAppVersionsLinkage(
    resourceId: string,
    query?: operations['gameCenterDetails_gameCenterAppVersions_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['gameCenterDetails_gameCenterAppVersions_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterDetails/{id}/relationships/gameCenterAppVersions',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterDetails/{id}/gameCenterAppVersions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterdetails-_id_-gamecenterappversions}
   */
  async listGameCenterDetailsGameCenterAppVersions(
    resourceId: string,
    query?: operations['gameCenterDetails_gameCenterAppVersions_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['gameCenterDetails_gameCenterAppVersions_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterDetails/{id}/gameCenterAppVersions',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterDetails/{id}/relationships/gameCenterChallenges
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterdetails-_id_-relationships-gamecenterchallenges}
   */
  async listGameCenterDetailsGameCenterChallengesLinkage(
    resourceId: string,
    query?: operations['gameCenterDetails_gameCenterChallenges_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['gameCenterDetails_gameCenterChallenges_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterDetails/{id}/relationships/gameCenterChallenges',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterDetails/{id}/gameCenterChallenges
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterdetails-_id_-gamecenterchallenges}
   */
  async listGameCenterDetailsGameCenterChallenges(
    resourceId: string,
    query?: operations['gameCenterDetails_gameCenterChallenges_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['gameCenterDetails_gameCenterChallenges_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterDetails/{id}/gameCenterChallenges',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterDetails/{id}/relationships/gameCenterGroup
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterdetails-_id_-relationships-gamecentergroup}
   */
  async getGameCenterDetailsGameCenterGroupLinkage(
    resourceId: string,
  ): Promise<
    operations['gameCenterDetails_gameCenterGroup_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterDetails/{id}/relationships/gameCenterGroup',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterDetails/{id}/gameCenterGroup
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterdetails-_id_-gamecentergroup}
   */
  async getGameCenterDetailsGameCenterGroup(
    resourceId: string,
    query?: operations['gameCenterDetails_gameCenterGroup_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['gameCenterDetails_gameCenterGroup_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterDetails/{id}/gameCenterGroup', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterDetails/{id}/relationships/gameCenterLeaderboardSets
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterdetails-_id_-relationships-gamecenterleaderboardsets}
   */
  async listGameCenterDetailsGameCenterLeaderboardSetsLinkage(
    resourceId: string,
    query?: operations['gameCenterDetails_gameCenterLeaderboardSets_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['gameCenterDetails_gameCenterLeaderboardSets_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterDetails/{id}/relationships/gameCenterLeaderboardSets',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/gameCenterDetails/{id}/relationships/gameCenterLeaderboardSets
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-gamecenterdetails-_id_-relationships-gamecenterleaderboardsets}
   */
  async replaceGameCenterDetailsGameCenterLeaderboardSetsLinkage(
    resourceId: string,
    document: operations['gameCenterDetails_gameCenterLeaderboardSets_replaceToManyRelationship']['requestBody']['content']['application/json'],
  ): Promise<void> {
    const url = appleRequestUrl(
      '/v1/gameCenterDetails/{id}/relationships/gameCenterLeaderboardSets',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('PATCH', url, document);
  }

  /**
   * GET /v1/gameCenterDetails/{id}/gameCenterLeaderboardSets
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterdetails-_id_-gamecenterleaderboardsets}
   */
  async listGameCenterDetailsGameCenterLeaderboardSets(
    resourceId: string,
    query?: operations['gameCenterDetails_gameCenterLeaderboardSets_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['gameCenterDetails_gameCenterLeaderboardSets_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterDetails/{id}/gameCenterLeaderboardSets',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterDetails/{id}/relationships/gameCenterLeaderboardSetsV2
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterdetails-_id_-relationships-gamecenterleaderboardsetsv2}
   */
  async listGameCenterDetailsGameCenterLeaderboardSetsV2Linkage(
    resourceId: string,
    query?: operations['gameCenterDetails_gameCenterLeaderboardSetsV2_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['gameCenterDetails_gameCenterLeaderboardSetsV2_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterDetails/{id}/relationships/gameCenterLeaderboardSetsV2',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/gameCenterDetails/{id}/relationships/gameCenterLeaderboardSetsV2
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-gamecenterdetails-_id_-relationships-gamecenterleaderboardsetsv2}
   */
  async replaceGameCenterDetailsGameCenterLeaderboardSetsV2Linkage(
    resourceId: string,
    document: operations['gameCenterDetails_gameCenterLeaderboardSetsV2_replaceToManyRelationship']['requestBody']['content']['application/json'],
  ): Promise<void> {
    const url = appleRequestUrl(
      '/v1/gameCenterDetails/{id}/relationships/gameCenterLeaderboardSetsV2',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('PATCH', url, document);
  }

  /**
   * GET /v1/gameCenterDetails/{id}/gameCenterLeaderboardSetsV2
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterdetails-_id_-gamecenterleaderboardsetsv2}
   */
  async listGameCenterDetailsGameCenterLeaderboardSetsV2(
    resourceId: string,
    query?: operations['gameCenterDetails_gameCenterLeaderboardSetsV2_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['gameCenterDetails_gameCenterLeaderboardSetsV2_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterDetails/{id}/gameCenterLeaderboardSetsV2',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterDetails/{id}/relationships/gameCenterLeaderboards
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterdetails-_id_-relationships-gamecenterleaderboards}
   */
  async listGameCenterDetailsGameCenterLeaderboardsLinkage(
    resourceId: string,
    query?: operations['gameCenterDetails_gameCenterLeaderboards_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['gameCenterDetails_gameCenterLeaderboards_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterDetails/{id}/relationships/gameCenterLeaderboards',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/gameCenterDetails/{id}/relationships/gameCenterLeaderboards
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-gamecenterdetails-_id_-relationships-gamecenterleaderboards}
   */
  async replaceGameCenterDetailsGameCenterLeaderboardsLinkage(
    resourceId: string,
    document: operations['gameCenterDetails_gameCenterLeaderboards_replaceToManyRelationship']['requestBody']['content']['application/json'],
  ): Promise<void> {
    const url = appleRequestUrl(
      '/v1/gameCenterDetails/{id}/relationships/gameCenterLeaderboards',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('PATCH', url, document);
  }

  /**
   * GET /v1/gameCenterDetails/{id}/gameCenterLeaderboards
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterdetails-_id_-gamecenterleaderboards}
   */
  async listGameCenterDetailsGameCenterLeaderboards(
    resourceId: string,
    query?: operations['gameCenterDetails_gameCenterLeaderboards_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['gameCenterDetails_gameCenterLeaderboards_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterDetails/{id}/gameCenterLeaderboards',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterDetails/{id}/relationships/gameCenterLeaderboardsV2
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterdetails-_id_-relationships-gamecenterleaderboardsv2}
   */
  async listGameCenterDetailsGameCenterLeaderboardsV2Linkage(
    resourceId: string,
    query?: operations['gameCenterDetails_gameCenterLeaderboardsV2_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['gameCenterDetails_gameCenterLeaderboardsV2_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterDetails/{id}/relationships/gameCenterLeaderboardsV2',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/gameCenterDetails/{id}/relationships/gameCenterLeaderboardsV2
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-gamecenterdetails-_id_-relationships-gamecenterleaderboardsv2}
   */
  async replaceGameCenterDetailsGameCenterLeaderboardsV2Linkage(
    resourceId: string,
    document: operations['gameCenterDetails_gameCenterLeaderboardsV2_replaceToManyRelationship']['requestBody']['content']['application/json'],
  ): Promise<void> {
    const url = appleRequestUrl(
      '/v1/gameCenterDetails/{id}/relationships/gameCenterLeaderboardsV2',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('PATCH', url, document);
  }

  /**
   * GET /v1/gameCenterDetails/{id}/gameCenterLeaderboardsV2
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterdetails-_id_-gamecenterleaderboardsv2}
   */
  async listGameCenterDetailsGameCenterLeaderboardsV2(
    resourceId: string,
    query?: operations['gameCenterDetails_gameCenterLeaderboardsV2_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['gameCenterDetails_gameCenterLeaderboardsV2_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterDetails/{id}/gameCenterLeaderboardsV2',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterDetails/{id}/relationships/leaderboardReleases
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterdetails-_id_-relationships-leaderboardreleases}
   */
  async listGameCenterDetailsLeaderboardReleasesLinkage(
    resourceId: string,
    query?: operations['gameCenterDetails_leaderboardReleases_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['gameCenterDetails_leaderboardReleases_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterDetails/{id}/relationships/leaderboardReleases',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterDetails/{id}/leaderboardReleases
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterdetails-_id_-leaderboardreleases}
   */
  async listGameCenterDetailsLeaderboardReleases(
    resourceId: string,
    query?: operations['gameCenterDetails_leaderboardReleases_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['gameCenterDetails_leaderboardReleases_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterDetails/{id}/leaderboardReleases',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterDetails/{id}/relationships/leaderboardSetReleases
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterdetails-_id_-relationships-leaderboardsetreleases}
   */
  async listGameCenterDetailsLeaderboardSetReleasesLinkage(
    resourceId: string,
    query?: operations['gameCenterDetails_leaderboardSetReleases_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['gameCenterDetails_leaderboardSetReleases_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterDetails/{id}/relationships/leaderboardSetReleases',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterDetails/{id}/leaderboardSetReleases
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterdetails-_id_-leaderboardsetreleases}
   */
  async listGameCenterDetailsLeaderboardSetReleases(
    resourceId: string,
    query?: operations['gameCenterDetails_leaderboardSetReleases_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['gameCenterDetails_leaderboardSetReleases_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterDetails/{id}/leaderboardSetReleases',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterEnabledVersions/{id}/relationships/compatibleVersions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterenabledversions-_id_-relationships-compatibleversions}
   */
  async listGameCenterEnabledVersionsCompatibleVersionsLinkage(
    resourceId: string,
    query?: operations['gameCenterEnabledVersions_compatibleVersions_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['gameCenterEnabledVersions_compatibleVersions_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterEnabledVersions/{id}/relationships/compatibleVersions',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * POST /v1/gameCenterEnabledVersions/{id}/relationships/compatibleVersions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-gamecenterenabledversions-_id_-relationships-compatibleversions}
   */
  async addGameCenterEnabledVersionsCompatibleVersionsLinkage(
    resourceId: string,
    document: operations['gameCenterEnabledVersions_compatibleVersions_createToManyRelationship']['requestBody']['content']['application/json'],
  ): Promise<void> {
    const url = appleRequestUrl(
      '/v1/gameCenterEnabledVersions/{id}/relationships/compatibleVersions',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('POST', url, document);
  }

  /**
   * PATCH /v1/gameCenterEnabledVersions/{id}/relationships/compatibleVersions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-gamecenterenabledversions-_id_-relationships-compatibleversions}
   */
  async replaceGameCenterEnabledVersionsCompatibleVersionsLinkage(
    resourceId: string,
    document: operations['gameCenterEnabledVersions_compatibleVersions_replaceToManyRelationship']['requestBody']['content']['application/json'],
  ): Promise<void> {
    const url = appleRequestUrl(
      '/v1/gameCenterEnabledVersions/{id}/relationships/compatibleVersions',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v1/gameCenterEnabledVersions/{id}/relationships/compatibleVersions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-gamecenterenabledversions-_id_-relationships-compatibleversions}
   */
  async removeGameCenterEnabledVersionsCompatibleVersionsLinkage(
    resourceId: string,
    document: operations['gameCenterEnabledVersions_compatibleVersions_deleteToManyRelationship']['requestBody']['content']['application/json'],
  ): Promise<void> {
    const url = appleRequestUrl(
      '/v1/gameCenterEnabledVersions/{id}/relationships/compatibleVersions',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('DELETE', url, document);
  }

  /**
   * GET /v1/gameCenterEnabledVersions/{id}/compatibleVersions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterenabledversions-_id_-compatibleversions}
   */
  async listGameCenterEnabledVersionsCompatibleVersions(
    resourceId: string,
    query?: operations['gameCenterEnabledVersions_compatibleVersions_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['gameCenterEnabledVersions_compatibleVersions_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterEnabledVersions/{id}/compatibleVersions',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterGroups/{id}/relationships/gameCenterAchievements
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecentergroups-_id_-relationships-gamecenterachievements}
   */
  async listGameCenterGroupsGameCenterAchievementsLinkage(
    resourceId: string,
    query?: operations['gameCenterGroups_gameCenterAchievements_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['gameCenterGroups_gameCenterAchievements_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterGroups/{id}/relationships/gameCenterAchievements',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/gameCenterGroups/{id}/relationships/gameCenterAchievements
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-gamecentergroups-_id_-relationships-gamecenterachievements}
   */
  async replaceGameCenterGroupsGameCenterAchievementsLinkage(
    resourceId: string,
    document: operations['gameCenterGroups_gameCenterAchievements_replaceToManyRelationship']['requestBody']['content']['application/json'],
  ): Promise<void> {
    const url = appleRequestUrl(
      '/v1/gameCenterGroups/{id}/relationships/gameCenterAchievements',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('PATCH', url, document);
  }

  /**
   * GET /v1/gameCenterGroups/{id}/gameCenterAchievements
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecentergroups-_id_-gamecenterachievements}
   */
  async listGameCenterGroupsGameCenterAchievements(
    resourceId: string,
    query?: operations['gameCenterGroups_gameCenterAchievements_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['gameCenterGroups_gameCenterAchievements_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterGroups/{id}/gameCenterAchievements',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterGroups/{id}/relationships/gameCenterAchievementsV2
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecentergroups-_id_-relationships-gamecenterachievementsv2}
   */
  async listGameCenterGroupsGameCenterAchievementsV2Linkage(
    resourceId: string,
    query?: operations['gameCenterGroups_gameCenterAchievementsV2_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['gameCenterGroups_gameCenterAchievementsV2_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterGroups/{id}/relationships/gameCenterAchievementsV2',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/gameCenterGroups/{id}/relationships/gameCenterAchievementsV2
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-gamecentergroups-_id_-relationships-gamecenterachievementsv2}
   */
  async replaceGameCenterGroupsGameCenterAchievementsV2Linkage(
    resourceId: string,
    document: operations['gameCenterGroups_gameCenterAchievementsV2_replaceToManyRelationship']['requestBody']['content']['application/json'],
  ): Promise<void> {
    const url = appleRequestUrl(
      '/v1/gameCenterGroups/{id}/relationships/gameCenterAchievementsV2',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('PATCH', url, document);
  }

  /**
   * GET /v1/gameCenterGroups/{id}/gameCenterAchievementsV2
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecentergroups-_id_-gamecenterachievementsv2}
   */
  async listGameCenterGroupsGameCenterAchievementsV2(
    resourceId: string,
    query?: operations['gameCenterGroups_gameCenterAchievementsV2_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['gameCenterGroups_gameCenterAchievementsV2_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterGroups/{id}/gameCenterAchievementsV2',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterGroups/{id}/relationships/gameCenterActivities
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecentergroups-_id_-relationships-gamecenteractivities}
   */
  async listGameCenterGroupsGameCenterActivitiesLinkage(
    resourceId: string,
    query?: operations['gameCenterGroups_gameCenterActivities_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['gameCenterGroups_gameCenterActivities_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterGroups/{id}/relationships/gameCenterActivities',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterGroups/{id}/gameCenterActivities
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecentergroups-_id_-gamecenteractivities}
   */
  async listGameCenterGroupsGameCenterActivities(
    resourceId: string,
    query?: operations['gameCenterGroups_gameCenterActivities_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['gameCenterGroups_gameCenterActivities_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterGroups/{id}/gameCenterActivities',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterGroups/{id}/relationships/gameCenterChallenges
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecentergroups-_id_-relationships-gamecenterchallenges}
   */
  async listGameCenterGroupsGameCenterChallengesLinkage(
    resourceId: string,
    query?: operations['gameCenterGroups_gameCenterChallenges_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['gameCenterGroups_gameCenterChallenges_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterGroups/{id}/relationships/gameCenterChallenges',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterGroups/{id}/gameCenterChallenges
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecentergroups-_id_-gamecenterchallenges}
   */
  async listGameCenterGroupsGameCenterChallenges(
    resourceId: string,
    query?: operations['gameCenterGroups_gameCenterChallenges_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['gameCenterGroups_gameCenterChallenges_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterGroups/{id}/gameCenterChallenges',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterGroups/{id}/relationships/gameCenterDetails
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecentergroups-_id_-relationships-gamecenterdetails}
   */
  async listGameCenterGroupsGameCenterDetailsLinkage(
    resourceId: string,
    query?: operations['gameCenterGroups_gameCenterDetails_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['gameCenterGroups_gameCenterDetails_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterGroups/{id}/relationships/gameCenterDetails',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterGroups/{id}/gameCenterDetails
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecentergroups-_id_-gamecenterdetails}
   */
  async listGameCenterGroupsGameCenterDetails(
    resourceId: string,
    query?: operations['gameCenterGroups_gameCenterDetails_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['gameCenterGroups_gameCenterDetails_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterGroups/{id}/gameCenterDetails', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterGroups/{id}/relationships/gameCenterLeaderboardSets
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecentergroups-_id_-relationships-gamecenterleaderboardsets}
   */
  async listGameCenterGroupsGameCenterLeaderboardSetsLinkage(
    resourceId: string,
    query?: operations['gameCenterGroups_gameCenterLeaderboardSets_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['gameCenterGroups_gameCenterLeaderboardSets_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterGroups/{id}/relationships/gameCenterLeaderboardSets',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/gameCenterGroups/{id}/relationships/gameCenterLeaderboardSets
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-gamecentergroups-_id_-relationships-gamecenterleaderboardsets}
   */
  async replaceGameCenterGroupsGameCenterLeaderboardSetsLinkage(
    resourceId: string,
    document: operations['gameCenterGroups_gameCenterLeaderboardSets_replaceToManyRelationship']['requestBody']['content']['application/json'],
  ): Promise<void> {
    const url = appleRequestUrl(
      '/v1/gameCenterGroups/{id}/relationships/gameCenterLeaderboardSets',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('PATCH', url, document);
  }

  /**
   * GET /v1/gameCenterGroups/{id}/gameCenterLeaderboardSets
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecentergroups-_id_-gamecenterleaderboardsets}
   */
  async listGameCenterGroupsGameCenterLeaderboardSets(
    resourceId: string,
    query?: operations['gameCenterGroups_gameCenterLeaderboardSets_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['gameCenterGroups_gameCenterLeaderboardSets_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterGroups/{id}/gameCenterLeaderboardSets',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterGroups/{id}/relationships/gameCenterLeaderboardSetsV2
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecentergroups-_id_-relationships-gamecenterleaderboardsetsv2}
   */
  async listGameCenterGroupsGameCenterLeaderboardSetsV2Linkage(
    resourceId: string,
    query?: operations['gameCenterGroups_gameCenterLeaderboardSetsV2_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['gameCenterGroups_gameCenterLeaderboardSetsV2_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterGroups/{id}/relationships/gameCenterLeaderboardSetsV2',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/gameCenterGroups/{id}/relationships/gameCenterLeaderboardSetsV2
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-gamecentergroups-_id_-relationships-gamecenterleaderboardsetsv2}
   */
  async replaceGameCenterGroupsGameCenterLeaderboardSetsV2Linkage(
    resourceId: string,
    document: operations['gameCenterGroups_gameCenterLeaderboardSetsV2_replaceToManyRelationship']['requestBody']['content']['application/json'],
  ): Promise<void> {
    const url = appleRequestUrl(
      '/v1/gameCenterGroups/{id}/relationships/gameCenterLeaderboardSetsV2',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('PATCH', url, document);
  }

  /**
   * GET /v1/gameCenterGroups/{id}/gameCenterLeaderboardSetsV2
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecentergroups-_id_-gamecenterleaderboardsetsv2}
   */
  async listGameCenterGroupsGameCenterLeaderboardSetsV2(
    resourceId: string,
    query?: operations['gameCenterGroups_gameCenterLeaderboardSetsV2_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['gameCenterGroups_gameCenterLeaderboardSetsV2_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterGroups/{id}/gameCenterLeaderboardSetsV2',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterGroups/{id}/relationships/gameCenterLeaderboards
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecentergroups-_id_-relationships-gamecenterleaderboards}
   */
  async listGameCenterGroupsGameCenterLeaderboardsLinkage(
    resourceId: string,
    query?: operations['gameCenterGroups_gameCenterLeaderboards_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['gameCenterGroups_gameCenterLeaderboards_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterGroups/{id}/relationships/gameCenterLeaderboards',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/gameCenterGroups/{id}/relationships/gameCenterLeaderboards
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-gamecentergroups-_id_-relationships-gamecenterleaderboards}
   */
  async replaceGameCenterGroupsGameCenterLeaderboardsLinkage(
    resourceId: string,
    document: operations['gameCenterGroups_gameCenterLeaderboards_replaceToManyRelationship']['requestBody']['content']['application/json'],
  ): Promise<void> {
    const url = appleRequestUrl(
      '/v1/gameCenterGroups/{id}/relationships/gameCenterLeaderboards',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('PATCH', url, document);
  }

  /**
   * GET /v1/gameCenterGroups/{id}/gameCenterLeaderboards
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecentergroups-_id_-gamecenterleaderboards}
   */
  async listGameCenterGroupsGameCenterLeaderboards(
    resourceId: string,
    query?: operations['gameCenterGroups_gameCenterLeaderboards_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['gameCenterGroups_gameCenterLeaderboards_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterGroups/{id}/gameCenterLeaderboards',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterGroups/{id}/relationships/gameCenterLeaderboardsV2
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecentergroups-_id_-relationships-gamecenterleaderboardsv2}
   */
  async listGameCenterGroupsGameCenterLeaderboardsV2Linkage(
    resourceId: string,
    query?: operations['gameCenterGroups_gameCenterLeaderboardsV2_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['gameCenterGroups_gameCenterLeaderboardsV2_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterGroups/{id}/relationships/gameCenterLeaderboardsV2',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/gameCenterGroups/{id}/relationships/gameCenterLeaderboardsV2
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-gamecentergroups-_id_-relationships-gamecenterleaderboardsv2}
   */
  async replaceGameCenterGroupsGameCenterLeaderboardsV2Linkage(
    resourceId: string,
    document: operations['gameCenterGroups_gameCenterLeaderboardsV2_replaceToManyRelationship']['requestBody']['content']['application/json'],
  ): Promise<void> {
    const url = appleRequestUrl(
      '/v1/gameCenterGroups/{id}/relationships/gameCenterLeaderboardsV2',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('PATCH', url, document);
  }

  /**
   * GET /v1/gameCenterGroups/{id}/gameCenterLeaderboardsV2
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecentergroups-_id_-gamecenterleaderboardsv2}
   */
  async listGameCenterGroupsGameCenterLeaderboardsV2(
    resourceId: string,
    query?: operations['gameCenterGroups_gameCenterLeaderboardsV2_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['gameCenterGroups_gameCenterLeaderboardsV2_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterGroups/{id}/gameCenterLeaderboardsV2',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterLeaderboardLocalizations/{id}/relationships/gameCenterLeaderboardImage
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterleaderboardlocalizations-_id_-relationships-gamecenterleaderboardimage}
   */
  async getGameCenterLeaderboardLocalizationsGameCenterLeaderboardImageLinkage(
    resourceId: string,
  ): Promise<
    operations['gameCenterLeaderboardLocalizations_gameCenterLeaderboardImage_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterLeaderboardLocalizations/{id}/relationships/gameCenterLeaderboardImage',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterLeaderboardLocalizations/{id}/gameCenterLeaderboardImage
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterleaderboardlocalizations-_id_-gamecenterleaderboardimage}
   */
  async getGameCenterLeaderboardLocalizationsGameCenterLeaderboardImage(
    resourceId: string,
    query?: operations['gameCenterLeaderboardLocalizations_gameCenterLeaderboardImage_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['gameCenterLeaderboardLocalizations_gameCenterLeaderboardImage_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterLeaderboardLocalizations/{id}/gameCenterLeaderboardImage',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v2/gameCenterLeaderboardLocalizations/{id}/relationships/image
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v2-gamecenterleaderboardlocalizations-_id_-relationships-image}
   */
  async getGameCenterLeaderboardLocalizationsV2ImageLinkage(
    resourceId: string,
  ): Promise<
    operations['gameCenterLeaderboardLocalizationsV2_image_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v2/gameCenterLeaderboardLocalizations/{id}/relationships/image',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v2/gameCenterLeaderboardLocalizations/{id}/image
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v2-gamecenterleaderboardlocalizations-_id_-image}
   */
  async getGameCenterLeaderboardLocalizationsV2Image(
    resourceId: string,
    query?: operations['gameCenterLeaderboardLocalizationsV2_image_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['gameCenterLeaderboardLocalizationsV2_image_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v2/gameCenterLeaderboardLocalizations/{id}/image',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterLeaderboardSetLocalizations/{id}/relationships/gameCenterLeaderboardSetImage
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterleaderboardsetlocalizations-_id_-relationships-gamecenterleaderboardsetimage}
   */
  async getGameCenterLeaderboardSetLocalizationsGameCenterLeaderboardSetImageLinkage(
    resourceId: string,
  ): Promise<
    operations['gameCenterLeaderboardSetLocalizations_gameCenterLeaderboardSetImage_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterLeaderboardSetLocalizations/{id}/relationships/gameCenterLeaderboardSetImage',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterLeaderboardSetLocalizations/{id}/gameCenterLeaderboardSetImage
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterleaderboardsetlocalizations-_id_-gamecenterleaderboardsetimage}
   */
  async getGameCenterLeaderboardSetLocalizationsGameCenterLeaderboardSetImage(
    resourceId: string,
    query?: operations['gameCenterLeaderboardSetLocalizations_gameCenterLeaderboardSetImage_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['gameCenterLeaderboardSetLocalizations_gameCenterLeaderboardSetImage_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterLeaderboardSetLocalizations/{id}/gameCenterLeaderboardSetImage',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v2/gameCenterLeaderboardSetLocalizations/{id}/relationships/image
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v2-gamecenterleaderboardsetlocalizations-_id_-relationships-image}
   */
  async getGameCenterLeaderboardSetLocalizationsV2ImageLinkage(
    resourceId: string,
  ): Promise<
    operations['gameCenterLeaderboardSetLocalizationsV2_image_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v2/gameCenterLeaderboardSetLocalizations/{id}/relationships/image',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v2/gameCenterLeaderboardSetLocalizations/{id}/image
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v2-gamecenterleaderboardsetlocalizations-_id_-image}
   */
  async getGameCenterLeaderboardSetLocalizationsV2Image(
    resourceId: string,
    query?: operations['gameCenterLeaderboardSetLocalizationsV2_image_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['gameCenterLeaderboardSetLocalizationsV2_image_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v2/gameCenterLeaderboardSetLocalizations/{id}/image',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterLeaderboardSetMemberLocalizations/{id}/relationships/gameCenterLeaderboard
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterleaderboardsetmemberlocalizations-_id_-relationships-gamecenterleaderboard}
   */
  async getGameCenterLeaderboardSetMemberLocalizationsGameCenterLeaderboardLinkage(
    resourceId: string,
  ): Promise<
    operations['gameCenterLeaderboardSetMemberLocalizations_gameCenterLeaderboard_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterLeaderboardSetMemberLocalizations/{id}/relationships/gameCenterLeaderboard',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterLeaderboardSetMemberLocalizations/{id}/gameCenterLeaderboard
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterleaderboardsetmemberlocalizations-_id_-gamecenterleaderboard}
   */
  async getGameCenterLeaderboardSetMemberLocalizationsGameCenterLeaderboard(
    resourceId: string,
    query?: operations['gameCenterLeaderboardSetMemberLocalizations_gameCenterLeaderboard_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['gameCenterLeaderboardSetMemberLocalizations_gameCenterLeaderboard_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterLeaderboardSetMemberLocalizations/{id}/gameCenterLeaderboard',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterLeaderboardSetMemberLocalizations/{id}/relationships/gameCenterLeaderboardSet
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterleaderboardsetmemberlocalizations-_id_-relationships-gamecenterleaderboardset}
   */
  async getGameCenterLeaderboardSetMemberLocalizationsGameCenterLeaderboardSetLinkage(
    resourceId: string,
  ): Promise<
    operations['gameCenterLeaderboardSetMemberLocalizations_gameCenterLeaderboardSet_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterLeaderboardSetMemberLocalizations/{id}/relationships/gameCenterLeaderboardSet',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterLeaderboardSetMemberLocalizations/{id}/gameCenterLeaderboardSet
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterleaderboardsetmemberlocalizations-_id_-gamecenterleaderboardset}
   */
  async getGameCenterLeaderboardSetMemberLocalizationsGameCenterLeaderboardSet(
    resourceId: string,
    query?: operations['gameCenterLeaderboardSetMemberLocalizations_gameCenterLeaderboardSet_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['gameCenterLeaderboardSetMemberLocalizations_gameCenterLeaderboardSet_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterLeaderboardSetMemberLocalizations/{id}/gameCenterLeaderboardSet',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v2/gameCenterLeaderboardSetVersions/{id}/relationships/localizations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v2-gamecenterleaderboardsetversions-_id_-relationships-localizations}
   */
  async listGameCenterLeaderboardSetVersionsV2LocalizationsLinkage(
    resourceId: string,
    query?: operations['gameCenterLeaderboardSetVersionsV2_localizations_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['gameCenterLeaderboardSetVersionsV2_localizations_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v2/gameCenterLeaderboardSetVersions/{id}/relationships/localizations',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v2/gameCenterLeaderboardSetVersions/{id}/localizations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v2-gamecenterleaderboardsetversions-_id_-localizations}
   */
  async listGameCenterLeaderboardSetVersionsV2Localizations(
    resourceId: string,
    query?: operations['gameCenterLeaderboardSetVersionsV2_localizations_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['gameCenterLeaderboardSetVersionsV2_localizations_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v2/gameCenterLeaderboardSetVersions/{id}/localizations',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v2/gameCenterLeaderboardSets/{id}/relationships/gameCenterLeaderboards
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v2-gamecenterleaderboardsets-_id_-relationships-gamecenterleaderboards}
   */
  async listGameCenterLeaderboardSetsV2GameCenterLeaderboardsLinkage(
    resourceId: string,
    query?: operations['gameCenterLeaderboardSetsV2_gameCenterLeaderboards_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['gameCenterLeaderboardSetsV2_gameCenterLeaderboards_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v2/gameCenterLeaderboardSets/{id}/relationships/gameCenterLeaderboards',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * POST /v2/gameCenterLeaderboardSets/{id}/relationships/gameCenterLeaderboards
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v2-gamecenterleaderboardsets-_id_-relationships-gamecenterleaderboards}
   */
  async addGameCenterLeaderboardSetsV2GameCenterLeaderboardsLinkage(
    resourceId: string,
    document: operations['gameCenterLeaderboardSetsV2_gameCenterLeaderboards_createToManyRelationship']['requestBody']['content']['application/json'],
  ): Promise<void> {
    const url = appleRequestUrl(
      '/v2/gameCenterLeaderboardSets/{id}/relationships/gameCenterLeaderboards',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('POST', url, document);
  }

  /**
   * PATCH /v2/gameCenterLeaderboardSets/{id}/relationships/gameCenterLeaderboards
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v2-gamecenterleaderboardsets-_id_-relationships-gamecenterleaderboards}
   */
  async replaceGameCenterLeaderboardSetsV2GameCenterLeaderboardsLinkage(
    resourceId: string,
    document: operations['gameCenterLeaderboardSetsV2_gameCenterLeaderboards_replaceToManyRelationship']['requestBody']['content']['application/json'],
  ): Promise<void> {
    const url = appleRequestUrl(
      '/v2/gameCenterLeaderboardSets/{id}/relationships/gameCenterLeaderboards',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v2/gameCenterLeaderboardSets/{id}/relationships/gameCenterLeaderboards
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v2-gamecenterleaderboardsets-_id_-relationships-gamecenterleaderboards}
   */
  async removeGameCenterLeaderboardSetsV2GameCenterLeaderboardsLinkage(
    resourceId: string,
    document: operations['gameCenterLeaderboardSetsV2_gameCenterLeaderboards_deleteToManyRelationship']['requestBody']['content']['application/json'],
  ): Promise<void> {
    const url = appleRequestUrl(
      '/v2/gameCenterLeaderboardSets/{id}/relationships/gameCenterLeaderboards',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('DELETE', url, document);
  }

  /**
   * GET /v2/gameCenterLeaderboardSets/{id}/gameCenterLeaderboards
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v2-gamecenterleaderboardsets-_id_-gamecenterleaderboards}
   */
  async listGameCenterLeaderboardSetsV2GameCenterLeaderboards(
    resourceId: string,
    query?: operations['gameCenterLeaderboardSetsV2_gameCenterLeaderboards_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['gameCenterLeaderboardSetsV2_gameCenterLeaderboards_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v2/gameCenterLeaderboardSets/{id}/gameCenterLeaderboards',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v2/gameCenterLeaderboardSets/{id}/relationships/versions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v2-gamecenterleaderboardsets-_id_-relationships-versions}
   */
  async listGameCenterLeaderboardSetsV2VersionsLinkage(
    resourceId: string,
    query?: operations['gameCenterLeaderboardSetsV2_versions_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['gameCenterLeaderboardSetsV2_versions_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v2/gameCenterLeaderboardSets/{id}/relationships/versions',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v2/gameCenterLeaderboardSets/{id}/versions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v2-gamecenterleaderboardsets-_id_-versions}
   */
  async listGameCenterLeaderboardSetsV2Versions(
    resourceId: string,
    query?: operations['gameCenterLeaderboardSetsV2_versions_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['gameCenterLeaderboardSetsV2_versions_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v2/gameCenterLeaderboardSets/{id}/versions', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterLeaderboardSets/{id}/relationships/gameCenterLeaderboards
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterleaderboardsets-_id_-relationships-gamecenterleaderboards}
   */
  async listGameCenterLeaderboardSetsGameCenterLeaderboardsLinkage(
    resourceId: string,
    query?: operations['gameCenterLeaderboardSets_gameCenterLeaderboards_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['gameCenterLeaderboardSets_gameCenterLeaderboards_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterLeaderboardSets/{id}/relationships/gameCenterLeaderboards',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * POST /v1/gameCenterLeaderboardSets/{id}/relationships/gameCenterLeaderboards
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-gamecenterleaderboardsets-_id_-relationships-gamecenterleaderboards}
   */
  async addGameCenterLeaderboardSetsGameCenterLeaderboardsLinkage(
    resourceId: string,
    document: operations['gameCenterLeaderboardSets_gameCenterLeaderboards_createToManyRelationship']['requestBody']['content']['application/json'],
  ): Promise<void> {
    const url = appleRequestUrl(
      '/v1/gameCenterLeaderboardSets/{id}/relationships/gameCenterLeaderboards',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('POST', url, document);
  }

  /**
   * PATCH /v1/gameCenterLeaderboardSets/{id}/relationships/gameCenterLeaderboards
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-gamecenterleaderboardsets-_id_-relationships-gamecenterleaderboards}
   */
  async replaceGameCenterLeaderboardSetsGameCenterLeaderboardsLinkage(
    resourceId: string,
    document: operations['gameCenterLeaderboardSets_gameCenterLeaderboards_replaceToManyRelationship']['requestBody']['content']['application/json'],
  ): Promise<void> {
    const url = appleRequestUrl(
      '/v1/gameCenterLeaderboardSets/{id}/relationships/gameCenterLeaderboards',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v1/gameCenterLeaderboardSets/{id}/relationships/gameCenterLeaderboards
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-gamecenterleaderboardsets-_id_-relationships-gamecenterleaderboards}
   */
  async removeGameCenterLeaderboardSetsGameCenterLeaderboardsLinkage(
    resourceId: string,
    document: operations['gameCenterLeaderboardSets_gameCenterLeaderboards_deleteToManyRelationship']['requestBody']['content']['application/json'],
  ): Promise<void> {
    const url = appleRequestUrl(
      '/v1/gameCenterLeaderboardSets/{id}/relationships/gameCenterLeaderboards',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('DELETE', url, document);
  }

  /**
   * GET /v1/gameCenterLeaderboardSets/{id}/gameCenterLeaderboards
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterleaderboardsets-_id_-gamecenterleaderboards}
   */
  async listGameCenterLeaderboardSetsGameCenterLeaderboards(
    resourceId: string,
    query?: operations['gameCenterLeaderboardSets_gameCenterLeaderboards_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['gameCenterLeaderboardSets_gameCenterLeaderboards_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterLeaderboardSets/{id}/gameCenterLeaderboards',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterLeaderboardSets/{id}/relationships/groupLeaderboardSet
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterleaderboardsets-_id_-relationships-groupleaderboardset}
   */
  async getGameCenterLeaderboardSetsGroupLeaderboardSetLinkage(
    resourceId: string,
  ): Promise<
    operations['gameCenterLeaderboardSets_groupLeaderboardSet_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterLeaderboardSets/{id}/relationships/groupLeaderboardSet',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/gameCenterLeaderboardSets/{id}/relationships/groupLeaderboardSet
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-gamecenterleaderboardsets-_id_-relationships-groupleaderboardset}
   */
  async updateGameCenterLeaderboardSetsGroupLeaderboardSetLinkage(
    resourceId: string,
    document: operations['gameCenterLeaderboardSets_groupLeaderboardSet_updateToOneRelationship']['requestBody']['content']['application/json'],
  ): Promise<void> {
    const url = appleRequestUrl(
      '/v1/gameCenterLeaderboardSets/{id}/relationships/groupLeaderboardSet',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('PATCH', url, document);
  }

  /**
   * GET /v1/gameCenterLeaderboardSets/{id}/groupLeaderboardSet
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterleaderboardsets-_id_-groupleaderboardset}
   */
  async getGameCenterLeaderboardSetsGroupLeaderboardSet(
    resourceId: string,
    query?: operations['gameCenterLeaderboardSets_groupLeaderboardSet_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['gameCenterLeaderboardSets_groupLeaderboardSet_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterLeaderboardSets/{id}/groupLeaderboardSet',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterLeaderboardSets/{id}/relationships/localizations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterleaderboardsets-_id_-relationships-localizations}
   */
  async listGameCenterLeaderboardSetsLocalizationsLinkage(
    resourceId: string,
    query?: operations['gameCenterLeaderboardSets_localizations_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['gameCenterLeaderboardSets_localizations_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterLeaderboardSets/{id}/relationships/localizations',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterLeaderboardSets/{id}/localizations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterleaderboardsets-_id_-localizations}
   */
  async listGameCenterLeaderboardSetsLocalizations(
    resourceId: string,
    query?: operations['gameCenterLeaderboardSets_localizations_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['gameCenterLeaderboardSets_localizations_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterLeaderboardSets/{id}/localizations',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterLeaderboardSets/{id}/relationships/releases
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterleaderboardsets-_id_-relationships-releases}
   */
  async listGameCenterLeaderboardSetsReleasesLinkage(
    resourceId: string,
    query?: operations['gameCenterLeaderboardSets_releases_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['gameCenterLeaderboardSets_releases_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterLeaderboardSets/{id}/relationships/releases',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterLeaderboardSets/{id}/releases
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterleaderboardsets-_id_-releases}
   */
  async listGameCenterLeaderboardSetsReleases(
    resourceId: string,
    query?: operations['gameCenterLeaderboardSets_releases_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['gameCenterLeaderboardSets_releases_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterLeaderboardSets/{id}/releases', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v2/gameCenterLeaderboardVersions/{id}/relationships/localizations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v2-gamecenterleaderboardversions-_id_-relationships-localizations}
   */
  async listGameCenterLeaderboardVersionsV2LocalizationsLinkage(
    resourceId: string,
    query?: operations['gameCenterLeaderboardVersionsV2_localizations_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['gameCenterLeaderboardVersionsV2_localizations_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v2/gameCenterLeaderboardVersions/{id}/relationships/localizations',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v2/gameCenterLeaderboardVersions/{id}/localizations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v2-gamecenterleaderboardversions-_id_-localizations}
   */
  async listGameCenterLeaderboardVersionsV2Localizations(
    resourceId: string,
    query?: operations['gameCenterLeaderboardVersionsV2_localizations_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['gameCenterLeaderboardVersionsV2_localizations_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v2/gameCenterLeaderboardVersions/{id}/localizations',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/gameCenterLeaderboards/{id}/relationships/activity
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-gamecenterleaderboards-_id_-relationships-activity}
   */
  async updateGameCenterLeaderboardsActivityLinkage(
    resourceId: string,
    document: operations['gameCenterLeaderboards_activity_updateToOneRelationship']['requestBody']['content']['application/json'],
  ): Promise<void> {
    const url = appleRequestUrl(
      '/v1/gameCenterLeaderboards/{id}/relationships/activity',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('PATCH', url, document);
  }

  /**
   * PATCH /v1/gameCenterLeaderboards/{id}/relationships/challenge
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-gamecenterleaderboards-_id_-relationships-challenge}
   */
  async updateGameCenterLeaderboardsChallengeLinkage(
    resourceId: string,
    document: operations['gameCenterLeaderboards_challenge_updateToOneRelationship']['requestBody']['content']['application/json'],
  ): Promise<void> {
    const url = appleRequestUrl(
      '/v1/gameCenterLeaderboards/{id}/relationships/challenge',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('PATCH', url, document);
  }

  /**
   * GET /v1/gameCenterLeaderboards/{id}/relationships/groupLeaderboard
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterleaderboards-_id_-relationships-groupleaderboard}
   */
  async getGameCenterLeaderboardsGroupLeaderboardLinkage(
    resourceId: string,
  ): Promise<
    operations['gameCenterLeaderboards_groupLeaderboard_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterLeaderboards/{id}/relationships/groupLeaderboard',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/gameCenterLeaderboards/{id}/relationships/groupLeaderboard
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-gamecenterleaderboards-_id_-relationships-groupleaderboard}
   */
  async updateGameCenterLeaderboardsGroupLeaderboardLinkage(
    resourceId: string,
    document: operations['gameCenterLeaderboards_groupLeaderboard_updateToOneRelationship']['requestBody']['content']['application/json'],
  ): Promise<void> {
    const url = appleRequestUrl(
      '/v1/gameCenterLeaderboards/{id}/relationships/groupLeaderboard',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('PATCH', url, document);
  }

  /**
   * GET /v1/gameCenterLeaderboards/{id}/groupLeaderboard
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterleaderboards-_id_-groupleaderboard}
   */
  async getGameCenterLeaderboardsGroupLeaderboard(
    resourceId: string,
    query?: operations['gameCenterLeaderboards_groupLeaderboard_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['gameCenterLeaderboards_groupLeaderboard_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterLeaderboards/{id}/groupLeaderboard',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterLeaderboards/{id}/relationships/localizations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterleaderboards-_id_-relationships-localizations}
   */
  async listGameCenterLeaderboardsLocalizationsLinkage(
    resourceId: string,
    query?: operations['gameCenterLeaderboards_localizations_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['gameCenterLeaderboards_localizations_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterLeaderboards/{id}/relationships/localizations',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterLeaderboards/{id}/localizations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterleaderboards-_id_-localizations}
   */
  async listGameCenterLeaderboardsLocalizations(
    resourceId: string,
    query?: operations['gameCenterLeaderboards_localizations_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['gameCenterLeaderboards_localizations_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterLeaderboards/{id}/localizations', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterLeaderboards/{id}/relationships/releases
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterleaderboards-_id_-relationships-releases}
   */
  async listGameCenterLeaderboardsReleasesLinkage(
    resourceId: string,
    query?: operations['gameCenterLeaderboards_releases_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['gameCenterLeaderboards_releases_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterLeaderboards/{id}/relationships/releases',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterLeaderboards/{id}/releases
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterleaderboards-_id_-releases}
   */
  async listGameCenterLeaderboardsReleases(
    resourceId: string,
    query?: operations['gameCenterLeaderboards_releases_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['gameCenterLeaderboards_releases_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterLeaderboards/{id}/releases', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v2/gameCenterLeaderboards/{id}/relationships/activity
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v2-gamecenterleaderboards-_id_-relationships-activity}
   */
  async updateGameCenterLeaderboardsV2ActivityLinkage(
    resourceId: string,
    document: operations['gameCenterLeaderboardsV2_activity_updateToOneRelationship']['requestBody']['content']['application/json'],
  ): Promise<void> {
    const url = appleRequestUrl(
      '/v2/gameCenterLeaderboards/{id}/relationships/activity',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('PATCH', url, document);
  }

  /**
   * PATCH /v2/gameCenterLeaderboards/{id}/relationships/challenge
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v2-gamecenterleaderboards-_id_-relationships-challenge}
   */
  async updateGameCenterLeaderboardsV2ChallengeLinkage(
    resourceId: string,
    document: operations['gameCenterLeaderboardsV2_challenge_updateToOneRelationship']['requestBody']['content']['application/json'],
  ): Promise<void> {
    const url = appleRequestUrl(
      '/v2/gameCenterLeaderboards/{id}/relationships/challenge',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('PATCH', url, document);
  }

  /**
   * GET /v2/gameCenterLeaderboards/{id}/relationships/gameCenterScoreModerations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v2-gamecenterleaderboards-_id_-relationships-gamecenterscoremoderations}
   */
  async listGameCenterLeaderboardsV2GameCenterScoreModerationsLinkage(
    resourceId: string,
    query?: operations['gameCenterLeaderboardsV2_gameCenterScoreModerations_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['gameCenterLeaderboardsV2_gameCenterScoreModerations_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v2/gameCenterLeaderboards/{id}/relationships/gameCenterScoreModerations',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v2/gameCenterLeaderboards/{id}/gameCenterScoreModerations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v2-gamecenterleaderboards-_id_-gamecenterscoremoderations}
   */
  async listGameCenterLeaderboardsV2GameCenterScoreModerations(
    resourceId: string,
    query?: operations['gameCenterLeaderboardsV2_gameCenterScoreModerations_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['gameCenterLeaderboardsV2_gameCenterScoreModerations_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v2/gameCenterLeaderboards/{id}/gameCenterScoreModerations',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v2/gameCenterLeaderboards/{id}/relationships/versions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v2-gamecenterleaderboards-_id_-relationships-versions}
   */
  async listGameCenterLeaderboardsV2VersionsLinkage(
    resourceId: string,
    query?: operations['gameCenterLeaderboardsV2_versions_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['gameCenterLeaderboardsV2_versions_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v2/gameCenterLeaderboards/{id}/relationships/versions',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v2/gameCenterLeaderboards/{id}/versions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v2-gamecenterleaderboards-_id_-versions}
   */
  async listGameCenterLeaderboardsV2Versions(
    resourceId: string,
    query?: operations['gameCenterLeaderboardsV2_versions_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['gameCenterLeaderboardsV2_versions_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v2/gameCenterLeaderboards/{id}/versions', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterMatchmakingRuleSets/{id}/relationships/matchmakingQueues
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecentermatchmakingrulesets-_id_-relationships-matchmakingqueues}
   */
  async listGameCenterMatchmakingRuleSetsMatchmakingQueuesLinkage(
    resourceId: string,
    query?: operations['gameCenterMatchmakingRuleSets_matchmakingQueues_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['gameCenterMatchmakingRuleSets_matchmakingQueues_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterMatchmakingRuleSets/{id}/relationships/matchmakingQueues',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterMatchmakingRuleSets/{id}/matchmakingQueues
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecentermatchmakingrulesets-_id_-matchmakingqueues}
   */
  async listGameCenterMatchmakingRuleSetsMatchmakingQueues(
    resourceId: string,
    query?: operations['gameCenterMatchmakingRuleSets_matchmakingQueues_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['gameCenterMatchmakingRuleSets_matchmakingQueues_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterMatchmakingRuleSets/{id}/matchmakingQueues',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterMatchmakingRuleSets/{id}/relationships/rules
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecentermatchmakingrulesets-_id_-relationships-rules}
   */
  async listGameCenterMatchmakingRuleSetsRulesLinkage(
    resourceId: string,
    query?: operations['gameCenterMatchmakingRuleSets_rules_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['gameCenterMatchmakingRuleSets_rules_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterMatchmakingRuleSets/{id}/relationships/rules',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterMatchmakingRuleSets/{id}/rules
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecentermatchmakingrulesets-_id_-rules}
   */
  async listGameCenterMatchmakingRuleSetsRules(
    resourceId: string,
    query?: operations['gameCenterMatchmakingRuleSets_rules_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['gameCenterMatchmakingRuleSets_rules_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterMatchmakingRuleSets/{id}/rules', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterMatchmakingRuleSets/{id}/relationships/teams
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecentermatchmakingrulesets-_id_-relationships-teams}
   */
  async listGameCenterMatchmakingRuleSetsTeamsLinkage(
    resourceId: string,
    query?: operations['gameCenterMatchmakingRuleSets_teams_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['gameCenterMatchmakingRuleSets_teams_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterMatchmakingRuleSets/{id}/relationships/teams',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterMatchmakingRuleSets/{id}/teams
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecentermatchmakingrulesets-_id_-teams}
   */
  async listGameCenterMatchmakingRuleSetsTeams(
    resourceId: string,
    query?: operations['gameCenterMatchmakingRuleSets_teams_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['gameCenterMatchmakingRuleSets_teams_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/gameCenterMatchmakingRuleSets/{id}/teams', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/inAppPurchaseAvailabilities/{id}/relationships/availableTerritories
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-inapppurchaseavailabilities-_id_-relationships-availableterritories}
   */
  async listInAppPurchaseAvailabilitiesAvailableTerritoriesLinkage(
    resourceId: string,
    query?: operations['inAppPurchaseAvailabilities_availableTerritories_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['inAppPurchaseAvailabilities_availableTerritories_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/inAppPurchaseAvailabilities/{id}/relationships/availableTerritories',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/inAppPurchaseAvailabilities/{id}/availableTerritories
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-inapppurchaseavailabilities-_id_-availableterritories}
   */
  async listInAppPurchaseAvailabilitiesAvailableTerritories(
    resourceId: string,
    query?: operations['inAppPurchaseAvailabilities_availableTerritories_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['inAppPurchaseAvailabilities_availableTerritories_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/inAppPurchaseAvailabilities/{id}/availableTerritories',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/inAppPurchaseOfferCodeOneTimeUseCodes/{id}/values
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-inapppurchaseoffercodeonetimeusecodes-_id_-values}
   */
  async getInAppPurchaseOfferCodeOneTimeUseCodesValues(resourceId: string): Promise<string> {
    const url = appleRequestUrl(
      '/v1/inAppPurchaseOfferCodeOneTimeUseCodes/{id}/values',
      resourceId,
      undefined,
    );
    return this.apple.sendText('GET', url, 'text/csv');
  }

  /**
   * GET /v1/inAppPurchaseOfferCodes/{id}/relationships/customCodes
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-inapppurchaseoffercodes-_id_-relationships-customcodes}
   */
  async listInAppPurchaseOfferCodesCustomCodesLinkage(
    resourceId: string,
    query?: operations['inAppPurchaseOfferCodes_customCodes_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['inAppPurchaseOfferCodes_customCodes_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/inAppPurchaseOfferCodes/{id}/relationships/customCodes',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/inAppPurchaseOfferCodes/{id}/customCodes
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-inapppurchaseoffercodes-_id_-customcodes}
   */
  async listInAppPurchaseOfferCodesCustomCodes(
    resourceId: string,
    query?: operations['inAppPurchaseOfferCodes_customCodes_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['inAppPurchaseOfferCodes_customCodes_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/inAppPurchaseOfferCodes/{id}/customCodes', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/inAppPurchaseOfferCodes/{id}/relationships/oneTimeUseCodes
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-inapppurchaseoffercodes-_id_-relationships-onetimeusecodes}
   */
  async listInAppPurchaseOfferCodesOneTimeUseCodesLinkage(
    resourceId: string,
    query?: operations['inAppPurchaseOfferCodes_oneTimeUseCodes_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['inAppPurchaseOfferCodes_oneTimeUseCodes_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/inAppPurchaseOfferCodes/{id}/relationships/oneTimeUseCodes',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/inAppPurchaseOfferCodes/{id}/oneTimeUseCodes
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-inapppurchaseoffercodes-_id_-onetimeusecodes}
   */
  async listInAppPurchaseOfferCodesOneTimeUseCodes(
    resourceId: string,
    query?: operations['inAppPurchaseOfferCodes_oneTimeUseCodes_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['inAppPurchaseOfferCodes_oneTimeUseCodes_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/inAppPurchaseOfferCodes/{id}/oneTimeUseCodes',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/inAppPurchaseOfferCodes/{id}/relationships/prices
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-inapppurchaseoffercodes-_id_-relationships-prices}
   */
  async listInAppPurchaseOfferCodesPricesLinkage(
    resourceId: string,
    query?: operations['inAppPurchaseOfferCodes_prices_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['inAppPurchaseOfferCodes_prices_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/inAppPurchaseOfferCodes/{id}/relationships/prices',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/inAppPurchaseOfferCodes/{id}/prices
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-inapppurchaseoffercodes-_id_-prices}
   */
  async listInAppPurchaseOfferCodesPrices(
    resourceId: string,
    query?: operations['inAppPurchaseOfferCodes_prices_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['inAppPurchaseOfferCodes_prices_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/inAppPurchaseOfferCodes/{id}/prices', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/inAppPurchasePricePoints/{id}/relationships/equalizations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-inapppurchasepricepoints-_id_-relationships-equalizations}
   */
  async listInAppPurchasePricePointsEqualizationsLinkage(
    resourceId: string,
    query?: operations['inAppPurchasePricePoints_equalizations_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['inAppPurchasePricePoints_equalizations_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/inAppPurchasePricePoints/{id}/relationships/equalizations',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/inAppPurchasePricePoints/{id}/equalizations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-inapppurchasepricepoints-_id_-equalizations}
   */
  async listInAppPurchasePricePointsEqualizations(
    resourceId: string,
    query?: operations['inAppPurchasePricePoints_equalizations_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['inAppPurchasePricePoints_equalizations_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/inAppPurchasePricePoints/{id}/equalizations',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/inAppPurchasePriceSchedules/{id}/relationships/automaticPrices
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-inapppurchasepriceschedules-_id_-relationships-automaticprices}
   */
  async listInAppPurchasePriceSchedulesAutomaticPricesLinkage(
    resourceId: string,
    query?: operations['inAppPurchasePriceSchedules_automaticPrices_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['inAppPurchasePriceSchedules_automaticPrices_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/inAppPurchasePriceSchedules/{id}/relationships/automaticPrices',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/inAppPurchasePriceSchedules/{id}/automaticPrices
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-inapppurchasepriceschedules-_id_-automaticprices}
   */
  async listInAppPurchasePriceSchedulesAutomaticPrices(
    resourceId: string,
    query?: operations['inAppPurchasePriceSchedules_automaticPrices_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['inAppPurchasePriceSchedules_automaticPrices_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/inAppPurchasePriceSchedules/{id}/automaticPrices',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/inAppPurchasePriceSchedules/{id}/relationships/baseTerritory
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-inapppurchasepriceschedules-_id_-relationships-baseterritory}
   */
  async getInAppPurchasePriceSchedulesBaseTerritoryLinkage(
    resourceId: string,
  ): Promise<
    operations['inAppPurchasePriceSchedules_baseTerritory_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/inAppPurchasePriceSchedules/{id}/relationships/baseTerritory',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/inAppPurchasePriceSchedules/{id}/baseTerritory
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-inapppurchasepriceschedules-_id_-baseterritory}
   */
  async getInAppPurchasePriceSchedulesBaseTerritory(
    resourceId: string,
    query?: operations['inAppPurchasePriceSchedules_baseTerritory_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['inAppPurchasePriceSchedules_baseTerritory_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/inAppPurchasePriceSchedules/{id}/baseTerritory',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/inAppPurchasePriceSchedules/{id}/relationships/manualPrices
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-inapppurchasepriceschedules-_id_-relationships-manualprices}
   */
  async listInAppPurchasePriceSchedulesManualPricesLinkage(
    resourceId: string,
    query?: operations['inAppPurchasePriceSchedules_manualPrices_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['inAppPurchasePriceSchedules_manualPrices_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/inAppPurchasePriceSchedules/{id}/relationships/manualPrices',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/inAppPurchasePriceSchedules/{id}/manualPrices
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-inapppurchasepriceschedules-_id_-manualprices}
   */
  async listInAppPurchasePriceSchedulesManualPrices(
    resourceId: string,
    query?: operations['inAppPurchasePriceSchedules_manualPrices_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['inAppPurchasePriceSchedules_manualPrices_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/inAppPurchasePriceSchedules/{id}/manualPrices',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/inAppPurchaseVersions/{id}/relationships/image
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-inapppurchaseversions-_id_-relationships-image}
   */
  async getInAppPurchaseVersionsImageLinkage(
    resourceId: string,
  ): Promise<
    operations['inAppPurchaseVersions_image_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/inAppPurchaseVersions/{id}/relationships/image',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/inAppPurchaseVersions/{id}/image
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-inapppurchaseversions-_id_-image}
   */
  async getInAppPurchaseVersionsImage(
    resourceId: string,
    query?: operations['inAppPurchaseVersions_image_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['inAppPurchaseVersions_image_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/inAppPurchaseVersions/{id}/image', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/inAppPurchaseVersions/{id}/relationships/images
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-inapppurchaseversions-_id_-relationships-images}
   */
  async listInAppPurchaseVersionsImagesLinkage(
    resourceId: string,
    query?: operations['inAppPurchaseVersions_images_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['inAppPurchaseVersions_images_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/inAppPurchaseVersions/{id}/relationships/images',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/inAppPurchaseVersions/{id}/images
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-inapppurchaseversions-_id_-images}
   */
  async listInAppPurchaseVersionsImages(
    resourceId: string,
    query?: operations['inAppPurchaseVersions_images_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['inAppPurchaseVersions_images_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/inAppPurchaseVersions/{id}/images', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/inAppPurchaseVersions/{id}/relationships/localizations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-inapppurchaseversions-_id_-relationships-localizations}
   */
  async listInAppPurchaseVersionsLocalizationsLinkage(
    resourceId: string,
    query?: operations['inAppPurchaseVersions_localizations_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['inAppPurchaseVersions_localizations_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/inAppPurchaseVersions/{id}/relationships/localizations',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/inAppPurchaseVersions/{id}/localizations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-inapppurchaseversions-_id_-localizations}
   */
  async listInAppPurchaseVersionsLocalizations(
    resourceId: string,
    query?: operations['inAppPurchaseVersions_localizations_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['inAppPurchaseVersions_localizations_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/inAppPurchaseVersions/{id}/localizations', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v2/inAppPurchases/{id}/relationships/appStoreReviewScreenshot
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v2-inapppurchases-_id_-relationships-appstorereviewscreenshot}
   */
  async getInAppPurchasesV2AppStoreReviewScreenshotLinkage(
    resourceId: string,
  ): Promise<
    operations['inAppPurchasesV2_appStoreReviewScreenshot_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v2/inAppPurchases/{id}/relationships/appStoreReviewScreenshot',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v2/inAppPurchases/{id}/appStoreReviewScreenshot
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v2-inapppurchases-_id_-appstorereviewscreenshot}
   */
  async getInAppPurchasesV2AppStoreReviewScreenshot(
    resourceId: string,
    query?: operations['inAppPurchasesV2_appStoreReviewScreenshot_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['inAppPurchasesV2_appStoreReviewScreenshot_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v2/inAppPurchases/{id}/appStoreReviewScreenshot',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v2/inAppPurchases/{id}/relationships/content
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v2-inapppurchases-_id_-relationships-content}
   */
  async getInAppPurchasesV2ContentLinkage(
    resourceId: string,
  ): Promise<
    operations['inAppPurchasesV2_content_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v2/inAppPurchases/{id}/relationships/content',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v2/inAppPurchases/{id}/content
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v2-inapppurchases-_id_-content}
   */
  async getInAppPurchasesV2Content(
    resourceId: string,
    query?: operations['inAppPurchasesV2_content_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['inAppPurchasesV2_content_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v2/inAppPurchases/{id}/content', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v2/inAppPurchases/{id}/relationships/iapPriceSchedule
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v2-inapppurchases-_id_-relationships-iappriceschedule}
   */
  async getInAppPurchasesV2IapPriceScheduleLinkage(
    resourceId: string,
  ): Promise<
    operations['inAppPurchasesV2_iapPriceSchedule_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v2/inAppPurchases/{id}/relationships/iapPriceSchedule',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v2/inAppPurchases/{id}/iapPriceSchedule
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v2-inapppurchases-_id_-iappriceschedule}
   */
  async getInAppPurchasesV2IapPriceSchedule(
    resourceId: string,
    query?: operations['inAppPurchasesV2_iapPriceSchedule_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['inAppPurchasesV2_iapPriceSchedule_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v2/inAppPurchases/{id}/iapPriceSchedule', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v2/inAppPurchases/{id}/relationships/images
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v2-inapppurchases-_id_-relationships-images}
   */
  async listInAppPurchasesV2ImagesLinkage(
    resourceId: string,
    query?: operations['inAppPurchasesV2_images_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['inAppPurchasesV2_images_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v2/inAppPurchases/{id}/relationships/images', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v2/inAppPurchases/{id}/images
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v2-inapppurchases-_id_-images}
   */
  async listInAppPurchasesV2Images(
    resourceId: string,
    query?: operations['inAppPurchasesV2_images_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['inAppPurchasesV2_images_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v2/inAppPurchases/{id}/images', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v2/inAppPurchases/{id}/relationships/inAppPurchaseAvailability
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v2-inapppurchases-_id_-relationships-inapppurchaseavailability}
   */
  async getInAppPurchasesV2InAppPurchaseAvailabilityLinkage(
    resourceId: string,
  ): Promise<
    operations['inAppPurchasesV2_inAppPurchaseAvailability_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v2/inAppPurchases/{id}/relationships/inAppPurchaseAvailability',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v2/inAppPurchases/{id}/inAppPurchaseAvailability
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v2-inapppurchases-_id_-inapppurchaseavailability}
   */
  async getInAppPurchasesV2InAppPurchaseAvailability(
    resourceId: string,
    query?: operations['inAppPurchasesV2_inAppPurchaseAvailability_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['inAppPurchasesV2_inAppPurchaseAvailability_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v2/inAppPurchases/{id}/inAppPurchaseAvailability',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v2/inAppPurchases/{id}/relationships/inAppPurchaseLocalizations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v2-inapppurchases-_id_-relationships-inapppurchaselocalizations}
   */
  async listInAppPurchasesV2InAppPurchaseLocalizationsLinkage(
    resourceId: string,
    query?: operations['inAppPurchasesV2_inAppPurchaseLocalizations_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['inAppPurchasesV2_inAppPurchaseLocalizations_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v2/inAppPurchases/{id}/relationships/inAppPurchaseLocalizations',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v2/inAppPurchases/{id}/inAppPurchaseLocalizations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v2-inapppurchases-_id_-inapppurchaselocalizations}
   */
  async listInAppPurchasesV2InAppPurchaseLocalizations(
    resourceId: string,
    query?: operations['inAppPurchasesV2_inAppPurchaseLocalizations_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['inAppPurchasesV2_inAppPurchaseLocalizations_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v2/inAppPurchases/{id}/inAppPurchaseLocalizations',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v2/inAppPurchases/{id}/relationships/offerCodes
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v2-inapppurchases-_id_-relationships-offercodes}
   */
  async listInAppPurchasesV2OfferCodesLinkage(
    resourceId: string,
    query?: operations['inAppPurchasesV2_offerCodes_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['inAppPurchasesV2_offerCodes_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v2/inAppPurchases/{id}/relationships/offerCodes',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v2/inAppPurchases/{id}/offerCodes
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v2-inapppurchases-_id_-offercodes}
   */
  async listInAppPurchasesV2OfferCodes(
    resourceId: string,
    query?: operations['inAppPurchasesV2_offerCodes_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['inAppPurchasesV2_offerCodes_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v2/inAppPurchases/{id}/offerCodes', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v2/inAppPurchases/{id}/relationships/pricePoints
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v2-inapppurchases-_id_-relationships-pricepoints}
   */
  async listInAppPurchasesV2PricePointsLinkage(
    resourceId: string,
    query?: operations['inAppPurchasesV2_pricePoints_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['inAppPurchasesV2_pricePoints_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v2/inAppPurchases/{id}/relationships/pricePoints',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v2/inAppPurchases/{id}/pricePoints
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v2-inapppurchases-_id_-pricepoints}
   */
  async listInAppPurchasesV2PricePoints(
    resourceId: string,
    query?: operations['inAppPurchasesV2_pricePoints_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['inAppPurchasesV2_pricePoints_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v2/inAppPurchases/{id}/pricePoints', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v2/inAppPurchases/{id}/relationships/promotedPurchase
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v2-inapppurchases-_id_-relationships-promotedpurchase}
   */
  async getInAppPurchasesV2PromotedPurchaseLinkage(
    resourceId: string,
  ): Promise<
    operations['inAppPurchasesV2_promotedPurchase_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v2/inAppPurchases/{id}/relationships/promotedPurchase',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v2/inAppPurchases/{id}/promotedPurchase
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v2-inapppurchases-_id_-promotedpurchase}
   */
  async getInAppPurchasesV2PromotedPurchase(
    resourceId: string,
    query?: operations['inAppPurchasesV2_promotedPurchase_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['inAppPurchasesV2_promotedPurchase_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v2/inAppPurchases/{id}/promotedPurchase', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v2/inAppPurchases/{id}/relationships/versions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v2-inapppurchases-_id_-relationships-versions}
   */
  async listInAppPurchasesV2VersionsLinkage(
    resourceId: string,
    query?: operations['inAppPurchasesV2_versions_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['inAppPurchasesV2_versions_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v2/inAppPurchases/{id}/relationships/versions',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v2/inAppPurchases/{id}/versions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v2-inapppurchases-_id_-versions}
   */
  async listInAppPurchasesV2Versions(
    resourceId: string,
    query?: operations['inAppPurchasesV2_versions_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['inAppPurchasesV2_versions_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v2/inAppPurchases/{id}/versions', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/merchantIds/{id}/relationships/certificates
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-merchantids-_id_-relationships-certificates}
   */
  async listMerchantIdsCertificatesLinkage(
    resourceId: string,
    query?: operations['merchantIds_certificates_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['merchantIds_certificates_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/merchantIds/{id}/relationships/certificates',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/merchantIds/{id}/certificates
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-merchantids-_id_-certificates}
   */
  async listMerchantIdsCertificates(
    resourceId: string,
    query?: operations['merchantIds_certificates_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['merchantIds_certificates_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/merchantIds/{id}/certificates', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/passTypeIds/{id}/relationships/certificates
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-passtypeids-_id_-relationships-certificates}
   */
  async listPassTypeIdsCertificatesLinkage(
    resourceId: string,
    query?: operations['passTypeIds_certificates_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['passTypeIds_certificates_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/passTypeIds/{id}/relationships/certificates',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/passTypeIds/{id}/certificates
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-passtypeids-_id_-certificates}
   */
  async listPassTypeIdsCertificates(
    resourceId: string,
    query?: operations['passTypeIds_certificates_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['passTypeIds_certificates_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/passTypeIds/{id}/certificates', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/preReleaseVersions/{id}/relationships/app
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-prereleaseversions-_id_-relationships-app}
   */
  async getPreReleaseVersionsAppLinkage(
    resourceId: string,
  ): Promise<
    operations['preReleaseVersions_app_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/preReleaseVersions/{id}/relationships/app',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/preReleaseVersions/{id}/app
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-prereleaseversions-_id_-app}
   */
  async getPreReleaseVersionsApp(
    resourceId: string,
    query?: operations['preReleaseVersions_app_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['preReleaseVersions_app_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/preReleaseVersions/{id}/app', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/preReleaseVersions/{id}/relationships/builds
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-prereleaseversions-_id_-relationships-builds}
   */
  async listPreReleaseVersionsBuildsLinkage(
    resourceId: string,
    query?: operations['preReleaseVersions_builds_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['preReleaseVersions_builds_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/preReleaseVersions/{id}/relationships/builds',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/preReleaseVersions/{id}/builds
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-prereleaseversions-_id_-builds}
   */
  async listPreReleaseVersionsBuilds(
    resourceId: string,
    query?: operations['preReleaseVersions_builds_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['preReleaseVersions_builds_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/preReleaseVersions/{id}/builds', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/profiles/{id}/relationships/bundleId
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-profiles-_id_-relationships-bundleid}
   */
  async getProfilesBundleIdLinkage(
    resourceId: string,
  ): Promise<
    operations['profiles_bundleId_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/profiles/{id}/relationships/bundleId', resourceId, undefined);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/profiles/{id}/bundleId
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-profiles-_id_-bundleid}
   */
  async getProfilesBundleId(
    resourceId: string,
    query?: operations['profiles_bundleId_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['profiles_bundleId_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/profiles/{id}/bundleId', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/profiles/{id}/relationships/certificates
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-profiles-_id_-relationships-certificates}
   */
  async listProfilesCertificatesLinkage(
    resourceId: string,
    query?: operations['profiles_certificates_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['profiles_certificates_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/profiles/{id}/relationships/certificates', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/profiles/{id}/certificates
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-profiles-_id_-certificates}
   */
  async listProfilesCertificates(
    resourceId: string,
    query?: operations['profiles_certificates_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['profiles_certificates_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/profiles/{id}/certificates', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/profiles/{id}/relationships/devices
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-profiles-_id_-relationships-devices}
   */
  async listProfilesDevicesLinkage(
    resourceId: string,
    query?: operations['profiles_devices_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['profiles_devices_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/profiles/{id}/relationships/devices', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/profiles/{id}/devices
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-profiles-_id_-devices}
   */
  async listProfilesDevices(
    resourceId: string,
    query?: operations['profiles_devices_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['profiles_devices_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/profiles/{id}/devices', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/retentionMessageVersions/{id}/relationships/localizations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-retentionmessageversions-_id_-relationships-localizations}
   */
  async listRetentionMessageVersionsLocalizationsLinkage(
    resourceId: string,
    query?: operations['retentionMessageVersions_localizations_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['retentionMessageVersions_localizations_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/retentionMessageVersions/{id}/relationships/localizations',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/retentionMessageVersions/{id}/localizations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-retentionmessageversions-_id_-localizations}
   */
  async listRetentionMessageVersionsLocalizations(
    resourceId: string,
    query?: operations['retentionMessageVersions_localizations_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['retentionMessageVersions_localizations_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/retentionMessageVersions/{id}/localizations',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/retentionMessageVersions/{id}/relationships/placement
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-retentionmessageversions-_id_-relationships-placement}
   */
  async getRetentionMessageVersionsPlacementLinkage(
    resourceId: string,
  ): Promise<
    operations['retentionMessageVersions_placement_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/retentionMessageVersions/{id}/relationships/placement',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/retentionMessageVersions/{id}/placement
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-retentionmessageversions-_id_-placement}
   */
  async getRetentionMessageVersionsPlacement(
    resourceId: string,
    query?: operations['retentionMessageVersions_placement_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['retentionMessageVersions_placement_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/retentionMessageVersions/{id}/placement', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/retentionMessages/{id}/relationships/subscriptions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-retentionmessages-_id_-relationships-subscriptions}
   */
  async listRetentionMessagesSubscriptionsLinkage(
    resourceId: string,
    query?: operations['retentionMessages_subscriptions_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['retentionMessages_subscriptions_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/retentionMessages/{id}/relationships/subscriptions',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/retentionMessages/{id}/subscriptions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-retentionmessages-_id_-subscriptions}
   */
  async listRetentionMessagesSubscriptions(
    resourceId: string,
    query?: operations['retentionMessages_subscriptions_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['retentionMessages_subscriptions_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/retentionMessages/{id}/subscriptions', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/retentionMessages/{id}/relationships/versions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-retentionmessages-_id_-relationships-versions}
   */
  async listRetentionMessagesVersionsLinkage(
    resourceId: string,
    query?: operations['retentionMessages_versions_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['retentionMessages_versions_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/retentionMessages/{id}/relationships/versions',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/retentionMessages/{id}/versions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-retentionmessages-_id_-versions}
   */
  async listRetentionMessagesVersions(
    resourceId: string,
    query?: operations['retentionMessages_versions_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['retentionMessages_versions_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/retentionMessages/{id}/versions', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/retentionOffers/{id}/relationships/prices
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-retentionoffers-_id_-relationships-prices}
   */
  async listRetentionOffersPricesLinkage(
    resourceId: string,
    query?: operations['retentionOffers_prices_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['retentionOffers_prices_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/retentionOffers/{id}/relationships/prices', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/retentionOffers/{id}/prices
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-retentionoffers-_id_-prices}
   */
  async listRetentionOffersPrices(
    resourceId: string,
    query?: operations['retentionOffers_prices_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['retentionOffers_prices_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/retentionOffers/{id}/prices', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/reviewSubmissions/{id}/relationships/items
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-reviewsubmissions-_id_-relationships-items}
   */
  async listReviewSubmissionsItemsLinkage(
    resourceId: string,
    query?: operations['reviewSubmissions_items_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['reviewSubmissions_items_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/reviewSubmissions/{id}/relationships/items',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/reviewSubmissions/{id}/items
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-reviewsubmissions-_id_-items}
   */
  async listReviewSubmissionsItems(
    resourceId: string,
    query?: operations['reviewSubmissions_items_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['reviewSubmissions_items_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/reviewSubmissions/{id}/items', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/scmProviders/{id}/relationships/repositories
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-scmproviders-_id_-relationships-repositories}
   */
  async listScmProvidersRepositoriesLinkage(
    resourceId: string,
    query?: operations['scmProviders_repositories_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['scmProviders_repositories_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/scmProviders/{id}/relationships/repositories',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/scmProviders/{id}/repositories
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-scmproviders-_id_-repositories}
   */
  async listScmProvidersRepositories(
    resourceId: string,
    query?: operations['scmProviders_repositories_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['scmProviders_repositories_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/scmProviders/{id}/repositories', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/scmRepositories/{id}/relationships/gitReferences
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-scmrepositories-_id_-relationships-gitreferences}
   */
  async listScmRepositoriesGitReferencesLinkage(
    resourceId: string,
    query?: operations['scmRepositories_gitReferences_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['scmRepositories_gitReferences_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/scmRepositories/{id}/relationships/gitReferences',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/scmRepositories/{id}/gitReferences
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-scmrepositories-_id_-gitreferences}
   */
  async listScmRepositoriesGitReferences(
    resourceId: string,
    query?: operations['scmRepositories_gitReferences_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['scmRepositories_gitReferences_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/scmRepositories/{id}/gitReferences', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/scmRepositories/{id}/relationships/pullRequests
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-scmrepositories-_id_-relationships-pullrequests}
   */
  async listScmRepositoriesPullRequestsLinkage(
    resourceId: string,
    query?: operations['scmRepositories_pullRequests_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['scmRepositories_pullRequests_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/scmRepositories/{id}/relationships/pullRequests',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/scmRepositories/{id}/pullRequests
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-scmrepositories-_id_-pullrequests}
   */
  async listScmRepositoriesPullRequests(
    resourceId: string,
    query?: operations['scmRepositories_pullRequests_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['scmRepositories_pullRequests_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/scmRepositories/{id}/pullRequests', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/subscriptionAvailabilities/{id}/relationships/availableTerritories
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptionavailabilities-_id_-relationships-availableterritories}
   */
  async listSubscriptionAvailabilitiesAvailableTerritoriesLinkage(
    resourceId: string,
    query?: operations['subscriptionAvailabilities_availableTerritories_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['subscriptionAvailabilities_availableTerritories_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/subscriptionAvailabilities/{id}/relationships/availableTerritories',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/subscriptionAvailabilities/{id}/availableTerritories
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptionavailabilities-_id_-availableterritories}
   */
  async listSubscriptionAvailabilitiesAvailableTerritories(
    resourceId: string,
    query?: operations['subscriptionAvailabilities_availableTerritories_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['subscriptionAvailabilities_availableTerritories_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/subscriptionAvailabilities/{id}/availableTerritories',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/subscriptionGroupVersions/{id}/relationships/localizations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptiongroupversions-_id_-relationships-localizations}
   */
  async listSubscriptionGroupVersionsLocalizationsLinkage(
    resourceId: string,
    query?: operations['subscriptionGroupVersions_localizations_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['subscriptionGroupVersions_localizations_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/subscriptionGroupVersions/{id}/relationships/localizations',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/subscriptionGroupVersions/{id}/localizations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptiongroupversions-_id_-localizations}
   */
  async listSubscriptionGroupVersionsLocalizations(
    resourceId: string,
    query?: operations['subscriptionGroupVersions_localizations_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['subscriptionGroupVersions_localizations_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/subscriptionGroupVersions/{id}/localizations',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/subscriptionGroups/{id}/relationships/subscriptionGroupLocalizations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptiongroups-_id_-relationships-subscriptiongrouplocalizations}
   */
  async listSubscriptionGroupsSubscriptionGroupLocalizationsLinkage(
    resourceId: string,
    query?: operations['subscriptionGroups_subscriptionGroupLocalizations_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['subscriptionGroups_subscriptionGroupLocalizations_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/subscriptionGroups/{id}/relationships/subscriptionGroupLocalizations',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/subscriptionGroups/{id}/subscriptionGroupLocalizations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptiongroups-_id_-subscriptiongrouplocalizations}
   */
  async listSubscriptionGroupsSubscriptionGroupLocalizations(
    resourceId: string,
    query?: operations['subscriptionGroups_subscriptionGroupLocalizations_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['subscriptionGroups_subscriptionGroupLocalizations_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/subscriptionGroups/{id}/subscriptionGroupLocalizations',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/subscriptionGroups/{id}/relationships/subscriptions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptiongroups-_id_-relationships-subscriptions}
   */
  async listSubscriptionGroupsSubscriptionsLinkage(
    resourceId: string,
    query?: operations['subscriptionGroups_subscriptions_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['subscriptionGroups_subscriptions_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/subscriptionGroups/{id}/relationships/subscriptions',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/subscriptionGroups/{id}/subscriptions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptiongroups-_id_-subscriptions}
   */
  async listSubscriptionGroupsSubscriptions(
    resourceId: string,
    query?: operations['subscriptionGroups_subscriptions_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['subscriptionGroups_subscriptions_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/subscriptionGroups/{id}/subscriptions', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/subscriptionGroups/{id}/relationships/versions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptiongroups-_id_-relationships-versions}
   */
  async listSubscriptionGroupsVersionsLinkage(
    resourceId: string,
    query?: operations['subscriptionGroups_versions_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['subscriptionGroups_versions_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/subscriptionGroups/{id}/relationships/versions',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/subscriptionGroups/{id}/versions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptiongroups-_id_-versions}
   */
  async listSubscriptionGroupsVersions(
    resourceId: string,
    query?: operations['subscriptionGroups_versions_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['subscriptionGroups_versions_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/subscriptionGroups/{id}/versions', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/subscriptionOfferCodeOneTimeUseCodes/{id}/values
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptionoffercodeonetimeusecodes-_id_-values}
   */
  async getSubscriptionOfferCodeOneTimeUseCodesValues(resourceId: string): Promise<string> {
    const url = appleRequestUrl(
      '/v1/subscriptionOfferCodeOneTimeUseCodes/{id}/values',
      resourceId,
      undefined,
    );
    return this.apple.sendText('GET', url, 'text/csv');
  }

  /**
   * GET /v1/subscriptionOfferCodes/{id}/relationships/customCodes
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptionoffercodes-_id_-relationships-customcodes}
   */
  async listSubscriptionOfferCodesCustomCodesLinkage(
    resourceId: string,
    query?: operations['subscriptionOfferCodes_customCodes_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['subscriptionOfferCodes_customCodes_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/subscriptionOfferCodes/{id}/relationships/customCodes',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/subscriptionOfferCodes/{id}/customCodes
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptionoffercodes-_id_-customcodes}
   */
  async listSubscriptionOfferCodesCustomCodes(
    resourceId: string,
    query?: operations['subscriptionOfferCodes_customCodes_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['subscriptionOfferCodes_customCodes_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/subscriptionOfferCodes/{id}/customCodes', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/subscriptionOfferCodes/{id}/relationships/oneTimeUseCodes
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptionoffercodes-_id_-relationships-onetimeusecodes}
   */
  async listSubscriptionOfferCodesOneTimeUseCodesLinkage(
    resourceId: string,
    query?: operations['subscriptionOfferCodes_oneTimeUseCodes_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['subscriptionOfferCodes_oneTimeUseCodes_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/subscriptionOfferCodes/{id}/relationships/oneTimeUseCodes',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/subscriptionOfferCodes/{id}/oneTimeUseCodes
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptionoffercodes-_id_-onetimeusecodes}
   */
  async listSubscriptionOfferCodesOneTimeUseCodes(
    resourceId: string,
    query?: operations['subscriptionOfferCodes_oneTimeUseCodes_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['subscriptionOfferCodes_oneTimeUseCodes_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/subscriptionOfferCodes/{id}/oneTimeUseCodes',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/subscriptionOfferCodes/{id}/relationships/prices
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptionoffercodes-_id_-relationships-prices}
   */
  async listSubscriptionOfferCodesPricesLinkage(
    resourceId: string,
    query?: operations['subscriptionOfferCodes_prices_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['subscriptionOfferCodes_prices_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/subscriptionOfferCodes/{id}/relationships/prices',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/subscriptionOfferCodes/{id}/prices
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptionoffercodes-_id_-prices}
   */
  async listSubscriptionOfferCodesPrices(
    resourceId: string,
    query?: operations['subscriptionOfferCodes_prices_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['subscriptionOfferCodes_prices_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/subscriptionOfferCodes/{id}/prices', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/subscriptionPlanAvailabilities/{id}/relationships/availableTerritories
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptionplanavailabilities-_id_-relationships-availableterritories}
   */
  async listSubscriptionPlanAvailabilitiesAvailableTerritoriesLinkage(
    resourceId: string,
    query?: operations['subscriptionPlanAvailabilities_availableTerritories_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['subscriptionPlanAvailabilities_availableTerritories_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/subscriptionPlanAvailabilities/{id}/relationships/availableTerritories',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/subscriptionPlanAvailabilities/{id}/relationships/availableTerritories
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-subscriptionplanavailabilities-_id_-relationships-availableterritories}
   */
  async replaceSubscriptionPlanAvailabilitiesAvailableTerritoriesLinkage(
    resourceId: string,
    document: operations['subscriptionPlanAvailabilities_availableTerritories_replaceToManyRelationship']['requestBody']['content']['application/json'],
  ): Promise<void> {
    const url = appleRequestUrl(
      '/v1/subscriptionPlanAvailabilities/{id}/relationships/availableTerritories',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('PATCH', url, document);
  }

  /**
   * GET /v1/subscriptionPlanAvailabilities/{id}/availableTerritories
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptionplanavailabilities-_id_-availableterritories}
   */
  async listSubscriptionPlanAvailabilitiesAvailableTerritories(
    resourceId: string,
    query?: operations['subscriptionPlanAvailabilities_availableTerritories_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['subscriptionPlanAvailabilities_availableTerritories_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/subscriptionPlanAvailabilities/{id}/availableTerritories',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/subscriptionPricePoints/{id}/adjustedEqualizations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptionpricepoints-_id_-adjustedequalizations}
   */
  async listSubscriptionPricePointsAdjustedEqualizations(
    resourceId: string,
    query?: operations['subscriptionPricePoints_adjustedEqualizations_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['subscriptionPricePoints_adjustedEqualizations_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/subscriptionPricePoints/{id}/adjustedEqualizations',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/subscriptionPricePoints/{id}/relationships/equalizations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptionpricepoints-_id_-relationships-equalizations}
   */
  async listSubscriptionPricePointsEqualizationsLinkage(
    resourceId: string,
    query?: operations['subscriptionPricePoints_equalizations_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['subscriptionPricePoints_equalizations_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/subscriptionPricePoints/{id}/relationships/equalizations',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/subscriptionPricePoints/{id}/equalizations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptionpricepoints-_id_-equalizations}
   */
  async listSubscriptionPricePointsEqualizations(
    resourceId: string,
    query?: operations['subscriptionPricePoints_equalizations_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['subscriptionPricePoints_equalizations_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/subscriptionPricePoints/{id}/equalizations',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/subscriptionPrices/{id}/relationships/additionalPriceTiers
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptionprices-_id_-relationships-additionalpricetiers}
   */
  async listSubscriptionPricesAdditionalPriceTiersLinkage(
    resourceId: string,
    query?: operations['subscriptionPrices_additionalPriceTiers_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['subscriptionPrices_additionalPriceTiers_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/subscriptionPrices/{id}/relationships/additionalPriceTiers',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/subscriptionPrices/{id}/additionalPriceTiers
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptionprices-_id_-additionalpricetiers}
   */
  async listSubscriptionPricesAdditionalPriceTiers(
    resourceId: string,
    query?: operations['subscriptionPrices_additionalPriceTiers_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['subscriptionPrices_additionalPriceTiers_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/subscriptionPrices/{id}/additionalPriceTiers',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/subscriptionPromotionalOffers/{id}/relationships/prices
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptionpromotionaloffers-_id_-relationships-prices}
   */
  async listSubscriptionPromotionalOffersPricesLinkage(
    resourceId: string,
    query?: operations['subscriptionPromotionalOffers_prices_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['subscriptionPromotionalOffers_prices_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/subscriptionPromotionalOffers/{id}/relationships/prices',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/subscriptionPromotionalOffers/{id}/prices
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptionpromotionaloffers-_id_-prices}
   */
  async listSubscriptionPromotionalOffersPrices(
    resourceId: string,
    query?: operations['subscriptionPromotionalOffers_prices_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['subscriptionPromotionalOffers_prices_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/subscriptionPromotionalOffers/{id}/prices', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/subscriptionVersions/{id}/relationships/image
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptionversions-_id_-relationships-image}
   */
  async getSubscriptionVersionsImageLinkage(
    resourceId: string,
  ): Promise<
    operations['subscriptionVersions_image_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/subscriptionVersions/{id}/relationships/image',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/subscriptionVersions/{id}/image
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptionversions-_id_-image}
   */
  async getSubscriptionVersionsImage(
    resourceId: string,
    query?: operations['subscriptionVersions_image_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['subscriptionVersions_image_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/subscriptionVersions/{id}/image', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/subscriptionVersions/{id}/relationships/images
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptionversions-_id_-relationships-images}
   */
  async listSubscriptionVersionsImagesLinkage(
    resourceId: string,
    query?: operations['subscriptionVersions_images_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['subscriptionVersions_images_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/subscriptionVersions/{id}/relationships/images',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/subscriptionVersions/{id}/images
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptionversions-_id_-images}
   */
  async listSubscriptionVersionsImages(
    resourceId: string,
    query?: operations['subscriptionVersions_images_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['subscriptionVersions_images_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/subscriptionVersions/{id}/images', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/subscriptionVersions/{id}/relationships/localizations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptionversions-_id_-relationships-localizations}
   */
  async listSubscriptionVersionsLocalizationsLinkage(
    resourceId: string,
    query?: operations['subscriptionVersions_localizations_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['subscriptionVersions_localizations_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/subscriptionVersions/{id}/relationships/localizations',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/subscriptionVersions/{id}/localizations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptionversions-_id_-localizations}
   */
  async listSubscriptionVersionsLocalizations(
    resourceId: string,
    query?: operations['subscriptionVersions_localizations_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['subscriptionVersions_localizations_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/subscriptionVersions/{id}/localizations', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/subscriptions/{id}/relationships/appStoreReviewScreenshot
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptions-_id_-relationships-appstorereviewscreenshot}
   */
  async getSubscriptionsAppStoreReviewScreenshotLinkage(
    resourceId: string,
  ): Promise<
    operations['subscriptions_appStoreReviewScreenshot_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/subscriptions/{id}/relationships/appStoreReviewScreenshot',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/subscriptions/{id}/appStoreReviewScreenshot
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptions-_id_-appstorereviewscreenshot}
   */
  async getSubscriptionsAppStoreReviewScreenshot(
    resourceId: string,
    query?: operations['subscriptions_appStoreReviewScreenshot_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['subscriptions_appStoreReviewScreenshot_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/subscriptions/{id}/appStoreReviewScreenshot',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/subscriptions/{id}/relationships/images
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptions-_id_-relationships-images}
   */
  async listSubscriptionsImagesLinkage(
    resourceId: string,
    query?: operations['subscriptions_images_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['subscriptions_images_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/subscriptions/{id}/relationships/images', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/subscriptions/{id}/images
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptions-_id_-images}
   */
  async listSubscriptionsImages(
    resourceId: string,
    query?: operations['subscriptions_images_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['subscriptions_images_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/subscriptions/{id}/images', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/subscriptions/{id}/relationships/introductoryOffers
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptions-_id_-relationships-introductoryoffers}
   */
  async listSubscriptionsIntroductoryOffersLinkage(
    resourceId: string,
    query?: operations['subscriptions_introductoryOffers_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['subscriptions_introductoryOffers_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/subscriptions/{id}/relationships/introductoryOffers',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * DELETE /v1/subscriptions/{id}/relationships/introductoryOffers
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-subscriptions-_id_-relationships-introductoryoffers}
   */
  async removeSubscriptionsIntroductoryOffersLinkage(
    resourceId: string,
    document: operations['subscriptions_introductoryOffers_deleteToManyRelationship']['requestBody']['content']['application/json'],
  ): Promise<void> {
    const url = appleRequestUrl(
      '/v1/subscriptions/{id}/relationships/introductoryOffers',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('DELETE', url, document);
  }

  /**
   * GET /v1/subscriptions/{id}/introductoryOffers
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptions-_id_-introductoryoffers}
   */
  async listSubscriptionsIntroductoryOffers(
    resourceId: string,
    query?: operations['subscriptions_introductoryOffers_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['subscriptions_introductoryOffers_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/subscriptions/{id}/introductoryOffers', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/subscriptions/{id}/relationships/offerCodes
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptions-_id_-relationships-offercodes}
   */
  async listSubscriptionsOfferCodesLinkage(
    resourceId: string,
    query?: operations['subscriptions_offerCodes_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['subscriptions_offerCodes_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/subscriptions/{id}/relationships/offerCodes',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/subscriptions/{id}/offerCodes
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptions-_id_-offercodes}
   */
  async listSubscriptionsOfferCodes(
    resourceId: string,
    query?: operations['subscriptions_offerCodes_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['subscriptions_offerCodes_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/subscriptions/{id}/offerCodes', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/subscriptions/{id}/relationships/planAvailabilities
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptions-_id_-relationships-planavailabilities}
   */
  async listSubscriptionsPlanAvailabilitiesLinkage(
    resourceId: string,
    query?: operations['subscriptions_planAvailabilities_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['subscriptions_planAvailabilities_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/subscriptions/{id}/relationships/planAvailabilities',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/subscriptions/{id}/planAvailabilities
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptions-_id_-planavailabilities}
   */
  async listSubscriptionsPlanAvailabilities(
    resourceId: string,
    query?: operations['subscriptions_planAvailabilities_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['subscriptions_planAvailabilities_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/subscriptions/{id}/planAvailabilities', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/subscriptions/{id}/relationships/pricePoints
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptions-_id_-relationships-pricepoints}
   */
  async listSubscriptionsPricePointsLinkage(
    resourceId: string,
    query?: operations['subscriptions_pricePoints_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['subscriptions_pricePoints_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/subscriptions/{id}/relationships/pricePoints',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/subscriptions/{id}/pricePoints
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptions-_id_-pricepoints}
   */
  async listSubscriptionsPricePoints(
    resourceId: string,
    query?: operations['subscriptions_pricePoints_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['subscriptions_pricePoints_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/subscriptions/{id}/pricePoints', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/subscriptions/{id}/relationships/prices
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptions-_id_-relationships-prices}
   */
  async listSubscriptionsPricesLinkage(
    resourceId: string,
    query?: operations['subscriptions_prices_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['subscriptions_prices_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/subscriptions/{id}/relationships/prices', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * DELETE /v1/subscriptions/{id}/relationships/prices
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-subscriptions-_id_-relationships-prices}
   */
  async removeSubscriptionsPricesLinkage(
    resourceId: string,
    document: operations['subscriptions_prices_deleteToManyRelationship']['requestBody']['content']['application/json'],
  ): Promise<void> {
    const url = appleRequestUrl(
      '/v1/subscriptions/{id}/relationships/prices',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('DELETE', url, document);
  }

  /**
   * GET /v1/subscriptions/{id}/prices
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptions-_id_-prices}
   */
  async listSubscriptionsPrices(
    resourceId: string,
    query?: operations['subscriptions_prices_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['subscriptions_prices_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/subscriptions/{id}/prices', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/subscriptions/{id}/relationships/promotedPurchase
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptions-_id_-relationships-promotedpurchase}
   */
  async getSubscriptionsPromotedPurchaseLinkage(
    resourceId: string,
  ): Promise<
    operations['subscriptions_promotedPurchase_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/subscriptions/{id}/relationships/promotedPurchase',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/subscriptions/{id}/promotedPurchase
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptions-_id_-promotedpurchase}
   */
  async getSubscriptionsPromotedPurchase(
    resourceId: string,
    query?: operations['subscriptions_promotedPurchase_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['subscriptions_promotedPurchase_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/subscriptions/{id}/promotedPurchase', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/subscriptions/{id}/relationships/promotionalOffers
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptions-_id_-relationships-promotionaloffers}
   */
  async listSubscriptionsPromotionalOffersLinkage(
    resourceId: string,
    query?: operations['subscriptions_promotionalOffers_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['subscriptions_promotionalOffers_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/subscriptions/{id}/relationships/promotionalOffers',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/subscriptions/{id}/promotionalOffers
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptions-_id_-promotionaloffers}
   */
  async listSubscriptionsPromotionalOffers(
    resourceId: string,
    query?: operations['subscriptions_promotionalOffers_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['subscriptions_promotionalOffers_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/subscriptions/{id}/promotionalOffers', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/subscriptions/{id}/relationships/retentionMessage
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptions-_id_-relationships-retentionmessage}
   */
  async getSubscriptionsRetentionMessageLinkage(
    resourceId: string,
  ): Promise<
    operations['subscriptions_retentionMessage_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/subscriptions/{id}/relationships/retentionMessage',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * PATCH /v1/subscriptions/{id}/relationships/retentionMessage
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-subscriptions-_id_-relationships-retentionmessage}
   */
  async updateSubscriptionsRetentionMessageLinkage(
    resourceId: string,
    document: operations['subscriptions_retentionMessage_updateToOneRelationship']['requestBody']['content']['application/json'],
  ): Promise<void> {
    const url = appleRequestUrl(
      '/v1/subscriptions/{id}/relationships/retentionMessage',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('PATCH', url, document);
  }

  /**
   * GET /v1/subscriptions/{id}/retentionMessage
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptions-_id_-retentionmessage}
   */
  async getSubscriptionsRetentionMessage(
    resourceId: string,
    query?: operations['subscriptions_retentionMessage_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['subscriptions_retentionMessage_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/subscriptions/{id}/retentionMessage', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/subscriptions/{id}/relationships/retentionMessageOffers
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptions-_id_-relationships-retentionmessageoffers}
   */
  async listSubscriptionsRetentionMessageOffersLinkage(
    resourceId: string,
    query?: operations['subscriptions_retentionMessageOffers_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['subscriptions_retentionMessageOffers_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/subscriptions/{id}/relationships/retentionMessageOffers',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * POST /v1/subscriptions/{id}/relationships/retentionMessageOffers
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-subscriptions-_id_-relationships-retentionmessageoffers}
   */
  async addSubscriptionsRetentionMessageOffersLinkage(
    resourceId: string,
    document: operations['subscriptions_retentionMessageOffers_createToManyRelationship']['requestBody']['content']['application/json'],
  ): Promise<void> {
    const url = appleRequestUrl(
      '/v1/subscriptions/{id}/relationships/retentionMessageOffers',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('POST', url, document);
  }

  /**
   * DELETE /v1/subscriptions/{id}/relationships/retentionMessageOffers
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-subscriptions-_id_-relationships-retentionmessageoffers}
   */
  async removeSubscriptionsRetentionMessageOffersLinkage(
    resourceId: string,
    document: operations['subscriptions_retentionMessageOffers_deleteToManyRelationship']['requestBody']['content']['application/json'],
  ): Promise<void> {
    const url = appleRequestUrl(
      '/v1/subscriptions/{id}/relationships/retentionMessageOffers',
      resourceId,
      undefined,
    );
    await this.apple.sendJson('DELETE', url, document);
  }

  /**
   * GET /v1/subscriptions/{id}/retentionMessageOffers
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptions-_id_-retentionmessageoffers}
   */
  async listSubscriptionsRetentionMessageOffers(
    resourceId: string,
    query?: operations['subscriptions_retentionMessageOffers_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['subscriptions_retentionMessageOffers_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/subscriptions/{id}/retentionMessageOffers', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/subscriptions/{id}/relationships/retentionOffers
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptions-_id_-relationships-retentionoffers}
   */
  async listSubscriptionsRetentionOffersLinkage(
    resourceId: string,
    query?: operations['subscriptions_retentionOffers_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['subscriptions_retentionOffers_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/subscriptions/{id}/relationships/retentionOffers',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/subscriptions/{id}/retentionOffers
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptions-_id_-retentionoffers}
   */
  async listSubscriptionsRetentionOffers(
    resourceId: string,
    query?: operations['subscriptions_retentionOffers_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['subscriptions_retentionOffers_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/subscriptions/{id}/retentionOffers', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/subscriptions/{id}/relationships/subscriptionAvailability
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptions-_id_-relationships-subscriptionavailability}
   */
  async getSubscriptionsSubscriptionAvailabilityLinkage(
    resourceId: string,
  ): Promise<
    operations['subscriptions_subscriptionAvailability_getToOneRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/subscriptions/{id}/relationships/subscriptionAvailability',
      resourceId,
      undefined,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/subscriptions/{id}/subscriptionAvailability
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptions-_id_-subscriptionavailability}
   */
  async getSubscriptionsSubscriptionAvailability(
    resourceId: string,
    query?: operations['subscriptions_subscriptionAvailability_getToOneRelated']['parameters']['query'],
  ): Promise<
    operations['subscriptions_subscriptionAvailability_getToOneRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/subscriptions/{id}/subscriptionAvailability',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/subscriptions/{id}/relationships/subscriptionLocalizations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptions-_id_-relationships-subscriptionlocalizations}
   */
  async listSubscriptionsSubscriptionLocalizationsLinkage(
    resourceId: string,
    query?: operations['subscriptions_subscriptionLocalizations_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['subscriptions_subscriptionLocalizations_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/subscriptions/{id}/relationships/subscriptionLocalizations',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/subscriptions/{id}/subscriptionLocalizations
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptions-_id_-subscriptionlocalizations}
   */
  async listSubscriptionsSubscriptionLocalizations(
    resourceId: string,
    query?: operations['subscriptions_subscriptionLocalizations_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['subscriptions_subscriptionLocalizations_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/subscriptions/{id}/subscriptionLocalizations',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/subscriptions/{id}/relationships/versions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptions-_id_-relationships-versions}
   */
  async listSubscriptionsVersionsLinkage(
    resourceId: string,
    query?: operations['subscriptions_versions_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['subscriptions_versions_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/subscriptions/{id}/relationships/versions', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/subscriptions/{id}/versions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptions-_id_-versions}
   */
  async listSubscriptionsVersions(
    resourceId: string,
    query?: operations['subscriptions_versions_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['subscriptions_versions_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/subscriptions/{id}/versions', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/subscriptions/{id}/relationships/winBackOffers
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptions-_id_-relationships-winbackoffers}
   */
  async listSubscriptionsWinBackOffersLinkage(
    resourceId: string,
    query?: operations['subscriptions_winBackOffers_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['subscriptions_winBackOffers_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/subscriptions/{id}/relationships/winBackOffers',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/subscriptions/{id}/winBackOffers
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptions-_id_-winbackoffers}
   */
  async listSubscriptionsWinBackOffers(
    resourceId: string,
    query?: operations['subscriptions_winBackOffers_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['subscriptions_winBackOffers_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/subscriptions/{id}/winBackOffers', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/userInvitations/{id}/relationships/visibleApps
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-userinvitations-_id_-relationships-visibleapps}
   */
  async listUserInvitationsVisibleAppsLinkage(
    resourceId: string,
    query?: operations['userInvitations_visibleApps_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['userInvitations_visibleApps_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/userInvitations/{id}/relationships/visibleApps',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/userInvitations/{id}/visibleApps
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-userinvitations-_id_-visibleapps}
   */
  async listUserInvitationsVisibleApps(
    resourceId: string,
    query?: operations['userInvitations_visibleApps_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['userInvitations_visibleApps_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/userInvitations/{id}/visibleApps', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/users/{id}/relationships/visibleApps
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-users-_id_-relationships-visibleapps}
   */
  async listUsersVisibleAppsLinkage(
    resourceId: string,
    query?: operations['users_visibleApps_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['users_visibleApps_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/users/{id}/relationships/visibleApps', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * POST /v1/users/{id}/relationships/visibleApps
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-users-_id_-relationships-visibleapps}
   */
  async addUsersVisibleAppsLinkage(
    resourceId: string,
    document: operations['users_visibleApps_createToManyRelationship']['requestBody']['content']['application/json'],
  ): Promise<void> {
    const url = appleRequestUrl('/v1/users/{id}/relationships/visibleApps', resourceId, undefined);
    await this.apple.sendJson('POST', url, document);
  }

  /**
   * PATCH /v1/users/{id}/relationships/visibleApps
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-users-_id_-relationships-visibleapps}
   */
  async replaceUsersVisibleAppsLinkage(
    resourceId: string,
    document: operations['users_visibleApps_replaceToManyRelationship']['requestBody']['content']['application/json'],
  ): Promise<void> {
    const url = appleRequestUrl('/v1/users/{id}/relationships/visibleApps', resourceId, undefined);
    await this.apple.sendJson('PATCH', url, document);
  }

  /**
   * DELETE /v1/users/{id}/relationships/visibleApps
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-users-_id_-relationships-visibleapps}
   */
  async removeUsersVisibleAppsLinkage(
    resourceId: string,
    document: operations['users_visibleApps_deleteToManyRelationship']['requestBody']['content']['application/json'],
  ): Promise<void> {
    const url = appleRequestUrl('/v1/users/{id}/relationships/visibleApps', resourceId, undefined);
    await this.apple.sendJson('DELETE', url, document);
  }

  /**
   * GET /v1/users/{id}/visibleApps
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-users-_id_-visibleapps}
   */
  async listUsersVisibleApps(
    resourceId: string,
    query?: operations['users_visibleApps_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['users_visibleApps_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/users/{id}/visibleApps', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/webhooks/{id}/relationships/deliveries
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-webhooks-_id_-relationships-deliveries}
   */
  async listWebhooksDeliveriesLinkage(
    resourceId: string,
    query?: operations['webhooks_deliveries_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['webhooks_deliveries_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/webhooks/{id}/relationships/deliveries', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/webhooks/{id}/deliveries
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-webhooks-_id_-deliveries}
   */
  async listWebhooksDeliveries(
    resourceId: string,
    query?: operations['webhooks_deliveries_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['webhooks_deliveries_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/webhooks/{id}/deliveries', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/winBackOffers/{id}/relationships/prices
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-winbackoffers-_id_-relationships-prices}
   */
  async listWinBackOffersPricesLinkage(
    resourceId: string,
    query?: operations['winBackOffers_prices_getToManyRelationship']['parameters']['query'],
  ): Promise<
    operations['winBackOffers_prices_getToManyRelationship']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/winBackOffers/{id}/relationships/prices', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/winBackOffers/{id}/prices
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-winbackoffers-_id_-prices}
   */
  async listWinBackOffersPrices(
    resourceId: string,
    query?: operations['winBackOffers_prices_getToManyRelated']['parameters']['query'],
  ): Promise<
    operations['winBackOffers_prices_getToManyRelated']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/winBackOffers/{id}/prices', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/apps/{id}/metrics/betaTesterUsages
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-metrics-betatesterusages}
   */
  async readAppsBetaTesterUsagesMetrics(
    resourceId: string,
    query?: operations['apps_betaTesterUsages_getMetrics']['parameters']['query'],
  ): Promise<
    operations['apps_betaTesterUsages_getMetrics']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/apps/{id}/metrics/betaTesterUsages', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/betaGroups/{id}/metrics/betaTesterUsages
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-betagroups-_id_-metrics-betatesterusages}
   */
  async readBetaGroupsBetaTesterUsagesMetrics(
    resourceId: string,
    query?: operations['betaGroups_betaTesterUsages_getMetrics']['parameters']['query'],
  ): Promise<
    operations['betaGroups_betaTesterUsages_getMetrics']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/betaGroups/{id}/metrics/betaTesterUsages', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/betaGroups/{id}/metrics/publicLinkUsages
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-betagroups-_id_-metrics-publiclinkusages}
   */
  async readBetaGroupsPublicLinkUsagesMetrics(
    resourceId: string,
    query?: operations['betaGroups_publicLinkUsages_getMetrics']['parameters']['query'],
  ): Promise<
    operations['betaGroups_publicLinkUsages_getMetrics']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/betaGroups/{id}/metrics/publicLinkUsages', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/betaTesters/{id}/metrics/betaTesterUsages
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-betatesters-_id_-metrics-betatesterusages}
   */
  async readBetaTestersBetaTesterUsagesMetrics(
    resourceId: string,
    query?: operations['betaTesters_betaTesterUsages_getMetrics']['parameters']['query'],
  ): Promise<
    operations['betaTesters_betaTesterUsages_getMetrics']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/betaTesters/{id}/metrics/betaTesterUsages', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/builds/{id}/metrics/betaBuildUsages
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-builds-_id_-metrics-betabuildusages}
   */
  async readBuildsBetaBuildUsagesMetrics(
    resourceId: string,
    query?: operations['builds_betaBuildUsages_getMetrics']['parameters']['query'],
  ): Promise<
    operations['builds_betaBuildUsages_getMetrics']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl('/v1/builds/{id}/metrics/betaBuildUsages', resourceId, query);
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterDetails/{id}/metrics/classicMatchmakingRequests
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterdetails-_id_-metrics-classicmatchmakingrequests}
   */
  async readGameCenterDetailsClassicMatchmakingRequestsMetrics(
    resourceId: string,
    query?: operations['gameCenterDetails_classicMatchmakingRequests_getMetrics']['parameters']['query'],
  ): Promise<
    operations['gameCenterDetails_classicMatchmakingRequests_getMetrics']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterDetails/{id}/metrics/classicMatchmakingRequests',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterDetails/{id}/metrics/ruleBasedMatchmakingRequests
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterdetails-_id_-metrics-rulebasedmatchmakingrequests}
   */
  async readGameCenterDetailsRuleBasedMatchmakingRequestsMetrics(
    resourceId: string,
    query?: operations['gameCenterDetails_ruleBasedMatchmakingRequests_getMetrics']['parameters']['query'],
  ): Promise<
    operations['gameCenterDetails_ruleBasedMatchmakingRequests_getMetrics']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterDetails/{id}/metrics/ruleBasedMatchmakingRequests',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterMatchmakingQueues/{id}/metrics/experimentMatchmakingQueueSizes
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecentermatchmakingqueues-_id_-metrics-experimentmatchmakingqueuesizes}
   */
  async readGameCenterMatchmakingQueuesExperimentMatchmakingQueueSizesMetrics(
    resourceId: string,
    query?: operations['gameCenterMatchmakingQueues_experimentMatchmakingQueueSizes_getMetrics']['parameters']['query'],
  ): Promise<
    operations['gameCenterMatchmakingQueues_experimentMatchmakingQueueSizes_getMetrics']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterMatchmakingQueues/{id}/metrics/experimentMatchmakingQueueSizes',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterMatchmakingQueues/{id}/metrics/experimentMatchmakingRequests
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecentermatchmakingqueues-_id_-metrics-experimentmatchmakingrequests}
   */
  async readGameCenterMatchmakingQueuesExperimentMatchmakingRequestsMetrics(
    resourceId: string,
    query?: operations['gameCenterMatchmakingQueues_experimentMatchmakingRequests_getMetrics']['parameters']['query'],
  ): Promise<
    operations['gameCenterMatchmakingQueues_experimentMatchmakingRequests_getMetrics']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterMatchmakingQueues/{id}/metrics/experimentMatchmakingRequests',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterMatchmakingQueues/{id}/metrics/matchmakingQueueSizes
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecentermatchmakingqueues-_id_-metrics-matchmakingqueuesizes}
   */
  async readGameCenterMatchmakingQueuesMatchmakingQueueSizesMetrics(
    resourceId: string,
    query?: operations['gameCenterMatchmakingQueues_matchmakingQueueSizes_getMetrics']['parameters']['query'],
  ): Promise<
    operations['gameCenterMatchmakingQueues_matchmakingQueueSizes_getMetrics']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterMatchmakingQueues/{id}/metrics/matchmakingQueueSizes',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterMatchmakingQueues/{id}/metrics/matchmakingRequests
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecentermatchmakingqueues-_id_-metrics-matchmakingrequests}
   */
  async readGameCenterMatchmakingQueuesMatchmakingRequestsMetrics(
    resourceId: string,
    query?: operations['gameCenterMatchmakingQueues_matchmakingRequests_getMetrics']['parameters']['query'],
  ): Promise<
    operations['gameCenterMatchmakingQueues_matchmakingRequests_getMetrics']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterMatchmakingQueues/{id}/metrics/matchmakingRequests',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterMatchmakingQueues/{id}/metrics/matchmakingSessions
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecentermatchmakingqueues-_id_-metrics-matchmakingsessions}
   */
  async readGameCenterMatchmakingQueuesMatchmakingSessionsMetrics(
    resourceId: string,
    query?: operations['gameCenterMatchmakingQueues_matchmakingSessions_getMetrics']['parameters']['query'],
  ): Promise<
    operations['gameCenterMatchmakingQueues_matchmakingSessions_getMetrics']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterMatchmakingQueues/{id}/metrics/matchmakingSessions',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterMatchmakingRules/{id}/metrics/matchmakingBooleanRuleResults
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecentermatchmakingrules-_id_-metrics-matchmakingbooleanruleresults}
   */
  async readGameCenterMatchmakingRulesMatchmakingBooleanRuleResultsMetrics(
    resourceId: string,
    query?: operations['gameCenterMatchmakingRules_matchmakingBooleanRuleResults_getMetrics']['parameters']['query'],
  ): Promise<
    operations['gameCenterMatchmakingRules_matchmakingBooleanRuleResults_getMetrics']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterMatchmakingRules/{id}/metrics/matchmakingBooleanRuleResults',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterMatchmakingRules/{id}/metrics/matchmakingNumberRuleResults
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecentermatchmakingrules-_id_-metrics-matchmakingnumberruleresults}
   */
  async readGameCenterMatchmakingRulesMatchmakingNumberRuleResultsMetrics(
    resourceId: string,
    query?: operations['gameCenterMatchmakingRules_matchmakingNumberRuleResults_getMetrics']['parameters']['query'],
  ): Promise<
    operations['gameCenterMatchmakingRules_matchmakingNumberRuleResults_getMetrics']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterMatchmakingRules/{id}/metrics/matchmakingNumberRuleResults',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }

  /**
   * GET /v1/gameCenterMatchmakingRules/{id}/metrics/matchmakingRuleErrors
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecentermatchmakingrules-_id_-metrics-matchmakingruleerrors}
   */
  async readGameCenterMatchmakingRulesMatchmakingRuleErrorsMetrics(
    resourceId: string,
    query?: operations['gameCenterMatchmakingRules_matchmakingRuleErrors_getMetrics']['parameters']['query'],
  ): Promise<
    operations['gameCenterMatchmakingRules_matchmakingRuleErrors_getMetrics']['responses'][200]['content']['application/json']
  > {
    const url = appleRequestUrl(
      '/v1/gameCenterMatchmakingRules/{id}/metrics/matchmakingRuleErrors',
      resourceId,
      query,
    );
    return this.apple.sendJson('GET', url);
  }
}
