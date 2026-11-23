export type AscKey = Readonly<{
  keyId: string;
  issuerId: string;
  p8: string;
}>;

/** One onboarded Apple account in Launch's registry (`~/.launch/accounts.json`). */
export type AccountRecord = Readonly<{
  keyId: string;
  issuerId: string;
  label: string;
  teamId?: string;
  apps?: readonly string[];
  addedAt: string;
  resolvedAt?: string;
  vendorNumber?: string;
}>;
/** The on-disk shape of `~/.launch/accounts.json` */
export type AccountsFile = Readonly<{
  active: string | null;
  accounts: readonly AccountRecord[];
}>;
/** The signing assets a release build needs, resolved (reused or freshly created) before export. */
export type SigningAssets = Readonly<{
  bundleId: string;
  teamId: string;
  certName: string;
  certSerial: string;
  profileName: string;
  profileUuid: string;
  profilePath: string;
  extensionProfiles?: Record<string, string>;
}>;
/** Apple credentials resolved for a build. */
export type AppleCredentials = Readonly<{
  ascKey: AscKey;
  signing?: SigningAssets;
}>;
/** The upload keystore Launch owns (or imported) to sign Android App Bundles */
export type KeystoreAssets = Readonly<{
  path: string;
  alias: string;
  storePassword: string;
  keyPassword: string;
}>;
/** Android credentials resolved for a build - the Android twin of {@link AppleCredentials}. */
export type AndroidCredentials = Readonly<{
  serviceAccountJson: string;
  keystore?: KeystoreAssets;
}>;

export type ServiceAccount = Readonly<{
  clientEmail: string;
  privateKey: string;
  tokenUri: string;
  privateKeyId?: string;
}>;
/** Credentials for one build */
export type BuildCredentials =
  | (Readonly<{
      platform: 'ios';
    }> &
      AppleCredentials)
  | (Readonly<{
      platform: 'android';
    }> &
      AndroidCredentials);
