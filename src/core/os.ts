/**
 * Host operating-system detection.
 *
 * One place to answer "what am I running on?" so the wizard and the build commands route correctly:
 * iOS code signing is macOS-only, so a non-Mac host must build remotely (AWS EC2 Mac / a Mac over
 * SSH) or hand off to Expo EAS. Centralized here rather than scattering `process.platform` checks.
 */

import { platform } from "node:os";
import type { HostOs } from "./types.js";

/** Resolve the current {@link HostOs} from Node's platform string (anything non-darwin/win32 is treated as linux). */
export function hostOs(): HostOs {
  switch (platform()) {
    case "darwin":
      return "macos";
    case "win32":
      return "windows";
    default:
      return "linux";
  }
}

/** True when Launch can sign and build iOS locally (i.e. we're on a Mac). */
export function isMac(): boolean {
  return hostOs() === "macos";
}

/** A short, human label for the host OS, used in wizard copy and `cloud doctor`. */
export function hostOsLabel(): string {
  switch (hostOs()) {
    case "macos":
      return "macOS";
    case "windows":
      return "Windows";
    case "linux":
      return "Linux";
  }
}
