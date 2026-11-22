import { findActiveAccount, readSavedAccounts } from './keychain.ts';

export interface AppleSigningIdentity {
  teamId: string;
  certificateName: string;
}

export class AppleSigning {
  async read(): Promise<AppleSigningIdentity> {
    const saved = await readSavedAccounts();
    const isMissing = saved == null;

    if (isMissing) {
      throw new Error('No App Store Connect account is saved. Run launch-store creds.');
    }

    const account = findActiveAccount(saved);
    const teamId = account.teamId;
    const isTeamMissing = teamId == null;

    if (isTeamMissing) {
      throw new Error('The active Apple account has no team id. Run launch-store creds.');
    }

    return { teamId, certificateName: 'Apple Distribution' };
  }
}
