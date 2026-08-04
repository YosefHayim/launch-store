import type { Effect } from 'effect';
import type { AscPermissionProbeApi } from '../store/ascPermissions.js';
import type { AppDescriptor } from './app.js';
import type { LaunchConfig } from './config.js';
import type { HostOs } from './remote.js';
/** The platform a doctor run targets - the same `ios` (default) / `android` split the build pipeline uses. */
export type DoctorPlatform = 'ios' | 'android';
/**
 * The status of one doctor check, mapped to a glyph by the CLI renderer:
 * - `ok` (OK) - present / healthy.
 * - `fail` (x) - a hard problem that fails the run (a missing required tool, an unsigned agreement, a
 *   missing app record): the "would block a build/submit" signal.
 * - `info` (-) - advisory or not-yet-provisioned state that does NOT fail the run (a recommended-only
 *   tool, a one-time manual step, a key-role gap).
 */
export type DoctorStatus = 'ok' | 'fail' | 'info';
/**
 * One line of the doctor report. `title` is the headline shown after the glyph; `detail` carries extra
 * context on its own indented line (e.g. an access-matrix row); `hint` is the actionable fix shown after
 * a `fail`/`info`. A check is always a finished read - never an error in disguise (a read that throws is
 * caught by the caller and surfaced as a `fail`).
 */
export type DoctorCheck = {
  status: DoctorStatus;
  title: string;
  detail?: string;
  hint?: string;
};
/**
 * The aggregate result of a doctor run, structured so the command renders it, `--json` serializes it, and
 * an MCP tool returns it. `ok` is the gate: `true` exactly when no check is `fail` (advisory `info` lines
 * never fail the run), which is what `launch doctor`'s exit code and the wizard's branch both read.
 */
export type DoctorReport = {
  platform: DoctorPlatform;
  checks: DoctorCheck[];
  ok: boolean;
};
/**
 * The read-only App Store Connect surface the doctor inspection uses - `assertReady` (agreement health)
 * and `getAppId` (app-record existence) on top of the {@link AscPermissionProbeApi} reads the role
 * preflight needs. `AppStoreConnectClient` satisfies it structurally, so the resolver from
 * `core/storeClients.ts` is assignable here with no cast (return-type covariance).
 */
export type DoctorAscApi = AscPermissionProbeApi & {
  assertReady(): Effect.Effect<void, unknown>;
  getAppId(bundleId: string): Effect.Effect<string | null, unknown>;
  findBundleId(identifier: string): Effect.Effect<
    {
      id: string;
    } | null,
    unknown
  >;
  listBundleIdCapabilities(bundleIdResourceId: string): Effect.Effect<
    {
      capabilityType: string;
    }[],
    unknown
  >;
};
/** The read-only Google Play surface the doctor uses: prove the service account can reach an app. */
export type DoctorPlayApi = {
  assertAppExists(packageName: string): Effect.Effect<void, unknown>;
};
/**
 * What {@link inspectDoctor} is handed. The pure config/apps plus every impure input injected as a
 * function, so the inspection itself performs no I/O it doesn't go through this seam - which is what lets
 * a test drive it with fakes and lets `launch mcp` reuse it unchanged. Each store resolver returns `null`
 * when that account isn't configured, so the inspection records an advisory skip instead of throwing.
 */
export type DoctorContext<Requirements = never> = {
  config: LaunchConfig;
  apps: AppDescriptor[];
  platform: DoctorPlatform;
  os: HostOs;
  cwd: string;
  exists(command: string): Effect.Effect<boolean, unknown, Requirements>;
  gradleWrapperExists(appDirectory: string): Effect.Effect<boolean, unknown, Requirements>;
  resolveAsc(): Effect.Effect<DoctorAscApi | null, unknown, Requirements>;
  resolvePlay(): Effect.Effect<DoctorPlayApi | null, unknown, Requirements>;
  credentialsStatus(): Effect.Effect<string, unknown, Requirements>;
  codesignIdentities(): Effect.Effect<string | null, unknown, Requirements>;
  corepackAvailable(): Effect.Effect<boolean, unknown, Requirements>;
  androidSdk?: string;
  shellLocale?: Partial<Pick<NodeJS.ProcessEnv, 'LANG' | 'LC_ALL' | 'LANGUAGE'>>;
};
