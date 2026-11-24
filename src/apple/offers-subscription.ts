// Finds the App Store Connect subscription and offer-code campaign an offer action needs.

import { loadConfig } from '../config/config.ts';
import type { AppStoreConnect } from './app-store-connect.ts';
import { errorMessage } from '../services/platform/error-message.ts';
import { readLaunchDirectories } from '../services/platform/paths.ts';
import type { AppDescriptor } from '../types/app.ts';
import type { OfferCodeResource } from '../types/apple/subscriptions.ts';
import { loadActiveAppleStore } from './apple-store-command.ts';

type ChosenSubscription = Readonly<{
  readonly appleStore: AppStoreConnect;
  readonly appName: string;
  readonly subscriptionId: string;
}>;

type AppleAppChoice = Readonly<{ app: AppDescriptor; bundleId: string }>;

function appleAppNames(appleApps: readonly AppleAppChoice[]): string {
  const names: string[] = [];

  for (const appleApp of appleApps) {
    names.push(appleApp.app.name);
  }

  return names.join(', ');
}

function readOnlyAppleApp(appleApps: readonly AppleAppChoice[]): AppleAppChoice | null {
  const isOnlyApp = appleApps.length == 1;

  if (isOnlyApp == false) {
    return null;
  }

  const onlyApp = appleApps[0];

  if (onlyApp == null) {
    return null;
  }

  return onlyApp;
}

/** Pick the explicit app, or the only app with an iOS bundle identifier. */
function pickSubscriptionApp(
  apps: AppDescriptor[],
  appSelector: string | undefined,
): AppleAppChoice {
  const appleApps: AppleAppChoice[] = [];

  for (const discoveredApp of apps) {
    const bundleId = discoveredApp.bundleId;

    const hasBundleId = bundleId != null;

    if (hasBundleId) {
      appleApps.push({ app: discoveredApp, bundleId });
    }
  }

  const hasSelector = appSelector != null;

  if (hasSelector) {
    let selectedApp: AppleAppChoice | null = null;

    for (const appleApp of appleApps) {
      const nameMatches = appleApp.app.name == appSelector;

      if (nameMatches) {
        selectedApp = appleApp;
      }
    }

    const chosenApp = selectedApp;

    const hasSelectedApp = chosenApp != null;

    if (hasSelectedApp) {
      return chosenApp;
    }

    throw new Error(`Unknown app "${appSelector}". Discovered: ${appleAppNames(appleApps)}.`, {
      cause: appSelector,
    });
  }

  const onlyApp = readOnlyAppleApp(appleApps);

  const hasOnlyApp = onlyApp != null;

  if (hasOnlyApp) {
    return onlyApp;
  }

  throw new Error(`Several apps found - pass --app <name> (one of: ${appleAppNames(appleApps)}).`, {
    cause: appleApps,
  });
}

/** Read an App Store subscription id for an imperative offer-code command. */
export async function readSubscription(
  appSelector: string | undefined,
  productId: string,
): Promise<ChosenSubscription> {
  const launchPaths = readLaunchDirectories();
  try {
    var loadedConfiguration = await loadConfig(launchPaths.workingDirectory);
  } catch (cause) {
    throw new Error(errorMessage(cause), { cause: cause });
  }

  const selectedApp = pickSubscriptionApp(loadedConfiguration.apps, appSelector);
  try {
    var appleStore = await loadActiveAppleStore();
  } catch (cause) {
    throw new Error(errorMessage(cause), { cause: cause });
  }

  try {
    var appId = await appleStore.getAppId(selectedApp.bundleId);
  } catch (cause) {
    throw new Error(errorMessage(cause), { cause: cause });
  }

  const foundAppId = appId;

  const isAppMissing = foundAppId == null;

  if (isAppMissing) {
    throw new Error(`No App Store Connect app record for ${selectedApp.bundleId}.`, {
      cause: selectedApp.bundleId,
    });
  }

  try {
    var subscriptionGroups = await appleStore.listSubscriptionGroups(foundAppId);
  } catch (cause) {
    throw new Error(errorMessage(cause), { cause: cause });
  }

  for (const subscriptionGroup of subscriptionGroups) {
    try {
      var subscriptions = await appleStore.listSubscriptions(subscriptionGroup.id);
    } catch (cause) {
      throw new Error(errorMessage(cause), { cause: cause });
    }

    for (const subscription of subscriptions) {
      const productMatches = subscription.productId == productId;

      if (productMatches) {
        return {
          appleStore,
          appName: selectedApp.app.name,
          subscriptionId: subscription.id,
        };
      }
    }
  }

  throw new Error(
    `No subscription ${productId} in App Store Connect for ${selectedApp.app.name}.`,
    { cause: productId },
  );
}

/** Find an offer-code campaign by its configured name. */
export async function findOfferCode(
  chosenSubscription: ChosenSubscription,
  productId: string,
  offerName: string,
): Promise<OfferCodeResource> {
  try {
    var offerCodes = await chosenSubscription.appleStore.listSubscriptionOfferCodes(
      chosenSubscription.subscriptionId,
    );
  } catch (cause) {
    throw new Error(errorMessage(cause), { cause: cause });
  }

  let matchingOfferCode: OfferCodeResource | null = null;

  for (const offerCode of offerCodes) {
    const nameMatches = offerCode.name == offerName;

    if (nameMatches) {
      matchingOfferCode = offerCode;
    }
  }

  const foundOfferCode = matchingOfferCode;

  const isOfferMissing = foundOfferCode == null;

  if (isOfferMissing) {
    throw new Error(
      `No offer code named "${offerName}" on ${productId} (${chosenSubscription.appName}).`,
      { cause: offerName },
    );
  }

  return foundOfferCode;
}
