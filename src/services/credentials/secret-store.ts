import { captureCommandOutput } from '../platform/exec.ts';
import { requireOptional } from '../platform/optional-dep.ts';
import { detectHostOperatingSystem } from '../platform/os.ts';

const KEYCHAIN_SERVICE_NAME = 'launch';
const MACOS_ITEM_NOT_FOUND_EXIT_CODE = 44;

type KeyringModule = typeof import('@napi-rs/keyring');

let loadedKeyring: KeyringModule | null = null;
let secretFixture: Map<string, string> | null = null;

export function useSecretStore(storedSecrets: Map<string, string> | null): void {
  secretFixture = storedSecrets;
}

export function resetSecretStore(): void {
  secretFixture = null;
}

async function loadNativeKeyring(): Promise<KeyringModule> {
  if (loadedKeyring != null) {
    return loadedKeyring;
  }

  loadedKeyring = await requireOptional(
    'Secure credential storage',
    'pnpm add @napi-rs/keyring',
    function loadKeyring() {
      return import('@napi-rs/keyring');
    },
  );

  return loadedKeyring;
}

function readExitCode(cause: unknown): unknown {
  if (cause == null) {
    return null;
  }

  if (typeof cause != 'object') {
    return null;
  }

  if ('exitCode' in cause == false) {
    return null;
  }

  return cause.exitCode;
}

async function confirmMacosMissingSecret(account: string): Promise<null> {
  try {
    await captureCommandOutput('security', [
      'find-generic-password',
      '-s',
      KEYCHAIN_SERVICE_NAME,
      '-a',
      account,
    ]);
  } catch (cause) {
    const exitCode = readExitCode(cause);
    const isItemMissing = exitCode == MACOS_ITEM_NOT_FOUND_EXIT_CODE;

    if (isItemMissing) {
      return null;
    }

    throw new Error(`Could not read ${account} from the keychain`, { cause });
  }

  throw new Error(`Could not read ${account} from the keychain`);
}

async function readNativeSecret(account: string): Promise<string | null> {
  const { Entry } = await loadNativeKeyring();

  let storedPassword: string | null;

  try {
    storedPassword = new Entry(KEYCHAIN_SERVICE_NAME, account).getPassword();
  } catch (cause) {
    throw new Error(`Could not read ${account} from the keychain`, { cause });
  }

  const isMacos = detectHostOperatingSystem() == 'macos';
  const isMissingPassword = storedPassword == null;

  if (isMissingPassword == false) {
    return storedPassword;
  }

  if (isMacos == false) {
    return storedPassword;
  }

  return confirmMacosMissingSecret(account);
}

async function storeNativeSecret(account: string, secretText: string): Promise<void> {
  const { Entry } = await loadNativeKeyring();

  try {
    new Entry(KEYCHAIN_SERVICE_NAME, account).setPassword(secretText);
  } catch (cause) {
    throw new Error(`Could not store ${account} in the keychain`, { cause });
  }
}

async function deleteNativeSecret(account: string): Promise<void> {
  const { Entry } = await loadNativeKeyring();

  try {
    new Entry(KEYCHAIN_SERVICE_NAME, account).deletePassword();
  } catch (cause) {
    const isAlreadyGone = cause != null;

    if (isAlreadyGone) {
      return;
    }
  }
}

export const LaunchSecretStore = {
  async readSecret(account: string): Promise<string | null> {
    if (secretFixture != null) {
      const secretText = secretFixture.get(account);

      if (secretText == null) {
        return null;
      }

      return secretText;
    }

    return readNativeSecret(account);
  },
  async storeSecret(account: string, secretText: string): Promise<void> {
    if (secretFixture != null) {
      secretFixture.set(account, secretText);
      return;
    }

    await storeNativeSecret(account, secretText);
  },
  async deleteSecret(account: string): Promise<void> {
    if (secretFixture != null) {
      secretFixture.delete(account);
      return;
    }

    await deleteNativeSecret(account);
  },
};
