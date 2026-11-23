export interface LaunchEnvironmentValues {
  editorCommand?: string;
  appleApiKeyPath?: string;
  appleKeyId?: string;
  appleIssuerId?: string;
  appleAccount?: string;
  appleVendorNumber?: string;
  playServiceAccountPath?: string;
  androidSdkHome?: string;
  androidSdkRoot?: string;
  androidKeystorePassword?: string;
  androidKeyPassword?: string;
  ccacheSetting?: string;
  aiModel?: string;
  anthropicApiKey?: string;
  s3AccessKeyId?: string;
  s3SecretAccessKey?: string;
  supabaseServiceKey?: string;
  continuousIntegration?: string;
  noColor?: string;
  colorTerminal?: string;
  launchNoUpgrade?: string;
  launchUpgraded?: string;
  shellPath?: string;
  language?: string;
  languageFallback?: string;
  localeOverride?: string;
}

const ENVIRONMENT_FIELDS = {
  EDITOR: 'editorCommand',
  ASC_API_KEY_PATH: 'appleApiKeyPath',
  ASC_KEY_ID: 'appleKeyId',
  ASC_ISSUER_ID: 'appleIssuerId',
  ASC_ACCOUNT: 'appleAccount',
  ASC_VENDOR_NUMBER: 'appleVendorNumber',
  PLAY_SERVICE_ACCOUNT: 'playServiceAccountPath',
  ANDROID_HOME: 'androidSdkHome',
  ANDROID_SDK_ROOT: 'androidSdkRoot',
  ANDROID_KEYSTORE_PASSWORD: 'androidKeystorePassword',
  ANDROID_KEY_PASSWORD: 'androidKeyPassword',
  USE_CCACHE: 'ccacheSetting',
  LAUNCH_AI_MODEL: 'aiModel',
  ANTHROPIC_API_KEY: 'anthropicApiKey',
  LAUNCH_S3_ACCESS_KEY_ID: 's3AccessKeyId',
  LAUNCH_S3_SECRET_ACCESS_KEY: 's3SecretAccessKey',
  LAUNCH_SUPABASE_SERVICE_KEY: 'supabaseServiceKey',
  CI: 'continuousIntegration',
  NO_COLOR: 'noColor',
  COLORTERM: 'colorTerminal',
  LAUNCH_NO_UPGRADE: 'launchNoUpgrade',
  LAUNCH_UPGRADED: 'launchUpgraded',
  SHELL: 'shellPath',
  LANG: 'language',
  LANGUAGE: 'languageFallback',
  LC_ALL: 'localeOverride',
} as const;

function readPresentText(
  variables: Readonly<Record<string, string | undefined>>,
  name: string,
): string | null {
  const text = variables[name];

  if (text == null) {
    return null;
  }

  if (text == '') {
    return null;
  }

  return text;
}

export function decodeLaunchEnvironment(
  variables: Readonly<Record<string, string | undefined>>,
): LaunchEnvironmentValues {
  const decoded: LaunchEnvironmentValues = {};

  for (const environmentName of Object.keys(ENVIRONMENT_FIELDS)) {
    const text = readPresentText(variables, environmentName);

    if (text == null) {
      continue;
    }

    const fieldName = ENVIRONMENT_FIELDS[environmentName as keyof typeof ENVIRONMENT_FIELDS];

    decoded[fieldName] = text;
  }

  return decoded;
}
