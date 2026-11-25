// Generated from the Android Publisher v3 Discovery document.
// Reproduce: python3 scripts/generate-api-methods.py
// The installed official client does not declare these Discovery methods yet:
// - purchases.subscriptionsv2.activateoffertargeting
// - purchases.subscriptionsv2.deactivateoffertargeting
// - purchases.subscriptionsv2.cancelplantransition
// - purchases.subscriptionsv2.scheduleplantransition

import {
  androidpublisher,
  auth as androidPublisherAuth,
  type androidpublisher_v3,
} from '@googleapis/androidpublisher';

import { readServiceAccount } from './google-play.js';

const PLAY_SCOPE = 'https://www.googleapis.com/auth/androidpublisher';

type PlayPublisher = ReturnType<typeof androidpublisher>;

function googlePlayFailure(operation: string, cause: unknown): Error {
  const isError = cause instanceof Error;

  if (isError) {
    return new Error(`Google Play ${operation} failed. ${cause.message}`, { cause });
  }

  return new Error(`Google Play ${operation} failed. ${String(cause)}`, { cause });
}

/** Every Android Publisher v3 method the installed official client declares. */
export class GooglePlayApi {
  private readonly publisher: PlayPublisher;

  constructor(serviceAccountJson: string, generatedPublisher?: PlayPublisher) {
    if (generatedPublisher != null) {
      this.publisher = generatedPublisher;
      return;
    }

    const account = readServiceAccount(serviceAccountJson);
    const googleAuthentication = new androidPublisherAuth.JWT({
      email: account.clientEmail,
      key: account.privateKey,
      scopes: [PLAY_SCOPE],
    });
    this.publisher = androidpublisher({ version: 'v3', auth: googleAuthentication });
  }

  /**
   * Creates an APK which is suitable for inclusion in a system image from an already uploaded Android App Bundle.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/systemapks.variants/create}
   */
  async createSystemapksVariants(
    call: androidpublisher_v3.Params$Resource$Systemapks$Variants$Create,
  ): Promise<androidpublisher_v3.Schema$Variant> {
    var completed: { data: androidpublisher_v3.Schema$Variant };

    try {
      completed = await this.publisher.systemapks.variants.create(call);
    } catch (error) {
      throw googlePlayFailure('systemapks.variants.create', error);
    }

    return completed.data;
  }

  /**
   * Returns the list of previously created system APK variants.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/systemapks.variants/list}
   */
  async listSystemapksVariants(
    call: androidpublisher_v3.Params$Resource$Systemapks$Variants$List,
  ): Promise<androidpublisher_v3.Schema$SystemApksListResponse> {
    var completed: { data: androidpublisher_v3.Schema$SystemApksListResponse };

    try {
      completed = await this.publisher.systemapks.variants.list(call);
    } catch (error) {
      throw googlePlayFailure('systemapks.variants.list', error);
    }

    return completed.data;
  }

  /**
   * Downloads a previously created system APK which is suitable for inclusion in a system image.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/systemapks.variants/download}
   */
  async downloadSystemapksVariants(
    call: androidpublisher_v3.Params$Resource$Systemapks$Variants$Download,
  ): Promise<unknown> {
    var completed: { data: unknown };

    try {
      completed = await this.publisher.systemapks.variants.download(call);
    } catch (error) {
      throw googlePlayFailure('systemapks.variants.download', error);
    }

    return completed.data;
  }

  /**
   * Returns a previously created system APK variant.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/systemapks.variants/get}
   */
  async getSystemapksVariants(
    call: androidpublisher_v3.Params$Resource$Systemapks$Variants$Get,
  ): Promise<androidpublisher_v3.Schema$Variant> {
    var completed: { data: androidpublisher_v3.Schema$Variant };

    try {
      completed = await this.publisher.systemapks.variants.get(call);
    } catch (error) {
      throw googlePlayFailure('systemapks.variants.get', error);
    }

    return completed.data;
  }

  /**
   * Calculates the region prices, using today's exchange rate and country-specific pricing patterns, based on the price in the request for a set of regions.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization/convertRegionPrices}
   */
  async convertRegionPricesMonetization(
    call: androidpublisher_v3.Params$Resource$Monetization$Convertregionprices,
  ): Promise<androidpublisher_v3.Schema$ConvertRegionPricesResponse> {
    var completed: { data: androidpublisher_v3.Schema$ConvertRegionPricesResponse };

    try {
      completed = await this.publisher.monetization.convertRegionPrices(call);
    } catch (error) {
      throw googlePlayFailure('monetization.convertRegionPrices', error);
    }

    return completed.data;
  }

  /**
   * Creates or updates one or more one-time products.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.onetimeproducts/batchUpdate}
   */
  async batchUpdateMonetizationOnetimeproducts(
    call: androidpublisher_v3.Params$Resource$Monetization$Onetimeproducts$Batchupdate,
  ): Promise<androidpublisher_v3.Schema$BatchUpdateOneTimeProductsResponse> {
    var completed: { data: androidpublisher_v3.Schema$BatchUpdateOneTimeProductsResponse };

    try {
      completed = await this.publisher.monetization.onetimeproducts.batchUpdate(call);
    } catch (error) {
      throw googlePlayFailure('monetization.onetimeproducts.batchUpdate', error);
    }

    return completed.data;
  }

  /**
   * Deletes one or more one-time products.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.onetimeproducts/batchDelete}
   */
  async batchDeleteMonetizationOnetimeproducts(
    call: androidpublisher_v3.Params$Resource$Monetization$Onetimeproducts$Batchdelete,
  ): Promise<void> {
    try {
      await this.publisher.monetization.onetimeproducts.batchDelete(call);
    } catch (error) {
      throw googlePlayFailure('monetization.onetimeproducts.batchDelete', error);
    }
  }

  /**
   * Deletes a one-time product.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.onetimeproducts/delete}
   */
  async deleteMonetizationOnetimeproducts(
    call: androidpublisher_v3.Params$Resource$Monetization$Onetimeproducts$Delete,
  ): Promise<void> {
    try {
      await this.publisher.monetization.onetimeproducts.delete(call);
    } catch (error) {
      throw googlePlayFailure('monetization.onetimeproducts.delete', error);
    }
  }

  /**
   * Creates or updates a one-time product.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.onetimeproducts/patch}
   */
  async patchMonetizationOnetimeproducts(
    call: androidpublisher_v3.Params$Resource$Monetization$Onetimeproducts$Patch,
  ): Promise<androidpublisher_v3.Schema$OneTimeProduct> {
    var completed: { data: androidpublisher_v3.Schema$OneTimeProduct };

    try {
      completed = await this.publisher.monetization.onetimeproducts.patch(call);
    } catch (error) {
      throw googlePlayFailure('monetization.onetimeproducts.patch', error);
    }

    return completed.data;
  }

  /**
   * Reads a single one-time product.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.onetimeproducts/get}
   */
  async getMonetizationOnetimeproducts(
    call: androidpublisher_v3.Params$Resource$Monetization$Onetimeproducts$Get,
  ): Promise<androidpublisher_v3.Schema$OneTimeProduct> {
    var completed: { data: androidpublisher_v3.Schema$OneTimeProduct };

    try {
      completed = await this.publisher.monetization.onetimeproducts.get(call);
    } catch (error) {
      throw googlePlayFailure('monetization.onetimeproducts.get', error);
    }

    return completed.data;
  }

  /**
   * Reads one or more one-time products.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.onetimeproducts/batchGet}
   */
  async batchGetMonetizationOnetimeproducts(
    call: androidpublisher_v3.Params$Resource$Monetization$Onetimeproducts$Batchget,
  ): Promise<androidpublisher_v3.Schema$BatchGetOneTimeProductsResponse> {
    var completed: { data: androidpublisher_v3.Schema$BatchGetOneTimeProductsResponse };

    try {
      completed = await this.publisher.monetization.onetimeproducts.batchGet(call);
    } catch (error) {
      throw googlePlayFailure('monetization.onetimeproducts.batchGet', error);
    }

    return completed.data;
  }

  /**
   * Lists all one-time products under a given app.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.onetimeproducts/list}
   */
  async listMonetizationOnetimeproducts(
    call: androidpublisher_v3.Params$Resource$Monetization$Onetimeproducts$List,
  ): Promise<androidpublisher_v3.Schema$ListOneTimeProductsResponse> {
    var completed: { data: androidpublisher_v3.Schema$ListOneTimeProductsResponse };

    try {
      completed = await this.publisher.monetization.onetimeproducts.list(call);
    } catch (error) {
      throw googlePlayFailure('monetization.onetimeproducts.list', error);
    }

    return completed.data;
  }

  /**
   * Activates or deactivates purchase options across one or multiple one-time products.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.onetimeproducts.purchaseOptions/batchUpdateStates}
   */
  async batchUpdateStatesMonetizationOnetimeproductsPurchaseOptions(
    call: androidpublisher_v3.Params$Resource$Monetization$Onetimeproducts$Purchaseoptions$Batchupdatestates,
  ): Promise<androidpublisher_v3.Schema$BatchUpdatePurchaseOptionStatesResponse> {
    var completed: { data: androidpublisher_v3.Schema$BatchUpdatePurchaseOptionStatesResponse };

    try {
      completed =
        await this.publisher.monetization.onetimeproducts.purchaseOptions.batchUpdateStates(call);
    } catch (error) {
      throw googlePlayFailure(
        'monetization.onetimeproducts.purchaseOptions.batchUpdateStates',
        error,
      );
    }

    return completed.data;
  }

  /**
   * Deletes purchase options across one or multiple one-time products.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.onetimeproducts.purchaseOptions/batchDelete}
   */
  async batchDeleteMonetizationOnetimeproductsPurchaseOptions(
    call: androidpublisher_v3.Params$Resource$Monetization$Onetimeproducts$Purchaseoptions$Batchdelete,
  ): Promise<void> {
    try {
      await this.publisher.monetization.onetimeproducts.purchaseOptions.batchDelete(call);
    } catch (error) {
      throw googlePlayFailure('monetization.onetimeproducts.purchaseOptions.batchDelete', error);
    }
  }

  /**
   * Reads one or more one-time product offers.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.onetimeproducts.purchaseOptions.offers/batchGet}
   */
  async batchGetMonetizationOnetimeproductsPurchaseOptionsOffers(
    call: androidpublisher_v3.Params$Resource$Monetization$Onetimeproducts$Purchaseoptions$Offers$Batchget,
  ): Promise<androidpublisher_v3.Schema$BatchGetOneTimeProductOffersResponse> {
    var completed: { data: androidpublisher_v3.Schema$BatchGetOneTimeProductOffersResponse };

    try {
      completed =
        await this.publisher.monetization.onetimeproducts.purchaseOptions.offers.batchGet(call);
    } catch (error) {
      throw googlePlayFailure(
        'monetization.onetimeproducts.purchaseOptions.offers.batchGet',
        error,
      );
    }

    return completed.data;
  }

  /**
   * Creates or updates one or more one-time product offers.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.onetimeproducts.purchaseOptions.offers/batchUpdate}
   */
  async batchUpdateMonetizationOnetimeproductsPurchaseOptionsOffers(
    call: androidpublisher_v3.Params$Resource$Monetization$Onetimeproducts$Purchaseoptions$Offers$Batchupdate,
  ): Promise<androidpublisher_v3.Schema$BatchUpdateOneTimeProductOffersResponse> {
    var completed: { data: androidpublisher_v3.Schema$BatchUpdateOneTimeProductOffersResponse };

    try {
      completed =
        await this.publisher.monetization.onetimeproducts.purchaseOptions.offers.batchUpdate(call);
    } catch (error) {
      throw googlePlayFailure(
        'monetization.onetimeproducts.purchaseOptions.offers.batchUpdate',
        error,
      );
    }

    return completed.data;
  }

  /**
   * Activates a one-time product offer.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.onetimeproducts.purchaseOptions.offers/activate}
   */
  async activateMonetizationOnetimeproductsPurchaseOptionsOffers(
    call: androidpublisher_v3.Params$Resource$Monetization$Onetimeproducts$Purchaseoptions$Offers$Activate,
  ): Promise<androidpublisher_v3.Schema$OneTimeProductOffer> {
    var completed: { data: androidpublisher_v3.Schema$OneTimeProductOffer };

    try {
      completed =
        await this.publisher.monetization.onetimeproducts.purchaseOptions.offers.activate(call);
    } catch (error) {
      throw googlePlayFailure(
        'monetization.onetimeproducts.purchaseOptions.offers.activate',
        error,
      );
    }

    return completed.data;
  }

  /**
   * Deletes one or more one-time product offers.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.onetimeproducts.purchaseOptions.offers/batchDelete}
   */
  async batchDeleteMonetizationOnetimeproductsPurchaseOptionsOffers(
    call: androidpublisher_v3.Params$Resource$Monetization$Onetimeproducts$Purchaseoptions$Offers$Batchdelete,
  ): Promise<void> {
    try {
      await this.publisher.monetization.onetimeproducts.purchaseOptions.offers.batchDelete(call);
    } catch (error) {
      throw googlePlayFailure(
        'monetization.onetimeproducts.purchaseOptions.offers.batchDelete',
        error,
      );
    }
  }

  /**
   * Updates a batch of one-time product offer states.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.onetimeproducts.purchaseOptions.offers/batchUpdateStates}
   */
  async batchUpdateStatesMonetizationOnetimeproductsPurchaseOptionsOffers(
    call: androidpublisher_v3.Params$Resource$Monetization$Onetimeproducts$Purchaseoptions$Offers$Batchupdatestates,
  ): Promise<androidpublisher_v3.Schema$BatchUpdateOneTimeProductOfferStatesResponse> {
    var completed: {
      data: androidpublisher_v3.Schema$BatchUpdateOneTimeProductOfferStatesResponse;
    };

    try {
      completed =
        await this.publisher.monetization.onetimeproducts.purchaseOptions.offers.batchUpdateStates(
          call,
        );
    } catch (error) {
      throw googlePlayFailure(
        'monetization.onetimeproducts.purchaseOptions.offers.batchUpdateStates',
        error,
      );
    }

    return completed.data;
  }

  /**
   * Deactivates a one-time product offer.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.onetimeproducts.purchaseOptions.offers/deactivate}
   */
  async deactivateMonetizationOnetimeproductsPurchaseOptionsOffers(
    call: androidpublisher_v3.Params$Resource$Monetization$Onetimeproducts$Purchaseoptions$Offers$Deactivate,
  ): Promise<androidpublisher_v3.Schema$OneTimeProductOffer> {
    var completed: { data: androidpublisher_v3.Schema$OneTimeProductOffer };

    try {
      completed =
        await this.publisher.monetization.onetimeproducts.purchaseOptions.offers.deactivate(call);
    } catch (error) {
      throw googlePlayFailure(
        'monetization.onetimeproducts.purchaseOptions.offers.deactivate',
        error,
      );
    }

    return completed.data;
  }

  /**
   * Lists all offers under a given app, product, or purchase option.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.onetimeproducts.purchaseOptions.offers/list}
   */
  async listMonetizationOnetimeproductsPurchaseOptionsOffers(
    call: androidpublisher_v3.Params$Resource$Monetization$Onetimeproducts$Purchaseoptions$Offers$List,
  ): Promise<androidpublisher_v3.Schema$ListOneTimeProductOffersResponse> {
    var completed: { data: androidpublisher_v3.Schema$ListOneTimeProductOffersResponse };

    try {
      completed =
        await this.publisher.monetization.onetimeproducts.purchaseOptions.offers.list(call);
    } catch (error) {
      throw googlePlayFailure('monetization.onetimeproducts.purchaseOptions.offers.list', error);
    }

    return completed.data;
  }

  /**
   * Cancels a one-time product offer.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.onetimeproducts.purchaseOptions.offers/cancel}
   */
  async cancelMonetizationOnetimeproductsPurchaseOptionsOffers(
    call: androidpublisher_v3.Params$Resource$Monetization$Onetimeproducts$Purchaseoptions$Offers$Cancel,
  ): Promise<androidpublisher_v3.Schema$OneTimeProductOffer> {
    var completed: { data: androidpublisher_v3.Schema$OneTimeProductOffer };

    try {
      completed =
        await this.publisher.monetization.onetimeproducts.purchaseOptions.offers.cancel(call);
    } catch (error) {
      throw googlePlayFailure('monetization.onetimeproducts.purchaseOptions.offers.cancel', error);
    }

    return completed.data;
  }

  /**
   * Creates a new subscription.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.subscriptions/create}
   */
  async createMonetizationSubscriptions(
    call: androidpublisher_v3.Params$Resource$Monetization$Subscriptions$Create,
  ): Promise<androidpublisher_v3.Schema$Subscription> {
    var completed: { data: androidpublisher_v3.Schema$Subscription };

    try {
      completed = await this.publisher.monetization.subscriptions.create(call);
    } catch (error) {
      throw googlePlayFailure('monetization.subscriptions.create', error);
    }

    return completed.data;
  }

  /**
   * Deprecated: subscription archiving is not supported.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.subscriptions/archive}
   */
  async archiveMonetizationSubscriptions(
    call: androidpublisher_v3.Params$Resource$Monetization$Subscriptions$Archive,
  ): Promise<androidpublisher_v3.Schema$Subscription> {
    var completed: { data: androidpublisher_v3.Schema$Subscription };

    try {
      completed = await this.publisher.monetization.subscriptions.archive(call);
    } catch (error) {
      throw googlePlayFailure('monetization.subscriptions.archive', error);
    }

    return completed.data;
  }

  /**
   * Updates a batch of subscriptions.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.subscriptions/batchUpdate}
   */
  async batchUpdateMonetizationSubscriptions(
    call: androidpublisher_v3.Params$Resource$Monetization$Subscriptions$Batchupdate,
  ): Promise<androidpublisher_v3.Schema$BatchUpdateSubscriptionsResponse> {
    var completed: { data: androidpublisher_v3.Schema$BatchUpdateSubscriptionsResponse };

    try {
      completed = await this.publisher.monetization.subscriptions.batchUpdate(call);
    } catch (error) {
      throw googlePlayFailure('monetization.subscriptions.batchUpdate', error);
    }

    return completed.data;
  }

  /**
   * Updates an existing subscription.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.subscriptions/patch}
   */
  async patchMonetizationSubscriptions(
    call: androidpublisher_v3.Params$Resource$Monetization$Subscriptions$Patch,
  ): Promise<androidpublisher_v3.Schema$Subscription> {
    var completed: { data: androidpublisher_v3.Schema$Subscription };

    try {
      completed = await this.publisher.monetization.subscriptions.patch(call);
    } catch (error) {
      throw googlePlayFailure('monetization.subscriptions.patch', error);
    }

    return completed.data;
  }

  /**
   * Reads one or more subscriptions.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.subscriptions/batchGet}
   */
  async batchGetMonetizationSubscriptions(
    call: androidpublisher_v3.Params$Resource$Monetization$Subscriptions$Batchget,
  ): Promise<androidpublisher_v3.Schema$BatchGetSubscriptionsResponse> {
    var completed: { data: androidpublisher_v3.Schema$BatchGetSubscriptionsResponse };

    try {
      completed = await this.publisher.monetization.subscriptions.batchGet(call);
    } catch (error) {
      throw googlePlayFailure('monetization.subscriptions.batchGet', error);
    }

    return completed.data;
  }

  /**
   * Reads a single subscription.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.subscriptions/get}
   */
  async getMonetizationSubscriptions(
    call: androidpublisher_v3.Params$Resource$Monetization$Subscriptions$Get,
  ): Promise<androidpublisher_v3.Schema$Subscription> {
    var completed: { data: androidpublisher_v3.Schema$Subscription };

    try {
      completed = await this.publisher.monetization.subscriptions.get(call);
    } catch (error) {
      throw googlePlayFailure('monetization.subscriptions.get', error);
    }

    return completed.data;
  }

  /**
   * Lists all subscriptions under a given app.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.subscriptions/list}
   */
  async listMonetizationSubscriptions(
    call: androidpublisher_v3.Params$Resource$Monetization$Subscriptions$List,
  ): Promise<androidpublisher_v3.Schema$ListSubscriptionsResponse> {
    var completed: { data: androidpublisher_v3.Schema$ListSubscriptionsResponse };

    try {
      completed = await this.publisher.monetization.subscriptions.list(call);
    } catch (error) {
      throw googlePlayFailure('monetization.subscriptions.list', error);
    }

    return completed.data;
  }

  /**
   * Deletes a subscription.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.subscriptions/delete}
   */
  async deleteMonetizationSubscriptions(
    call: androidpublisher_v3.Params$Resource$Monetization$Subscriptions$Delete,
  ): Promise<void> {
    try {
      await this.publisher.monetization.subscriptions.delete(call);
    } catch (error) {
      throw googlePlayFailure('monetization.subscriptions.delete', error);
    }
  }

  /**
   * Batch variant of the MigrateBasePlanPrices endpoint.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.subscriptions.basePlans/batchMigratePrices}
   */
  async batchMigratePricesMonetizationSubscriptionsBasePlans(
    call: androidpublisher_v3.Params$Resource$Monetization$Subscriptions$Baseplans$Batchmigrateprices,
  ): Promise<androidpublisher_v3.Schema$BatchMigrateBasePlanPricesResponse> {
    var completed: { data: androidpublisher_v3.Schema$BatchMigrateBasePlanPricesResponse };

    try {
      completed =
        await this.publisher.monetization.subscriptions.basePlans.batchMigratePrices(call);
    } catch (error) {
      throw googlePlayFailure('monetization.subscriptions.basePlans.batchMigratePrices', error);
    }

    return completed.data;
  }

  /**
   * Deletes a base plan.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.subscriptions.basePlans/delete}
   */
  async deleteMonetizationSubscriptionsBasePlans(
    call: androidpublisher_v3.Params$Resource$Monetization$Subscriptions$Baseplans$Delete,
  ): Promise<void> {
    try {
      await this.publisher.monetization.subscriptions.basePlans.delete(call);
    } catch (error) {
      throw googlePlayFailure('monetization.subscriptions.basePlans.delete', error);
    }
  }

  /**
   * Migrates subscribers from one or more legacy price cohorts to the current price.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.subscriptions.basePlans/migratePrices}
   */
  async migratePricesMonetizationSubscriptionsBasePlans(
    call: androidpublisher_v3.Params$Resource$Monetization$Subscriptions$Baseplans$Migrateprices,
  ): Promise<androidpublisher_v3.Schema$MigrateBasePlanPricesResponse> {
    var completed: { data: androidpublisher_v3.Schema$MigrateBasePlanPricesResponse };

    try {
      completed = await this.publisher.monetization.subscriptions.basePlans.migratePrices(call);
    } catch (error) {
      throw googlePlayFailure('monetization.subscriptions.basePlans.migratePrices', error);
    }

    return completed.data;
  }

  /**
   * Activates a base plan.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.subscriptions.basePlans/activate}
   */
  async activateMonetizationSubscriptionsBasePlans(
    call: androidpublisher_v3.Params$Resource$Monetization$Subscriptions$Baseplans$Activate,
  ): Promise<androidpublisher_v3.Schema$Subscription> {
    var completed: { data: androidpublisher_v3.Schema$Subscription };

    try {
      completed = await this.publisher.monetization.subscriptions.basePlans.activate(call);
    } catch (error) {
      throw googlePlayFailure('monetization.subscriptions.basePlans.activate', error);
    }

    return completed.data;
  }

  /**
   * Activates or deactivates base plans across one or multiple subscriptions.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.subscriptions.basePlans/batchUpdateStates}
   */
  async batchUpdateStatesMonetizationSubscriptionsBasePlans(
    call: androidpublisher_v3.Params$Resource$Monetization$Subscriptions$Baseplans$Batchupdatestates,
  ): Promise<androidpublisher_v3.Schema$BatchUpdateBasePlanStatesResponse> {
    var completed: { data: androidpublisher_v3.Schema$BatchUpdateBasePlanStatesResponse };

    try {
      completed = await this.publisher.monetization.subscriptions.basePlans.batchUpdateStates(call);
    } catch (error) {
      throw googlePlayFailure('monetization.subscriptions.basePlans.batchUpdateStates', error);
    }

    return completed.data;
  }

  /**
   * Deactivates a base plan.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.subscriptions.basePlans/deactivate}
   */
  async deactivateMonetizationSubscriptionsBasePlans(
    call: androidpublisher_v3.Params$Resource$Monetization$Subscriptions$Baseplans$Deactivate,
  ): Promise<androidpublisher_v3.Schema$Subscription> {
    var completed: { data: androidpublisher_v3.Schema$Subscription };

    try {
      completed = await this.publisher.monetization.subscriptions.basePlans.deactivate(call);
    } catch (error) {
      throw googlePlayFailure('monetization.subscriptions.basePlans.deactivate', error);
    }

    return completed.data;
  }

  /**
   * Updates an existing subscription offer.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.subscriptions.basePlans.offers/patch}
   */
  async patchMonetizationSubscriptionsBasePlansOffers(
    call: androidpublisher_v3.Params$Resource$Monetization$Subscriptions$Baseplans$Offers$Patch,
  ): Promise<androidpublisher_v3.Schema$SubscriptionOffer> {
    var completed: { data: androidpublisher_v3.Schema$SubscriptionOffer };

    try {
      completed = await this.publisher.monetization.subscriptions.basePlans.offers.patch(call);
    } catch (error) {
      throw googlePlayFailure('monetization.subscriptions.basePlans.offers.patch', error);
    }

    return completed.data;
  }

  /**
   * Creates a new subscription offer.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.subscriptions.basePlans.offers/create}
   */
  async createMonetizationSubscriptionsBasePlansOffers(
    call: androidpublisher_v3.Params$Resource$Monetization$Subscriptions$Baseplans$Offers$Create,
  ): Promise<androidpublisher_v3.Schema$SubscriptionOffer> {
    var completed: { data: androidpublisher_v3.Schema$SubscriptionOffer };

    try {
      completed = await this.publisher.monetization.subscriptions.basePlans.offers.create(call);
    } catch (error) {
      throw googlePlayFailure('monetization.subscriptions.basePlans.offers.create', error);
    }

    return completed.data;
  }

  /**
   * Reads a single offer.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.subscriptions.basePlans.offers/get}
   */
  async getMonetizationSubscriptionsBasePlansOffers(
    call: androidpublisher_v3.Params$Resource$Monetization$Subscriptions$Baseplans$Offers$Get,
  ): Promise<androidpublisher_v3.Schema$SubscriptionOffer> {
    var completed: { data: androidpublisher_v3.Schema$SubscriptionOffer };

    try {
      completed = await this.publisher.monetization.subscriptions.basePlans.offers.get(call);
    } catch (error) {
      throw googlePlayFailure('monetization.subscriptions.basePlans.offers.get', error);
    }

    return completed.data;
  }

  /**
   * Deletes a subscription offer.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.subscriptions.basePlans.offers/delete}
   */
  async deleteMonetizationSubscriptionsBasePlansOffers(
    call: androidpublisher_v3.Params$Resource$Monetization$Subscriptions$Baseplans$Offers$Delete,
  ): Promise<void> {
    try {
      await this.publisher.monetization.subscriptions.basePlans.offers.delete(call);
    } catch (error) {
      throw googlePlayFailure('monetization.subscriptions.basePlans.offers.delete', error);
    }
  }

  /**
   * Reads one or more subscription offers.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.subscriptions.basePlans.offers/batchGet}
   */
  async batchGetMonetizationSubscriptionsBasePlansOffers(
    call: androidpublisher_v3.Params$Resource$Monetization$Subscriptions$Baseplans$Offers$Batchget,
  ): Promise<androidpublisher_v3.Schema$BatchGetSubscriptionOffersResponse> {
    var completed: { data: androidpublisher_v3.Schema$BatchGetSubscriptionOffersResponse };

    try {
      completed = await this.publisher.monetization.subscriptions.basePlans.offers.batchGet(call);
    } catch (error) {
      throw googlePlayFailure('monetization.subscriptions.basePlans.offers.batchGet', error);
    }

    return completed.data;
  }

  /**
   * Deactivates a subscription offer.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.subscriptions.basePlans.offers/deactivate}
   */
  async deactivateMonetizationSubscriptionsBasePlansOffers(
    call: androidpublisher_v3.Params$Resource$Monetization$Subscriptions$Baseplans$Offers$Deactivate,
  ): Promise<androidpublisher_v3.Schema$SubscriptionOffer> {
    var completed: { data: androidpublisher_v3.Schema$SubscriptionOffer };

    try {
      completed = await this.publisher.monetization.subscriptions.basePlans.offers.deactivate(call);
    } catch (error) {
      throw googlePlayFailure('monetization.subscriptions.basePlans.offers.deactivate', error);
    }

    return completed.data;
  }

  /**
   * Activates a subscription offer.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.subscriptions.basePlans.offers/activate}
   */
  async activateMonetizationSubscriptionsBasePlansOffers(
    call: androidpublisher_v3.Params$Resource$Monetization$Subscriptions$Baseplans$Offers$Activate,
  ): Promise<androidpublisher_v3.Schema$SubscriptionOffer> {
    var completed: { data: androidpublisher_v3.Schema$SubscriptionOffer };

    try {
      completed = await this.publisher.monetization.subscriptions.basePlans.offers.activate(call);
    } catch (error) {
      throw googlePlayFailure('monetization.subscriptions.basePlans.offers.activate', error);
    }

    return completed.data;
  }

  /**
   * Lists all offers under a given subscription.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.subscriptions.basePlans.offers/list}
   */
  async listMonetizationSubscriptionsBasePlansOffers(
    call: androidpublisher_v3.Params$Resource$Monetization$Subscriptions$Baseplans$Offers$List,
  ): Promise<androidpublisher_v3.Schema$ListSubscriptionOffersResponse> {
    var completed: { data: androidpublisher_v3.Schema$ListSubscriptionOffersResponse };

    try {
      completed = await this.publisher.monetization.subscriptions.basePlans.offers.list(call);
    } catch (error) {
      throw googlePlayFailure('monetization.subscriptions.basePlans.offers.list', error);
    }

    return completed.data;
  }

  /**
   * Updates a batch of subscription offer states.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.subscriptions.basePlans.offers/batchUpdateStates}
   */
  async batchUpdateStatesMonetizationSubscriptionsBasePlansOffers(
    call: androidpublisher_v3.Params$Resource$Monetization$Subscriptions$Baseplans$Offers$Batchupdatestates,
  ): Promise<androidpublisher_v3.Schema$BatchUpdateSubscriptionOfferStatesResponse> {
    var completed: { data: androidpublisher_v3.Schema$BatchUpdateSubscriptionOfferStatesResponse };

    try {
      completed =
        await this.publisher.monetization.subscriptions.basePlans.offers.batchUpdateStates(call);
    } catch (error) {
      throw googlePlayFailure(
        'monetization.subscriptions.basePlans.offers.batchUpdateStates',
        error,
      );
    }

    return completed.data;
  }

  /**
   * Updates a batch of subscription offers.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.subscriptions.basePlans.offers/batchUpdate}
   */
  async batchUpdateMonetizationSubscriptionsBasePlansOffers(
    call: androidpublisher_v3.Params$Resource$Monetization$Subscriptions$Baseplans$Offers$Batchupdate,
  ): Promise<androidpublisher_v3.Schema$BatchUpdateSubscriptionOffersResponse> {
    var completed: { data: androidpublisher_v3.Schema$BatchUpdateSubscriptionOffersResponse };

    try {
      completed =
        await this.publisher.monetization.subscriptions.basePlans.offers.batchUpdate(call);
    } catch (error) {
      throw googlePlayFailure('monetization.subscriptions.basePlans.offers.batchUpdate', error);
    }

    return completed.data;
  }

  /**
   * Get order details for a single order.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/orders/get}
   */
  async getOrders(
    call: androidpublisher_v3.Params$Resource$Orders$Get,
  ): Promise<androidpublisher_v3.Schema$Order> {
    var completed: { data: androidpublisher_v3.Schema$Order };

    try {
      completed = await this.publisher.orders.get(call);
    } catch (error) {
      throw googlePlayFailure('orders.get', error);
    }

    return completed.data;
  }

  /**
   * Refunds a user's subscription or in-app purchase order.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/orders/refund}
   */
  async refundOrders(call: androidpublisher_v3.Params$Resource$Orders$Refund): Promise<void> {
    try {
      await this.publisher.orders.refund(call);
    } catch (error) {
      throw googlePlayFailure('orders.refund', error);
    }
  }

  /**
   * Get order details for a list of orders.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/orders/batchget}
   */
  async batchgetOrders(
    call: androidpublisher_v3.Params$Resource$Orders$Batchget,
  ): Promise<androidpublisher_v3.Schema$BatchGetOrdersResponse> {
    var completed: { data: androidpublisher_v3.Schema$BatchGetOrdersResponse };

    try {
      completed = await this.publisher.orders.batchget(call);
    } catch (error) {
      throw googlePlayFailure('orders.batchget', error);
    }

    return completed.data;
  }

  /**
   * Provide refund preference and purchase usage for a chargeback request.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/orders/reviewrefund}
   */
  async reviewrefundOrders(
    call: androidpublisher_v3.Params$Resource$Orders$Reviewrefund,
  ): Promise<void> {
    try {
      await this.publisher.orders.reviewrefund(call);
    } catch (error) {
      throw googlePlayFailure('orders.reviewrefund', error);
    }
  }

  /**
   * Writes the Safety Labels declaration of an app.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/applications/dataSafety}
   */
  async dataSafetyApplications(
    call: androidpublisher_v3.Params$Resource$Applications$Datasafety,
  ): Promise<androidpublisher_v3.Schema$SafetyLabelsUpdateResponse> {
    var completed: { data: androidpublisher_v3.Schema$SafetyLabelsUpdateResponse };

    try {
      completed = await this.publisher.applications.dataSafety(call);
    } catch (error) {
      throw googlePlayFailure('applications.dataSafety', error);
    }

    return completed.data;
  }

  /**
   * Returns created device tier configs, ordered by descending creation time.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/applications.deviceTierConfigs/list}
   */
  async listApplicationsDeviceTierConfigs(
    call: androidpublisher_v3.Params$Resource$Applications$Devicetierconfigs$List,
  ): Promise<androidpublisher_v3.Schema$ListDeviceTierConfigsResponse> {
    var completed: { data: androidpublisher_v3.Schema$ListDeviceTierConfigsResponse };

    try {
      completed = await this.publisher.applications.deviceTierConfigs.list(call);
    } catch (error) {
      throw googlePlayFailure('applications.deviceTierConfigs.list', error);
    }

    return completed.data;
  }

  /**
   * Returns a particular device tier config.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/applications.deviceTierConfigs/get}
   */
  async getApplicationsDeviceTierConfigs(
    call: androidpublisher_v3.Params$Resource$Applications$Devicetierconfigs$Get,
  ): Promise<androidpublisher_v3.Schema$DeviceTierConfig> {
    var completed: { data: androidpublisher_v3.Schema$DeviceTierConfig };

    try {
      completed = await this.publisher.applications.deviceTierConfigs.get(call);
    } catch (error) {
      throw googlePlayFailure('applications.deviceTierConfigs.get', error);
    }

    return completed.data;
  }

  /**
   * Creates a new device tier config for an app.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/applications.deviceTierConfigs/create}
   */
  async createApplicationsDeviceTierConfigs(
    call: androidpublisher_v3.Params$Resource$Applications$Devicetierconfigs$Create,
  ): Promise<androidpublisher_v3.Schema$DeviceTierConfig> {
    var completed: { data: androidpublisher_v3.Schema$DeviceTierConfig };

    try {
      completed = await this.publisher.applications.deviceTierConfigs.create(call);
    } catch (error) {
      throw googlePlayFailure('applications.deviceTierConfigs.create', error);
    }

    return completed.data;
  }

  /**
   * Returns the list of all releases for a given track.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/applications.tracks.releases/list}
   */
  async listApplicationsTracksReleases(
    call: androidpublisher_v3.Params$Resource$Applications$Tracks$Releases$List,
  ): Promise<androidpublisher_v3.Schema$ListReleaseSummariesResponse> {
    var completed: { data: androidpublisher_v3.Schema$ListReleaseSummariesResponse };

    try {
      completed = await this.publisher.applications.tracks.releases.list(call);
    } catch (error) {
      throw googlePlayFailure('applications.tracks.releases.list', error);
    }

    return completed.data;
  }

  /**
   * Updates or inserts one or more in-app products (managed products or subscriptions).
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/inappproducts/batchUpdate}
   */
  async batchUpdateInappproducts(
    call: androidpublisher_v3.Params$Resource$Inappproducts$Batchupdate,
  ): Promise<androidpublisher_v3.Schema$InappproductsBatchUpdateResponse> {
    var completed: { data: androidpublisher_v3.Schema$InappproductsBatchUpdateResponse };

    try {
      completed = await this.publisher.inappproducts.batchUpdate(call);
    } catch (error) {
      throw googlePlayFailure('inappproducts.batchUpdate', error);
    }

    return completed.data;
  }

  /**
   * Reads multiple in-app products, which can be managed products or subscriptions.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/inappproducts/batchGet}
   */
  async batchGetInappproducts(
    call: androidpublisher_v3.Params$Resource$Inappproducts$Batchget,
  ): Promise<androidpublisher_v3.Schema$InappproductsBatchGetResponse> {
    var completed: { data: androidpublisher_v3.Schema$InappproductsBatchGetResponse };

    try {
      completed = await this.publisher.inappproducts.batchGet(call);
    } catch (error) {
      throw googlePlayFailure('inappproducts.batchGet', error);
    }

    return completed.data;
  }

  /**
   * Updates an in-app product (a managed product or a subscription).
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/inappproducts/update}
   */
  async updateInappproducts(
    call: androidpublisher_v3.Params$Resource$Inappproducts$Update,
  ): Promise<androidpublisher_v3.Schema$InAppProduct> {
    var completed: { data: androidpublisher_v3.Schema$InAppProduct };

    try {
      completed = await this.publisher.inappproducts.update(call);
    } catch (error) {
      throw googlePlayFailure('inappproducts.update', error);
    }

    return completed.data;
  }

  /**
   * Lists all in-app products - both managed products and subscriptions.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/inappproducts/list}
   */
  async listInappproducts(
    call: androidpublisher_v3.Params$Resource$Inappproducts$List,
  ): Promise<androidpublisher_v3.Schema$InappproductsListResponse> {
    var completed: { data: androidpublisher_v3.Schema$InappproductsListResponse };

    try {
      completed = await this.publisher.inappproducts.list(call);
    } catch (error) {
      throw googlePlayFailure('inappproducts.list', error);
    }

    return completed.data;
  }

  /**
   * Gets an in-app product, which can be a managed product or a subscription.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/inappproducts/get}
   */
  async getInappproducts(
    call: androidpublisher_v3.Params$Resource$Inappproducts$Get,
  ): Promise<androidpublisher_v3.Schema$InAppProduct> {
    var completed: { data: androidpublisher_v3.Schema$InAppProduct };

    try {
      completed = await this.publisher.inappproducts.get(call);
    } catch (error) {
      throw googlePlayFailure('inappproducts.get', error);
    }

    return completed.data;
  }

  /**
   * Deletes in-app products (managed products or subscriptions).
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/inappproducts/batchDelete}
   */
  async batchDeleteInappproducts(
    call: androidpublisher_v3.Params$Resource$Inappproducts$Batchdelete,
  ): Promise<void> {
    try {
      await this.publisher.inappproducts.batchDelete(call);
    } catch (error) {
      throw googlePlayFailure('inappproducts.batchDelete', error);
    }
  }

  /**
   * Creates an in-app product (a managed product or a subscription).
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/inappproducts/insert}
   */
  async insertInappproducts(
    call: androidpublisher_v3.Params$Resource$Inappproducts$Insert,
  ): Promise<androidpublisher_v3.Schema$InAppProduct> {
    var completed: { data: androidpublisher_v3.Schema$InAppProduct };

    try {
      completed = await this.publisher.inappproducts.insert(call);
    } catch (error) {
      throw googlePlayFailure('inappproducts.insert', error);
    }

    return completed.data;
  }

  /**
   * Patches an in-app product (a managed product or a subscription).
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/inappproducts/patch}
   */
  async patchInappproducts(
    call: androidpublisher_v3.Params$Resource$Inappproducts$Patch,
  ): Promise<androidpublisher_v3.Schema$InAppProduct> {
    var completed: { data: androidpublisher_v3.Schema$InAppProduct };

    try {
      completed = await this.publisher.inappproducts.patch(call);
    } catch (error) {
      throw googlePlayFailure('inappproducts.patch', error);
    }

    return completed.data;
  }

  /**
   * Deletes an in-app product (a managed product or a subscription).
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/inappproducts/delete}
   */
  async deleteInappproducts(
    call: androidpublisher_v3.Params$Resource$Inappproducts$Delete,
  ): Promise<void> {
    try {
      await this.publisher.inappproducts.delete(call);
    } catch (error) {
      throw googlePlayFailure('inappproducts.delete', error);
    }
  }

  /**
   * Returns metadata about a recently updated app.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/appstorecatalog.recentappviews/get}
   */
  async getAppstorecatalogRecentappviews(
    call: androidpublisher_v3.Params$Resource$Appstorecatalog$Recentappviews$Get,
  ): Promise<androidpublisher_v3.Schema$RecentAppView> {
    var completed: { data: androidpublisher_v3.Schema$RecentAppView };

    try {
      completed = await this.publisher.appstorecatalog.recentappviews.get(call);
    } catch (error) {
      throw googlePlayFailure('appstorecatalog.recentappviews.get', error);
    }

    return completed.data;
  }

  /**
   * Lists update events for eligible apps in the given time range.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/appstorecatalog.recentupdateevents/list}
   */
  async listAppstorecatalogRecentupdateevents(
    call: androidpublisher_v3.Params$Resource$Appstorecatalog$Recentupdateevents$List,
  ): Promise<androidpublisher_v3.Schema$ListRecentUpdateEventsResponse> {
    var completed: { data: androidpublisher_v3.Schema$ListRecentUpdateEventsResponse };

    try {
      completed = await this.publisher.appstorecatalog.recentupdateevents.list(call);
    } catch (error) {
      throw googlePlayFailure('appstorecatalog.recentupdateevents.list', error);
    }

    return completed.data;
  }

  /**
   * Creates an app store hosted app.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/appstoreappsreview/createappstorehostedapp}
   */
  async createappstorehostedappAppstoreappsreview(
    call: androidpublisher_v3.Params$Resource$Appstoreappsreview$Createappstorehostedapp,
  ): Promise<androidpublisher_v3.Schema$CreateAppStoreHostedAppResponse> {
    var completed: { data: androidpublisher_v3.Schema$CreateAppStoreHostedAppResponse };

    try {
      completed = await this.publisher.appstoreappsreview.createappstorehostedapp(call);
    } catch (error) {
      throw googlePlayFailure('appstoreappsreview.createappstorehostedapp', error);
    }

    return completed.data;
  }

  /**
   * Upload a screenshot or app icon for the hosted app.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/appstoreappsreview/uploadimage}
   */
  async uploadimageAppstoreappsreview(
    call: androidpublisher_v3.Params$Resource$Appstoreappsreview$Uploadimage,
  ): Promise<androidpublisher_v3.Schema$UploadImageResponse> {
    var completed: { data: androidpublisher_v3.Schema$UploadImageResponse };

    try {
      completed = await this.publisher.appstoreappsreview.uploadimage(call);
    } catch (error) {
      throw googlePlayFailure('appstoreappsreview.uploadimage', error);
    }

    return completed.data;
  }

  /**
   * Upload a policy declaration file for the hosted app.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/appstoreappsreview/uploadappstoreapppolicydeclarationfile}
   */
  async uploadappstoreapppolicydeclarationfileAppstoreappsreview(
    call: androidpublisher_v3.Params$Resource$Appstoreappsreview$Uploadappstoreapppolicydeclarationfile,
  ): Promise<androidpublisher_v3.Schema$UploadAppStoreAppPolicyDeclarationFileResponse> {
    var completed: {
      data: androidpublisher_v3.Schema$UploadAppStoreAppPolicyDeclarationFileResponse;
    };

    try {
      completed =
        await this.publisher.appstoreappsreview.uploadappstoreapppolicydeclarationfile(call);
    } catch (error) {
      throw googlePlayFailure('appstoreappsreview.uploadappstoreapppolicydeclarationfile', error);
    }

    return completed.data;
  }

  /**
   * Updates details for an app hosted on an app store.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/appstoreappsreview/updateappstorehostedapp}
   */
  async updateappstorehostedappAppstoreappsreview(
    call: androidpublisher_v3.Params$Resource$Appstoreappsreview$Updateappstorehostedapp,
  ): Promise<androidpublisher_v3.Schema$UpdateAppStoreHostedAppResponse> {
    var completed: { data: androidpublisher_v3.Schema$UpdateAppStoreHostedAppResponse };

    try {
      completed = await this.publisher.appstoreappsreview.updateappstorehostedapp(call);
    } catch (error) {
      throw googlePlayFailure('appstoreappsreview.updateappstorehostedapp', error);
    }

    return completed.data;
  }

  /**
   * Upload an APK file for the hosted app.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/appstoreappsreview/uploadapk}
   */
  async uploadapkAppstoreappsreview(
    call: androidpublisher_v3.Params$Resource$Appstoreappsreview$Uploadapk,
  ): Promise<androidpublisher_v3.Schema$UploadApkResponse> {
    var completed: { data: androidpublisher_v3.Schema$UploadApkResponse };

    try {
      completed = await this.publisher.appstoreappsreview.uploadapk(call);
    } catch (error) {
      throw googlePlayFailure('appstoreappsreview.uploadapk', error);
    }

    return completed.data;
  }

  /**
   * Updates the publish status of an app store hosted app.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/appstoreappsreview/updateappstorehostedapppublishstatus}
   */
  async updateappstorehostedapppublishstatusAppstoreappsreview(
    call: androidpublisher_v3.Params$Resource$Appstoreappsreview$Updateappstorehostedapppublishstatus,
  ): Promise<androidpublisher_v3.Schema$UpdateAppStoreHostedAppPublishStatusResponse> {
    var completed: {
      data: androidpublisher_v3.Schema$UpdateAppStoreHostedAppPublishStatusResponse;
    };

    try {
      completed =
        await this.publisher.appstoreappsreview.updateappstorehostedapppublishstatus(call);
    } catch (error) {
      throw googlePlayFailure('appstoreappsreview.updateappstorehostedapppublishstatus', error);
    }

    return completed.data;
  }

  /**
   * Grant access for a user to the given developer account.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/users/create}
   */
  async createUsers(
    call: androidpublisher_v3.Params$Resource$Users$Create,
  ): Promise<androidpublisher_v3.Schema$User> {
    var completed: { data: androidpublisher_v3.Schema$User };

    try {
      completed = await this.publisher.users.create(call);
    } catch (error) {
      throw googlePlayFailure('users.create', error);
    }

    return completed.data;
  }

  /**
   * Removes all access for the user to the given developer account.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/users/delete}
   */
  async deleteUsers(call: androidpublisher_v3.Params$Resource$Users$Delete): Promise<void> {
    try {
      await this.publisher.users.delete(call);
    } catch (error) {
      throw googlePlayFailure('users.delete', error);
    }
  }

  /**
   * Updates access for the user to the developer account.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/users/patch}
   */
  async patchUsers(
    call: androidpublisher_v3.Params$Resource$Users$Patch,
  ): Promise<androidpublisher_v3.Schema$User> {
    var completed: { data: androidpublisher_v3.Schema$User };

    try {
      completed = await this.publisher.users.patch(call);
    } catch (error) {
      throw googlePlayFailure('users.patch', error);
    }

    return completed.data;
  }

  /**
   * Lists all users with access to a developer account.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/users/list}
   */
  async listUsers(
    call: androidpublisher_v3.Params$Resource$Users$List,
  ): Promise<androidpublisher_v3.Schema$ListUsersResponse> {
    var completed: { data: androidpublisher_v3.Schema$ListUsersResponse };

    try {
      completed = await this.publisher.users.list(call);
    } catch (error) {
      throw googlePlayFailure('users.list', error);
    }

    return completed.data;
  }

  /**
   * Gets a single review.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/reviews/get}
   */
  async getReviews(
    call: androidpublisher_v3.Params$Resource$Reviews$Get,
  ): Promise<androidpublisher_v3.Schema$Review> {
    var completed: { data: androidpublisher_v3.Schema$Review };

    try {
      completed = await this.publisher.reviews.get(call);
    } catch (error) {
      throw googlePlayFailure('reviews.get', error);
    }

    return completed.data;
  }

  /**
   * Lists all reviews.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/reviews/list}
   */
  async listReviews(
    call: androidpublisher_v3.Params$Resource$Reviews$List,
  ): Promise<androidpublisher_v3.Schema$ReviewsListResponse> {
    var completed: { data: androidpublisher_v3.Schema$ReviewsListResponse };

    try {
      completed = await this.publisher.reviews.list(call);
    } catch (error) {
      throw googlePlayFailure('reviews.list', error);
    }

    return completed.data;
  }

  /**
   * Replies to a single review, or updates an existing reply.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/reviews/reply}
   */
  async replyReviews(
    call: androidpublisher_v3.Params$Resource$Reviews$Reply,
  ): Promise<androidpublisher_v3.Schema$ReviewsReplyResponse> {
    var completed: { data: androidpublisher_v3.Schema$ReviewsReplyResponse };

    try {
      completed = await this.publisher.reviews.reply(call);
    } catch (error) {
      throw googlePlayFailure('reviews.reply', error);
    }

    return completed.data;
  }

  /**
   * Refunds or partially refunds an existing external transaction.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/externaltransactions/refundexternaltransaction}
   */
  async refundexternaltransactionExternaltransactions(
    call: androidpublisher_v3.Params$Resource$Externaltransactions$Refundexternaltransaction,
  ): Promise<androidpublisher_v3.Schema$ExternalTransaction> {
    var completed: { data: androidpublisher_v3.Schema$ExternalTransaction };

    try {
      completed = await this.publisher.externaltransactions.refundexternaltransaction(call);
    } catch (error) {
      throw googlePlayFailure('externaltransactions.refundexternaltransaction', error);
    }

    return completed.data;
  }

  /**
   * Creates a new external transaction.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/externaltransactions/createexternaltransaction}
   */
  async createexternaltransactionExternaltransactions(
    call: androidpublisher_v3.Params$Resource$Externaltransactions$Createexternaltransaction,
  ): Promise<androidpublisher_v3.Schema$ExternalTransaction> {
    var completed: { data: androidpublisher_v3.Schema$ExternalTransaction };

    try {
      completed = await this.publisher.externaltransactions.createexternaltransaction(call);
    } catch (error) {
      throw googlePlayFailure('externaltransactions.createexternaltransaction', error);
    }

    return completed.data;
  }

  /**
   * Gets an existing external transaction.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/externaltransactions/getexternaltransaction}
   */
  async getexternaltransactionExternaltransactions(
    call: androidpublisher_v3.Params$Resource$Externaltransactions$Getexternaltransaction,
  ): Promise<androidpublisher_v3.Schema$ExternalTransaction> {
    var completed: { data: androidpublisher_v3.Schema$ExternalTransaction };

    try {
      completed = await this.publisher.externaltransactions.getexternaltransaction(call);
    } catch (error) {
      throw googlePlayFailure('externaltransactions.getexternaltransaction', error);
    }

    return completed.data;
  }

  /**
   * Updates access for the user to the given package.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/grants/patch}
   */
  async patchGrants(
    call: androidpublisher_v3.Params$Resource$Grants$Patch,
  ): Promise<androidpublisher_v3.Schema$Grant> {
    var completed: { data: androidpublisher_v3.Schema$Grant };

    try {
      completed = await this.publisher.grants.patch(call);
    } catch (error) {
      throw googlePlayFailure('grants.patch', error);
    }

    return completed.data;
  }

  /**
   * Removes all access for the user to the given package or developer account.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/grants/delete}
   */
  async deleteGrants(call: androidpublisher_v3.Params$Resource$Grants$Delete): Promise<void> {
    try {
      await this.publisher.grants.delete(call);
    } catch (error) {
      throw googlePlayFailure('grants.delete', error);
    }
  }

  /**
   * Grant access for a user to the given package.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/grants/create}
   */
  async createGrants(
    call: androidpublisher_v3.Params$Resource$Grants$Create,
  ): Promise<androidpublisher_v3.Schema$Grant> {
    var completed: { data: androidpublisher_v3.Schema$Grant };

    try {
      completed = await this.publisher.grants.create(call);
    } catch (error) {
      throw googlePlayFailure('grants.create', error);
    }

    return completed.data;
  }

  /**
   * Enrolls an app in Play App Signing using a self-hosted Google Cloud KMS key.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/appsigning/enrollApp}
   */
  async enrollAppAppsigning(
    call: androidpublisher_v3.Params$Resource$Appsigning$Enrollapp,
  ): Promise<androidpublisher_v3.Schema$EnrollAppResponse> {
    var completed: { data: androidpublisher_v3.Schema$EnrollAppResponse };

    try {
      completed = await this.publisher.appsigning.enrollApp(call);
    } catch (error) {
      throw googlePlayFailure('appsigning.enrollApp', error);
    }

    return completed.data;
  }

  /**
   * Rotates an app's signing key to a new self-hosted Google Cloud KMS key.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/appsigning/rotateAppSigningKey}
   */
  async rotateAppSigningKeyAppsigning(
    call: androidpublisher_v3.Params$Resource$Appsigning$Rotateappsigningkey,
  ): Promise<androidpublisher_v3.Schema$RotateAppSigningKeyResponse> {
    var completed: { data: androidpublisher_v3.Schema$RotateAppSigningKeyResponse };

    try {
      completed = await this.publisher.appsigning.rotateAppSigningKey(call);
    } catch (error) {
      throw googlePlayFailure('appsigning.rotateAppSigningKey', error);
    }

    return completed.data;
  }

  /**
   * List all app recovery action resources associated with a particular package name and app version.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/apprecovery/list}
   */
  async listApprecovery(
    call: androidpublisher_v3.Params$Resource$Apprecovery$List,
  ): Promise<androidpublisher_v3.Schema$ListAppRecoveriesResponse> {
    var completed: { data: androidpublisher_v3.Schema$ListAppRecoveriesResponse };

    try {
      completed = await this.publisher.apprecovery.list(call);
    } catch (error) {
      throw googlePlayFailure('apprecovery.list', error);
    }

    return completed.data;
  }

  /**
   * Cancel an already executing app recovery action.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/apprecovery/cancel}
   */
  async cancelApprecovery(
    call: androidpublisher_v3.Params$Resource$Apprecovery$Cancel,
  ): Promise<androidpublisher_v3.Schema$CancelAppRecoveryResponse> {
    var completed: { data: androidpublisher_v3.Schema$CancelAppRecoveryResponse };

    try {
      completed = await this.publisher.apprecovery.cancel(call);
    } catch (error) {
      throw googlePlayFailure('apprecovery.cancel', error);
    }

    return completed.data;
  }

  /**
   * Deploy an already created app recovery action with recovery status DRAFT.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/apprecovery/deploy}
   */
  async deployApprecovery(
    call: androidpublisher_v3.Params$Resource$Apprecovery$Deploy,
  ): Promise<androidpublisher_v3.Schema$DeployAppRecoveryResponse> {
    var completed: { data: androidpublisher_v3.Schema$DeployAppRecoveryResponse };

    try {
      completed = await this.publisher.apprecovery.deploy(call);
    } catch (error) {
      throw googlePlayFailure('apprecovery.deploy', error);
    }

    return completed.data;
  }

  /**
   * Incrementally update targeting for a recovery action.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/apprecovery/addTargeting}
   */
  async addTargetingApprecovery(
    call: androidpublisher_v3.Params$Resource$Apprecovery$Addtargeting,
  ): Promise<androidpublisher_v3.Schema$AddTargetingResponse> {
    var completed: { data: androidpublisher_v3.Schema$AddTargetingResponse };

    try {
      completed = await this.publisher.apprecovery.addTargeting(call);
    } catch (error) {
      throw googlePlayFailure('apprecovery.addTargeting', error);
    }

    return completed.data;
  }

  /**
   * Create an app recovery action with recovery status as DRAFT.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/apprecovery/create}
   */
  async createApprecovery(
    call: androidpublisher_v3.Params$Resource$Apprecovery$Create,
  ): Promise<androidpublisher_v3.Schema$AppRecoveryAction> {
    var completed: { data: androidpublisher_v3.Schema$AppRecoveryAction };

    try {
      completed = await this.publisher.apprecovery.create(call);
    } catch (error) {
      throw googlePlayFailure('apprecovery.create', error);
    }

    return completed.data;
  }

  /**
   * Uploads an APK to internal app sharing.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/internalappsharingartifacts/uploadapk}
   */
  async uploadapkInternalappsharingartifacts(
    call: androidpublisher_v3.Params$Resource$Internalappsharingartifacts$Uploadapk,
  ): Promise<androidpublisher_v3.Schema$InternalAppSharingArtifact> {
    var completed: { data: androidpublisher_v3.Schema$InternalAppSharingArtifact };

    try {
      completed = await this.publisher.internalappsharingartifacts.uploadapk(call);
    } catch (error) {
      throw googlePlayFailure('internalappsharingartifacts.uploadapk', error);
    }

    return completed.data;
  }

  /**
   * Uploads an app bundle to internal app sharing.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/internalappsharingartifacts/uploadbundle}
   */
  async uploadbundleInternalappsharingartifacts(
    call: androidpublisher_v3.Params$Resource$Internalappsharingartifacts$Uploadbundle,
  ): Promise<androidpublisher_v3.Schema$InternalAppSharingArtifact> {
    var completed: { data: androidpublisher_v3.Schema$InternalAppSharingArtifact };

    try {
      completed = await this.publisher.internalappsharingartifacts.uploadbundle(call);
    } catch (error) {
      throw googlePlayFailure('internalappsharingartifacts.uploadbundle', error);
    }

    return completed.data;
  }

  /**
   * Returns download metadata for all APKs that were generated from a given app bundle.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/generatedapks/list}
   */
  async listGeneratedapks(
    call: androidpublisher_v3.Params$Resource$Generatedapks$List,
  ): Promise<androidpublisher_v3.Schema$GeneratedApksListResponse> {
    var completed: { data: androidpublisher_v3.Schema$GeneratedApksListResponse };

    try {
      completed = await this.publisher.generatedapks.list(call);
    } catch (error) {
      throw googlePlayFailure('generatedapks.list', error);
    }

    return completed.data;
  }

  /**
   * Downloads a single signed APK generated from an app bundle.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/generatedapks/download}
   */
  async downloadGeneratedapks(
    call: androidpublisher_v3.Params$Resource$Generatedapks$Download,
  ): Promise<unknown> {
    var completed: { data: unknown };

    try {
      completed = await this.publisher.generatedapks.download(call);
    } catch (error) {
      throw googlePlayFailure('generatedapks.download', error);
    }

    return completed.data;
  }

  /**
   * Commits an app edit.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/edits/commit}
   */
  async commitEdits(
    call: androidpublisher_v3.Params$Resource$Edits$Commit,
  ): Promise<androidpublisher_v3.Schema$AppEdit> {
    var completed: { data: androidpublisher_v3.Schema$AppEdit };

    try {
      completed = await this.publisher.edits.commit(call);
    } catch (error) {
      throw googlePlayFailure('edits.commit', error);
    }

    return completed.data;
  }

  /**
   * Deletes an app edit.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/edits/delete}
   */
  async deleteEdits(call: androidpublisher_v3.Params$Resource$Edits$Delete): Promise<void> {
    try {
      await this.publisher.edits.delete(call);
    } catch (error) {
      throw googlePlayFailure('edits.delete', error);
    }
  }

  /**
   * Gets an app edit.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/edits/get}
   */
  async getEdits(
    call: androidpublisher_v3.Params$Resource$Edits$Get,
  ): Promise<androidpublisher_v3.Schema$AppEdit> {
    var completed: { data: androidpublisher_v3.Schema$AppEdit };

    try {
      completed = await this.publisher.edits.get(call);
    } catch (error) {
      throw googlePlayFailure('edits.get', error);
    }

    return completed.data;
  }

  /**
   * Creates a new edit for an app.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/edits/insert}
   */
  async insertEdits(
    call: androidpublisher_v3.Params$Resource$Edits$Insert,
  ): Promise<androidpublisher_v3.Schema$AppEdit> {
    var completed: { data: androidpublisher_v3.Schema$AppEdit };

    try {
      completed = await this.publisher.edits.insert(call);
    } catch (error) {
      throw googlePlayFailure('edits.insert', error);
    }

    return completed.data;
  }

  /**
   * Validates an app edit.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/edits/validate}
   */
  async validateEdits(
    call: androidpublisher_v3.Params$Resource$Edits$Validate,
  ): Promise<androidpublisher_v3.Schema$AppEdit> {
    var completed: { data: androidpublisher_v3.Schema$AppEdit };

    try {
      completed = await this.publisher.edits.validate(call);
    } catch (error) {
      throw googlePlayFailure('edits.validate', error);
    }

    return completed.data;
  }

  /**
   * Gets testers.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/edits.testers/get}
   */
  async getEditsTesters(
    call: androidpublisher_v3.Params$Resource$Edits$Testers$Get,
  ): Promise<androidpublisher_v3.Schema$Testers> {
    var completed: { data: androidpublisher_v3.Schema$Testers };

    try {
      completed = await this.publisher.edits.testers.get(call);
    } catch (error) {
      throw googlePlayFailure('edits.testers.get', error);
    }

    return completed.data;
  }

  /**
   * Patches testers.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/edits.testers/patch}
   */
  async patchEditsTesters(
    call: androidpublisher_v3.Params$Resource$Edits$Testers$Patch,
  ): Promise<androidpublisher_v3.Schema$Testers> {
    var completed: { data: androidpublisher_v3.Schema$Testers };

    try {
      completed = await this.publisher.edits.testers.patch(call);
    } catch (error) {
      throw googlePlayFailure('edits.testers.patch', error);
    }

    return completed.data;
  }

  /**
   * Updates testers.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/edits.testers/update}
   */
  async updateEditsTesters(
    call: androidpublisher_v3.Params$Resource$Edits$Testers$Update,
  ): Promise<androidpublisher_v3.Schema$Testers> {
    var completed: { data: androidpublisher_v3.Schema$Testers };

    try {
      completed = await this.publisher.edits.testers.update(call);
    } catch (error) {
      throw googlePlayFailure('edits.testers.update', error);
    }

    return completed.data;
  }

  /**
   * Deletes all store listings.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/edits.listings/deleteall}
   */
  async deleteallEditsListings(
    call: androidpublisher_v3.Params$Resource$Edits$Listings$Deleteall,
  ): Promise<void> {
    try {
      await this.publisher.edits.listings.deleteall(call);
    } catch (error) {
      throw googlePlayFailure('edits.listings.deleteall', error);
    }
  }

  /**
   * Patches a localized store listing.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/edits.listings/patch}
   */
  async patchEditsListings(
    call: androidpublisher_v3.Params$Resource$Edits$Listings$Patch,
  ): Promise<androidpublisher_v3.Schema$Listing> {
    var completed: { data: androidpublisher_v3.Schema$Listing };

    try {
      completed = await this.publisher.edits.listings.patch(call);
    } catch (error) {
      throw googlePlayFailure('edits.listings.patch', error);
    }

    return completed.data;
  }

  /**
   * Creates or updates a localized store listing.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/edits.listings/update}
   */
  async updateEditsListings(
    call: androidpublisher_v3.Params$Resource$Edits$Listings$Update,
  ): Promise<androidpublisher_v3.Schema$Listing> {
    var completed: { data: androidpublisher_v3.Schema$Listing };

    try {
      completed = await this.publisher.edits.listings.update(call);
    } catch (error) {
      throw googlePlayFailure('edits.listings.update', error);
    }

    return completed.data;
  }

  /**
   * Gets a localized store listing.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/edits.listings/get}
   */
  async getEditsListings(
    call: androidpublisher_v3.Params$Resource$Edits$Listings$Get,
  ): Promise<androidpublisher_v3.Schema$Listing> {
    var completed: { data: androidpublisher_v3.Schema$Listing };

    try {
      completed = await this.publisher.edits.listings.get(call);
    } catch (error) {
      throw googlePlayFailure('edits.listings.get', error);
    }

    return completed.data;
  }

  /**
   * Deletes a localized store listing.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/edits.listings/delete}
   */
  async deleteEditsListings(
    call: androidpublisher_v3.Params$Resource$Edits$Listings$Delete,
  ): Promise<void> {
    try {
      await this.publisher.edits.listings.delete(call);
    } catch (error) {
      throw googlePlayFailure('edits.listings.delete', error);
    }
  }

  /**
   * Lists all localized store listings.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/edits.listings/list}
   */
  async listEditsListings(
    call: androidpublisher_v3.Params$Resource$Edits$Listings$List,
  ): Promise<androidpublisher_v3.Schema$ListingsListResponse> {
    var completed: { data: androidpublisher_v3.Schema$ListingsListResponse };

    try {
      completed = await this.publisher.edits.listings.list(call);
    } catch (error) {
      throw googlePlayFailure('edits.listings.list', error);
    }

    return completed.data;
  }

  /**
   * Deletes the image (specified by id) from the edit.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/edits.images/delete}
   */
  async deleteEditsImages(
    call: androidpublisher_v3.Params$Resource$Edits$Images$Delete,
  ): Promise<void> {
    try {
      await this.publisher.edits.images.delete(call);
    } catch (error) {
      throw googlePlayFailure('edits.images.delete', error);
    }
  }

  /**
   * Lists all images.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/edits.images/list}
   */
  async listEditsImages(
    call: androidpublisher_v3.Params$Resource$Edits$Images$List,
  ): Promise<androidpublisher_v3.Schema$ImagesListResponse> {
    var completed: { data: androidpublisher_v3.Schema$ImagesListResponse };

    try {
      completed = await this.publisher.edits.images.list(call);
    } catch (error) {
      throw googlePlayFailure('edits.images.list', error);
    }

    return completed.data;
  }

  /**
   * Deletes all images for the specified language and image type.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/edits.images/deleteall}
   */
  async deleteallEditsImages(
    call: androidpublisher_v3.Params$Resource$Edits$Images$Deleteall,
  ): Promise<androidpublisher_v3.Schema$ImagesDeleteAllResponse> {
    var completed: { data: androidpublisher_v3.Schema$ImagesDeleteAllResponse };

    try {
      completed = await this.publisher.edits.images.deleteall(call);
    } catch (error) {
      throw googlePlayFailure('edits.images.deleteall', error);
    }

    return completed.data;
  }

  /**
   * Uploads an image of the specified language and image type, and adds to the edit.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/edits.images/upload}
   */
  async uploadEditsImages(
    call: androidpublisher_v3.Params$Resource$Edits$Images$Upload,
  ): Promise<androidpublisher_v3.Schema$ImagesUploadResponse> {
    var completed: { data: androidpublisher_v3.Schema$ImagesUploadResponse };

    try {
      completed = await this.publisher.edits.images.upload(call);
    } catch (error) {
      throw googlePlayFailure('edits.images.upload', error);
    }

    return completed.data;
  }

  /**
   * Uploads an APK and adds to the current edit.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/edits.apks/upload}
   */
  async uploadEditsApks(
    call: androidpublisher_v3.Params$Resource$Edits$Apks$Upload,
  ): Promise<androidpublisher_v3.Schema$Apk> {
    var completed: { data: androidpublisher_v3.Schema$Apk };

    try {
      completed = await this.publisher.edits.apks.upload(call);
    } catch (error) {
      throw googlePlayFailure('edits.apks.upload', error);
    }

    return completed.data;
  }

  /**
   * Creates a new APK without uploading the APK itself to Google Play, instead hosting the APK at a specified URL.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/edits.apks/addexternallyhosted}
   */
  async addexternallyhostedEditsApks(
    call: androidpublisher_v3.Params$Resource$Edits$Apks$Addexternallyhosted,
  ): Promise<androidpublisher_v3.Schema$ApksAddExternallyHostedResponse> {
    var completed: { data: androidpublisher_v3.Schema$ApksAddExternallyHostedResponse };

    try {
      completed = await this.publisher.edits.apks.addexternallyhosted(call);
    } catch (error) {
      throw googlePlayFailure('edits.apks.addexternallyhosted', error);
    }

    return completed.data;
  }

  /**
   * Lists all current APKs of the app and edit.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/edits.apks/list}
   */
  async listEditsApks(
    call: androidpublisher_v3.Params$Resource$Edits$Apks$List,
  ): Promise<androidpublisher_v3.Schema$ApksListResponse> {
    var completed: { data: androidpublisher_v3.Schema$ApksListResponse };

    try {
      completed = await this.publisher.edits.apks.list(call);
    } catch (error) {
      throw googlePlayFailure('edits.apks.list', error);
    }

    return completed.data;
  }

  /**
   * Uploads a new Android App Bundle to this edit.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/edits.bundles/upload}
   */
  async uploadEditsBundles(
    call: androidpublisher_v3.Params$Resource$Edits$Bundles$Upload,
  ): Promise<androidpublisher_v3.Schema$Bundle> {
    var completed: { data: androidpublisher_v3.Schema$Bundle };

    try {
      completed = await this.publisher.edits.bundles.upload(call);
    } catch (error) {
      throw googlePlayFailure('edits.bundles.upload', error);
    }

    return completed.data;
  }

  /**
   * Lists all current Android App Bundles of the app and edit.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/edits.bundles/list}
   */
  async listEditsBundles(
    call: androidpublisher_v3.Params$Resource$Edits$Bundles$List,
  ): Promise<androidpublisher_v3.Schema$BundlesListResponse> {
    var completed: { data: androidpublisher_v3.Schema$BundlesListResponse };

    try {
      completed = await this.publisher.edits.bundles.list(call);
    } catch (error) {
      throw googlePlayFailure('edits.bundles.list', error);
    }

    return completed.data;
  }

  /**
   * Uploads a new deobfuscation file and attaches to the specified APK.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/edits.deobfuscationfiles/upload}
   */
  async uploadEditsDeobfuscationfiles(
    call: androidpublisher_v3.Params$Resource$Edits$Deobfuscationfiles$Upload,
  ): Promise<androidpublisher_v3.Schema$DeobfuscationFilesUploadResponse> {
    var completed: { data: androidpublisher_v3.Schema$DeobfuscationFilesUploadResponse };

    try {
      completed = await this.publisher.edits.deobfuscationfiles.upload(call);
    } catch (error) {
      throw googlePlayFailure('edits.deobfuscationfiles.upload', error);
    }

    return completed.data;
  }

  /**
   * Gets country availability.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/edits.countryavailability/get}
   */
  async getEditsCountryavailability(
    call: androidpublisher_v3.Params$Resource$Edits$Countryavailability$Get,
  ): Promise<androidpublisher_v3.Schema$TrackCountryAvailability> {
    var completed: { data: androidpublisher_v3.Schema$TrackCountryAvailability };

    try {
      completed = await this.publisher.edits.countryavailability.get(call);
    } catch (error) {
      throw googlePlayFailure('edits.countryavailability.get', error);
    }

    return completed.data;
  }

  /**
   * Patches a track.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/edits.tracks/patch}
   */
  async patchEditsTracks(
    call: androidpublisher_v3.Params$Resource$Edits$Tracks$Patch,
  ): Promise<androidpublisher_v3.Schema$Track> {
    var completed: { data: androidpublisher_v3.Schema$Track };

    try {
      completed = await this.publisher.edits.tracks.patch(call);
    } catch (error) {
      throw googlePlayFailure('edits.tracks.patch', error);
    }

    return completed.data;
  }

  /**
   * Lists all tracks.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/edits.tracks/list}
   */
  async listEditsTracks(
    call: androidpublisher_v3.Params$Resource$Edits$Tracks$List,
  ): Promise<androidpublisher_v3.Schema$TracksListResponse> {
    var completed: { data: androidpublisher_v3.Schema$TracksListResponse };

    try {
      completed = await this.publisher.edits.tracks.list(call);
    } catch (error) {
      throw googlePlayFailure('edits.tracks.list', error);
    }

    return completed.data;
  }

  /**
   * Creates a new track.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/edits.tracks/create}
   */
  async createEditsTracks(
    call: androidpublisher_v3.Params$Resource$Edits$Tracks$Create,
  ): Promise<androidpublisher_v3.Schema$Track> {
    var completed: { data: androidpublisher_v3.Schema$Track };

    try {
      completed = await this.publisher.edits.tracks.create(call);
    } catch (error) {
      throw googlePlayFailure('edits.tracks.create', error);
    }

    return completed.data;
  }

  /**
   * Gets a track.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/edits.tracks/get}
   */
  async getEditsTracks(
    call: androidpublisher_v3.Params$Resource$Edits$Tracks$Get,
  ): Promise<androidpublisher_v3.Schema$Track> {
    var completed: { data: androidpublisher_v3.Schema$Track };

    try {
      completed = await this.publisher.edits.tracks.get(call);
    } catch (error) {
      throw googlePlayFailure('edits.tracks.get', error);
    }

    return completed.data;
  }

  /**
   * Updates a track.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/edits.tracks/update}
   */
  async updateEditsTracks(
    call: androidpublisher_v3.Params$Resource$Edits$Tracks$Update,
  ): Promise<androidpublisher_v3.Schema$Track> {
    var completed: { data: androidpublisher_v3.Schema$Track };

    try {
      completed = await this.publisher.edits.tracks.update(call);
    } catch (error) {
      throw googlePlayFailure('edits.tracks.update', error);
    }

    return completed.data;
  }

  /**
   * Updates the APK's expansion file configuration to reference another APK's expansion file.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/edits.expansionfiles/update}
   */
  async updateEditsExpansionfiles(
    call: androidpublisher_v3.Params$Resource$Edits$Expansionfiles$Update,
  ): Promise<androidpublisher_v3.Schema$ExpansionFile> {
    var completed: { data: androidpublisher_v3.Schema$ExpansionFile };

    try {
      completed = await this.publisher.edits.expansionfiles.update(call);
    } catch (error) {
      throw googlePlayFailure('edits.expansionfiles.update', error);
    }

    return completed.data;
  }

  /**
   * Uploads a new expansion file and attaches to the specified APK.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/edits.expansionfiles/upload}
   */
  async uploadEditsExpansionfiles(
    call: androidpublisher_v3.Params$Resource$Edits$Expansionfiles$Upload,
  ): Promise<androidpublisher_v3.Schema$ExpansionFilesUploadResponse> {
    var completed: { data: androidpublisher_v3.Schema$ExpansionFilesUploadResponse };

    try {
      completed = await this.publisher.edits.expansionfiles.upload(call);
    } catch (error) {
      throw googlePlayFailure('edits.expansionfiles.upload', error);
    }

    return completed.data;
  }

  /**
   * Patches the APK's expansion file configuration to reference another APK's expansion file.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/edits.expansionfiles/patch}
   */
  async patchEditsExpansionfiles(
    call: androidpublisher_v3.Params$Resource$Edits$Expansionfiles$Patch,
  ): Promise<androidpublisher_v3.Schema$ExpansionFile> {
    var completed: { data: androidpublisher_v3.Schema$ExpansionFile };

    try {
      completed = await this.publisher.edits.expansionfiles.patch(call);
    } catch (error) {
      throw googlePlayFailure('edits.expansionfiles.patch', error);
    }

    return completed.data;
  }

  /**
   * Fetches the expansion file configuration for the specified APK.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/edits.expansionfiles/get}
   */
  async getEditsExpansionfiles(
    call: androidpublisher_v3.Params$Resource$Edits$Expansionfiles$Get,
  ): Promise<androidpublisher_v3.Schema$ExpansionFile> {
    var completed: { data: androidpublisher_v3.Schema$ExpansionFile };

    try {
      completed = await this.publisher.edits.expansionfiles.get(call);
    } catch (error) {
      throw googlePlayFailure('edits.expansionfiles.get', error);
    }

    return completed.data;
  }

  /**
   * Patches details of an app.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/edits.details/patch}
   */
  async patchEditsDetails(
    call: androidpublisher_v3.Params$Resource$Edits$Details$Patch,
  ): Promise<androidpublisher_v3.Schema$AppDetails> {
    var completed: { data: androidpublisher_v3.Schema$AppDetails };

    try {
      completed = await this.publisher.edits.details.patch(call);
    } catch (error) {
      throw googlePlayFailure('edits.details.patch', error);
    }

    return completed.data;
  }

  /**
   * Gets details of an app.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/edits.details/get}
   */
  async getEditsDetails(
    call: androidpublisher_v3.Params$Resource$Edits$Details$Get,
  ): Promise<androidpublisher_v3.Schema$AppDetails> {
    var completed: { data: androidpublisher_v3.Schema$AppDetails };

    try {
      completed = await this.publisher.edits.details.get(call);
    } catch (error) {
      throw googlePlayFailure('edits.details.get', error);
    }

    return completed.data;
  }

  /**
   * Updates details of an app.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/edits.details/update}
   */
  async updateEditsDetails(
    call: androidpublisher_v3.Params$Resource$Edits$Details$Update,
  ): Promise<androidpublisher_v3.Schema$AppDetails> {
    var completed: { data: androidpublisher_v3.Schema$AppDetails };

    try {
      completed = await this.publisher.edits.details.update(call);
    } catch (error) {
      throw googlePlayFailure('edits.details.update', error);
    }

    return completed.data;
  }

  /**
   * Get metadata about a subscription.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptionsv2/get}
   */
  async getPurchasesSubscriptionsv2(
    call: androidpublisher_v3.Params$Resource$Purchases$Subscriptionsv2$Get,
  ): Promise<androidpublisher_v3.Schema$SubscriptionPurchaseV2> {
    var completed: { data: androidpublisher_v3.Schema$SubscriptionPurchaseV2 };

    try {
      completed = await this.publisher.purchases.subscriptionsv2.get(call);
    } catch (error) {
      throw googlePlayFailure('purchases.subscriptionsv2.get', error);
    }

    return completed.data;
  }

  /**
   * Revoke a subscription purchase for the user.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptionsv2/revoke}
   */
  async revokePurchasesSubscriptionsv2(
    call: androidpublisher_v3.Params$Resource$Purchases$Subscriptionsv2$Revoke,
  ): Promise<androidpublisher_v3.Schema$RevokeSubscriptionPurchaseResponse> {
    var completed: { data: androidpublisher_v3.Schema$RevokeSubscriptionPurchaseResponse };

    try {
      completed = await this.publisher.purchases.subscriptionsv2.revoke(call);
    } catch (error) {
      throw googlePlayFailure('purchases.subscriptionsv2.revoke', error);
    }

    return completed.data;
  }

  /**
   * Defers the renewal of a subscription.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptionsv2/defer}
   */
  async deferPurchasesSubscriptionsv2(
    call: androidpublisher_v3.Params$Resource$Purchases$Subscriptionsv2$Defer,
  ): Promise<androidpublisher_v3.Schema$DeferSubscriptionPurchaseResponse> {
    var completed: { data: androidpublisher_v3.Schema$DeferSubscriptionPurchaseResponse };

    try {
      completed = await this.publisher.purchases.subscriptionsv2.defer(call);
    } catch (error) {
      throw googlePlayFailure('purchases.subscriptionsv2.defer', error);
    }

    return completed.data;
  }

  /**
   * Cancel a subscription purchase for the user.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptionsv2/cancel}
   */
  async cancelPurchasesSubscriptionsv2(
    call: androidpublisher_v3.Params$Resource$Purchases$Subscriptionsv2$Cancel,
  ): Promise<androidpublisher_v3.Schema$CancelSubscriptionPurchaseResponse> {
    var completed: { data: androidpublisher_v3.Schema$CancelSubscriptionPurchaseResponse };

    try {
      completed = await this.publisher.purchases.subscriptionsv2.cancel(call);
    } catch (error) {
      throw googlePlayFailure('purchases.subscriptionsv2.cancel', error);
    }

    return completed.data;
  }

  /**
   * Checks the purchase and consumption status of an inapp item.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.productsv2/getproductpurchasev2}
   */
  async getproductpurchasev2PurchasesProductsv2(
    call: androidpublisher_v3.Params$Resource$Purchases$Productsv2$Getproductpurchasev2,
  ): Promise<androidpublisher_v3.Schema$ProductPurchaseV2> {
    var completed: { data: androidpublisher_v3.Schema$ProductPurchaseV2 };

    try {
      completed = await this.publisher.purchases.productsv2.getproductpurchasev2(call);
    } catch (error) {
      throw googlePlayFailure('purchases.productsv2.getproductpurchasev2', error);
    }

    return completed.data;
  }

  /**
   * Acknowledges a subscription purchase.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptions/acknowledge}
   */
  async acknowledgePurchasesSubscriptions(
    call: androidpublisher_v3.Params$Resource$Purchases$Subscriptions$Acknowledge,
  ): Promise<void> {
    try {
      await this.publisher.purchases.subscriptions.acknowledge(call);
    } catch (error) {
      throw googlePlayFailure('purchases.subscriptions.acknowledge', error);
    }
  }

  /**
   * Deprecated: Use purchases.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptions/cancel}
   */
  async cancelPurchasesSubscriptions(
    call: androidpublisher_v3.Params$Resource$Purchases$Subscriptions$Cancel,
  ): Promise<void> {
    try {
      await this.publisher.purchases.subscriptions.cancel(call);
    } catch (error) {
      throw googlePlayFailure('purchases.subscriptions.cancel', error);
    }
  }

  /**
   * Deprecated: Use purchases.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptions/defer}
   */
  async deferPurchasesSubscriptions(
    call: androidpublisher_v3.Params$Resource$Purchases$Subscriptions$Defer,
  ): Promise<androidpublisher_v3.Schema$SubscriptionPurchasesDeferResponse> {
    var completed: { data: androidpublisher_v3.Schema$SubscriptionPurchasesDeferResponse };

    try {
      completed = await this.publisher.purchases.subscriptions.defer(call);
    } catch (error) {
      throw googlePlayFailure('purchases.subscriptions.defer', error);
    }

    return completed.data;
  }

  /**
   * Lists the purchases that were canceled, refunded or charged-back.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.voidedpurchases/list}
   */
  async listPurchasesVoidedpurchases(
    call: androidpublisher_v3.Params$Resource$Purchases$Voidedpurchases$List,
  ): Promise<androidpublisher_v3.Schema$VoidedPurchasesListResponse> {
    var completed: { data: androidpublisher_v3.Schema$VoidedPurchasesListResponse };

    try {
      completed = await this.publisher.purchases.voidedpurchases.list(call);
    } catch (error) {
      throw googlePlayFailure('purchases.voidedpurchases.list', error);
    }

    return completed.data;
  }

  /**
   * Acknowledges a purchase of an inapp item.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.products/acknowledge}
   */
  async acknowledgePurchasesProducts(
    call: androidpublisher_v3.Params$Resource$Purchases$Products$Acknowledge,
  ): Promise<void> {
    try {
      await this.publisher.purchases.products.acknowledge(call);
    } catch (error) {
      throw googlePlayFailure('purchases.products.acknowledge', error);
    }
  }

  /**
   * Checks the purchase and consumption status of an inapp item.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.products/get}
   */
  async getPurchasesProducts(
    call: androidpublisher_v3.Params$Resource$Purchases$Products$Get,
  ): Promise<androidpublisher_v3.Schema$ProductPurchase> {
    var completed: { data: androidpublisher_v3.Schema$ProductPurchase };

    try {
      completed = await this.publisher.purchases.products.get(call);
    } catch (error) {
      throw googlePlayFailure('purchases.products.get', error);
    }

    return completed.data;
  }

  /**
   * Consumes a purchase for an inapp item.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.products/consume}
   */
  async consumePurchasesProducts(
    call: androidpublisher_v3.Params$Resource$Purchases$Products$Consume,
  ): Promise<void> {
    try {
      await this.publisher.purchases.products.consume(call);
    } catch (error) {
      throw googlePlayFailure('purchases.products.consume', error);
    }
  }
}
