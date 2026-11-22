import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveCommandEnv, selectApp, validateResolvedEnv } from '../build/pipelineEnv.ts';
import { ensureCodeSigner } from '../credentials/codeSign.ts';
import { publishOtaPlatform, readExportMetadata } from '../distribution/otaPublish.ts';
import { updatesAppConfigSnippet, updatesWorkerScript } from '../distribution/otaManifest.ts';
import { isCloudStorage, resolveStorageProvider } from '../distribution/storage.ts';
import { hasMessage } from '../services/platform/errorMessage.ts';
import { executeCommand, type CommandExecutionOptions } from '../services/platform/exec.ts';
import { createLogger, type Logger } from '../services/platform/logger.ts';
import type { AppDescriptor } from '../types/app.ts';
import { loadConfig } from './config.ts';
import { formatEnvTable, parseCliEnv } from './env.ts';

type UpdateCommandInput = Readonly<{
  channel: string;
  platform: string;
  app?: string;
  profile: string;
  runtimeVersion?: string;
  sign: boolean;
  dryRun: boolean;
  env: readonly string[];
  includeLocal: boolean;
  printEnv: boolean;
}>;

type UpdateCommandFailure = Readonly<{
  _tag: 'UpdateCommandFailure';
  operation: string;
  message: string;
  cause: unknown;
}>;

type UpdatePlatform = 'ios' | 'android';

function updateFailure(
  operation: string,
  cause: unknown,
  fallbackMessage?: string,
): UpdateCommandFailure {
  let message = fallbackMessage;

  if (message == null) {
    if (hasMessage(cause)) {
      message = cause.message;
    }
  }

  if (message == null) {
    message = `${operation} failed.`;
  }

  return { _tag: 'UpdateCommandFailure', operation, message, cause };
}

function platformsFor(platformSelector: string): readonly UpdatePlatform[] {
  if (platformSelector == 'ios') {
    return ['ios'];
  }

  if (platformSelector == 'android') {
    return ['android'];
  }

  if (platformSelector == 'all') {
    return ['ios', 'android'];
  }

  throw updateFailure(
    'select update platforms',
    platformSelector,
    `Unknown --platform "${platformSelector}". Use ios, android, or all.`,
  );
}

function isPlainRecord(candidate: unknown): candidate is Record<string, unknown> {
  if (candidate == null) {
    return false;
  }

  if (typeof candidate != 'object') {
    return false;
  }

  return Array.isArray(candidate) == false;
}

function readRuntimeVersion(candidate: unknown): string | null {
  if (isPlainRecord(candidate)) {
    return runtimeVersionFromRecord(candidate);
  }

  return null;
}

function runtimeVersionFromRecord(candidate: Record<string, unknown>): string | null {
  const expo = candidate['expo'];

  if (isPlainRecord(expo)) {
    const expoRuntimeVersion = expo['runtimeVersion'];

    if (typeof expoRuntimeVersion == 'string') {
      return expoRuntimeVersion;
    }
  }

  const runtimeVersion = candidate['runtimeVersion'];

  if (typeof runtimeVersion == 'string') {
    return runtimeVersion;
  }

  return null;
}

export async function resolveRuntimeVersion(
  appDescriptor: AppDescriptor,
  override: string | undefined,
): Promise<string> {
  const hasOverride = override != null;

  if (hasOverride) {
    const overrideIsBlank = override == '';

    if (overrideIsBlank == false) {
      return override;
    }
  }

  let appConfigText: string;

  try {
    appConfigText = await readFile(appDescriptor.configPath, 'utf8');
  } catch (cause) {
    throw updateFailure('read app runtime version', cause);
  }

  let parsedConfig: unknown;

  try {
    parsedConfig = JSON.parse(appConfigText);
  } catch (cause) {
    throw updateFailure('decode app runtime version', cause);
  }

  const configuredVersion = readRuntimeVersion(parsedConfig);

  if (configuredVersion != null) {
    return configuredVersion;
  }

  if (appDescriptor.version != null) {
    const versionIsBlank = appDescriptor.version == '';

    if (versionIsBlank == false) {
      return appDescriptor.version;
    }
  }

  throw updateFailure(
    'resolve update runtime version',
    appDescriptor.configPath,
    'Could not resolve a runtime version. Pass --runtime-version <v> (e.g. 1.0.0).',
  );
}

function renderAfterPublish(
  workerUrl: string,
  runtimeVersion: string,
  signed: boolean,
  logger: Logger,
): void {
  logger.gap();
  logger.note(
    "Edge worker uploaded - deploy it (Cloudflare) and point the app's updates.url at the Worker route.",
  );
  logger.note(`Worker source: ${workerUrl}`);
  logger.gap();
  logger.note('One-time app config (app.json):');
  logger.line(
    updatesAppConfigSnippet({
      updateUrl: '<your-worker-route>',
      runtimeVersion,
      signed,
    }),
  );
}

function readExportOptions(
  workingDirectory: string,
  environmentOverrides: Record<string, string>,
  excludedEnvironmentNames: readonly string[] | undefined,
): CommandExecutionOptions {
  const baseOptions = {
    workingDirectory,
    environmentOverrides,
  };

  if (excludedEnvironmentNames == null) {
    return baseOptions;
  }

  return {
    ...baseOptions,
    envExclude: excludedEnvironmentNames,
  };
}

export async function updateCommandProgram(commandInput: UpdateCommandInput): Promise<void> {
  const logger = createLogger(false);
  const platforms = platformsFor(commandInput.platform);
  let loadedConfiguration: Awaited<ReturnType<typeof loadConfig>>;

  try {
    loadedConfiguration = await loadConfig();
  } catch (cause) {
    throw updateFailure('load Launch configuration', cause);
  }

  let selectedApp: AppDescriptor;

  try {
    selectedApp = await selectApp(loadedConfiguration.apps, commandInput.app);
  } catch (cause) {
    throw updateFailure('select app', cause, hasMessage(cause) ? cause.message : undefined);
  }

  let buildProfile = loadedConfiguration.config.profiles[commandInput.profile];

  if (buildProfile == null) {
    buildProfile = { name: commandInput.profile };
  }

  const runtimeVersion = await resolveRuntimeVersion(selectedApp, commandInput.runtimeVersion);
  let environmentOverrides: ReturnType<typeof parseCliEnv>;

  try {
    environmentOverrides = parseCliEnv([...commandInput.env]);
  } catch (cause) {
    throw updateFailure(
      'parse environment overrides',
      cause,
      hasMessage(cause) ? cause.message : undefined,
    );
  }

  let resolvedEnvironment: Awaited<ReturnType<typeof resolveCommandEnv>>;

  try {
    resolvedEnvironment = await resolveCommandEnv({
      app: selectedApp,
      profile: buildProfile,
      cliEnv: environmentOverrides,
      includeLocal: commandInput.includeLocal,
      envExclude: loadedConfiguration.config.envExclude,
    });
  } catch (cause) {
    throw updateFailure('resolve update environment', cause);
  }

  if (commandInput.printEnv) {
    logger.line(formatEnvTable(resolvedEnvironment));

    return;
  }

  try {
    await validateResolvedEnv(
      selectedApp.dir,
      resolvedEnvironment,
      logger,
      loadedConfiguration.config.envExclude,
    );
  } catch (cause) {
    throw updateFailure('validate update environment', cause);
  }

  const cloudStorage = isCloudStorage(loadedConfiguration.config);

  if (cloudStorage == false) {
    throw updateFailure(
      'resolve OTA storage',
      loadedConfiguration.config.storage,
      'OTA updates need a cloud storage provider. Set storage to s3 or supabase and add storageConfig in launch.config.ts.',
    );
  }

  logger.step(
    'config',
    `${selectedApp.name} - channel ${commandInput.channel} - rtv ${runtimeVersion} - ${platforms.join('+')}`,
  );

  let storageProvider: Awaited<ReturnType<typeof resolveStorageProvider>>;

  try {
    storageProvider = await resolveStorageProvider(loadedConfiguration.config);
  } catch (cause) {
    throw updateFailure('resolve OTA storage', cause);
  }

  const workerPath = 'updates/_worker.js';

  if (commandInput.dryRun) {
    for (const platform of platforms) {
      logger.step(
        'update',
        `would export + upload ${platform} manifest -> updates/${commandInput.channel}/${platform}/${runtimeVersion}/`,
        'ota-update',
      );
    }

    let signingSummary = 'off (--no-sign)';

    if (commandInput.sign) {
      signingSummary = 'on (manifests code-signed)';
    }

    logger.note(`signing: ${signingSummary}`);
    renderAfterPublish(
      storageProvider.publicUrl(workerPath),
      runtimeVersion,
      commandInput.sign,
      logger,
    );

    return;
  }

  const distributionDirectory = join(selectedApp.dir, 'dist');
  logger.run(`Exporting JS bundle - ${selectedApp.name}`);

  const excludedEnvironmentNames = loadedConfiguration.config.envExclude;
  const exportOptions = readExportOptions(
    selectedApp.dir,
    resolvedEnvironment.values,
    excludedEnvironmentNames,
  );

  try {
    await executeCommand(
      'npx',
      ['expo', 'export', '--output-dir', distributionDirectory],
      exportOptions,
    );
  } catch (cause) {
    throw updateFailure('export update bundle', cause);
  }

  logger.ok(`Exported JS bundle - ${selectedApp.name}`);

  let exportMetadata: Awaited<ReturnType<typeof readExportMetadata>>;

  try {
    exportMetadata = await readExportMetadata(distributionDirectory);
  } catch (cause) {
    throw updateFailure('read update export metadata', cause);
  }

  let codeSigner = null;

  if (commandInput.sign) {
    try {
      codeSigner = await ensureCodeSigner(false, logger);
    } catch (cause) {
      throw updateFailure('resolve update signer', cause);
    }
  }

  for (const platform of platforms) {
    try {
      await publishOtaPlatform(
        {
          storage: storageProvider,
          distDir: distributionDirectory,
          metadata: exportMetadata,
          platform,
          channel: commandInput.channel,
          runtimeVersion,
          signer: codeSigner,
        },
        logger,
      );
    } catch (cause) {
      throw updateFailure(`publish ${platform} update`, cause);
    }
  }

  try {
    await storageProvider.putObject(
      workerPath,
      updatesWorkerScript(storageProvider.publicUrl('')),
      'application/javascript',
    );
  } catch (cause) {
    throw updateFailure('upload update worker', cause);
  }

  renderAfterPublish(
    storageProvider.publicUrl(workerPath),
    runtimeVersion,
    commandInput.sign,
    logger,
  );
}
