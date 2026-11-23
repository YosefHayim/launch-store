// Holds the check lines, the report, and the store calls one doctor run may make.

import type { AscPermissionProbeApi } from '../store/apple/app-store-connect-permissions.ts';
import type { AppDescriptor } from './app.ts';
import type { LaunchConfig } from './config.ts';
import type { HostOs } from './remote.ts';

/** The platform a doctor run targets - the same `ios` (default) / `android` split the build pipeline uses. */
export type DoctorPlatform = 'ios' | 'android';

/** The status of one doctor check, mapped to a glyph by the CLI renderer: */
type DoctorStatus = 'ok' | 'fail' | 'info';

/** One line of the doctor report. */
export type DoctorCheck = Readonly<{
  status: DoctorStatus;
  title: string;
  detail?: string;
  hint?: string;
}>;

/** The aggregate result of a doctor run */
export type DoctorReport = Readonly<{
  platform: DoctorPlatform;
  checks: readonly DoctorCheck[];
  ok: boolean;
}>;

/** The read-only App Store Connect surface the doctor inspection uses */
export type DoctorAscApi = AscPermissionProbeApi &
  Readonly<{
    assertReady(): Promise<void>;

    getAppId(bundleId: string): Promise<string | null>;

    findBundleId(identifier: string): Promise<Readonly<{
      id: string;
    }> | null>;

    listBundleIdCapabilities(bundleIdResourceId: string): Promise<
      Readonly<{
        capabilityType: string;
      }>[]
    >;
  }>;

/** The read-only Google Play surface the doctor uses: prove the service account can reach an app. */
type DoctorPlayApi = Readonly<{
  assertAppExists(packageName: string): Promise<void>;
}>;

/** What {@link inspectDoctor} is handed. */
export type DoctorContext = {
  config: LaunchConfig;
  apps: readonly AppDescriptor[];
  platform: DoctorPlatform;
  os: HostOs;
  cwd: string;

  exists(command: string): Promise<boolean>;

  gradleWrapperExists(appDirectory: string): Promise<boolean>;

  resolveAsc(): Promise<DoctorAscApi | null>;

  resolvePlay(packageName?: string): Promise<DoctorPlayApi | null>;

  credentialsStatus(): Promise<string>;

  codesignIdentities(): Promise<string | null>;

  corepackAvailable(): Promise<boolean>;

  androidSdk?: string;
  shellLocale?: Partial<Pick<NodeJS.ProcessEnv, 'LANG' | 'LC_ALL' | 'LANGUAGE'>>;
};
