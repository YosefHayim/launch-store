import type { DoctorCheck } from '../types/doctor.js';
/** Locale variables fastlane documents as required for a healthy iOS build. */
export const UTF8_LOCALE = {
  LANG: 'en_US.UTF-8',
  LANGUAGE: 'en_US.UTF-8',
  LC_ALL: 'en_US.UTF-8',
} as const;
export type ShellLocaleEnv = Partial<Pick<NodeJS.ProcessEnv, 'LANG' | 'LC_ALL' | 'LANGUAGE'>>;
/**
 * Merge the environment service's raw variables with UTF-8 locale defaults for child processes. Caller `env` wins last so tests
 * can override, but production builds always pass UTF-8 unless explicitly replaced.
 */
export const mergeChildEnv = (
  environmentVariables: NodeJS.ProcessEnv,
  extra?: Record<string, string>,
): NodeJS.ProcessEnv => {
  return { ...environmentVariables, ...UTF8_LOCALE, ...extra };
};
/** Whether the effective shell locale encodes as UTF-8 (`LC_ALL` -> `LANG` -> `LANGUAGE`). */
export const isUtf8ShellLocale = (env: ShellLocaleEnv): boolean => {
  let effectiveLocale = env.LC_ALL;
  if (effectiveLocale === undefined) effectiveLocale = env.LANG;
  if (effectiveLocale === undefined) effectiveLocale = env.LANGUAGE;
  return typeof effectiveLocale === 'string' && /UTF-?8/i.test(effectiveLocale);
};
/** Doctor line grading the interactive shell locale (build subprocesses are fixed regardless). */
export const shellLocaleDoctorCheck = (env: ShellLocaleEnv): DoctorCheck => {
  if (isUtf8ShellLocale(env)) {
    let localeLabel = env.LC_ALL;
    if (localeLabel === undefined) localeLabel = env.LANG;
    if (localeLabel === undefined) localeLabel = UTF8_LOCALE.LANG;
    return { status: 'ok', title: `Shell locale (${localeLabel})` };
  }
  let observedLocale = env.LC_ALL;
  if (observedLocale === undefined) observedLocale = env.LANG;
  if (observedLocale === undefined) observedLocale = env.LANGUAGE;
  if (observedLocale === undefined) observedLocale = 'unset';
  return {
    status: 'info',
    title: `Shell locale (${observedLocale})`,
    hint: 'Launch sets UTF-8 for fastlane/xcodebuild. Add `export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8` to ~/.zshrc to fix your shell too.',
  };
};
