// Generated from the Android Publisher v3 Discovery document.
// Reproduce: pnpm gen:api
// The installed official client does not declare these Discovery methods yet:
// - purchases.subscriptionsv2.scheduleplantransition
// - purchases.subscriptionsv2.deactivateoffertargeting
// - purchases.subscriptionsv2.activateoffertargeting
// - purchases.subscriptionsv2.cancelplantransition

import {
  androidpublisher,
  auth as androidPublisherAuth,
  type androidpublisher_v3,
} from '@googleapis/androidpublisher';
import { Effect } from 'effect';
import type { ServiceAccount } from '../core/types/credentials.js';
import {
  googleFailureMessage,
  googleFailureStatus,
  makeGooglePlayApiError,
  serviceAccountJwtOptions,
  type GooglePlayApiError,
} from './playClient.js';

const PLAY_SCOPE = 'https://www.googleapis.com/auth/androidpublisher';

type PlayPublisher = ReturnType<typeof androidpublisher>;

const isPlayPublisher = (
  generatedPublisher: PlayPublisher | undefined,
): generatedPublisher is PlayPublisher => {
  return generatedPublisher != null;
};

const isHttpStatus = (statusCode: number | undefined): statusCode is number => {
  return typeof statusCode === 'number';
};

const playFailure = (operation: string, cause: unknown): GooglePlayApiError => {
  const statusCode = googleFailureStatus(cause);
  const message = `Google Play ${operation} failed: ${googleFailureMessage(cause)}`;

  if (isHttpStatus(statusCode)) {
    return makeGooglePlayApiError({ operation, statusCode, message, cause });
  }

  return makeGooglePlayApiError({ operation, message, cause });
};

const runPlayCall = <PlayShape>(
  operation: string,
  invoke: () => PromiseLike<{ data: PlayShape }>,
): Effect.Effect<PlayShape, GooglePlayApiError> => {
  return Effect.tryPromise({
    try: invoke,
    catch: (cause) => playFailure(operation, cause),
  }).pipe(Effect.map((completed) => completed.data));
};

/** Every Android Publisher v3 method, on Google's official client. */
export class GooglePlayApi {
  private readonly publisher: PlayPublisher;

  constructor(account: ServiceAccount, generatedPublisher?: PlayPublisher) {
    if (isPlayPublisher(generatedPublisher)) {
      this.publisher = generatedPublisher;
      return;
    }

    const googleAuthentication = new androidPublisherAuth.JWT(
      serviceAccountJwtOptions(account, [PLAY_SCOPE]),
    );
    this.publisher = androidpublisher({ version: 'v3', auth: googleAuthentication });
  }

  /**
   * Writes the Safety Labels declaration of an app.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/applications/dataSafety}
   */
  dataSafetyApplications(
    parameters: androidpublisher_v3.Params$Resource$Applications$Datasafety,
  ): Effect.Effect<androidpublisher_v3.Schema$SafetyLabelsUpdateResponse, GooglePlayApiError> {
    return runPlayCall('applications.dataSafety', () =>
      this.publisher.applications.dataSafety(parameters),
    );
  }

  /**
   * Returns the list of all releases for a given track.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/applications.tracks.releases/list}
   */
  listApplicationsTracksReleases(
    parameters: androidpublisher_v3.Params$Resource$Applications$Tracks$Releases$List,
  ): Effect.Effect<androidpublisher_v3.Schema$ListReleaseSummariesResponse, GooglePlayApiError> {
    return runPlayCall('applications.tracks.releases.list', () =>
      this.publisher.applications.tracks.releases.list(parameters),
    );
  }

  /**
   * Creates a new device tier config for an app.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/applications.deviceTierConfigs/create}
   */
  createApplicationsDeviceTierConfigs(
    parameters: androidpublisher_v3.Params$Resource$Applications$Devicetierconfigs$Create,
  ): Effect.Effect<androidpublisher_v3.Schema$DeviceTierConfig, GooglePlayApiError> {
    return runPlayCall('applications.deviceTierConfigs.create', () =>
      this.publisher.applications.deviceTierConfigs.create(parameters),
    );
  }

  /**
   * Returns a particular device tier config.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/applications.deviceTierConfigs/get}
   */
  getApplicationsDeviceTierConfigs(
    parameters: androidpublisher_v3.Params$Resource$Applications$Devicetierconfigs$Get,
  ): Effect.Effect<androidpublisher_v3.Schema$DeviceTierConfig, GooglePlayApiError> {
    return runPlayCall('applications.deviceTierConfigs.get', () =>
      this.publisher.applications.deviceTierConfigs.get(parameters),
    );
  }

  /**
   * Returns created device tier configs, ordered by descending creation time.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/applications.deviceTierConfigs/list}
   */
  listApplicationsDeviceTierConfigs(
    parameters: androidpublisher_v3.Params$Resource$Applications$Devicetierconfigs$List,
  ): Effect.Effect<androidpublisher_v3.Schema$ListDeviceTierConfigsResponse, GooglePlayApiError> {
    return runPlayCall('applications.deviceTierConfigs.list', () =>
      this.publisher.applications.deviceTierConfigs.list(parameters),
    );
  }

  /**
   * Uploads an APK to internal app sharing.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/internalappsharingartifacts/uploadapk}
   */
  uploadapkInternalappsharingartifacts(
    parameters: androidpublisher_v3.Params$Resource$Internalappsharingartifacts$Uploadapk,
  ): Effect.Effect<androidpublisher_v3.Schema$InternalAppSharingArtifact, GooglePlayApiError> {
    return runPlayCall('internalappsharingartifacts.uploadapk', () =>
      this.publisher.internalappsharingartifacts.uploadapk(parameters),
    );
  }

  /**
   * Uploads an app bundle to internal app sharing.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/internalappsharingartifacts/uploadbundle}
   */
  uploadbundleInternalappsharingartifacts(
    parameters: androidpublisher_v3.Params$Resource$Internalappsharingartifacts$Uploadbundle,
  ): Effect.Effect<androidpublisher_v3.Schema$InternalAppSharingArtifact, GooglePlayApiError> {
    return runPlayCall('internalappsharingartifacts.uploadbundle', () =>
      this.publisher.internalappsharingartifacts.uploadbundle(parameters),
    );
  }

  /**
   * Lists the purchases that were canceled, refunded or charged-back.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.voidedpurchases/list}
   */
  listPurchasesVoidedpurchases(
    parameters: androidpublisher_v3.Params$Resource$Purchases$Voidedpurchases$List,
  ): Effect.Effect<androidpublisher_v3.Schema$VoidedPurchasesListResponse, GooglePlayApiError> {
    return runPlayCall('purchases.voidedpurchases.list', () =>
      this.publisher.purchases.voidedpurchases.list(parameters),
    );
  }

  /**
   * Deprecated: Use purchases.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptions/defer}
   */
  deferPurchasesSubscriptions(
    parameters: androidpublisher_v3.Params$Resource$Purchases$Subscriptions$Defer,
  ): Effect.Effect<
    androidpublisher_v3.Schema$SubscriptionPurchasesDeferResponse,
    GooglePlayApiError
  > {
    return runPlayCall('purchases.subscriptions.defer', () =>
      this.publisher.purchases.subscriptions.defer(parameters),
    );
  }

  /**
   * Deprecated: Use purchases.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptions/cancel}
   */
  cancelPurchasesSubscriptions(
    parameters: androidpublisher_v3.Params$Resource$Purchases$Subscriptions$Cancel,
  ): Effect.Effect<void, GooglePlayApiError> {
    return runPlayCall('purchases.subscriptions.cancel', () =>
      this.publisher.purchases.subscriptions.cancel(parameters),
    ).pipe(Effect.asVoid);
  }

  /**
   * Acknowledges a subscription purchase.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptions/acknowledge}
   */
  acknowledgePurchasesSubscriptions(
    parameters: androidpublisher_v3.Params$Resource$Purchases$Subscriptions$Acknowledge,
  ): Effect.Effect<void, GooglePlayApiError> {
    return runPlayCall('purchases.subscriptions.acknowledge', () =>
      this.publisher.purchases.subscriptions.acknowledge(parameters),
    ).pipe(Effect.asVoid);
  }

  /**
   * Checks the purchase and consumption status of an inapp item.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.products/get}
   */
  getPurchasesProducts(
    parameters: androidpublisher_v3.Params$Resource$Purchases$Products$Get,
  ): Effect.Effect<androidpublisher_v3.Schema$ProductPurchase, GooglePlayApiError> {
    return runPlayCall('purchases.products.get', () =>
      this.publisher.purchases.products.get(parameters),
    );
  }

  /**
   * Consumes a purchase for an inapp item.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.products/consume}
   */
  consumePurchasesProducts(
    parameters: androidpublisher_v3.Params$Resource$Purchases$Products$Consume,
  ): Effect.Effect<void, GooglePlayApiError> {
    return runPlayCall('purchases.products.consume', () =>
      this.publisher.purchases.products.consume(parameters),
    ).pipe(Effect.asVoid);
  }

  /**
   * Acknowledges a purchase of an inapp item.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.products/acknowledge}
   */
  acknowledgePurchasesProducts(
    parameters: androidpublisher_v3.Params$Resource$Purchases$Products$Acknowledge,
  ): Effect.Effect<void, GooglePlayApiError> {
    return runPlayCall('purchases.products.acknowledge', () =>
      this.publisher.purchases.products.acknowledge(parameters),
    ).pipe(Effect.asVoid);
  }

  /**
   * Checks the purchase and consumption status of an inapp item.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.productsv2/getproductpurchasev2}
   */
  getproductpurchasev2PurchasesProductsv2(
    parameters: androidpublisher_v3.Params$Resource$Purchases$Productsv2$Getproductpurchasev2,
  ): Effect.Effect<androidpublisher_v3.Schema$ProductPurchaseV2, GooglePlayApiError> {
    return runPlayCall('purchases.productsv2.getproductpurchasev2', () =>
      this.publisher.purchases.productsv2.getproductpurchasev2(parameters),
    );
  }

  /**
   * Revoke a subscription purchase for the user.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptionsv2/revoke}
   */
  revokePurchasesSubscriptionsv2(
    parameters: androidpublisher_v3.Params$Resource$Purchases$Subscriptionsv2$Revoke,
  ): Effect.Effect<
    androidpublisher_v3.Schema$RevokeSubscriptionPurchaseResponse,
    GooglePlayApiError
  > {
    return runPlayCall('purchases.subscriptionsv2.revoke', () =>
      this.publisher.purchases.subscriptionsv2.revoke(parameters),
    );
  }

  /**
   * Cancel a subscription purchase for the user.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptionsv2/cancel}
   */
  cancelPurchasesSubscriptionsv2(
    parameters: androidpublisher_v3.Params$Resource$Purchases$Subscriptionsv2$Cancel,
  ): Effect.Effect<
    androidpublisher_v3.Schema$CancelSubscriptionPurchaseResponse,
    GooglePlayApiError
  > {
    return runPlayCall('purchases.subscriptionsv2.cancel', () =>
      this.publisher.purchases.subscriptionsv2.cancel(parameters),
    );
  }

  /**
   * Defers the renewal of a subscription.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptionsv2/defer}
   */
  deferPurchasesSubscriptionsv2(
    parameters: androidpublisher_v3.Params$Resource$Purchases$Subscriptionsv2$Defer,
  ): Effect.Effect<
    androidpublisher_v3.Schema$DeferSubscriptionPurchaseResponse,
    GooglePlayApiError
  > {
    return runPlayCall('purchases.subscriptionsv2.defer', () =>
      this.publisher.purchases.subscriptionsv2.defer(parameters),
    );
  }

  /**
   * Get metadata about a subscription.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptionsv2/get}
   */
  getPurchasesSubscriptionsv2(
    parameters: androidpublisher_v3.Params$Resource$Purchases$Subscriptionsv2$Get,
  ): Effect.Effect<androidpublisher_v3.Schema$SubscriptionPurchaseV2, GooglePlayApiError> {
    return runPlayCall('purchases.subscriptionsv2.get', () =>
      this.publisher.purchases.subscriptionsv2.get(parameters),
    );
  }

  /**
   * Removes all access for the user to the given developer account.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/users/delete}
   */
  deleteUsers(
    parameters: androidpublisher_v3.Params$Resource$Users$Delete,
  ): Effect.Effect<void, GooglePlayApiError> {
    return runPlayCall('users.delete', () => this.publisher.users.delete(parameters)).pipe(
      Effect.asVoid,
    );
  }

  /**
   * Grant access for a user to the given developer account.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/users/create}
   */
  createUsers(
    parameters: androidpublisher_v3.Params$Resource$Users$Create,
  ): Effect.Effect<androidpublisher_v3.Schema$User, GooglePlayApiError> {
    return runPlayCall('users.create', () => this.publisher.users.create(parameters));
  }

  /**
   * Lists all users with access to a developer account.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/users/list}
   */
  listUsers(
    parameters: androidpublisher_v3.Params$Resource$Users$List,
  ): Effect.Effect<androidpublisher_v3.Schema$ListUsersResponse, GooglePlayApiError> {
    return runPlayCall('users.list', () => this.publisher.users.list(parameters));
  }

  /**
   * Updates access for the user to the developer account.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/users/patch}
   */
  patchUsers(
    parameters: androidpublisher_v3.Params$Resource$Users$Patch,
  ): Effect.Effect<androidpublisher_v3.Schema$User, GooglePlayApiError> {
    return runPlayCall('users.patch', () => this.publisher.users.patch(parameters));
  }

  /**
   * Downloads a previously created system APK which is suitable for inclusion in a system image.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/systemapks.variants/download}
   */
  downloadSystemapksVariants(
    parameters: androidpublisher_v3.Params$Resource$Systemapks$Variants$Download,
  ): Effect.Effect<unknown, GooglePlayApiError> {
    return runPlayCall('systemapks.variants.download', () =>
      this.publisher.systemapks.variants.download(parameters),
    );
  }

  /**
   * Returns the list of previously created system APK variants.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/systemapks.variants/list}
   */
  listSystemapksVariants(
    parameters: androidpublisher_v3.Params$Resource$Systemapks$Variants$List,
  ): Effect.Effect<androidpublisher_v3.Schema$SystemApksListResponse, GooglePlayApiError> {
    return runPlayCall('systemapks.variants.list', () =>
      this.publisher.systemapks.variants.list(parameters),
    );
  }

  /**
   * Creates an APK which is suitable for inclusion in a system image from an already uploaded Android App Bundle.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/systemapks.variants/create}
   */
  createSystemapksVariants(
    parameters: androidpublisher_v3.Params$Resource$Systemapks$Variants$Create,
  ): Effect.Effect<androidpublisher_v3.Schema$Variant, GooglePlayApiError> {
    return runPlayCall('systemapks.variants.create', () =>
      this.publisher.systemapks.variants.create(parameters),
    );
  }

  /**
   * Returns a previously created system APK variant.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/systemapks.variants/get}
   */
  getSystemapksVariants(
    parameters: androidpublisher_v3.Params$Resource$Systemapks$Variants$Get,
  ): Effect.Effect<androidpublisher_v3.Schema$Variant, GooglePlayApiError> {
    return runPlayCall('systemapks.variants.get', () =>
      this.publisher.systemapks.variants.get(parameters),
    );
  }

  /**
   * Upload a screenshot or app icon for the hosted app.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/appstoreappsreview/uploadimage}
   */
  uploadimageAppstoreappsreview(
    parameters: androidpublisher_v3.Params$Resource$Appstoreappsreview$Uploadimage,
  ): Effect.Effect<androidpublisher_v3.Schema$UploadImageResponse, GooglePlayApiError> {
    return runPlayCall('appstoreappsreview.uploadimage', () =>
      this.publisher.appstoreappsreview.uploadimage(parameters),
    );
  }

  /**
   * Upload an APK file for the hosted app.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/appstoreappsreview/uploadapk}
   */
  uploadapkAppstoreappsreview(
    parameters: androidpublisher_v3.Params$Resource$Appstoreappsreview$Uploadapk,
  ): Effect.Effect<androidpublisher_v3.Schema$UploadApkResponse, GooglePlayApiError> {
    return runPlayCall('appstoreappsreview.uploadapk', () =>
      this.publisher.appstoreappsreview.uploadapk(parameters),
    );
  }

  /**
   * Upload a policy declaration file for the hosted app.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/appstoreappsreview/uploadappstoreapppolicydeclarationfile}
   */
  uploadappstoreapppolicydeclarationfileAppstoreappsreview(
    parameters: androidpublisher_v3.Params$Resource$Appstoreappsreview$Uploadappstoreapppolicydeclarationfile,
  ): Effect.Effect<
    androidpublisher_v3.Schema$UploadAppStoreAppPolicyDeclarationFileResponse,
    GooglePlayApiError
  > {
    return runPlayCall('appstoreappsreview.uploadappstoreapppolicydeclarationfile', () =>
      this.publisher.appstoreappsreview.uploadappstoreapppolicydeclarationfile(parameters),
    );
  }

  /**
   * Updates details for an app hosted on an app store.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/appstoreappsreview/updateappstorehostedapp}
   */
  updateappstorehostedappAppstoreappsreview(
    parameters: androidpublisher_v3.Params$Resource$Appstoreappsreview$Updateappstorehostedapp,
  ): Effect.Effect<androidpublisher_v3.Schema$UpdateAppStoreHostedAppResponse, GooglePlayApiError> {
    return runPlayCall('appstoreappsreview.updateappstorehostedapp', () =>
      this.publisher.appstoreappsreview.updateappstorehostedapp(parameters),
    );
  }

  /**
   * Updates the publish status of an app store hosted app.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/appstoreappsreview/updateappstorehostedapppublishstatus}
   */
  updateappstorehostedapppublishstatusAppstoreappsreview(
    parameters: androidpublisher_v3.Params$Resource$Appstoreappsreview$Updateappstorehostedapppublishstatus,
  ): Effect.Effect<
    androidpublisher_v3.Schema$UpdateAppStoreHostedAppPublishStatusResponse,
    GooglePlayApiError
  > {
    return runPlayCall('appstoreappsreview.updateappstorehostedapppublishstatus', () =>
      this.publisher.appstoreappsreview.updateappstorehostedapppublishstatus(parameters),
    );
  }

  /**
   * Creates an app store hosted app.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/appstoreappsreview/createappstorehostedapp}
   */
  createappstorehostedappAppstoreappsreview(
    parameters: androidpublisher_v3.Params$Resource$Appstoreappsreview$Createappstorehostedapp,
  ): Effect.Effect<androidpublisher_v3.Schema$CreateAppStoreHostedAppResponse, GooglePlayApiError> {
    return runPlayCall('appstoreappsreview.createappstorehostedapp', () =>
      this.publisher.appstoreappsreview.createappstorehostedapp(parameters),
    );
  }

  /**
   * Rotates an app's signing key to a new self-hosted Google Cloud KMS key.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/appsigning/rotateAppSigningKey}
   */
  rotateAppSigningKeyAppsigning(
    parameters: androidpublisher_v3.Params$Resource$Appsigning$Rotateappsigningkey,
  ): Effect.Effect<androidpublisher_v3.Schema$RotateAppSigningKeyResponse, GooglePlayApiError> {
    return runPlayCall('appsigning.rotateAppSigningKey', () =>
      this.publisher.appsigning.rotateAppSigningKey(parameters),
    );
  }

  /**
   * Enrolls an app in Play App Signing using a self-hosted Google Cloud KMS key.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/appsigning/enrollApp}
   */
  enrollAppAppsigning(
    parameters: androidpublisher_v3.Params$Resource$Appsigning$Enrollapp,
  ): Effect.Effect<androidpublisher_v3.Schema$EnrollAppResponse, GooglePlayApiError> {
    return runPlayCall('appsigning.enrollApp', () =>
      this.publisher.appsigning.enrollApp(parameters),
    );
  }

  /**
   * Creates a new external transaction.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/externaltransactions/createexternaltransaction}
   */
  createexternaltransactionExternaltransactions(
    parameters: androidpublisher_v3.Params$Resource$Externaltransactions$Createexternaltransaction,
  ): Effect.Effect<androidpublisher_v3.Schema$ExternalTransaction, GooglePlayApiError> {
    return runPlayCall('externaltransactions.createexternaltransaction', () =>
      this.publisher.externaltransactions.createexternaltransaction(parameters),
    );
  }

  /**
   * Refunds or partially refunds an existing external transaction.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/externaltransactions/refundexternaltransaction}
   */
  refundexternaltransactionExternaltransactions(
    parameters: androidpublisher_v3.Params$Resource$Externaltransactions$Refundexternaltransaction,
  ): Effect.Effect<androidpublisher_v3.Schema$ExternalTransaction, GooglePlayApiError> {
    return runPlayCall('externaltransactions.refundexternaltransaction', () =>
      this.publisher.externaltransactions.refundexternaltransaction(parameters),
    );
  }

  /**
   * Gets an existing external transaction.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/externaltransactions/getexternaltransaction}
   */
  getexternaltransactionExternaltransactions(
    parameters: androidpublisher_v3.Params$Resource$Externaltransactions$Getexternaltransaction,
  ): Effect.Effect<androidpublisher_v3.Schema$ExternalTransaction, GooglePlayApiError> {
    return runPlayCall('externaltransactions.getexternaltransaction', () =>
      this.publisher.externaltransactions.getexternaltransaction(parameters),
    );
  }

  /**
   * Get order details for a single order.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/orders/get}
   */
  getOrders(
    parameters: androidpublisher_v3.Params$Resource$Orders$Get,
  ): Effect.Effect<androidpublisher_v3.Schema$Order, GooglePlayApiError> {
    return runPlayCall('orders.get', () => this.publisher.orders.get(parameters));
  }

  /**
   * Refunds a user's subscription or in-app purchase order.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/orders/refund}
   */
  refundOrders(
    parameters: androidpublisher_v3.Params$Resource$Orders$Refund,
  ): Effect.Effect<void, GooglePlayApiError> {
    return runPlayCall('orders.refund', () => this.publisher.orders.refund(parameters)).pipe(
      Effect.asVoid,
    );
  }

  /**
   * Get order details for a list of orders.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/orders/batchget}
   */
  batchgetOrders(
    parameters: androidpublisher_v3.Params$Resource$Orders$Batchget,
  ): Effect.Effect<androidpublisher_v3.Schema$BatchGetOrdersResponse, GooglePlayApiError> {
    return runPlayCall('orders.batchget', () => this.publisher.orders.batchget(parameters));
  }

  /**
   * Provide refund preference and purchase usage for a chargeback request.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/orders/reviewrefund}
   */
  reviewrefundOrders(
    parameters: androidpublisher_v3.Params$Resource$Orders$Reviewrefund,
  ): Effect.Effect<void, GooglePlayApiError> {
    return runPlayCall('orders.reviewrefund', () =>
      this.publisher.orders.reviewrefund(parameters),
    ).pipe(Effect.asVoid);
  }

  /**
   * Deletes an in-app product (a managed product or a subscription).
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/inappproducts/delete}
   */
  deleteInappproducts(
    parameters: androidpublisher_v3.Params$Resource$Inappproducts$Delete,
  ): Effect.Effect<void, GooglePlayApiError> {
    return runPlayCall('inappproducts.delete', () =>
      this.publisher.inappproducts.delete(parameters),
    ).pipe(Effect.asVoid);
  }

  /**
   * Deletes in-app products (managed products or subscriptions).
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/inappproducts/batchDelete}
   */
  batchDeleteInappproducts(
    parameters: androidpublisher_v3.Params$Resource$Inappproducts$Batchdelete,
  ): Effect.Effect<void, GooglePlayApiError> {
    return runPlayCall('inappproducts.batchDelete', () =>
      this.publisher.inappproducts.batchDelete(parameters),
    ).pipe(Effect.asVoid);
  }

  /**
   * Updates an in-app product (a managed product or a subscription).
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/inappproducts/update}
   */
  updateInappproducts(
    parameters: androidpublisher_v3.Params$Resource$Inappproducts$Update,
  ): Effect.Effect<androidpublisher_v3.Schema$InAppProduct, GooglePlayApiError> {
    return runPlayCall('inappproducts.update', () =>
      this.publisher.inappproducts.update(parameters),
    );
  }

  /**
   * Updates or inserts one or more in-app products (managed products or subscriptions).
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/inappproducts/batchUpdate}
   */
  batchUpdateInappproducts(
    parameters: androidpublisher_v3.Params$Resource$Inappproducts$Batchupdate,
  ): Effect.Effect<
    androidpublisher_v3.Schema$InappproductsBatchUpdateResponse,
    GooglePlayApiError
  > {
    return runPlayCall('inappproducts.batchUpdate', () =>
      this.publisher.inappproducts.batchUpdate(parameters),
    );
  }

  /**
   * Reads multiple in-app products, which can be managed products or subscriptions.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/inappproducts/batchGet}
   */
  batchGetInappproducts(
    parameters: androidpublisher_v3.Params$Resource$Inappproducts$Batchget,
  ): Effect.Effect<androidpublisher_v3.Schema$InappproductsBatchGetResponse, GooglePlayApiError> {
    return runPlayCall('inappproducts.batchGet', () =>
      this.publisher.inappproducts.batchGet(parameters),
    );
  }

  /**
   * Patches an in-app product (a managed product or a subscription).
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/inappproducts/patch}
   */
  patchInappproducts(
    parameters: androidpublisher_v3.Params$Resource$Inappproducts$Patch,
  ): Effect.Effect<androidpublisher_v3.Schema$InAppProduct, GooglePlayApiError> {
    return runPlayCall('inappproducts.patch', () => this.publisher.inappproducts.patch(parameters));
  }

  /**
   * Gets an in-app product, which can be a managed product or a subscription.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/inappproducts/get}
   */
  getInappproducts(
    parameters: androidpublisher_v3.Params$Resource$Inappproducts$Get,
  ): Effect.Effect<androidpublisher_v3.Schema$InAppProduct, GooglePlayApiError> {
    return runPlayCall('inappproducts.get', () => this.publisher.inappproducts.get(parameters));
  }

  /**
   * Lists all in-app products - both managed products and subscriptions.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/inappproducts/list}
   */
  listInappproducts(
    parameters: androidpublisher_v3.Params$Resource$Inappproducts$List,
  ): Effect.Effect<androidpublisher_v3.Schema$InappproductsListResponse, GooglePlayApiError> {
    return runPlayCall('inappproducts.list', () => this.publisher.inappproducts.list(parameters));
  }

  /**
   * Creates an in-app product (a managed product or a subscription).
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/inappproducts/insert}
   */
  insertInappproducts(
    parameters: androidpublisher_v3.Params$Resource$Inappproducts$Insert,
  ): Effect.Effect<androidpublisher_v3.Schema$InAppProduct, GooglePlayApiError> {
    return runPlayCall('inappproducts.insert', () =>
      this.publisher.inappproducts.insert(parameters),
    );
  }

  /**
   * Removes all access for the user to the given package or developer account.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/grants/delete}
   */
  deleteGrants(
    parameters: androidpublisher_v3.Params$Resource$Grants$Delete,
  ): Effect.Effect<void, GooglePlayApiError> {
    return runPlayCall('grants.delete', () => this.publisher.grants.delete(parameters)).pipe(
      Effect.asVoid,
    );
  }

  /**
   * Grant access for a user to the given package.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/grants/create}
   */
  createGrants(
    parameters: androidpublisher_v3.Params$Resource$Grants$Create,
  ): Effect.Effect<androidpublisher_v3.Schema$Grant, GooglePlayApiError> {
    return runPlayCall('grants.create', () => this.publisher.grants.create(parameters));
  }

  /**
   * Updates access for the user to the given package.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/grants/patch}
   */
  patchGrants(
    parameters: androidpublisher_v3.Params$Resource$Grants$Patch,
  ): Effect.Effect<androidpublisher_v3.Schema$Grant, GooglePlayApiError> {
    return runPlayCall('grants.patch', () => this.publisher.grants.patch(parameters));
  }

  /**
   * Lists update events for eligible apps in the given time range.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/appstorecatalog.recentupdateevents/list}
   */
  listAppstorecatalogRecentupdateevents(
    parameters: androidpublisher_v3.Params$Resource$Appstorecatalog$Recentupdateevents$List,
  ): Effect.Effect<androidpublisher_v3.Schema$ListRecentUpdateEventsResponse, GooglePlayApiError> {
    return runPlayCall('appstorecatalog.recentupdateevents.list', () =>
      this.publisher.appstorecatalog.recentupdateevents.list(parameters),
    );
  }

  /**
   * Returns metadata about a recently updated app.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/appstorecatalog.recentappviews/get}
   */
  getAppstorecatalogRecentappviews(
    parameters: androidpublisher_v3.Params$Resource$Appstorecatalog$Recentappviews$Get,
  ): Effect.Effect<androidpublisher_v3.Schema$RecentAppView, GooglePlayApiError> {
    return runPlayCall('appstorecatalog.recentappviews.get', () =>
      this.publisher.appstorecatalog.recentappviews.get(parameters),
    );
  }

  /**
   * Create an app recovery action with recovery status as DRAFT.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/apprecovery/create}
   */
  createApprecovery(
    parameters: androidpublisher_v3.Params$Resource$Apprecovery$Create,
  ): Effect.Effect<androidpublisher_v3.Schema$AppRecoveryAction, GooglePlayApiError> {
    return runPlayCall('apprecovery.create', () => this.publisher.apprecovery.create(parameters));
  }

  /**
   * Deploy an already created app recovery action with recovery status DRAFT.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/apprecovery/deploy}
   */
  deployApprecovery(
    parameters: androidpublisher_v3.Params$Resource$Apprecovery$Deploy,
  ): Effect.Effect<androidpublisher_v3.Schema$DeployAppRecoveryResponse, GooglePlayApiError> {
    return runPlayCall('apprecovery.deploy', () => this.publisher.apprecovery.deploy(parameters));
  }

  /**
   * Incrementally update targeting for a recovery action.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/apprecovery/addTargeting}
   */
  addTargetingApprecovery(
    parameters: androidpublisher_v3.Params$Resource$Apprecovery$Addtargeting,
  ): Effect.Effect<androidpublisher_v3.Schema$AddTargetingResponse, GooglePlayApiError> {
    return runPlayCall('apprecovery.addTargeting', () =>
      this.publisher.apprecovery.addTargeting(parameters),
    );
  }

  /**
   * Cancel an already executing app recovery action.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/apprecovery/cancel}
   */
  cancelApprecovery(
    parameters: androidpublisher_v3.Params$Resource$Apprecovery$Cancel,
  ): Effect.Effect<androidpublisher_v3.Schema$CancelAppRecoveryResponse, GooglePlayApiError> {
    return runPlayCall('apprecovery.cancel', () => this.publisher.apprecovery.cancel(parameters));
  }

  /**
   * List all app recovery action resources associated with a particular package name and app version.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/apprecovery/list}
   */
  listApprecovery(
    parameters: androidpublisher_v3.Params$Resource$Apprecovery$List,
  ): Effect.Effect<androidpublisher_v3.Schema$ListAppRecoveriesResponse, GooglePlayApiError> {
    return runPlayCall('apprecovery.list', () => this.publisher.apprecovery.list(parameters));
  }

  /**
   * Gets a single review.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/reviews/get}
   */
  getReviews(
    parameters: androidpublisher_v3.Params$Resource$Reviews$Get,
  ): Effect.Effect<androidpublisher_v3.Schema$Review, GooglePlayApiError> {
    return runPlayCall('reviews.get', () => this.publisher.reviews.get(parameters));
  }

  /**
   * Lists all reviews.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/reviews/list}
   */
  listReviews(
    parameters: androidpublisher_v3.Params$Resource$Reviews$List,
  ): Effect.Effect<androidpublisher_v3.Schema$ReviewsListResponse, GooglePlayApiError> {
    return runPlayCall('reviews.list', () => this.publisher.reviews.list(parameters));
  }

  /**
   * Replies to a single review, or updates an existing reply.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/reviews/reply}
   */
  replyReviews(
    parameters: androidpublisher_v3.Params$Resource$Reviews$Reply,
  ): Effect.Effect<androidpublisher_v3.Schema$ReviewsReplyResponse, GooglePlayApiError> {
    return runPlayCall('reviews.reply', () => this.publisher.reviews.reply(parameters));
  }

  /**
   * Returns download metadata for all APKs that were generated from a given app bundle.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/generatedapks/list}
   */
  listGeneratedapks(
    parameters: androidpublisher_v3.Params$Resource$Generatedapks$List,
  ): Effect.Effect<androidpublisher_v3.Schema$GeneratedApksListResponse, GooglePlayApiError> {
    return runPlayCall('generatedapks.list', () => this.publisher.generatedapks.list(parameters));
  }

  /**
   * Downloads a single signed APK generated from an app bundle.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/generatedapks/download}
   */
  downloadGeneratedapks(
    parameters: androidpublisher_v3.Params$Resource$Generatedapks$Download,
  ): Effect.Effect<unknown, GooglePlayApiError> {
    return runPlayCall('generatedapks.download', () =>
      this.publisher.generatedapks.download(parameters),
    );
  }

  /**
   * Gets an app edit.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/edits/get}
   */
  getEdits(
    parameters: androidpublisher_v3.Params$Resource$Edits$Get,
  ): Effect.Effect<androidpublisher_v3.Schema$AppEdit, GooglePlayApiError> {
    return runPlayCall('edits.get', () => this.publisher.edits.get(parameters));
  }

  /**
   * Deletes an app edit.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/edits/delete}
   */
  deleteEdits(
    parameters: androidpublisher_v3.Params$Resource$Edits$Delete,
  ): Effect.Effect<void, GooglePlayApiError> {
    return runPlayCall('edits.delete', () => this.publisher.edits.delete(parameters)).pipe(
      Effect.asVoid,
    );
  }

  /**
   * Validates an app edit.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/edits/validate}
   */
  validateEdits(
    parameters: androidpublisher_v3.Params$Resource$Edits$Validate,
  ): Effect.Effect<androidpublisher_v3.Schema$AppEdit, GooglePlayApiError> {
    return runPlayCall('edits.validate', () => this.publisher.edits.validate(parameters));
  }

  /**
   * Creates a new edit for an app.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/edits/insert}
   */
  insertEdits(
    parameters: androidpublisher_v3.Params$Resource$Edits$Insert,
  ): Effect.Effect<androidpublisher_v3.Schema$AppEdit, GooglePlayApiError> {
    return runPlayCall('edits.insert', () => this.publisher.edits.insert(parameters));
  }

  /**
   * Commits an app edit.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/edits/commit}
   */
  commitEdits(
    parameters: androidpublisher_v3.Params$Resource$Edits$Commit,
  ): Effect.Effect<androidpublisher_v3.Schema$AppEdit, GooglePlayApiError> {
    return runPlayCall('edits.commit', () => this.publisher.edits.commit(parameters));
  }

  /**
   * Deletes the image (specified by id) from the edit.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/edits.images/delete}
   */
  deleteEditsImages(
    parameters: androidpublisher_v3.Params$Resource$Edits$Images$Delete,
  ): Effect.Effect<void, GooglePlayApiError> {
    return runPlayCall('edits.images.delete', () =>
      this.publisher.edits.images.delete(parameters),
    ).pipe(Effect.asVoid);
  }

  /**
   * Lists all images.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/edits.images/list}
   */
  listEditsImages(
    parameters: androidpublisher_v3.Params$Resource$Edits$Images$List,
  ): Effect.Effect<androidpublisher_v3.Schema$ImagesListResponse, GooglePlayApiError> {
    return runPlayCall('edits.images.list', () => this.publisher.edits.images.list(parameters));
  }

  /**
   * Uploads an image of the specified language and image type, and adds to the edit.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/edits.images/upload}
   */
  uploadEditsImages(
    parameters: androidpublisher_v3.Params$Resource$Edits$Images$Upload,
  ): Effect.Effect<androidpublisher_v3.Schema$ImagesUploadResponse, GooglePlayApiError> {
    return runPlayCall('edits.images.upload', () => this.publisher.edits.images.upload(parameters));
  }

  /**
   * Deletes all images for the specified language and image type.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/edits.images/deleteall}
   */
  deleteallEditsImages(
    parameters: androidpublisher_v3.Params$Resource$Edits$Images$Deleteall,
  ): Effect.Effect<androidpublisher_v3.Schema$ImagesDeleteAllResponse, GooglePlayApiError> {
    return runPlayCall('edits.images.deleteall', () =>
      this.publisher.edits.images.deleteall(parameters),
    );
  }

  /**
   * Patches the APK's expansion file configuration to reference another APK's expansion file.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/edits.expansionfiles/patch}
   */
  patchEditsExpansionfiles(
    parameters: androidpublisher_v3.Params$Resource$Edits$Expansionfiles$Patch,
  ): Effect.Effect<androidpublisher_v3.Schema$ExpansionFile, GooglePlayApiError> {
    return runPlayCall('edits.expansionfiles.patch', () =>
      this.publisher.edits.expansionfiles.patch(parameters),
    );
  }

  /**
   * Uploads a new expansion file and attaches to the specified APK.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/edits.expansionfiles/upload}
   */
  uploadEditsExpansionfiles(
    parameters: androidpublisher_v3.Params$Resource$Edits$Expansionfiles$Upload,
  ): Effect.Effect<androidpublisher_v3.Schema$ExpansionFilesUploadResponse, GooglePlayApiError> {
    return runPlayCall('edits.expansionfiles.upload', () =>
      this.publisher.edits.expansionfiles.upload(parameters),
    );
  }

  /**
   * Fetches the expansion file configuration for the specified APK.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/edits.expansionfiles/get}
   */
  getEditsExpansionfiles(
    parameters: androidpublisher_v3.Params$Resource$Edits$Expansionfiles$Get,
  ): Effect.Effect<androidpublisher_v3.Schema$ExpansionFile, GooglePlayApiError> {
    return runPlayCall('edits.expansionfiles.get', () =>
      this.publisher.edits.expansionfiles.get(parameters),
    );
  }

  /**
   * Updates the APK's expansion file configuration to reference another APK's expansion file.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/edits.expansionfiles/update}
   */
  updateEditsExpansionfiles(
    parameters: androidpublisher_v3.Params$Resource$Edits$Expansionfiles$Update,
  ): Effect.Effect<androidpublisher_v3.Schema$ExpansionFile, GooglePlayApiError> {
    return runPlayCall('edits.expansionfiles.update', () =>
      this.publisher.edits.expansionfiles.update(parameters),
    );
  }

  /**
   * Gets details of an app.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/edits.details/get}
   */
  getEditsDetails(
    parameters: androidpublisher_v3.Params$Resource$Edits$Details$Get,
  ): Effect.Effect<androidpublisher_v3.Schema$AppDetails, GooglePlayApiError> {
    return runPlayCall('edits.details.get', () => this.publisher.edits.details.get(parameters));
  }

  /**
   * Updates details of an app.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/edits.details/update}
   */
  updateEditsDetails(
    parameters: androidpublisher_v3.Params$Resource$Edits$Details$Update,
  ): Effect.Effect<androidpublisher_v3.Schema$AppDetails, GooglePlayApiError> {
    return runPlayCall('edits.details.update', () =>
      this.publisher.edits.details.update(parameters),
    );
  }

  /**
   * Patches details of an app.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/edits.details/patch}
   */
  patchEditsDetails(
    parameters: androidpublisher_v3.Params$Resource$Edits$Details$Patch,
  ): Effect.Effect<androidpublisher_v3.Schema$AppDetails, GooglePlayApiError> {
    return runPlayCall('edits.details.patch', () => this.publisher.edits.details.patch(parameters));
  }

  /**
   * Updates testers.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/edits.testers/update}
   */
  updateEditsTesters(
    parameters: androidpublisher_v3.Params$Resource$Edits$Testers$Update,
  ): Effect.Effect<androidpublisher_v3.Schema$Testers, GooglePlayApiError> {
    return runPlayCall('edits.testers.update', () =>
      this.publisher.edits.testers.update(parameters),
    );
  }

  /**
   * Gets testers.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/edits.testers/get}
   */
  getEditsTesters(
    parameters: androidpublisher_v3.Params$Resource$Edits$Testers$Get,
  ): Effect.Effect<androidpublisher_v3.Schema$Testers, GooglePlayApiError> {
    return runPlayCall('edits.testers.get', () => this.publisher.edits.testers.get(parameters));
  }

  /**
   * Patches testers.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/edits.testers/patch}
   */
  patchEditsTesters(
    parameters: androidpublisher_v3.Params$Resource$Edits$Testers$Patch,
  ): Effect.Effect<androidpublisher_v3.Schema$Testers, GooglePlayApiError> {
    return runPlayCall('edits.testers.patch', () => this.publisher.edits.testers.patch(parameters));
  }

  /**
   * Lists all current Android App Bundles of the app and edit.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/edits.bundles/list}
   */
  listEditsBundles(
    parameters: androidpublisher_v3.Params$Resource$Edits$Bundles$List,
  ): Effect.Effect<androidpublisher_v3.Schema$BundlesListResponse, GooglePlayApiError> {
    return runPlayCall('edits.bundles.list', () => this.publisher.edits.bundles.list(parameters));
  }

  /**
   * Uploads a new Android App Bundle to this edit.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/edits.bundles/upload}
   */
  uploadEditsBundles(
    parameters: androidpublisher_v3.Params$Resource$Edits$Bundles$Upload,
  ): Effect.Effect<androidpublisher_v3.Schema$Bundle, GooglePlayApiError> {
    return runPlayCall('edits.bundles.upload', () =>
      this.publisher.edits.bundles.upload(parameters),
    );
  }

  /**
   * Creates a new APK without uploading the APK itself to Google Play, instead hosting the APK at a specified URL.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/edits.apks/addexternallyhosted}
   */
  addexternallyhostedEditsApks(
    parameters: androidpublisher_v3.Params$Resource$Edits$Apks$Addexternallyhosted,
  ): Effect.Effect<androidpublisher_v3.Schema$ApksAddExternallyHostedResponse, GooglePlayApiError> {
    return runPlayCall('edits.apks.addexternallyhosted', () =>
      this.publisher.edits.apks.addexternallyhosted(parameters),
    );
  }

  /**
   * Uploads an APK and adds to the current edit.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/edits.apks/upload}
   */
  uploadEditsApks(
    parameters: androidpublisher_v3.Params$Resource$Edits$Apks$Upload,
  ): Effect.Effect<androidpublisher_v3.Schema$Apk, GooglePlayApiError> {
    return runPlayCall('edits.apks.upload', () => this.publisher.edits.apks.upload(parameters));
  }

  /**
   * Lists all current APKs of the app and edit.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/edits.apks/list}
   */
  listEditsApks(
    parameters: androidpublisher_v3.Params$Resource$Edits$Apks$List,
  ): Effect.Effect<androidpublisher_v3.Schema$ApksListResponse, GooglePlayApiError> {
    return runPlayCall('edits.apks.list', () => this.publisher.edits.apks.list(parameters));
  }

  /**
   * Gets country availability.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/edits.countryavailability/get}
   */
  getEditsCountryavailability(
    parameters: androidpublisher_v3.Params$Resource$Edits$Countryavailability$Get,
  ): Effect.Effect<androidpublisher_v3.Schema$TrackCountryAvailability, GooglePlayApiError> {
    return runPlayCall('edits.countryavailability.get', () =>
      this.publisher.edits.countryavailability.get(parameters),
    );
  }

  /**
   * Deletes a localized store listing.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/edits.listings/delete}
   */
  deleteEditsListings(
    parameters: androidpublisher_v3.Params$Resource$Edits$Listings$Delete,
  ): Effect.Effect<void, GooglePlayApiError> {
    return runPlayCall('edits.listings.delete', () =>
      this.publisher.edits.listings.delete(parameters),
    ).pipe(Effect.asVoid);
  }

  /**
   * Patches a localized store listing.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/edits.listings/patch}
   */
  patchEditsListings(
    parameters: androidpublisher_v3.Params$Resource$Edits$Listings$Patch,
  ): Effect.Effect<androidpublisher_v3.Schema$Listing, GooglePlayApiError> {
    return runPlayCall('edits.listings.patch', () =>
      this.publisher.edits.listings.patch(parameters),
    );
  }

  /**
   * Deletes all store listings.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/edits.listings/deleteall}
   */
  deleteallEditsListings(
    parameters: androidpublisher_v3.Params$Resource$Edits$Listings$Deleteall,
  ): Effect.Effect<void, GooglePlayApiError> {
    return runPlayCall('edits.listings.deleteall', () =>
      this.publisher.edits.listings.deleteall(parameters),
    ).pipe(Effect.asVoid);
  }

  /**
   * Lists all localized store listings.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/edits.listings/list}
   */
  listEditsListings(
    parameters: androidpublisher_v3.Params$Resource$Edits$Listings$List,
  ): Effect.Effect<androidpublisher_v3.Schema$ListingsListResponse, GooglePlayApiError> {
    return runPlayCall('edits.listings.list', () => this.publisher.edits.listings.list(parameters));
  }

  /**
   * Creates or updates a localized store listing.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/edits.listings/update}
   */
  updateEditsListings(
    parameters: androidpublisher_v3.Params$Resource$Edits$Listings$Update,
  ): Effect.Effect<androidpublisher_v3.Schema$Listing, GooglePlayApiError> {
    return runPlayCall('edits.listings.update', () =>
      this.publisher.edits.listings.update(parameters),
    );
  }

  /**
   * Gets a localized store listing.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/edits.listings/get}
   */
  getEditsListings(
    parameters: androidpublisher_v3.Params$Resource$Edits$Listings$Get,
  ): Effect.Effect<androidpublisher_v3.Schema$Listing, GooglePlayApiError> {
    return runPlayCall('edits.listings.get', () => this.publisher.edits.listings.get(parameters));
  }

  /**
   * Gets a track.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/edits.tracks/get}
   */
  getEditsTracks(
    parameters: androidpublisher_v3.Params$Resource$Edits$Tracks$Get,
  ): Effect.Effect<androidpublisher_v3.Schema$Track, GooglePlayApiError> {
    return runPlayCall('edits.tracks.get', () => this.publisher.edits.tracks.get(parameters));
  }

  /**
   * Lists all tracks.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/edits.tracks/list}
   */
  listEditsTracks(
    parameters: androidpublisher_v3.Params$Resource$Edits$Tracks$List,
  ): Effect.Effect<androidpublisher_v3.Schema$TracksListResponse, GooglePlayApiError> {
    return runPlayCall('edits.tracks.list', () => this.publisher.edits.tracks.list(parameters));
  }

  /**
   * Patches a track.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/edits.tracks/patch}
   */
  patchEditsTracks(
    parameters: androidpublisher_v3.Params$Resource$Edits$Tracks$Patch,
  ): Effect.Effect<androidpublisher_v3.Schema$Track, GooglePlayApiError> {
    return runPlayCall('edits.tracks.patch', () => this.publisher.edits.tracks.patch(parameters));
  }

  /**
   * Updates a track.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/edits.tracks/update}
   */
  updateEditsTracks(
    parameters: androidpublisher_v3.Params$Resource$Edits$Tracks$Update,
  ): Effect.Effect<androidpublisher_v3.Schema$Track, GooglePlayApiError> {
    return runPlayCall('edits.tracks.update', () => this.publisher.edits.tracks.update(parameters));
  }

  /**
   * Creates a new track.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/edits.tracks/create}
   */
  createEditsTracks(
    parameters: androidpublisher_v3.Params$Resource$Edits$Tracks$Create,
  ): Effect.Effect<androidpublisher_v3.Schema$Track, GooglePlayApiError> {
    return runPlayCall('edits.tracks.create', () => this.publisher.edits.tracks.create(parameters));
  }

  /**
   * Uploads a new deobfuscation file and attaches to the specified APK.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/edits.deobfuscationfiles/upload}
   */
  uploadEditsDeobfuscationfiles(
    parameters: androidpublisher_v3.Params$Resource$Edits$Deobfuscationfiles$Upload,
  ): Effect.Effect<
    androidpublisher_v3.Schema$DeobfuscationFilesUploadResponse,
    GooglePlayApiError
  > {
    return runPlayCall('edits.deobfuscationfiles.upload', () =>
      this.publisher.edits.deobfuscationfiles.upload(parameters),
    );
  }

  /**
   * Calculates the region prices, using today's exchange rate and country-specific pricing patterns, based on the price in the request for a set of regions.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization/convertRegionPrices}
   */
  convertRegionPricesMonetization(
    parameters: androidpublisher_v3.Params$Resource$Monetization$Convertregionprices,
  ): Effect.Effect<androidpublisher_v3.Schema$ConvertRegionPricesResponse, GooglePlayApiError> {
    return runPlayCall('monetization.convertRegionPrices', () =>
      this.publisher.monetization.convertRegionPrices(parameters),
    );
  }

  /**
   * Reads one or more subscriptions.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.subscriptions/batchGet}
   */
  batchGetMonetizationSubscriptions(
    parameters: androidpublisher_v3.Params$Resource$Monetization$Subscriptions$Batchget,
  ): Effect.Effect<androidpublisher_v3.Schema$BatchGetSubscriptionsResponse, GooglePlayApiError> {
    return runPlayCall('monetization.subscriptions.batchGet', () =>
      this.publisher.monetization.subscriptions.batchGet(parameters),
    );
  }

  /**
   * Reads a single subscription.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.subscriptions/get}
   */
  getMonetizationSubscriptions(
    parameters: androidpublisher_v3.Params$Resource$Monetization$Subscriptions$Get,
  ): Effect.Effect<androidpublisher_v3.Schema$Subscription, GooglePlayApiError> {
    return runPlayCall('monetization.subscriptions.get', () =>
      this.publisher.monetization.subscriptions.get(parameters),
    );
  }

  /**
   * Deprecated: subscription archiving is not supported.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.subscriptions/archive}
   */
  archiveMonetizationSubscriptions(
    parameters: androidpublisher_v3.Params$Resource$Monetization$Subscriptions$Archive,
  ): Effect.Effect<androidpublisher_v3.Schema$Subscription, GooglePlayApiError> {
    return runPlayCall('monetization.subscriptions.archive', () =>
      this.publisher.monetization.subscriptions.archive(parameters),
    );
  }

  /**
   * Deletes a subscription.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.subscriptions/delete}
   */
  deleteMonetizationSubscriptions(
    parameters: androidpublisher_v3.Params$Resource$Monetization$Subscriptions$Delete,
  ): Effect.Effect<void, GooglePlayApiError> {
    return runPlayCall('monetization.subscriptions.delete', () =>
      this.publisher.monetization.subscriptions.delete(parameters),
    ).pipe(Effect.asVoid);
  }

  /**
   * Updates a batch of subscriptions.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.subscriptions/batchUpdate}
   */
  batchUpdateMonetizationSubscriptions(
    parameters: androidpublisher_v3.Params$Resource$Monetization$Subscriptions$Batchupdate,
  ): Effect.Effect<
    androidpublisher_v3.Schema$BatchUpdateSubscriptionsResponse,
    GooglePlayApiError
  > {
    return runPlayCall('monetization.subscriptions.batchUpdate', () =>
      this.publisher.monetization.subscriptions.batchUpdate(parameters),
    );
  }

  /**
   * Updates an existing subscription.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.subscriptions/patch}
   */
  patchMonetizationSubscriptions(
    parameters: androidpublisher_v3.Params$Resource$Monetization$Subscriptions$Patch,
  ): Effect.Effect<androidpublisher_v3.Schema$Subscription, GooglePlayApiError> {
    return runPlayCall('monetization.subscriptions.patch', () =>
      this.publisher.monetization.subscriptions.patch(parameters),
    );
  }

  /**
   * Creates a new subscription.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.subscriptions/create}
   */
  createMonetizationSubscriptions(
    parameters: androidpublisher_v3.Params$Resource$Monetization$Subscriptions$Create,
  ): Effect.Effect<androidpublisher_v3.Schema$Subscription, GooglePlayApiError> {
    return runPlayCall('monetization.subscriptions.create', () =>
      this.publisher.monetization.subscriptions.create(parameters),
    );
  }

  /**
   * Lists all subscriptions under a given app.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.subscriptions/list}
   */
  listMonetizationSubscriptions(
    parameters: androidpublisher_v3.Params$Resource$Monetization$Subscriptions$List,
  ): Effect.Effect<androidpublisher_v3.Schema$ListSubscriptionsResponse, GooglePlayApiError> {
    return runPlayCall('monetization.subscriptions.list', () =>
      this.publisher.monetization.subscriptions.list(parameters),
    );
  }

  /**
   * Deletes a base plan.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.subscriptions.basePlans/delete}
   */
  deleteMonetizationSubscriptionsBasePlans(
    parameters: androidpublisher_v3.Params$Resource$Monetization$Subscriptions$Baseplans$Delete,
  ): Effect.Effect<void, GooglePlayApiError> {
    return runPlayCall('monetization.subscriptions.basePlans.delete', () =>
      this.publisher.monetization.subscriptions.basePlans.delete(parameters),
    ).pipe(Effect.asVoid);
  }

  /**
   * Activates or deactivates base plans across one or multiple subscriptions.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.subscriptions.basePlans/batchUpdateStates}
   */
  batchUpdateStatesMonetizationSubscriptionsBasePlans(
    parameters: androidpublisher_v3.Params$Resource$Monetization$Subscriptions$Baseplans$Batchupdatestates,
  ): Effect.Effect<
    androidpublisher_v3.Schema$BatchUpdateBasePlanStatesResponse,
    GooglePlayApiError
  > {
    return runPlayCall('monetization.subscriptions.basePlans.batchUpdateStates', () =>
      this.publisher.monetization.subscriptions.basePlans.batchUpdateStates(parameters),
    );
  }

  /**
   * Batch variant of the MigrateBasePlanPrices endpoint.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.subscriptions.basePlans/batchMigratePrices}
   */
  batchMigratePricesMonetizationSubscriptionsBasePlans(
    parameters: androidpublisher_v3.Params$Resource$Monetization$Subscriptions$Baseplans$Batchmigrateprices,
  ): Effect.Effect<
    androidpublisher_v3.Schema$BatchMigrateBasePlanPricesResponse,
    GooglePlayApiError
  > {
    return runPlayCall('monetization.subscriptions.basePlans.batchMigratePrices', () =>
      this.publisher.monetization.subscriptions.basePlans.batchMigratePrices(parameters),
    );
  }

  /**
   * Migrates subscribers from one or more legacy price cohorts to the current price.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.subscriptions.basePlans/migratePrices}
   */
  migratePricesMonetizationSubscriptionsBasePlans(
    parameters: androidpublisher_v3.Params$Resource$Monetization$Subscriptions$Baseplans$Migrateprices,
  ): Effect.Effect<androidpublisher_v3.Schema$MigrateBasePlanPricesResponse, GooglePlayApiError> {
    return runPlayCall('monetization.subscriptions.basePlans.migratePrices', () =>
      this.publisher.monetization.subscriptions.basePlans.migratePrices(parameters),
    );
  }

  /**
   * Deactivates a base plan.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.subscriptions.basePlans/deactivate}
   */
  deactivateMonetizationSubscriptionsBasePlans(
    parameters: androidpublisher_v3.Params$Resource$Monetization$Subscriptions$Baseplans$Deactivate,
  ): Effect.Effect<androidpublisher_v3.Schema$Subscription, GooglePlayApiError> {
    return runPlayCall('monetization.subscriptions.basePlans.deactivate', () =>
      this.publisher.monetization.subscriptions.basePlans.deactivate(parameters),
    );
  }

  /**
   * Activates a base plan.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.subscriptions.basePlans/activate}
   */
  activateMonetizationSubscriptionsBasePlans(
    parameters: androidpublisher_v3.Params$Resource$Monetization$Subscriptions$Baseplans$Activate,
  ): Effect.Effect<androidpublisher_v3.Schema$Subscription, GooglePlayApiError> {
    return runPlayCall('monetization.subscriptions.basePlans.activate', () =>
      this.publisher.monetization.subscriptions.basePlans.activate(parameters),
    );
  }

  /**
   * Updates a batch of subscription offer states.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.subscriptions.basePlans.offers/batchUpdateStates}
   */
  batchUpdateStatesMonetizationSubscriptionsBasePlansOffers(
    parameters: androidpublisher_v3.Params$Resource$Monetization$Subscriptions$Baseplans$Offers$Batchupdatestates,
  ): Effect.Effect<
    androidpublisher_v3.Schema$BatchUpdateSubscriptionOfferStatesResponse,
    GooglePlayApiError
  > {
    return runPlayCall('monetization.subscriptions.basePlans.offers.batchUpdateStates', () =>
      this.publisher.monetization.subscriptions.basePlans.offers.batchUpdateStates(parameters),
    );
  }

  /**
   * Updates an existing subscription offer.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.subscriptions.basePlans.offers/patch}
   */
  patchMonetizationSubscriptionsBasePlansOffers(
    parameters: androidpublisher_v3.Params$Resource$Monetization$Subscriptions$Baseplans$Offers$Patch,
  ): Effect.Effect<androidpublisher_v3.Schema$SubscriptionOffer, GooglePlayApiError> {
    return runPlayCall('monetization.subscriptions.basePlans.offers.patch', () =>
      this.publisher.monetization.subscriptions.basePlans.offers.patch(parameters),
    );
  }

  /**
   * Deletes a subscription offer.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.subscriptions.basePlans.offers/delete}
   */
  deleteMonetizationSubscriptionsBasePlansOffers(
    parameters: androidpublisher_v3.Params$Resource$Monetization$Subscriptions$Baseplans$Offers$Delete,
  ): Effect.Effect<void, GooglePlayApiError> {
    return runPlayCall('monetization.subscriptions.basePlans.offers.delete', () =>
      this.publisher.monetization.subscriptions.basePlans.offers.delete(parameters),
    ).pipe(Effect.asVoid);
  }

  /**
   * Updates a batch of subscription offers.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.subscriptions.basePlans.offers/batchUpdate}
   */
  batchUpdateMonetizationSubscriptionsBasePlansOffers(
    parameters: androidpublisher_v3.Params$Resource$Monetization$Subscriptions$Baseplans$Offers$Batchupdate,
  ): Effect.Effect<
    androidpublisher_v3.Schema$BatchUpdateSubscriptionOffersResponse,
    GooglePlayApiError
  > {
    return runPlayCall('monetization.subscriptions.basePlans.offers.batchUpdate', () =>
      this.publisher.monetization.subscriptions.basePlans.offers.batchUpdate(parameters),
    );
  }

  /**
   * Deactivates a subscription offer.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.subscriptions.basePlans.offers/deactivate}
   */
  deactivateMonetizationSubscriptionsBasePlansOffers(
    parameters: androidpublisher_v3.Params$Resource$Monetization$Subscriptions$Baseplans$Offers$Deactivate,
  ): Effect.Effect<androidpublisher_v3.Schema$SubscriptionOffer, GooglePlayApiError> {
    return runPlayCall('monetization.subscriptions.basePlans.offers.deactivate', () =>
      this.publisher.monetization.subscriptions.basePlans.offers.deactivate(parameters),
    );
  }

  /**
   * Creates a new subscription offer.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.subscriptions.basePlans.offers/create}
   */
  createMonetizationSubscriptionsBasePlansOffers(
    parameters: androidpublisher_v3.Params$Resource$Monetization$Subscriptions$Baseplans$Offers$Create,
  ): Effect.Effect<androidpublisher_v3.Schema$SubscriptionOffer, GooglePlayApiError> {
    return runPlayCall('monetization.subscriptions.basePlans.offers.create', () =>
      this.publisher.monetization.subscriptions.basePlans.offers.create(parameters),
    );
  }

  /**
   * Activates a subscription offer.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.subscriptions.basePlans.offers/activate}
   */
  activateMonetizationSubscriptionsBasePlansOffers(
    parameters: androidpublisher_v3.Params$Resource$Monetization$Subscriptions$Baseplans$Offers$Activate,
  ): Effect.Effect<androidpublisher_v3.Schema$SubscriptionOffer, GooglePlayApiError> {
    return runPlayCall('monetization.subscriptions.basePlans.offers.activate', () =>
      this.publisher.monetization.subscriptions.basePlans.offers.activate(parameters),
    );
  }

  /**
   * Reads one or more subscription offers.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.subscriptions.basePlans.offers/batchGet}
   */
  batchGetMonetizationSubscriptionsBasePlansOffers(
    parameters: androidpublisher_v3.Params$Resource$Monetization$Subscriptions$Baseplans$Offers$Batchget,
  ): Effect.Effect<
    androidpublisher_v3.Schema$BatchGetSubscriptionOffersResponse,
    GooglePlayApiError
  > {
    return runPlayCall('monetization.subscriptions.basePlans.offers.batchGet', () =>
      this.publisher.monetization.subscriptions.basePlans.offers.batchGet(parameters),
    );
  }

  /**
   * Lists all offers under a given subscription.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.subscriptions.basePlans.offers/list}
   */
  listMonetizationSubscriptionsBasePlansOffers(
    parameters: androidpublisher_v3.Params$Resource$Monetization$Subscriptions$Baseplans$Offers$List,
  ): Effect.Effect<androidpublisher_v3.Schema$ListSubscriptionOffersResponse, GooglePlayApiError> {
    return runPlayCall('monetization.subscriptions.basePlans.offers.list', () =>
      this.publisher.monetization.subscriptions.basePlans.offers.list(parameters),
    );
  }

  /**
   * Reads a single offer.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.subscriptions.basePlans.offers/get}
   */
  getMonetizationSubscriptionsBasePlansOffers(
    parameters: androidpublisher_v3.Params$Resource$Monetization$Subscriptions$Baseplans$Offers$Get,
  ): Effect.Effect<androidpublisher_v3.Schema$SubscriptionOffer, GooglePlayApiError> {
    return runPlayCall('monetization.subscriptions.basePlans.offers.get', () =>
      this.publisher.monetization.subscriptions.basePlans.offers.get(parameters),
    );
  }

  /**
   * Reads one or more one-time products.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.onetimeproducts/batchGet}
   */
  batchGetMonetizationOnetimeproducts(
    parameters: androidpublisher_v3.Params$Resource$Monetization$Onetimeproducts$Batchget,
  ): Effect.Effect<androidpublisher_v3.Schema$BatchGetOneTimeProductsResponse, GooglePlayApiError> {
    return runPlayCall('monetization.onetimeproducts.batchGet', () =>
      this.publisher.monetization.onetimeproducts.batchGet(parameters),
    );
  }

  /**
   * Reads a single one-time product.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.onetimeproducts/get}
   */
  getMonetizationOnetimeproducts(
    parameters: androidpublisher_v3.Params$Resource$Monetization$Onetimeproducts$Get,
  ): Effect.Effect<androidpublisher_v3.Schema$OneTimeProduct, GooglePlayApiError> {
    return runPlayCall('monetization.onetimeproducts.get', () =>
      this.publisher.monetization.onetimeproducts.get(parameters),
    );
  }

  /**
   * Deletes one or more one-time products.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.onetimeproducts/batchDelete}
   */
  batchDeleteMonetizationOnetimeproducts(
    parameters: androidpublisher_v3.Params$Resource$Monetization$Onetimeproducts$Batchdelete,
  ): Effect.Effect<void, GooglePlayApiError> {
    return runPlayCall('monetization.onetimeproducts.batchDelete', () =>
      this.publisher.monetization.onetimeproducts.batchDelete(parameters),
    ).pipe(Effect.asVoid);
  }

  /**
   * Lists all one-time products under a given app.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.onetimeproducts/list}
   */
  listMonetizationOnetimeproducts(
    parameters: androidpublisher_v3.Params$Resource$Monetization$Onetimeproducts$List,
  ): Effect.Effect<androidpublisher_v3.Schema$ListOneTimeProductsResponse, GooglePlayApiError> {
    return runPlayCall('monetization.onetimeproducts.list', () =>
      this.publisher.monetization.onetimeproducts.list(parameters),
    );
  }

  /**
   * Creates or updates one or more one-time products.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.onetimeproducts/batchUpdate}
   */
  batchUpdateMonetizationOnetimeproducts(
    parameters: androidpublisher_v3.Params$Resource$Monetization$Onetimeproducts$Batchupdate,
  ): Effect.Effect<
    androidpublisher_v3.Schema$BatchUpdateOneTimeProductsResponse,
    GooglePlayApiError
  > {
    return runPlayCall('monetization.onetimeproducts.batchUpdate', () =>
      this.publisher.monetization.onetimeproducts.batchUpdate(parameters),
    );
  }

  /**
   * Creates or updates a one-time product.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.onetimeproducts/patch}
   */
  patchMonetizationOnetimeproducts(
    parameters: androidpublisher_v3.Params$Resource$Monetization$Onetimeproducts$Patch,
  ): Effect.Effect<androidpublisher_v3.Schema$OneTimeProduct, GooglePlayApiError> {
    return runPlayCall('monetization.onetimeproducts.patch', () =>
      this.publisher.monetization.onetimeproducts.patch(parameters),
    );
  }

  /**
   * Deletes a one-time product.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.onetimeproducts/delete}
   */
  deleteMonetizationOnetimeproducts(
    parameters: androidpublisher_v3.Params$Resource$Monetization$Onetimeproducts$Delete,
  ): Effect.Effect<void, GooglePlayApiError> {
    return runPlayCall('monetization.onetimeproducts.delete', () =>
      this.publisher.monetization.onetimeproducts.delete(parameters),
    ).pipe(Effect.asVoid);
  }

  /**
   * Activates or deactivates purchase options across one or multiple one-time products.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.onetimeproducts.purchaseOptions/batchUpdateStates}
   */
  batchUpdateStatesMonetizationOnetimeproductsPurchaseOptions(
    parameters: androidpublisher_v3.Params$Resource$Monetization$Onetimeproducts$Purchaseoptions$Batchupdatestates,
  ): Effect.Effect<
    androidpublisher_v3.Schema$BatchUpdatePurchaseOptionStatesResponse,
    GooglePlayApiError
  > {
    return runPlayCall('monetization.onetimeproducts.purchaseOptions.batchUpdateStates', () =>
      this.publisher.monetization.onetimeproducts.purchaseOptions.batchUpdateStates(parameters),
    );
  }

  /**
   * Deletes purchase options across one or multiple one-time products.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.onetimeproducts.purchaseOptions/batchDelete}
   */
  batchDeleteMonetizationOnetimeproductsPurchaseOptions(
    parameters: androidpublisher_v3.Params$Resource$Monetization$Onetimeproducts$Purchaseoptions$Batchdelete,
  ): Effect.Effect<void, GooglePlayApiError> {
    return runPlayCall('monetization.onetimeproducts.purchaseOptions.batchDelete', () =>
      this.publisher.monetization.onetimeproducts.purchaseOptions.batchDelete(parameters),
    ).pipe(Effect.asVoid);
  }

  /**
   * Creates or updates one or more one-time product offers.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.onetimeproducts.purchaseOptions.offers/batchUpdate}
   */
  batchUpdateMonetizationOnetimeproductsPurchaseOptionsOffers(
    parameters: androidpublisher_v3.Params$Resource$Monetization$Onetimeproducts$Purchaseoptions$Offers$Batchupdate,
  ): Effect.Effect<
    androidpublisher_v3.Schema$BatchUpdateOneTimeProductOffersResponse,
    GooglePlayApiError
  > {
    return runPlayCall('monetization.onetimeproducts.purchaseOptions.offers.batchUpdate', () =>
      this.publisher.monetization.onetimeproducts.purchaseOptions.offers.batchUpdate(parameters),
    );
  }

  /**
   * Updates a batch of one-time product offer states.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.onetimeproducts.purchaseOptions.offers/batchUpdateStates}
   */
  batchUpdateStatesMonetizationOnetimeproductsPurchaseOptionsOffers(
    parameters: androidpublisher_v3.Params$Resource$Monetization$Onetimeproducts$Purchaseoptions$Offers$Batchupdatestates,
  ): Effect.Effect<
    androidpublisher_v3.Schema$BatchUpdateOneTimeProductOfferStatesResponse,
    GooglePlayApiError
  > {
    return runPlayCall(
      'monetization.onetimeproducts.purchaseOptions.offers.batchUpdateStates',
      () =>
        this.publisher.monetization.onetimeproducts.purchaseOptions.offers.batchUpdateStates(
          parameters,
        ),
    );
  }

  /**
   * Activates a one-time product offer.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.onetimeproducts.purchaseOptions.offers/activate}
   */
  activateMonetizationOnetimeproductsPurchaseOptionsOffers(
    parameters: androidpublisher_v3.Params$Resource$Monetization$Onetimeproducts$Purchaseoptions$Offers$Activate,
  ): Effect.Effect<androidpublisher_v3.Schema$OneTimeProductOffer, GooglePlayApiError> {
    return runPlayCall('monetization.onetimeproducts.purchaseOptions.offers.activate', () =>
      this.publisher.monetization.onetimeproducts.purchaseOptions.offers.activate(parameters),
    );
  }

  /**
   * Reads one or more one-time product offers.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.onetimeproducts.purchaseOptions.offers/batchGet}
   */
  batchGetMonetizationOnetimeproductsPurchaseOptionsOffers(
    parameters: androidpublisher_v3.Params$Resource$Monetization$Onetimeproducts$Purchaseoptions$Offers$Batchget,
  ): Effect.Effect<
    androidpublisher_v3.Schema$BatchGetOneTimeProductOffersResponse,
    GooglePlayApiError
  > {
    return runPlayCall('monetization.onetimeproducts.purchaseOptions.offers.batchGet', () =>
      this.publisher.monetization.onetimeproducts.purchaseOptions.offers.batchGet(parameters),
    );
  }

  /**
   * Cancels a one-time product offer.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.onetimeproducts.purchaseOptions.offers/cancel}
   */
  cancelMonetizationOnetimeproductsPurchaseOptionsOffers(
    parameters: androidpublisher_v3.Params$Resource$Monetization$Onetimeproducts$Purchaseoptions$Offers$Cancel,
  ): Effect.Effect<androidpublisher_v3.Schema$OneTimeProductOffer, GooglePlayApiError> {
    return runPlayCall('monetization.onetimeproducts.purchaseOptions.offers.cancel', () =>
      this.publisher.monetization.onetimeproducts.purchaseOptions.offers.cancel(parameters),
    );
  }

  /**
   * Deletes one or more one-time product offers.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.onetimeproducts.purchaseOptions.offers/batchDelete}
   */
  batchDeleteMonetizationOnetimeproductsPurchaseOptionsOffers(
    parameters: androidpublisher_v3.Params$Resource$Monetization$Onetimeproducts$Purchaseoptions$Offers$Batchdelete,
  ): Effect.Effect<void, GooglePlayApiError> {
    return runPlayCall('monetization.onetimeproducts.purchaseOptions.offers.batchDelete', () =>
      this.publisher.monetization.onetimeproducts.purchaseOptions.offers.batchDelete(parameters),
    ).pipe(Effect.asVoid);
  }

  /**
   * Lists all offers under a given app, product, or purchase option.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.onetimeproducts.purchaseOptions.offers/list}
   */
  listMonetizationOnetimeproductsPurchaseOptionsOffers(
    parameters: androidpublisher_v3.Params$Resource$Monetization$Onetimeproducts$Purchaseoptions$Offers$List,
  ): Effect.Effect<
    androidpublisher_v3.Schema$ListOneTimeProductOffersResponse,
    GooglePlayApiError
  > {
    return runPlayCall('monetization.onetimeproducts.purchaseOptions.offers.list', () =>
      this.publisher.monetization.onetimeproducts.purchaseOptions.offers.list(parameters),
    );
  }

  /**
   * Deactivates a one-time product offer.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.onetimeproducts.purchaseOptions.offers/deactivate}
   */
  deactivateMonetizationOnetimeproductsPurchaseOptionsOffers(
    parameters: androidpublisher_v3.Params$Resource$Monetization$Onetimeproducts$Purchaseoptions$Offers$Deactivate,
  ): Effect.Effect<androidpublisher_v3.Schema$OneTimeProductOffer, GooglePlayApiError> {
    return runPlayCall('monetization.onetimeproducts.purchaseOptions.offers.deactivate', () =>
      this.publisher.monetization.onetimeproducts.purchaseOptions.offers.deactivate(parameters),
    );
  }
}
