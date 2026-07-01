/**
 * UTF-8 locale helpers for child processes.
 *
 * fastlane/gym and xcpretty assume a UTF-8 locale. macOS shells that default to US-ASCII (or omit
 * LANG/LC_ALL) hit `invalid byte sequence in US-ASCII` when Xcode output contains non-ASCII bytes.
 * Launch forces UTF-8 on every subprocess env (`core/exec.ts`); `launch doctor` reports whether the
 * interactive shell is already UTF-8.
 */

import type { DoctorCheck } from './types.js';

/** Locale variables fastlane documents as required for a healthy iOS build. */
export const UTF8_LOCALE = {
  LANG: 'en_US.UTF-8',
  LANGUAGE: 'en_US.UTF-8',
  LC_ALL: 'en_US.UTF-8',
} as const;

export type ShellLocaleEnv = Partial<Pick<NodeJS.ProcessEnv, 'LANG' | 'LC_ALL' | 'LANGUAGE'>>;

/**
 * Merge `process.env` with UTF-8 locale defaults for {@link spawn}. Caller `env` wins last so tests
 * can override, but production builds always pass UTF-8 unless explicitly replaced.
 */
export function mergeChildEnv(extra?: Record<string, string>): NodeJS.ProcessEnv {
  return { ...process.env, ...UTF8_LOCALE, ...extra };
}

/** Whether the effective shell locale encodes as UTF-8 (`LC_ALL` → `LANG` → `LANGUAGE`). */
export function isUtf8ShellLocale(env: ShellLocaleEnv = process.env): boolean {
  const effective = env.LC_ALL ?? env.LANG ?? env.LANGUAGE;
  return typeof effective === 'string' && /UTF-?8/i.test(effective);
}

/** Doctor line grading the interactive shell locale (build subprocesses are fixed regardless). */
export function shellLocaleDoctorCheck(env: ShellLocaleEnv = process.env): DoctorCheck {
  if (isUtf8ShellLocale(env)) {
    const label = env.LC_ALL ?? env.LANG ?? UTF8_LOCALE.LANG;
    return { status: 'ok', title: `Shell locale (${label})` };
  }
  const observed = env.LC_ALL ?? env.LANG ?? env.LANGUAGE ?? 'unset';
  return {
    status: 'info',
    title: `Shell locale (${observed})`,
    hint: 'Launch sets UTF-8 for fastlane/xcodebuild. Add `export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8` to ~/.zshrc to fix your shell too.',
  };
}
