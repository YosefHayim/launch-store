// Compiles the iOS app with xcodebuild and returns the .ipa path.

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { LaunchApp } from '@/config/launch-file.js';

export async function compileIos(app: LaunchApp): Promise<string> {
  const ios = app.ios;
  const isIosMissing = ios == null;

  if (isIosMissing) {
    throw new Error(`${app.name} has no ios settings in launch.config.ts.`);
  }

  const projectDir = join(app.projectPath, 'ios');
  const nativeProject = await findIosProject(projectDir);
  const archivePath = join(app.projectPath, 'build', `${ios.scheme}.xcarchive`);
  const exportDir = join(app.projectPath, 'build', 'ios');
  await mkdir(exportDir, { recursive: true });
  console.log(`[RUN] xcodebuild ${ios.scheme}`);
  await runProcess('xcodebuild', [
    nativeProject.flag,
    nativeProject.path,
    '-scheme',
    ios.scheme,
    '-configuration',
    'Release',
    '-archivePath',
    archivePath,
    'archive',
  ]);
  const exportOptionsPath = join(exportDir, 'ExportOptions.plist');
  await writeFile(exportOptionsPath, exportOptionsPlist());
  await runProcess('xcodebuild', [
    '-exportArchive',
    '-archivePath',
    archivePath,
    '-exportPath',
    exportDir,
    '-exportOptionsPlist',
    exportOptionsPath,
  ]);

  return findIpa(exportDir);
}

async function findIosProject(
  projectDir: string,
): Promise<{ flag: '-workspace' | '-project'; path: string }> {
  const workspace = await findNativeProject(projectDir, '.xcworkspace');
  const isWorkspaceMissing = workspace == null;

  if (isWorkspaceMissing) {
    const project = await findNativeProject(projectDir, '.xcodeproj');
    const isProjectMissing = project == null;

    if (isProjectMissing) {
      throw new Error(`No Xcode project under ${projectDir}.`);
    }

    return { flag: '-project', path: project };
  }

  return { flag: '-workspace', path: workspace };
}

async function findNativeProject(directory: string, extension: string): Promise<string | null> {
  var names: string[];

  try {
    names = await readdir(directory);
  } catch (error) {
    const isError = error instanceof Error;

    if (isError) {
      return null;
    }

    return null;
  }

  function matchesExtension(name: string): boolean {
    return name.endsWith(extension);
  }

  const projectName = names.find(matchesExtension);
  const isMissing = projectName == null;

  if (isMissing) {
    return null;
  }

  return join(directory, projectName);
}

function exportOptionsPlist(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key>
  <string>app-store-connect</string>
  <key>destination</key>
  <string>export</string>
  <key>signingStyle</key>
  <string>automatic</string>
</dict>
</plist>
`;
}

async function findIpa(exportDir: string): Promise<string> {
  const names = await readdir(exportDir);

  function isIpa(name: string): boolean {
    return name.endsWith('.ipa');
  }

  const ipaName = names.find(isIpa);
  const isMissing = ipaName == null;

  if (isMissing) {
    throw new Error(`xcodebuild finished but no .ipa was written in ${exportDir}.`);
  }

  return join(exportDir, ipaName);
}

async function runProcess(command: string, args: readonly string[]): Promise<void> {
  const child = spawn(command, [...args], { stdio: 'inherit' });
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
