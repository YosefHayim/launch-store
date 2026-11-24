// App Store Connect users, invitations, and sandbox testers.

/** One **sandbox tester** (`sandboxTesters`) */
export type SandboxTesterResource = Readonly<{
  id: string;
  acAccountName: string;
  firstName?: string;
  lastName?: string;
  territory?: string;
  applePayCompatible?: boolean;
  interruptPurchases?: boolean;
  subscriptionRenewalRate?: string;
}>;

/** One App Store Connect **team member** (`users`) */
export type UserResource = Readonly<{
  id: string;
  username: string;
  firstName?: string;
  lastName?: string;
  roles: readonly string[];
}>;

/** One **pending** team invitation (`userInvitations`) - an invited member who hasn't accepted. */
export type UserInvitationResource = Readonly<{
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  roles: readonly string[];
  expirationDate?: string;
}>;

/** The attributes required to invite a new team member */
export type NewUserInvitation = Readonly<{
  email: string;
  firstName: string;
  lastName: string;
  roles: readonly string[];
  allAppsVisible: boolean;
  provisioningAllowed: boolean;
}>;
