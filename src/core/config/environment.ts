import { Schema } from 'effect';
const optionalEnvironmentText = Schema.optionalWith(Schema.String, { exact: true });
const optionalEnvironmentSecret = Schema.optionalWith(Schema.Redacted(Schema.String), {
  exact: true,
});
/** Every environment variable Launch reads by name, decoded to domain-facing property names. */
export const LaunchEnvironmentSchema = Schema.Struct({
  editorCommand: optionalEnvironmentText.pipe(Schema.fromKey('EDITOR')),
  appleApiKeyPath: optionalEnvironmentText.pipe(Schema.fromKey('ASC_API_KEY_PATH')),
  appleKeyId: optionalEnvironmentText.pipe(Schema.fromKey('ASC_KEY_ID')),
  appleIssuerId: optionalEnvironmentText.pipe(Schema.fromKey('ASC_ISSUER_ID')),
  appleAccount: optionalEnvironmentText.pipe(Schema.fromKey('ASC_ACCOUNT')),
  appleVendorNumber: optionalEnvironmentText.pipe(Schema.fromKey('ASC_VENDOR_NUMBER')),
  playServiceAccountPath: optionalEnvironmentText.pipe(Schema.fromKey('PLAY_SERVICE_ACCOUNT')),
  androidSdkHome: optionalEnvironmentText.pipe(Schema.fromKey('ANDROID_HOME')),
  androidSdkRoot: optionalEnvironmentText.pipe(Schema.fromKey('ANDROID_SDK_ROOT')),
  androidKeystorePassword: optionalEnvironmentSecret.pipe(
    Schema.fromKey('ANDROID_KEYSTORE_PASSWORD'),
  ),
  androidKeyPassword: optionalEnvironmentSecret.pipe(Schema.fromKey('ANDROID_KEY_PASSWORD')),
  ccacheSetting: optionalEnvironmentText.pipe(Schema.fromKey('USE_CCACHE')),
  aiModel: optionalEnvironmentText.pipe(Schema.fromKey('LAUNCH_AI_MODEL')),
  anthropicApiKey: optionalEnvironmentSecret.pipe(Schema.fromKey('ANTHROPIC_API_KEY')),
  s3AccessKeyId: optionalEnvironmentSecret.pipe(Schema.fromKey('LAUNCH_S3_ACCESS_KEY_ID')),
  s3SecretAccessKey: optionalEnvironmentSecret.pipe(Schema.fromKey('LAUNCH_S3_SECRET_ACCESS_KEY')),
  supabaseServiceKey: optionalEnvironmentSecret.pipe(Schema.fromKey('LAUNCH_SUPABASE_SERVICE_KEY')),
  continuousIntegration: optionalEnvironmentText.pipe(Schema.fromKey('CI')),
  noColor: optionalEnvironmentText.pipe(Schema.fromKey('NO_COLOR')),
  colorTerminal: optionalEnvironmentText.pipe(Schema.fromKey('COLORTERM')),
  launchNoAnimation: optionalEnvironmentText.pipe(Schema.fromKey('LAUNCH_NO_ANIMATION')),
  launchNoUpgrade: optionalEnvironmentText.pipe(Schema.fromKey('LAUNCH_NO_UPGRADE')),
  launchUpgraded: optionalEnvironmentText.pipe(Schema.fromKey('LAUNCH_UPGRADED')),
  shellPath: optionalEnvironmentText.pipe(Schema.fromKey('SHELL')),
  language: optionalEnvironmentText.pipe(Schema.fromKey('LANG')),
  languageFallback: optionalEnvironmentText.pipe(Schema.fromKey('LANGUAGE')),
  localeOverride: optionalEnvironmentText.pipe(Schema.fromKey('LC_ALL')),
});
/** Decoded values for Launch's named environment variables. */
export type LaunchEnvironmentValues = Schema.Schema.Type<typeof LaunchEnvironmentSchema>;
/** Decode raw process variables into Launch's named and redacted environment values. */
export const decodeLaunchEnvironment = Schema.decodeUnknown(LaunchEnvironmentSchema);
