/**
 * The Launch command surface, assembled but not run.
 *
 * {@link buildProgram} wires every `register*` command onto a fresh commander {@link Command} and
 * returns it **without parsing or registering providers** — so it has no import-time side effects and
 * can be introspected. The real entry ({@link import("./index.js")}) calls it and parses `argv`; the
 * docs generator ({@link import("../../scripts/gen-docs.js")}) walks its `.commands` tree to produce
 * `docs/commands.md` and `llms.txt`, which makes the command definitions here the single source of
 * truth the docs can't drift from.
 */

import { readFileSync } from "node:fs";
import { Command } from "commander";
import { renderBanner } from "../core/banner.js";
import { registerInitCommand } from "./commands/init.js";
import { registerAdoptCommand } from "./commands/adopt.js";
import { registerMigrateCommand } from "./commands/migrate.js";
import { registerConfigCommand } from "./commands/config.js";
import { registerBuildCommand } from "./commands/build.js";
import { registerReleaseCommand } from "./commands/release.js";
import { registerStatusCommand } from "./commands/status.js";
import { registerReleaseTrainCommand } from "./commands/releaseTrain.js";
import { registerRolloutCommand } from "./commands/rollout.js";
import { registerCredsCommand } from "./commands/creds.js";
import { registerSecretCommand } from "./commands/secret.js";
import { registerMetadataCommand } from "./commands/metadata.js";
import { registerSyncCommand } from "./commands/sync.js";
import { registerPlanCommand } from "./commands/plan.js";
import { registerOffersCommand } from "./commands/offers.js";
import { registerReviewsCommand } from "./commands/reviews.js";
import { registerReportsCommand } from "./commands/reports.js";
import { registerInsightsCommand } from "./commands/insights.js";
import { registerTeamCommand } from "./commands/team.js";
import { registerReleaseConfigCommand } from "./commands/releaseConfig.js";
import { registerAppClipsCommand } from "./commands/appClips.js";
import { registerEuDistributionCommand } from "./commands/euDistribution.js";
import { registerWalletCommand } from "./commands/wallet.js";
import { registerGameCenterCommand } from "./commands/gameCenter.js";
import { registerAccessibilityCommand } from "./commands/accessibility.js";
import { registerAvailabilityCommand } from "./commands/availability.js";
import { registerCustomPagesCommand } from "./commands/customPages.js";
import { registerExperimentsCommand } from "./commands/experiments.js";
import { registerPlayProductsCommand } from "./commands/playProducts.js";
import { registerPlaySubscriptionsCommand } from "./commands/playSubscriptions.js";
import { registerPlayReviewsCommand } from "./commands/playReviews.js";
import { registerPlayTracksCommand } from "./commands/playTracks.js";
import { registerDeviceCommand } from "./commands/device.js";
import { registerTestflightCommand } from "./commands/testflight.js";
import { registerEventsCommand } from "./commands/events.js";
import { registerDoctorCommand } from "./commands/doctor.js";
import { registerStoreCommand } from "./commands/storeDoctor.js";
import { registerAuditCommand } from "./commands/audit.js";
import { registerIapCommand } from "./commands/iapDoctor.js";
import { registerSnapshotCommand } from "./commands/snapshot.js";
import { registerExplainCommand } from "./commands/explain.js";
import { registerUpdateCommand } from "./commands/update.js";
import { registerUpdatesCommand } from "./commands/updates.js";
import { registerCloudCommand } from "./commands/cloud.js";
import { registerDemoCommand } from "./commands/demo.js";
import { registerBuildsCommand } from "./commands/builds.js";
import { registerCiCommand } from "./commands/ci.js";
import { registerAgentsCommand } from "./commands/agents.js";
import { registerMcpCommand } from "./commands/mcp.js";
import { registerRunCommand } from "./commands/run.js";
import { registerFingerprintCommand } from "./commands/fingerprint.js";
import { registerDiagnoseCommand } from "./commands/diagnose.js";
import { registerResignCommand } from "./commands/resign.js";
import { registerSetupCommand } from "./commands/setup.js";
import { registerSandboxCommand } from "./commands/sandbox.js";
import { runWizard } from "./commands/wizard.js";

/**
 * Read the CLI version straight from the package manifest so `package.json` stays the single
 * source of truth (no second copy to keep in sync at release time). package.json always ships
 * with the published package, and sits two levels above the compiled `dist/cli/program.js`.
 */
export function readVersion(): string {
  const manifest: unknown = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  return typeof manifest === "object" &&
    manifest !== null &&
    "version" in manifest &&
    typeof manifest.version === "string"
    ? manifest.version
    : "0.0.0";
}

/**
 * Assemble the full `launch` command tree and return it unparsed. Pure — registering providers and
 * dispatching `argv` are the caller's job — so importing this module does nothing observable, which is
 * what lets both the runtime entry and the docs generator share one definition of the command surface.
 */
export function buildProgram(): Command {
  const program = new Command();
  program
    .name("launch")
    .description("Build and ship your iOS/Android apps to the stores from your own machine — no Expo bill.")
    .version(readVersion());

  registerInitCommand(program);
  registerAdoptCommand(program);
  registerMigrateCommand(program);
  registerConfigCommand(program);
  registerBuildCommand(program);
  registerReleaseCommand(program);
  registerStatusCommand(program);
  registerReleaseTrainCommand(program);
  registerRolloutCommand(program);
  registerCredsCommand(program);
  registerSecretCommand(program);
  registerMetadataCommand(program);
  registerSyncCommand(program);
  registerPlanCommand(program);
  registerOffersCommand(program);
  registerReviewsCommand(program);
  registerReportsCommand(program);
  registerInsightsCommand(program);
  registerTeamCommand(program);
  registerReleaseConfigCommand(program);
  registerAppClipsCommand(program);
  registerEuDistributionCommand(program);
  registerWalletCommand(program);
  registerGameCenterCommand(program);
  registerAccessibilityCommand(program);
  registerAvailabilityCommand(program);
  registerCustomPagesCommand(program);
  registerExperimentsCommand(program);
  registerPlayProductsCommand(program);
  registerPlaySubscriptionsCommand(program);
  registerPlayReviewsCommand(program);
  registerPlayTracksCommand(program);
  registerDeviceCommand(program);
  registerTestflightCommand(program);
  registerEventsCommand(program);
  registerSetupCommand(program);
  registerSandboxCommand(program);
  registerDoctorCommand(program);
  registerStoreCommand(program);
  registerAuditCommand(program);
  registerIapCommand(program);
  registerSnapshotCommand(program);
  registerExplainCommand(program);
  registerUpdateCommand(program);
  registerUpdatesCommand(program);
  registerCloudCommand(program);
  registerDemoCommand(program);
  registerBuildsCommand(program);
  registerCiCommand(program);
  registerAgentsCommand(program);
  registerMcpCommand(program);
  registerRunCommand(program);
  registerFingerprintCommand(program);
  registerDiagnoseCommand(program);
  registerResignCommand(program);

  // No subcommand → the glowing LAUNCH banner, then the interactive wizard (the Expo-style front
  // door that detects the host OS and routes the build accordingly).
  program.action(async () => {
    await renderBanner();
    await runWizard();
  });

  return program;
}
