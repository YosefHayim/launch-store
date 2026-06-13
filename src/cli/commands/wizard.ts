/**
 * The no-args `launch` wizard — the Expo-style interactive front door.
 *
 * Running `launch` with no subcommand lands here. It detects the host OS and routes: on a Mac it
 * offers a local build (or an advanced remote build); on Windows/Linux — where iOS can't be signed
 * locally — it presents the honest "pick your path" choice from the design (decision 5): a cloud Mac
 * on your own AWS account, the Expo EAS free tier, or a Mac you already reach over SSH.
 *
 * It is thin glue: it builds {@link BuildRunOptions} and calls the SAME entry points the subcommands
 * use ({@link runBuild} / {@link runEasBuild}), so there is no second copy of the build logic.
 */

import { cancel, intro, isCancel, note, outro, select, text } from "@clack/prompts";
import { type BuildRunOptions, prepareBuild, runBuild } from "../../core/pipeline.js";
import { runEasBuild } from "../../core/easPipeline.js";
import { hostOs, hostOsLabel } from "../../core/os.js";
import { parseSshTarget } from "../../providers/compute/byoSsh.js";

/** Defaults the wizard builds with — production profile, upload to the testing track, real run. */
function baseOptions(): BuildRunOptions {
  return {
    platform: "ios",
    profileName: "production",
    appName: undefined,
    explain: false,
    submit: true,
    target: "testing",
    dryRun: false,
  };
}

/** Exit cleanly when the user cancels a prompt. */
function exitOnCancel(value: unknown): void {
  if (isCancel(value)) {
    cancel("Cancelled.");
    process.exit(0);
  }
}

/** Prompt for an SSH `user@host[:port]`, validating it before we try to use it. */
async function promptSshTarget(): Promise<string> {
  const target = await text({
    message: "SSH target for your Mac",
    placeholder: "ec2-user@host or user@host:port",
    validate: (value) => {
      try {
        parseSshTarget(value);
        return undefined;
      } catch (error) {
        return error instanceof Error ? error.message : "Invalid target.";
      }
    },
  });
  if (isCancel(target)) {
    cancel("Cancelled.");
    process.exit(0);
  }
  return target.trim();
}

/** Run the interactive front door. */
export async function runWizard(): Promise<void> {
  intro("Launch");
  const os = hostOs();
  note(`Detected ${hostOsLabel()}.`, "Environment");

  if (os === "macos") {
    const action = await select({
      message: "What would you like to do?",
      options: [
        { value: "local", label: "Build & upload to TestFlight (on this Mac)" },
        { value: "remote", label: "Build on a remote Mac (advanced)" },
        { value: "help", label: "Set up Launch / credentials" },
      ],
    });
    exitOnCancel(action);
    if (action === "local") {
      await runBuild(baseOptions());
    } else if (action === "remote") {
      await runRemoteChoice();
    } else {
      note("Run `launch init` to scaffold config, then `launch creds set-key` and `launch creds setup`.", "Setup");
    }
    outro("Done.");
    return;
  }

  // Non-Mac: iOS signing is macOS-only, so present the three honest paths.
  note("iOS apps can only be signed on macOS — pick how to build:", "No local Mac");
  await runRemoteChoice();
  outro("Done.");
}

/** The shared "cloud Mac vs EAS vs your own Mac" branch (offered as the main path on non-Mac). */
async function runRemoteChoice(): Promise<void> {
  const path = await select({
    message: "How should we build your iOS app?",
    options: [
      { value: "aws", label: "AWS cloud Mac — your own account (~$16 minimum per 24h session)" },
      { value: "eas", label: "Expo EAS — Expo's cloud, free tier with monthly caps" },
      { value: "ssh", label: "Connect a Mac I already have (over SSH)" },
    ],
  });
  exitOnCancel(path);

  if (path === "aws") {
    await runBuild({ ...baseOptions(), remote: { kind: "aws" } });
    return;
  }
  if (path === "ssh") {
    const target = await promptSshTarget();
    await runBuild({ ...baseOptions(), remote: { kind: "ssh", target } });
    return;
  }
  // EAS: force the handoff regardless of config.buildEngine by calling its pipeline directly.
  const options = baseOptions();
  const prepared = await prepareBuild(options);
  await runEasBuild(prepared, options);
}
