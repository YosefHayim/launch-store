// Docs: https://developers.google.com/android-publisher/api-ref/rest/v3/edits.details
import { makePlayAppNotFoundError, type PlayRequests } from '@/play-console-api/api-client.js';

const readFailureMessage = (failure: unknown): string => {
  if (failure instanceof Error) return failure.message;
  if (typeof failure !== 'object') return String(failure);
  if (failure === null) return String(failure);
  if (!('message' in failure)) return String(failure);
  return String(failure.message);
};

export const makeDetailsApi = (play: PlayRequests) => {
  /** Confirm the service account can reach the app's Play record - the detect-and-deep-link probe for `launch doctor`. */
  const assertAppExists = async (packageName: string): Promise<void> => {
    let editId: string;
    try {
      editId = await play.openEdit(packageName);
    } catch (cause) {
      throw makePlayAppNotFoundError({
        packageName,
        message:
          `No reachable Play app for ${packageName} - ${readFailureMessage(cause)}. Create it once in Play Console ` +
          `(the API can't), and grant the service account access under Users & Permissions.`,
        cause,
      });
    }
    await play.discardEdit(packageName, editId);
  };

  return { assertAppExists };
};
