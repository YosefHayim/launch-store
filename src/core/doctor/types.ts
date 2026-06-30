/**
 * Shared vocabulary for the doctor layer — the read-only preflight behind `launch doctor` that grades
 * the local build toolchain and store-account onboarding ("can I build and reach my stores right now?").
 *
 * Where `core/readiness` grades *live store* shippability and `core/plan` *diffs* config against live
 * state, the doctor grades the *local machine* plus account reachability. The refactor that introduced
 * these types pulled every check out of `cli/commands/doctor.ts` (where each one `console.log`-ed) into a
 * pure {@link inspectDoctor} that returns a {@link DoctorReport}: the CLI renders it with ✓/✗/• glyphs,
 * `--json` serializes it verbatim, and `launch mcp` hands the same structured object to an agent — one
 * read-only inspection, three consumers. The impure inputs (PATH probes, store clients, the keychain
 * query) are injected via {@link DoctorContext} so the inspection is faked in tests with no network.
 *
 * These types describe the doctor *mechanism*, not a config shape, so — like `core/readiness/types.ts` —
 * they live here beside the feature rather than in `core/types.ts`.
 */

import type { AscPermissionProbeApi } from '../ascPermissions.js';
import type { AppDescriptor, HostOs, LaunchConfig } from '../types.js';

/** The platform a doctor run targets — the same `ios` (default) / `android` split the build pipeline uses. */
export type DoctorPlatform = 'ios' | 'android';

/**
 * The status of one doctor check, mapped to a glyph by the CLI renderer:
 * - `ok` (✓) — present / healthy.
 * - `fail` (✗) — a hard problem that fails the run (a missing required tool, an unsigned agreement, a
 *   missing app record): the "would block a build/submit" signal.
 * - `info` (•) — advisory or not-yet-provisioned state that does NOT fail the run (a recommended-only
 *   tool, a one-time manual step, a key-role gap).
 */
export type DoctorStatus = 'ok' | 'fail' | 'info';

/**
 * One line of the doctor report. `title` is the headline shown after the glyph; `detail` carries extra
 * context on its own indented line (e.g. an access-matrix row); `hint` is the actionable fix shown after
 * a `fail`/`info`. A check is always a finished read — never an error in disguise (a read that throws is
 * caught by the caller and surfaced as a `fail`).
 */
export interface DoctorCheck {
  status: DoctorStatus;
  /** The headline, e.g. `Xcode` or `App record for com.acme.app`. */
  title: string;
  /** Optional extra context shown indented under the title (multi-line allowed). */
  detail?: string;
  /** Optional concrete next step, shown after a `fail`/`info`. */
  hint?: string;
}

/**
 * The aggregate result of a doctor run, structured so the command renders it, `--json` serializes it, and
 * an MCP tool returns it. `ok` is the gate: `true` exactly when no check is `fail` (advisory `info` lines
 * never fail the run), which is what `launch doctor`'s exit code and the wizard's branch both read.
 */
export interface DoctorReport {
  /** The platform this report graded. */
  platform: DoctorPlatform;
  /** Every check that ran, in display order. */
  checks: DoctorCheck[];
  /** Whether every required check passed (no `fail`); the run's pass/fail verdict. */
  ok: boolean;
}

/**
 * The read-only App Store Connect surface the doctor inspection uses — `assertReady` (agreement health)
 * and `getAppId` (app-record existence) on top of the {@link AscPermissionProbeApi} reads the role
 * preflight needs. `AppStoreConnectClient` satisfies it structurally, so the resolver from
 * `core/storeClients.ts` is assignable here with no cast (return-type covariance).
 */
export interface DoctorAscApi extends AscPermissionProbeApi {
  /** Resolve-vs-throw: throws when the Apple agreements are unsigned/expired or the key is invalid. */
  assertReady(): Promise<void>;
  /** The app's App Store Connect id for a bundle id, or `null` when no app record exists yet. */
  getAppId(bundleId: string): Promise<string | null>;
  /** Look up a bundle id's App ID resource, or `null` when it isn't registered yet. */
  findBundleId(identifier: string): Promise<{ id: string } | null>;
  /** The capabilities currently enabled on an App ID resource. */
  listBundleIdCapabilities(bundleIdResourceId: string): Promise<{ capabilityType: string }[]>;
}

/** The read-only Google Play surface the doctor uses: prove the service account can reach an app. */
export interface DoctorPlayApi {
  /** Throws when the app doesn't exist or the service account can't access it; resolves otherwise. */
  assertAppExists(packageName: string): Promise<void>;
}

/**
 * What {@link inspectDoctor} is handed. The pure config/apps plus every impure input injected as a
 * function, so the inspection itself performs no I/O it doesn't go through this seam — which is what lets
 * a test drive it with fakes and lets `launch mcp` reuse it unchanged. Each store resolver returns `null`
 * when that account isn't configured, so the inspection records an advisory skip instead of throwing.
 */
export interface DoctorContext {
  config: LaunchConfig;
  apps: AppDescriptor[];
  /** The platform this run grades — selects the iOS vs Android check set. */
  platform: DoctorPlatform;
  /** Host OS — gates the macOS-only codesign-identity check. */
  os: HostOs;
  /** Directory whose package-manager/workspace setup is inspected (normally `process.cwd()`). */
  cwd: string;
  /** Whether a CLI tool is resolvable on PATH (the toolchain probes). */
  exists(command: string): Promise<boolean>;
  /** Resolve the read-only App Store Connect client, or `null` when no Apple account is active. */
  resolveAsc(): Promise<DoctorAscApi | null>;
  /** Resolve the read-only Google Play client, or `null` when no Play service account is configured. */
  resolvePlay(): Promise<DoctorPlayApi | null>;
  /** The `launch creds status` line(s) for the local credentials provider. */
  credentialsStatus(): Promise<string>;
  /** `security find-identity` output for codesigning identities, or `null` when it couldn't be queried. */
  codesignIdentities(): Promise<string | null>;
  /** Whether `corepack` is on PATH (drives a package-manager warning). */
  corepackAvailable(): Promise<boolean>;
  /** `ANDROID_HOME` / `ANDROID_SDK_ROOT`, when set — the Android SDK location. */
  androidSdk?: string;
  /** Locale env for the shell-locale doctor line; defaults to `process.env` when omitted. */
  shellLocale?: Partial<Pick<NodeJS.ProcessEnv, 'LANG' | 'LC_ALL' | 'LANGUAGE'>>;
}
