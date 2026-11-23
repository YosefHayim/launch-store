// Generates redeemable subscription offer codes on App Store Connect.

import { createLogger } from '@/services/platform/logger.js';
import type { OffersGenerateCodesInput } from './offers-command.ts';
import { findOfferCode, offersFailure, resolveSubscription } from './offers-subscription.ts';

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
      throw offersFailure(
        'validate offer code count',
        commandInput.count,
        '--count must be a positive integer.',
      );
    }

    const resolvedSubscription = await resolveSubscription(
      commandInput.app,
      commandInput.productId,
    );
    const offerCode = await findOfferCode(
      resolvedSubscription,
      commandInput.productId,
      commandInput.offerName,
    );
    const customCode = commandInput.custom;

    const hasCustomCode = customCode != null;

    if (hasCustomCode) {
      try {
        await resolvedSubscription.appleStore.createOfferCodeCustomCode(
          offerCode.id,
          customCode,
          codeCount,
          commandInput.expires,
        );
      } catch (cause) {
        throw offersFailure('create custom offer code', cause);
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
      throw offersFailure(
        'validate one-time offer codes',
        commandInput,
        'One-time-use codes need an expiration date: --expires YYYY-MM-DD.',
      );
    }

    const isExpirationBlank = expirationDate.length == 0;

    if (isExpirationBlank) {
      throw offersFailure(
        'validate one-time offer codes',
        commandInput,
        'One-time-use codes need an expiration date: --expires YYYY-MM-DD.',
      );
    }

    try {
      await resolvedSubscription.appleStore.createOfferCodeOneTimeUseBatch(
        offerCode.id,
        codeCount,
        expirationDate,
      );
    } catch (cause) {
      throw offersFailure('create one-time offer codes', cause);
    }

    logger.step(
      'offers',
      `generated ${codeCount} one-time-use code(s) on "${commandInput.offerName}" (expire ${expirationDate})`,
    );
  } catch (cause) {
    throw offersFailure('generate offer codes', cause);
  }
}
