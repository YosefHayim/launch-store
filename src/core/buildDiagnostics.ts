/**
 * Native build-failure diagnostics — turn a wall of xcodebuild/Gradle/CocoaPods output into a short,
 * actionable "here's the cause, here's the fix" list.
 *
 * Native build logs are long and the real error is usually one line buried in thousands. This module
 * scans a captured log against a curated table of the failures Launch users actually hit and maps each
 * to a plain-English cause and a concrete fix (often a single `launch …` command). It's a pure text →
 * diagnoses function, so it's exhaustively unit-testable and reused in two places: automatically on a
 * failed build (see `core/progress.ts`'s failure path) and on demand via `launch diagnose`.
 *
 * Adding a case = append one {@link DiagnosticSignature}. Keep matches specific enough not to fire on
 * unrelated lines, and order the table most-specific-first since {@link diagnoseBuildLog} preserves
 * table order and de-duplicates by title.
 */

/**
 * One recognized build failure: what went wrong, in human terms, and exactly how to fix it. This is
 * the public result shape — `cause`/`fix` are written to be shown verbatim to the user.
 */
export interface BuildDiagnosis {
  /** Short headline for the problem, e.g. `"Code signing: no usable profile"`. */
  title: string;
  /** Plain-English explanation of why the build failed. */
  cause: string;
  /** The concrete remedy — a command to run or a setting to change. */
  fix: string;
}

/** A diagnosis plus the regexes that trigger it; `match` fires when ANY pattern is found in the log. */
interface DiagnosticSignature extends BuildDiagnosis {
  /** Any one of these matching the log text selects this diagnosis. */
  match: RegExp[];
}

/**
 * The known-failure table, most-specific first. Patterns are intentionally narrow so a diagnosis only
 * fires on its real signature, not on an incidental mention of a word.
 */
const SIGNATURES: DiagnosticSignature[] = [
  {
    title: "Code signing — no usable certificate or profile",
    cause: "Xcode couldn't find a distribution certificate and provisioning profile matching this app.",
    fix: "Run `launch creds setup` to provision (or reuse) the cert + profile, then rebuild.",
    match: [
      /No profiles for '.*' were found/i,
      /doesn't include signing certificate/i,
      /requires a provisioning profile/i,
      /No signing certificate "iOS Distribution"/i,
      /Code Signing Error/i,
    ],
  },
  {
    title: "CocoaPods sandbox out of sync",
    cause: "The installed Pods no longer match Podfile.lock, so Xcode refuses to build.",
    fix: "Re-resolve native deps: `launch build ios --clean` (forces `pod install` + a clean build).",
    match: [/sandbox is not in sync with the Podfile\.lock/i],
  },
  {
    title: "CocoaPods could not resolve dependencies",
    cause: "A pod spec can't be found or the local CocoaPods spec repo is stale.",
    fix: "Update the spec repo (`pod repo update`) then `launch build ios --clean`.",
    match: [
      /CocoaPods could not find compatible versions/i,
      /Unable to find a specification for/i,
      /\[!\] CDN: trunk .* could not/i,
    ],
  },
  {
    title: "Native module not found",
    cause: "A native module isn't linked — usually Pods are stale after adding or upgrading a dependency.",
    fix: "Rebuild clean so Pods re-install and link: `launch build ios --clean`.",
    match: [/error: no such module/i, /Could not build module/i, /Undefined symbol/i, /ld: symbol\(s\) not found/i],
  },
  {
    title: "Xcode command-line tools not selected",
    cause: "The active developer directory is missing or points at the wrong place, so the iOS SDK can't be located.",
    fix: "Install/select the tools: `xcode-select --install`, or `sudo xcode-select -s /Applications/Xcode.app`.",
    match: [/SDK "iphoneos" cannot be located/i, /unable to find utility/i, /xcode-select: error/i],
  },
  {
    title: "Run-script phase failed (Xcode sandbox)",
    cause: "A build script phase failed — on Xcode 15+ this is often the user-script sandbox blocking file access.",
    fix: "Check the failing script in the log; if it's the sandbox, set `ENABLE_USER_SCRIPT_SANDBOXING=NO`.",
    match: [/Command PhaseScriptExecution failed/i, /Sandbox: .* deny/i],
  },
  {
    title: "Android SDK location not found",
    cause: "Gradle can't find the Android SDK — ANDROID_HOME / ANDROID_SDK_ROOT isn't set.",
    fix: "Install the SDK (Android Studio or command-line tools) and export `ANDROID_HOME`. `launch doctor --platform android` checks this.",
    match: [/SDK location not found/i, /ANDROID_HOME is not set/i, /ANDROID_SDK_ROOT/i],
  },
  {
    title: "Wrong JDK version",
    cause: "The JDK on PATH is incompatible with this Android Gradle Plugin version.",
    fix: "Install and select JDK 17 (Temurin) and point `JAVA_HOME` at it.",
    match: [
      /Unsupported class file major version/i,
      /Could not determine java version/i,
      /has been compiled by a more recent version of the Java/i,
    ],
  },
  {
    title: "Android signing — keystore problem",
    cause: "Gradle couldn't read the upload keystore, or the keystore/key password is wrong.",
    fix: "Re-import the keystore: `launch creds setup --platform android`, and check the keystore + key passwords.",
    match: [/Keystore file .* not found/i, /keystore password was incorrect/i, /Failed to read key .* from store/i],
  },
  {
    title: "Android SDK license not accepted",
    cause: "A required SDK package hasn't had its license accepted, so Gradle won't download it.",
    fix: "Accept the licenses: `sdkmanager --licenses` (or via Android Studio's SDK Manager).",
    match: [/You have not accepted the license agreements/i, /license for package .* not accepted/i],
  },
  {
    title: "Gradle ran out of memory",
    cause: "The Gradle/Kotlin daemon exhausted its heap during the build.",
    fix: "Raise the heap in `android/gradle.properties`, e.g. `org.gradle.jvmargs=-Xmx4g`.",
    match: [/OutOfMemoryError/i, /Java heap space/i, /GC overhead limit exceeded/i],
  },
  {
    title: "Dependency download failed (network)",
    cause: "A dependency couldn't be fetched — usually a network, proxy, or registry outage.",
    fix: "Check your connection/proxy and retry; the build is likely fine once the registry is reachable.",
    match: [/Could not resolve all (?:files|dependencies|artifacts)/i, /Could not GET/i, /Connection (?:timed out|refused)/i],
  },
  {
    title: "Out of disk space",
    cause: "The build filled the disk; native builds need several GB of scratch space.",
    fix: "Free up disk space (DerivedData, old simulators, Docker images) and rebuild.",
    match: [/ENOSPC/i, /No space left on device/i],
  },
  {
    title: "A required build tool is missing",
    cause: "A command the build depends on (CocoaPods, fastlane, bundletool) isn't installed or on PATH.",
    fix: "Install the missing toolchain: `launch doctor --fix` (iOS) or `launch doctor --platform android`.",
    match: [/command not found: (?:pod|fastlane|bundletool|gym)/i, /(?:pod|fastlane|bundletool): command not found/i],
  },
];

/**
 * Scan a build log and return the distinct diagnoses whose signatures matched, in table order. Returns
 * an empty array when nothing is recognized — the caller then falls back to the raw log tail.
 */
export function diagnoseBuildLog(log: string): BuildDiagnosis[] {
  const matched: BuildDiagnosis[] = [];
  for (const signature of SIGNATURES) {
    if (signature.match.some((pattern) => pattern.test(log))) {
      matched.push({ title: signature.title, cause: signature.cause, fix: signature.fix });
    }
  }
  return matched;
}

/** Render diagnoses as an indented, human-readable block for the terminal. Empty input → empty string. */
export function formatDiagnoses(diagnoses: BuildDiagnosis[]): string {
  if (diagnoses.length === 0) return "";
  const header = diagnoses.length === 1 ? "Likely cause:" : "Likely causes:";
  const blocks = diagnoses.map(
    (diagnosis) => `  • ${diagnosis.title}\n    Why: ${diagnosis.cause}\n    Fix: ${diagnosis.fix}`,
  );
  return [header, ...blocks].join("\n");
}
