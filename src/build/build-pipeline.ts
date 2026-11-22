import type { LaunchConfig } from '../types/config.ts';
import type { ExpoApp } from '../expo-app.ts';
import { readExpoApp } from '../expo-app.ts';
import { AppStoreConnect } from '../apple/app-store-connect.ts';
import { AppleSigning } from '../credentials/apple-signing.ts';
import { GooglePlay } from '../google-play.ts';
import { LoadLaunchFile } from '../launch-file/load-launch-file.ts';
import { GradleBuild } from './gradle-build.ts';
import { SubmitToAppStore } from './submit-to-app-store.ts';
import { SubmitToPlay } from './submit-to-play.ts';
import { XcodeBuild } from './xcode-build.ts';

export interface ShipBuild {
  platform: 'ios' | 'android';
  profileName: string;
  isDryRun: boolean;
  workspaceDirectory: string;
  shouldSubmit: boolean;
}

interface PreparedBuild {
  launchFile: LaunchConfig;
  expoApp: ExpoApp;
  track: string;
}

export class BuildPipeline {
  constructor(
    private readonly loadLaunchFile = new LoadLaunchFile(),
    private readonly apple = new AppStoreConnect(),
    private readonly play = new GooglePlay(),
  ) {}

  async run(shipBuild: ShipBuild): Promise<string | null> {
    const prepared = await this.prepare(shipBuild);
    const isDryRun = shipBuild.isDryRun;

    if (isDryRun) {
      return null;
    }

    const isIos = shipBuild.platform == 'ios';

    if (isIos) {
      return this.runIos(shipBuild, prepared);
    }

    return this.runAndroid(shipBuild, prepared);
  }

  private async prepare(shipBuild: ShipBuild): Promise<PreparedBuild> {
    const launchFile = await this.loadLaunchFile.read(shipBuild.workspaceDirectory);
    const profile = launchFile.profiles[shipBuild.profileName];
    const isMissing = profile == null;

    if (isMissing) {
      throw new Error(`Unknown profile ${shipBuild.profileName}`);
    }

    const expoApp = await readExpoApp(shipBuild.workspaceDirectory);

    return { launchFile, expoApp, track: profile.track ?? 'internal' };
  }

  private async runIos(shipBuild: ShipBuild, prepared: PreparedBuild): Promise<string> {
    const bundleId = prepared.expoApp.bundleId;
    const isBundleMissing = bundleId == null;

    if (isBundleMissing) {
      throw new Error('app.json has no ios bundle id');
    }

    const signing = await new AppleSigning().read();
    const xcode = new XcodeBuild();
    const archiveRequest = {
      directory: shipBuild.workspaceDirectory,
      signing,
      scheme: prepared.expoApp.name,
    };
    const archivePath = await xcode.archive(archiveRequest);
    const signedAppPath = await xcode.exportSignedApp(archiveRequest, archivePath);
    const shouldSubmit = shipBuild.shouldSubmit;

    if (shouldSubmit == false) {
      return signedAppPath;
    }

    const submit = new SubmitToAppStore(this.apple);

    return submit.upload({ path: signedAppPath, bundleId });
  }

  private async runAndroid(shipBuild: ShipBuild, prepared: PreparedBuild): Promise<string> {
    const packageName = prepared.expoApp.packageName;
    const isPackageMissing = packageName == null;

    if (isPackageMissing) {
      throw new Error('app.json has no android package name');
    }

    const gradle = new GradleBuild();
    const bundlePath = await gradle.bundle(shipBuild.workspaceDirectory);
    const shouldSubmit = shipBuild.shouldSubmit;

    if (shouldSubmit == false) {
      return bundlePath;
    }

    const submit = new SubmitToPlay(this.play);

    return submit.upload({ path: bundlePath, packageName, track: prepared.track });
  }
}
