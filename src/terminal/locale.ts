// Sets a UTF-8 locale for child tools such as xcodebuild and CocoaPods.

/** Locale variables xcodebuild and CocoaPods need to run with UTF-8. */
export const UTF8_LOCALE = {
  LANG: 'en_US.UTF-8',
  LANGUAGE: 'en_US.UTF-8',
  LC_ALL: 'en_US.UTF-8',
} as const;

export type ShellLocaleEnv = Partial<Pick<NodeJS.ProcessEnv, 'LANG' | 'LC_ALL' | 'LANGUAGE'>>;

/** Merge the environment service's raw variables with UTF-8 locale defaults for child processes. */
export function mergeChildEnv(
  environmentVariables: NodeJS.ProcessEnv,
  extra?: Record<string, string>,
): NodeJS.ProcessEnv {
  return { ...environmentVariables, ...UTF8_LOCALE, ...extra };
}

/** Whether the effective shell locale encodes as UTF-8 (`LC_ALL` -> `LANG` -> `LANGUAGE`). */
export function isUtf8ShellLocale(env: ShellLocaleEnv): boolean {
  let effectiveLocale = env.LC_ALL;

  if (effectiveLocale == null) effectiveLocale = env.LANG;

  if (effectiveLocale == null) effectiveLocale = env.LANGUAGE;

  return typeof effectiveLocale == 'string' && /UTF-?8/i.test(effectiveLocale);
}
