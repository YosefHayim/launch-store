import { createLogger } from '../../../../services/platform/logger.ts';
import type { OfferCodeResource } from '../../../../types/apple-catalog.ts';
import type { OffersListInput } from './offers-command.ts';
import { offersFailure, resolveSubscription } from './offers-subscription.ts';

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
    const resolvedSubscription = await resolveSubscription(
      commandInput.app,
      commandInput.productId,
    );
    let offerCodes: OfferCodeResource[];

    try {
      offerCodes = await resolvedSubscription.appleStore.listSubscriptionOfferCodes(
        resolvedSubscription.subscriptionId,
      );
    } catch (cause) {
      throw offersFailure('list offer-code campaigns', cause);
    }

    const hasNoOfferCodes = offerCodes.length == 0;

    if (hasNoOfferCodes) {
      logger.note(`No offer codes on ${commandInput.productId} (${resolvedSubscription.appName}).`);
      return;
    }

    const offerLines: string[] = [];

    for (const offerCode of offerCodes) {
      offerLines.push(renderOfferCodeState(offerCode));
    }

    logger.notice(
      `Offer codes - ${commandInput.productId} (${resolvedSubscription.appName})`,
      ...offerLines,
    );
  } catch (cause) {
    throw offersFailure('list offer codes', cause);
  }
}
