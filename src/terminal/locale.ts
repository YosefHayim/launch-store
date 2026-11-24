// Sets a UTF-8 locale for child tools such as xcodebuild and CocoaPods.

/** Locale variables xcodebuild and CocoaPods need to run with UTF-8. */
export const UTF8_LOCALE = {
  LANG: 'en_US.UTF-8',
  LANGUAGE: 'en_US.UTF-8',
  LC_ALL: 'en_US.UTF-8',
} as const;

/** Merge the environment service's raw variables with UTF-8 locale defaults for child processes. */
export function mergeChildEnv(
  environmentVariables: NodeJS.ProcessEnv,
  extra?: Record<string, string>,
): NodeJS.ProcessEnv {
  return { ...environmentVariables, ...UTF8_LOCALE, ...extra };
}
