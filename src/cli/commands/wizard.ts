/**
 * The no-args `launch` wizard — the Expo-style interactive front door.
 *
 * Running `launch` with no subcommand lands here. It's a guided, teaching-first journey: every step
 * renders the full glossary block for that decision (so a newcomer learns the "why") plus a one-line
 * hint on each option, then routes the build. A fresh checkout (no `launch.config.ts`) is walked
 * through guided setup first; otherwise a small menu offers Build or Set up.
 *
 * The journey is platform-first (the Apple account only matters for iOS-signed builds): pick a
 * platform → for iOS pick where to build, which Apple account, a profile, and whether to upload →
 * then run. It's thin glue over the SAME entry points the subcommands use ({@link runBuild} /
 * {@link runEasBuild} / {@link runInit} / {@link runDoctor} / {@link chooseAccountInteractive}), so
 * there's no second copy of the build, setup, or account logic.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { cancel, confirm, intro, isCancel, note, outro, select, text } from "@clack/prompts";
import type { AppDescriptor, LaunchConfig, Platform } from "../../core/types.js";
import { type GlossaryTopic, explainTopic } from "../../core/glossary.js";
import { hostOsLabel, isMac } from "../../core/os.js";
import { isInteractive } from "../../core/progress.js";
import { hasSeenTour, markTourSeen } from "../../core/firstRun.js";
import { runTour } from "../../core/tour.js";
import { getActiveAccount } from "../../core/accounts.js";
import { loadConfig } from "../../core/config.js";
import { type BuildRunOptions, prepareBuild, runBuild } from "../../core/pipeline.js";
import { runEasBuild } from "../../core/easPipeline.js";
import { chooseAccountInteractive, setupIos } from "./creds.js";
import { runInit } from "./init.js";
import { runDoctor } from "./doctor.js";
import { parseSshTarget } from "../../providers/compute/byoSsh.js";

/** Where an iOS build runs. `local` is offered only on a Mac; the rest work from any host. */
type BuildLocation = "local" | "aws" | "ssh" | "eas";

/** Resolve a Clack prompt, exiting cleanly on cancel and narrowing the cancel symbol away. */
function resolvePrompt<T>(value: T | symbol): T {
  if (isCancel(value)) {
    cancel("Cancelled.");
    process.exit(0);
  }
  return value;
}

/** Render a step's full glossary teaching block above its prompt — always shown in the wizard. */
function teach(topic: GlossaryTopic, title: string): void {
  note(explainTopic(topic), title);
}

/** Yes/no "Build now?", treating a cancel as no. */
async function confirmBuildNow(): Promise<boolean> {
  const answer = await confirm({ message: "Build now?" });
  return !isCancel(answer) && answer;
}

/** Prompt for an SSH `user@host[:port]`, validating it before we try to use it. */
async function promptSshTarget(): Promise<string> {
  const target = await text({
    message: "SSH target for your Mac",
    placeholder: "ec2-user@host or user@host:port",
    validate: (value) => {
      if (!value) return "Enter an SSH target.";
      try {
        parseSshTarget(value);
        return undefined;
      } catch (error) {
        return error instanceof Error ? error.message : "Invalid target.";
      }
    },
  });
  return resolvePrompt(target).trim();
}

/** Build the base options every wizard build shares — production-ish defaults, real (non-dry) run. */
function buildOptions(platform: Platform, profileName: string, submit: boolean): BuildRunOptions {
  return { platform, profileName, appName: undefined, explain: false, submit, target: "testing", dryRun: false };
}

/** Step 1: platform. Always shown; an option with no configured app is hinted so the choice is honest. */
async function selectPlatform(apps: AppDescriptor[]): Promise<Platform> {
  const hasIos = apps.some((app) => app.bundleId);
  const hasAndroid = apps.some((app) => app.packageName);
  return resolvePrompt(
    await select<Platform>({
      message: "Which platform?",
      options: [
        {
          value: "ios",
          label: "iOS",
          hint: hasIos ? "build & sign on macOS, a remote Mac, or EAS" : "no iOS app configured",
        },
        {
          value: "android",
          label: "Android",
          hint: hasAndroid ? "build locally on any OS" : "no Android app configured",
        },
      ],
    }),
  );
}

/** Step 2 (iOS): where to build. `This Mac` appears only on a Mac; the rest cover the off-Mac paths. */
async function selectLocation(): Promise<BuildLocation> {
  const options: { value: BuildLocation; label: string; hint: string }[] = [
    ...(isMac() ? [{ value: "local" as const, label: "This Mac", hint: "fastest; your local Xcode" }] : []),
    { value: "aws", label: "AWS cloud Mac", hint: "your own AWS; ~$16 min / 24h" },
    { value: "ssh", label: "A Mac over SSH", hint: "a Mac you already reach" },
    { value: "eas", label: "Expo EAS", hint: "Expo's cloud; free-tier caps" },
  ];
  return resolvePrompt(await select<BuildLocation>({ message: "Where should we build?", options }));
}

/** Step (both): which profile. Always shown; each option hints its size budget when set. */
async function selectProfile(config: LaunchConfig): Promise<string> {
  const names = Object.keys(config.profiles);
  if (names.length === 0) return "production"; // the pipeline applies a 200 MB default profile under this name
  const options = names.map((name) => {
    const budget = config.profiles[name]?.sizeBudgetMB;
    return budget ? { value: name, label: name, hint: `budget ${budget} MB` } : { value: name, label: name };
  });
  const initialValue = names.includes("production") ? "production" : (names[0] ?? "production");
  return resolvePrompt(await select<string>({ message: "Which profile?", options, initialValue }));
}

/** Step (both): upload or stop after building. Returns whether to submit. */
async function selectAfterBuild(uploadLabel: string): Promise<boolean> {
  const choice = resolvePrompt(
    await select<"upload" | "build">({
      message: "After building?",
      options: [
        { value: "upload", label: `Upload to ${uploadLabel}`, hint: "build, then submit" },
        { value: "build", label: "Build only", hint: "stop after building; don't upload" },
      ],
    }),
  );
  return choice === "upload";
}

/** The iOS journey: location → Apple account → profile → upload choice → run the matching build path. */
async function runIosJourney(config: LaunchConfig): Promise<void> {
  teach("build-location", "Where to build");
  const location = await selectLocation();

  teach("apple-account", "Apple account");
  await chooseAccountInteractive();
  if (location === "eas") {
    note(
      "EAS signs in Expo's cloud, so this account isn't used to sign — it just stays your active account for other Launch commands.",
      "Note",
    );
  }

  teach("build-profile", "Profile");
  const profileName = await selectProfile(config);

  teach("testflight", "After build");
  const submit = await selectAfterBuild("TestFlight");

  const options = buildOptions("ios", profileName, submit);
  switch (location) {
    case "local":
      return runBuild(options);
    case "aws":
      return runBuild({ ...options, remote: { kind: "aws" } });
    case "ssh":
      return runBuild({ ...options, remote: { kind: "ssh", target: await promptSshTarget() } });
    case "eas": {
      const prepared = await prepareBuild(options);
      return runEasBuild(prepared, options);
    }
  }
}

/** The Android journey: profile → upload choice → run. No Apple account or build-location applies. */
async function runAndroidJourney(config: LaunchConfig): Promise<void> {
  teach("build-profile", "Profile");
  const profileName = await selectProfile(config);

  teach("play-track", "After build");
  const submit = await selectAfterBuild("Google Play (internal track)");

  await runBuild(buildOptions("android", profileName, submit));
}

/** The build journey: platform first, then the platform-specific steps. */
async function runBuildJourney(): Promise<void> {
  const { config, apps } = await loadConfig();
  teach("build-platform", "Platform");
  const platform = await selectPlatform(apps);
  return platform === "ios" ? runIosJourney(config) : runAndroidJourney(config);
}

/**
 * The four-step guided setup, each step detect-and-skip: scaffold config, onboard an Apple account,
 * check the toolchain (offering `--fix` on a Mac), and provision signing. Run automatically on a fresh
 * checkout and on demand from the menu. Signing is Mac-only (it uses the macOS Keychain) and the
 * account/signing steps are skipped for an Android-only setup that declines to add an Apple account.
 */
async function runGuidedSetup(): Promise<void> {
  note(
    [
      "Four quick steps — each is skipped when it's already done:",
      "  1) Config  2) Apple account  3) Toolchain  4) Signing",
    ].join("\n"),
    "Set up Launch",
  );

  // 1 · Config
  if (existsSync(join(process.cwd(), "launch.config.ts"))) {
    note("launch.config.ts is already present.", "1 · Config ✓");
  } else {
    await runInit(process.cwd());
  }

  // 2 · Apple account
  const active = getActiveAccount();
  if (active) {
    note(`Active account: ${active.label}${active.teamId ? ` · team ${active.teamId}` : ""}.`, "2 · Apple account ✓");
  } else {
    const add = await confirm({ message: "Add an Apple account now? (skip if you only ship Android)" });
    if (!isCancel(add) && add) await chooseAccountInteractive();
  }

  // 3 · Toolchain
  if (isMac()) {
    note("Checking your iOS build toolchain…", "3 · Toolchain");
    if (!(await runDoctor({ platform: "ios" }))) {
      const fix = await confirm({ message: "Some tools are missing. Install them now (Homebrew)?" });
      if (!isCancel(fix) && fix) await runDoctor({ platform: "ios", fix: true });
    }
  } else {
    note(
      "No local Mac — iOS builds run on a remote Mac, so no local Xcode is needed. Use `launch cloud doctor` to check a remote host.",
      "3 · Toolchain (remote)",
    );
  }

  // 4 · Signing — provisioning uses the macOS Keychain, so it's Mac-only and needs an account.
  if (isMac() && getActiveAccount()) {
    const provision = await confirm({ message: "Provision (or reuse) your iOS signing cert + profile now?" });
    if (!isCancel(provision) && provision) {
      try {
        await setupIos({});
      } catch (error) {
        note(error instanceof Error ? error.message : String(error), "Signing — skipped");
      }
    }
  }

  note("Setup complete.", "Done");
}

/**
 * Pick which platform leg the simulated tour walks through (default iOS). Returns null if the user
 * skips. Shared by the first-run auto-play below and the standalone `launch demo` command.
 */
export async function promptTourPlatform(): Promise<Platform | null> {
  const choice = await select<Platform>({
    message: "Take the 60-second tour? Pick a platform to walk through (Esc to skip)",
    options: [
      { value: "ios", label: "iOS → TestFlight" },
      { value: "android", label: "Android → Google Play" },
    ],
    initialValue: "ios",
  });
  return isCancel(choice) ? null : choice;
}

/**
 * On the very first interactive `launch` (no args) on this machine, auto-play the simulated walkthrough
 * once, then record it so later runs go straight to the menu. No-op in CI / piped / agent runs (the
 * tour needs a TTY) and once it's been seen. Offered-once: even skipping the platform pick marks it
 * seen, so the tour never nags.
 */
async function maybeRunFirstRunTour(): Promise<void> {
  if (!isInteractive() || hasSeenTour()) return;
  const platform = await promptTourPlatform();
  markTourSeen();
  if (platform) await runTour(platform, true);
}

/** Run the interactive front door. */
export async function runWizard(): Promise<void> {
  await maybeRunFirstRunTour();
  intro("Launch");
  note(`Detected ${hostOsLabel()}.`, "Environment");

  // Fresh checkout (no launch.config.ts) → guide setup, then offer to build straight away.
  if (!existsSync(join(process.cwd(), "launch.config.ts"))) {
    note("Looks like a fresh checkout — let's get Launch ready first.", "First run");
    await runGuidedSetup();
    if (await confirmBuildNow()) await runBuildJourney();
    outro("Done.");
    return;
  }

  const action = resolvePrompt(
    await select<"build" | "setup">({
      message: "What would you like to do?",
      options: [
        { value: "build", label: "Build an app", hint: "compile, check size, upload" },
        {
          value: "setup",
          label: "Set up Launch (credentials & checks)",
          hint: "config · account · toolchain · signing",
        },
      ],
    }),
  );

  if (action === "setup") {
    await runGuidedSetup();
    if (!(await confirmBuildNow())) {
      outro("Done.");
      return;
    }
  }
  await runBuildJourney();
  outro("Done.");
}
