// Generates redeemable subscription offer codes on App Store Connect.

import { errorMessage } from '../services/platform/error-message.ts';
import { createLogger } from '../services/platform/logger.ts';
import type { OffersGenerateCodesInput } from './offers-command.ts';
import { findOfferCode, readSubscription } from './offers-subscription.ts';

function isInvalidCodeCount(codeCount: number): boolean {
  const isWholeNumber = Number.isInteger(codeCount);

  if (isWholeNumber == false) {
    return true;
  }

  return codeCount < 1;
}

/** Generate custom or one-time-use redeemable codes. */
export async function executeGenerateCodes(commandInput: OffersGenerateCodesInput): Promise<void> {
  try {
    const logger = createLogger(false);
    const codeCount = Number.parseInt(commandInput.count, 10);

    const countIsInvalid = isInvalidCodeCount(codeCount);

    if (countIsInvalid) {
      throw new Error('--count must be a positive integer.', { cause: commandInput.count });
    }

    const chosenSubscription = await readSubscription(commandInput.app, commandInput.productId);
    const offerCode = await findOfferCode(
      chosenSubscription,
      commandInput.productId,
      commandInput.offerName,
    );
    const customCode = commandInput.custom;

    const hasCustomCode = customCode != null;

    if (hasCustomCode) {
      try {
        await chosenSubscription.appleStore.createOfferCodeCustomCode(
          offerCode.id,
          customCode,
          codeCount,
          commandInput.expires,
        );
      } catch (cause) {
        throw new Error(errorMessage(cause), { cause: cause });
      }

      logger.step(
        'offers',
        `created custom code "${customCode}" (${codeCount} uses) on "${commandInput.offerName}"`,
      );

      return;
    }

    const expirationDate = commandInput.expires;

    const isExpirationMissing = expirationDate == null;

    if (isExpirationMissing) {
      throw new Error('One-time-use codes need an expiration date: --expires YYYY-MM-DD.', {
        cause: commandInput,
      });
    }

    const isExpirationBlank = expirationDate.length == 0;

    if (isExpirationBlank) {
      throw new Error('One-time-use codes need an expiration date: --expires YYYY-MM-DD.', {
        cause: commandInput,
      });
    }

    try {
      await chosenSubscription.appleStore.createOfferCodeOneTimeUseBatch(
        offerCode.id,
        codeCount,
        expirationDate,
      );
    } catch (cause) {
      throw new Error(errorMessage(cause), { cause: cause });
    }

    logger.step(
      'offers',
      `generated ${codeCount} one-time-use code(s) on "${commandInput.offerName}" (expire ${expirationDate})`,
    );
  } catch (cause) {
    throw new Error(errorMessage(cause), { cause: cause });
  }
}
