import { hasMessage } from './errorMessage.js';

const NOT_INSTALLED = /Cannot find (module|package)|ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND/;

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

function isOptionalDependencyMissing(cause: unknown): cause is OptionalDependencyMissing {
  if (cause == null) {
    return false;
  }

  if (typeof cause != 'object') {
    return false;
  }

  if ('_tag' in cause == false) {
    return false;
  }

  return cause._tag == 'OptionalDependencyMissing';
}

export async function requireOptional<LoadedCapability>(
  feature: string,
  installHint: string,
  load: () => Promise<LoadedCapability>,
): Promise<LoadedCapability> {
  try {
    return await load();
  } catch (cause) {
    if (isOptionalDependencyMissing(cause)) {
      throw cause;
    }

    let message = String(cause);

    if (hasMessage(cause)) {
      message = cause.message;
    }

    const isInstalled = NOT_INSTALLED.test(message) == false;

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
