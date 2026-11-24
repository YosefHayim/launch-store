// Finds the single saved App Store Connect account a name or key id refers to.

import type { AccountRecord } from '../types/credentials.ts';
import { matchAccount } from './accounts.ts';

export function requireMatchedAccount(
  accounts: readonly AccountRecord[],
  selector: string,
): AccountRecord {
  const matchedAccount = matchAccount([...accounts], selector);

  if (matchedAccount == null) {
    throw new Error(`No Apple account matching "${selector}".`);
  }

  return matchedAccount;
}

function findLabelConflict(
  accounts: readonly AccountRecord[],
  accountLabel: string,
  excludingKeyId: string,
): AccountRecord | null {
  const requestedLabel = accountLabel.toLowerCase();

  for (const account of accounts) {
    const isSameLabel = account.label.toLowerCase() == requestedLabel;

    if (isSameLabel == false) {
      continue;
    }

    const isDifferentKey = account.keyId != excludingKeyId;

    if (isDifferentKey) {
      return account;
    }
  }

  return null;
}

export function requireUniqueAccountLabel(
  accounts: readonly AccountRecord[],
  accountLabel: string,
  excludingKeyId: string,
): void {
  const conflictingAccount = findLabelConflict(accounts, accountLabel, excludingKeyId);

  if (conflictingAccount != null) {
    throw new Error(`Label "${accountLabel}" is already used by key ${conflictingAccount.keyId}.`);
  }
}
