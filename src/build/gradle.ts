// Compiles the Android app with Gradle and returns the .aab path.

import { spawn, type ChildProcess } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

import type { LaunchApp } from '@/config/launch-file.js';

export async function compileAndroid(app: LaunchApp): Promise<string> {
  const android = app.android;
  const isAndroidMissing = android == null;

  if (isAndroidMissing) {
    throw new Error(`${app.name} has no android settings in launch.config.ts.`);
  }

  const androidDir = join(app.projectPath, 'android');
  const bundleDir = join(androidDir, 'app', 'build', 'outputs', 'bundle', 'release');
  console.log(`[RUN] gradlew bundleRelease`);
  await runProcess('sh', [join(androidDir, 'gradlew'), 'bundleRelease'], androidDir);

  return findAab(bundleDir);
}

async function findAab(bundleDir: string): Promise<string> {
  let names: string[];

  try {
    names = await readdir(bundleDir);
  } catch (error) {
    throw new Error(`Gradle finished but no .aab was written in ${bundleDir}.`, { cause: error });
  }

  function isAab(name: string): boolean {
    return name.endsWith('.aab');
  }

  const aabName = names.find(isAab);
  const isMissing = aabName == null;

  if (isMissing) {
    throw new Error(`Gradle finished but no .aab was written in ${bundleDir}.`);
  }

  return join(bundleDir, aabName);
}

async function runProcess(command: string, args: readonly string[], cwd: string): Promise<void> {
  const child = spawn(command, [...args], { cwd, stdio: 'inherit' });
  const exitCode = await waitForExit(child);
  const isFailed = exitCode !== 0;

  if (isFailed) {
    throw new Error(`${command} failed (${exitCode ?? 'missing'}).`);
  }
}

function waitForExit(child: ChildProcess): Promise<number | null> {
  return new Promise(function settle(resolve, reject) {
    function onError(error: Error): void {
      reject(error);
    }

    function onClose(code: number | null): void {
      resolve(code);
    }

    child.once('error', onError);
    child.once('close', onClose);
  });
}
