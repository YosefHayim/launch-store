import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { resolveLastRunFilePath } from '../services/platform/paths.ts';
import { pathExists } from '../path-exists.ts';
import type { BumpKind } from '../release/version.ts';

type AppMemory = {
  bump?: BumpKind;
};

type LastRunState = {
  lastApp?: string;
  apps: Record<string, AppMemory>;
};

function emptyLastRunState(): LastRunState {
  return { apps: {} };
}

function isRecord(candidate: unknown): candidate is Record<string, unknown> {
  if (typeof candidate != 'object') {
    return false;
  }

  if (candidate == null) {
    return false;
  }

  return Array.isArray(candidate) == false;
}

function readBump(candidate: unknown): BumpKind | null | undefined {
  if (Object.hasOwn(candidate as object, 'bump') == false) {
    return undefined;
  }

  const bump = (candidate as Record<string, unknown>)['bump'];

  if (typeof bump != 'string') {
    return null;
  }

  const isBump = ['major', 'minor', 'patch', 'keep'].includes(bump as BumpKind);

  if (isBump) {
    return bump as BumpKind;
  }

  return null;
}

function decodeLastRun(memoryText: string): LastRunState | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(memoryText);
  } catch (cause) {
    const isUnreadable = cause != null;

    if (isUnreadable) {
      return null;
    }

    return null;
  }

  if (isRecord(parsed) == false) {
    return null;
  }

  if (isRecord(parsed['apps']) == false) {
    return null;
  }

  const apps: Record<string, AppMemory> = {};

  for (const appName of Object.keys(parsed['apps'])) {
    const appMemory = parsed['apps'][appName];

    if (isRecord(appMemory) == false) {
      return null;
    }

    const bump = readBump(appMemory);

    if (bump == null) {
      return null;
    }

    if (bump == null) {
      apps[appName] = {};
    } else {
      apps[appName] = { bump };
    }
  }

  const memory: LastRunState = { apps };
  const lastApp = parsed['lastApp'];

  if (lastApp == null) {
    return memory;
  }

  if (typeof lastApp != 'string') {
    return null;
  }

  return { ...memory, lastApp };
}

function resolveMemoryFilePath(filePath: string | undefined): string {
  if (filePath != null) {
    return filePath;
  }

  return resolveLastRunFilePath();
}

/** Reads remembered build choices, treating absent or malformed state as empty. */
export async function readLastRun(filePath?: string): Promise<LastRunState> {
  const memoryFilePath = resolveMemoryFilePath(filePath);
  const memoryExists = await pathExists(memoryFilePath);

  if (memoryExists == false) {
    return emptyLastRunState();
  }

  try {
    const memoryText = await readFile(memoryFilePath, 'utf8');
    const memory = decodeLastRun(memoryText);

    if (memory == null) {
      return emptyLastRunState();
    }

    return memory;
  } catch (cause) {
    const isUnreadable = cause != null;

    if (isUnreadable) {
      return emptyLastRunState();
    }

    return emptyLastRunState();
  }
}

/** Reads the most recently built app name. */
export async function readLastApp(filePath?: string): Promise<string | undefined> {
  const memory = await readLastRun(filePath);

  return memory.lastApp;
}

/** Reads the last version bump selected for an app. */
export async function readLastBump(
  appName: string,
  filePath?: string,
): Promise<BumpKind | undefined> {
  const memory = await readLastRun(filePath);
  const appMemory = memory.apps[appName];

  if (appMemory == null) {
    return undefined;
  }

  return appMemory.bump;
}

async function writeLastRun(memoryFilePath: string, memory: LastRunState): Promise<void> {
  await mkdir(dirname(memoryFilePath), { recursive: true });
  await writeFile(memoryFilePath, JSON.stringify(memory, null, 2));
}

/** Records one successful build's app and optional version bump. */
export async function rememberLastRun(
  appName: string,
  bump?: BumpKind,
  filePath?: string,
): Promise<void> {
  const memoryFilePath = resolveMemoryFilePath(filePath);
  const memory = await readLastRun(memoryFilePath);
  let nextApps = memory.apps;

  if (bump != null) {
    const priorAppMemory = memory.apps[appName];

    if (priorAppMemory == null) {
      nextApps = { ...memory.apps, [appName]: { bump } };
    } else {
      nextApps = { ...memory.apps, [appName]: { ...priorAppMemory, bump } };
    }
  }

  const nextMemory: LastRunState = {
    ...memory,
    lastApp: appName,
    apps: nextApps,
  };

  await writeLastRun(memoryFilePath, nextMemory);
}
