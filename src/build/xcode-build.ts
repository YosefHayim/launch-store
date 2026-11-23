import { spawn } from 'node:child_process';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AppleSigningIdentity } from '../credentials/apple-signing.ts';

interface ArchiveRequest {
  directory: string;
  signing: AppleSigningIdentity;
  scheme: string | null;
}

export class XcodeBuild {
  async archive(archiveRequest: ArchiveRequest): Promise<string> {
    const iosDirectory = join(archiveRequest.directory, 'ios');
    const workspacePath = await this.findWorkspace(iosDirectory);
    const scheme = this.pickScheme(archiveRequest.scheme, workspacePath);
    const archivePath = join(iosDirectory, 'build', 'Launch.xcarchive');
    const archiveArguments = [
      '-workspace',
      workspacePath,
      '-scheme',
      scheme,
      '-configuration',
      'Release',
      '-archivePath',
      archivePath,
      '-destination',
      'generic/platform=iOS',
      `DEVELOPMENT_TEAM=${archiveRequest.signing.teamId}`,
      'CODE_SIGN_STYLE=Manual',
      `CODE_SIGN_IDENTITY=${archiveRequest.signing.certificateName}`,
      'COMPILER_INDEX_STORE_ENABLE=NO',
      'archive',
    ];

    await this.runXcode(archiveArguments, iosDirectory);

    return archivePath;
  }

  async exportSignedApp(archiveRequest: ArchiveRequest, archivePath: string): Promise<string> {
    const iosDirectory = join(archiveRequest.directory, 'ios');
    const exportDirectory = join(iosDirectory, 'build', 'export');
    const plistPath = join(iosDirectory, 'build', 'ExportOptions.plist');

    await mkdir(exportDirectory, { recursive: true });

    const exportPlist = exportOptionsPlist(archiveRequest.signing.teamId);

    await writeFile(plistPath, exportPlist);
    await this.runXcode(
      [
        '-exportArchive',
        '-archivePath',
        archivePath,
        '-exportOptionsPlist',
        plistPath,
        '-exportPath',
        exportDirectory,
      ],
      iosDirectory,
    );

    const names = await readdir(exportDirectory);

    function isSignedApp(name: string): boolean {
      return name.endsWith('.ipa');
    }

    const signedAppName = names.find(isSignedApp);

    const isMissing = signedAppName == null;

    if (isMissing) {
      throw new Error('xcodebuild did not write a signed app');
    }

    return join(exportDirectory, signedAppName);
  }

  private pickScheme(scheme: string | null, workspacePath: string): string {
    const hasScheme = scheme != null;

    if (hasScheme) {
      return scheme;
    }

    const workspaceName = workspacePath.split('/').pop();

    const isNameMissing = workspaceName == null;

    if (isNameMissing) {
      throw new Error('The Xcode workspace has no name');
    }

    return workspaceName.replace('.xcworkspace', '');
  }

  private async findWorkspace(iosDirectory: string): Promise<string> {
    let names: string[];

    try {
      names = await readdir(iosDirectory);
    } catch (error) {
      throw new Error('No ios directory. Run expo prebuild first.', { cause: error });
    }

    function isAppWorkspace(name: string): boolean {
      const isWorkspace = name.endsWith('.xcworkspace');

      if (isWorkspace == false) {
        return false;
      }

      return name != 'Pods.xcworkspace';
    }

    const workspaceName = names.find(isAppWorkspace);

    const isMissing = workspaceName == null;

    if (isMissing) {
      throw new Error('No Xcode workspace in ios/');
    }

    return join(iosDirectory, workspaceName);
  }

  private runXcode(toolArguments: readonly string[], workingDirectory: string): Promise<void> {
    function waitForXcode(resolveRun: () => void, rejectRun: (reason: Error) => void): void {
      const child = spawn('xcodebuild', [...toolArguments], {
        cwd: workingDirectory,
        stdio: 'inherit',
      });

      function onStartError(error: Error): void {
        rejectRun(new Error('xcodebuild did not start', { cause: error }));
      }

      function onClose(exitCode: number | null): void {
        const isSuccess = exitCode == 0;

        if (isSuccess) {
          resolveRun();
          return;
        }

        rejectRun(new Error(`xcodebuild exited with ${exitCode}`));
      }

      child.on('error', onStartError);
      child.on('close', onClose);
    }

    return new Promise(waitForXcode);
  }
}

function exportOptionsPlist(teamId: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key>
  <string>app-store-connect</string>
  <key>teamID</key>
  <string>${teamId}</string>
  <key>signingStyle</key>
  <string>manual</string>
  <key>uploadSymbols</key>
  <true/>
</dict>
</plist>
`;
}
