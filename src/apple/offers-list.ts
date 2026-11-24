// Lists the offer-code campaigns for one subscription on App Store Connect.

import { errorMessage } from '../services/platform/error-message.ts';
import { createLogger } from '../services/platform/logger.ts';
import type { OffersListInput } from './offers-command.ts';
import { readSubscription } from './offers-subscription.ts';

/** Render an offer-code campaign without Unicode status glyphs. */
export function renderOfferCodeState(
  offerCode: Readonly<{ name: string; active: boolean }>,
): string {
  if (offerCode.active) {
    return `[active] ${offerCode.name}`;
  }

  return `[inactive] ${offerCode.name}`;
}

/** List a subscription's offer-code campaigns. */
export async function executeListOfferCodes(commandInput: OffersListInput): Promise<void> {
  try {
    const logger = createLogger(false);
    const chosenSubscription = await readSubscription(commandInput.app, commandInput.productId);
    try {
      var offerCodes = await chosenSubscription.appleStore.listSubscriptionOfferCodes(
        chosenSubscription.subscriptionId,
      );
    } catch (cause) {
      throw new Error(errorMessage(cause), { cause: cause });
    }

    const hasNoOfferCodes = offerCodes.length == 0;

    if (hasNoOfferCodes) {
      logger.note(`No offer codes on ${commandInput.productId} (${chosenSubscription.appName}).`);
      return;
    }

    const offerLines: string[] = [];

    for (const offerCode of offerCodes) {
      const renderOfferCode = renderOfferCodeState(offerCode);
      offerLines.push(renderOfferCode);
    }

    logger.notice(
      `Offer codes - ${commandInput.productId} (${chosenSubscription.appName})`,
      ...offerLines,
    );
  } catch (cause) {
    throw new Error(errorMessage(cause), { cause: cause });
  }
}
