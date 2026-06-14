/**
 * Export-compliance resolution for `launch release` — answering Apple's "Missing Compliance" question
 * once, then never again.
 *
 * Before App Store Connect will accept a build for review it must know whether the app uses
 * non-exempt encryption (the `usesNonExemptEncryption` attribute, surfaced in the UI as the
 * "Missing Compliance" / Export Compliance prompt). Apps that use only exempt cryptography — HTTPS,
 * the system keychain, standard OS crypto — answer `false`; the rest answer `true` and may owe Apple
 * an export-compliance document. EAS users hit this as a build that silently sticks in "Missing
 * Compliance" until they click through the portal.
 *
 * Launch resolves the answer by precedence so a developer states it once:
 *  1. the app's own `ios.config.usesNonExemptEncryption` in `app.json` (the durable, shareable home —
 *     it also bakes `ITSAppUsesNonExemptEncryption` into the binary, so the portal never even asks);
 *  2. a previously-remembered answer in `~/.launch/compliance.json` (keyed by bundle id);
 *  3. a one-time interactive prompt, whose answer is then persisted for next time.
 * In CI with none of the above set, it fails loudly with the exact `app.json` key to add, rather than
 * leaving a build stuck. The resolved boolean is PATCHed onto the build at submit time so promoted
 * TestFlight builds (which never went through a local Launch build) are covered too.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { COMPLIANCE_FILE, LAUNCH_HOME, ensureDir } from "./paths.js";

/** The on-disk shape of `~/.launch/compliance.json`: remembered answers keyed by bundle id. */
type ComplianceStore = Record<string, boolean>;

/** Narrow an unknown value to a plain object, or null. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

/**
 * Read `ios.config.usesNonExemptEncryption` from a resolved Expo config (tolerating the `{ expo: … }`
 * wrapper or a flat shape), or undefined when the app doesn't declare it. Pure — the release command
 * passes in the config it already loaded via {@link import("./config.js").readResolvedConfig}.
 */
export function readComplianceFromAppConfig(rawConfig: Record<string, unknown> | null): boolean | undefined {
  const expo = asRecord(rawConfig?.["expo"]) ?? rawConfig;
  const ios = asRecord(expo?.["ios"]);
  const config = asRecord(ios?.["config"]);
  const value = config?.["usesNonExemptEncryption"];
  return typeof value === "boolean" ? value : undefined;
}

/** Read the remembered compliance store, returning {} when the file is absent or malformed. */
function readStore(): ComplianceStore {
  if (!existsSync(COMPLIANCE_FILE)) return {};
  try {
    const parsed = asRecord(JSON.parse(readFileSync(COMPLIANCE_FILE, "utf8")));
    if (!parsed) return {};
    const store: ComplianceStore = {};
    for (const [bundleId, value] of Object.entries(parsed)) {
      if (typeof value === "boolean") store[bundleId] = value;
    }
    return store;
  } catch {
    return {};
  }
}

/** The remembered answer for a bundle id, or undefined when none was stored. */
export function readPersistedCompliance(bundleId: string): boolean | undefined {
  return readStore()[bundleId];
}

/** Remember a bundle id's compliance answer so later releases set it without asking again. */
export function persistCompliance(bundleId: string, usesNonExemptEncryption: boolean): void {
  ensureDir(LAUNCH_HOME);
  const store = readStore();
  store[bundleId] = usesNonExemptEncryption;
  writeFileSync(COMPLIANCE_FILE, `${JSON.stringify(store, null, 2)}\n`);
}

/**
 * Where a resolved compliance answer came from — surfaced in the release log so the choice is never
 * silent. `app.json` and `remembered` need no action; `prompt` means we just asked and persisted it.
 */
export type ComplianceSource = "app.json" | "remembered" | "prompt";

/** The outcome of {@link decideExportCompliance}: a resolved value, a need to prompt, or a hard stop. */
export type ComplianceDecision =
  | { kind: "use"; value: boolean; source: Exclude<ComplianceSource, "prompt"> }
  | { kind: "prompt" }
  | { kind: "error"; message: string };

/**
 * Decide the export-compliance answer by precedence (app.json → remembered → prompt), or fail with an
 * actionable message when nothing is set and we can't ask. Pure so the precedence is unit-testable
 * without the filesystem or a TTY — the side effects (prompting, persisting) live in
 * {@link resolveExportCompliance}.
 */
export function decideExportCompliance(input: {
  fromAppConfig: boolean | undefined;
  fromPersisted: boolean | undefined;
  interactive: boolean;
}): ComplianceDecision {
  if (input.fromAppConfig !== undefined) return { kind: "use", value: input.fromAppConfig, source: "app.json" };
  if (input.fromPersisted !== undefined) return { kind: "use", value: input.fromPersisted, source: "remembered" };
  if (input.interactive) return { kind: "prompt" };
  return {
    kind: "error",
    message:
      "Export-compliance status unknown. Set `ios.config.usesNonExemptEncryption` in app.json " +
      "(false for apps using only standard/exempt encryption like HTTPS), or run `launch release` " +
      "once interactively to answer it.",
  };
}

/** A resolved export-compliance answer plus where it came from, for the release log. */
export interface ResolvedCompliance {
  usesNonExemptEncryption: boolean;
  source: ComplianceSource;
}

/**
 * Resolve the export-compliance answer for one app, prompting (and remembering) once when needed.
 * Applies {@link decideExportCompliance}; on `prompt` it calls `prompt`, persists the answer keyed by
 * bundle id, and returns it. Throws the decision's actionable message in CI when nothing is declared.
 */
export async function resolveExportCompliance(input: {
  bundleId: string;
  appConfig: Record<string, unknown> | null;
  interactive: boolean;
  /** Asks the developer "Does this app use non-exempt encryption?"; returns their answer. */
  prompt: () => Promise<boolean>;
}): Promise<ResolvedCompliance> {
  const decision = decideExportCompliance({
    fromAppConfig: readComplianceFromAppConfig(input.appConfig),
    fromPersisted: readPersistedCompliance(input.bundleId),
    interactive: input.interactive,
  });
  if (decision.kind === "error") throw new Error(decision.message);
  if (decision.kind === "use") return { usesNonExemptEncryption: decision.value, source: decision.source };

  const answer = await input.prompt();
  persistCompliance(input.bundleId, answer);
  return { usesNonExemptEncryption: answer, source: "prompt" };
}
