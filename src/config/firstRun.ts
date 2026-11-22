import { readFile, writeFile } from 'node:fs/promises';
import { pathExists } from '../path-exists.ts';
import {
  ensureDirectoryExists,
  resolveLaunchHomeDirectory,
  resolveStateFilePath,
} from '../services/platform/paths.ts';

type FirstRunState = {
  ccacheOfferDeclinedAt?: string;
};

function isFirstRunState(candidate: unknown): candidate is FirstRunState {
  if (candidate == null) {
    return false;
  }

  if (typeof candidate != 'object') {
    return false;
  }

  if (Array.isArray(candidate)) {
    return false;
  }

  const declinedAt = (candidate as { ccacheOfferDeclinedAt?: unknown }).ccacheOfferDeclinedAt;

  if (declinedAt == null) {
    return true;
  }

  return typeof declinedAt == 'string';
}

/** Reads first-run state, treating absent or malformed state as empty. */
export async function readFirstRunState(): Promise<FirstRunState> {
  const stateFilePath = resolveStateFilePath();
  const stateExists = await pathExists(stateFilePath);

  if (stateExists == false) {
    return {};
  }

  try {
    const stateText = await readFile(stateFilePath, 'utf8');
    const parsedState: unknown = JSON.parse(stateText);
    const isUsable = isFirstRunState(parsedState);

    if (isUsable == false) {
      return {};
    }

    return parsedState;
  } catch (error) {
    const isUnreadable = error != null;

    if (isUnreadable) {
      return {};
    }

    return {};
  }
}

/** Merges one first-run flag without replacing unrelated state. */
async function patchFirstRunState(statePatch: Partial<FirstRunState>): Promise<void> {
  const launchHomeDirectory = resolveLaunchHomeDirectory();
  const stateFilePath = resolveStateFilePath();
  const currentState = await readFirstRunState();

  await ensureDirectoryExists(launchHomeDirectory);
  await writeFile(stateFilePath, JSON.stringify({ ...currentState, ...statePatch }, null, 2));
}

/** Reports whether the inline ccache offer was declined. */
export async function ccacheOfferDeclined(): Promise<boolean> {
  const state = await readFirstRunState();

  return state.ccacheOfferDeclinedAt != null;
}

/** Records that the inline ccache offer was declined. */
export async function markCcacheOfferDeclined(): Promise<void> {
  await patchFirstRunState({ ccacheOfferDeclinedAt: new Date().toISOString() });
}
