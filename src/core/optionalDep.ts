/**
 * Loader for Launch's OPTIONAL cloud dependencies.
 *
 * The AWS SDK and the native keyring are declared in `optionalDependencies` and imported only on the
 * remote-build / non-Mac paths, so a local-only Mac install never loads them (decision 4/6 in
 * docs/plan-aws-ec2-mac.md). This helper turns the one failure that matters — the package isn't
 * installed (e.g. the user ran `npm install --no-optional`, or a prebuilt native binary was missing) —
 * into an actionable "install this" message, while letting any other error surface unchanged.
 */

/** Matches the module-resolution errors Node/the loader throw when a package isn't installed. */
const NOT_INSTALLED = /Cannot find (module|package)|ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND/;

/**
 * Run an optional-dependency dynamic `import()`, mapping a "not installed" failure to a clear message.
 *
 * @param feature  Human label for what needs it, e.g. "AWS EC2 Mac builds".
 * @param installHint  The exact command to install the missing package(s).
 * @param load  A thunk performing the dynamic `import()` (kept as a thunk so the import is lazy).
 */
export async function requireOptional<T>(feature: string, installHint: string, load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (NOT_INSTALLED.test(message)) {
      throw new Error(`${feature} need an optional package that isn't installed. Install it with:\n  ${installHint}`);
    }
    throw error instanceof Error ? error : new Error(message);
  }
}
