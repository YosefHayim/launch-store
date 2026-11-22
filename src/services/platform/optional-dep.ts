import { hasMessage } from './error-message.ts';
import { isFailureTag } from './tagged-failure.ts';

type OptionalDependencyMissing = Readonly<{
  _tag: 'OptionalDependencyMissing';
  feature: string;
  installHint: string;
  message: string;
}>;

function makeOptionalDependencyMissing(fields: {
  feature: string;
  installHint: string;
  message: string;
}): OptionalDependencyMissing {
  return { _tag: 'OptionalDependencyMissing', ...fields };
}

export async function requireOptional<LoadedCapability>(
  feature: string,
  installHint: string,
  load: () => Promise<LoadedCapability>,
): Promise<LoadedCapability> {
  try {
    return await load();
  } catch (cause) {
    if (isFailureTag(cause, 'OptionalDependencyMissing')) {
      throw cause;
    }

    let message = String(cause);

    if (hasMessage(cause)) {
      message = cause.message;
    }

    const isInstalled =
      /Cannot find (module|package)|ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND/.test(message) == false;

    if (isInstalled) {
      throw cause;
    }

    throw makeOptionalDependencyMissing({
      feature,
      installHint,
      message: `${feature} needs an optional package that isn't installed. Install it with:\n  ${installHint}`,
    });
  }
}
