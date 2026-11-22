export const PLAY_CONSOLE_URL = 'https://play.google.com/console';

/** Link to Play Console user grants, optionally pinned to one developer account. */
export const buildPlayUsersAndPermissionsUrl = (developerId?: string): string => {
  if (developerId == null) return `${PLAY_CONSOLE_URL}/developers/users-and-permissions`;
  return `${PLAY_CONSOLE_URL}/u/0/developers/${encodeURIComponent(developerId)}/users-and-permissions`;
};

/** Link to Play Console payments-profile setup, optionally pinned to one developer account. */
export const buildPlayPaymentsProfileUrl = (developerId?: string): string => {
  if (developerId == null) return `${PLAY_CONSOLE_URL}/developers/paymentssettings`;
  return `${PLAY_CONSOLE_URL}/u/0/developers/${encodeURIComponent(developerId)}/paymentssettings`;
};
