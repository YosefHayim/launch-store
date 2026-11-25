import { Path } from '@effect/platform';
import { Effect } from 'effect';

/**
 * One asset (or the launch bundle) in an update manifest: where it lives and what it is.
 * Fields stay writable so copy helpers outside this module can assemble assets without casts.
 */
export type ManifestAsset = {
  key: string;
  contentType: string;
  url: string;
  fileExtension?: string;
};

/** An Expo Updates protocol v0 manifest for one platform + runtime version. */
export type UpdateManifest = {
  id: string;
  createdAt: string;
  runtimeVersion: string;
  launchAsset: ManifestAsset;
  assets: ManifestAsset[];
  metadata: Record<string, never>;
  extra: Record<string, never>;
};

/** Map a file extension to the content type Expo serves it as. */
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.js': 'application/javascript',
  '.hbc': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/** Resolve a file's content type from its extension, defaulting to a binary stream. */
export const contentTypeFor = (filePath: string): Effect.Effect<string, never, Path.Path> =>
  Effect.gen(function* () {
    const pathService = yield* Path.Path;
    const contentType = CONTENT_TYPES[pathService.extname(filePath).toLowerCase()];
    if (contentType === undefined) return 'application/octet-stream';
    return contentType;
  });

/** Inputs for {@link assembleManifest}. */
export type AssembleManifestInput = {
  id: string;
  createdAt: string;
  runtimeVersion: string;
  launchAsset: ManifestAsset;
  assets: ManifestAsset[];
};

/** Assemble a protocol-v0 {@link UpdateManifest} from its resolved parts (pure). */
export const assembleManifest = (input: AssembleManifestInput): UpdateManifest => ({
  id: input.id,
  createdAt: input.createdAt,
  runtimeVersion: input.runtimeVersion,
  launchAsset: input.launchAsset,
  assets: input.assets,
  metadata: {},
  extra: {},
});

/** Static object key for the active manifest. */
export const manifestKey = (channel: string, platform: string, runtimeVersion: string): string =>
  `updates/${channel}/${platform}/${runtimeVersion}/manifest.json`;

/** Object key for the active manifest's `expo-signature` sibling. */
export const manifestSignatureKey = (
  channel: string,
  platform: string,
  runtimeVersion: string,
): string => `updates/${channel}/${platform}/${runtimeVersion}/manifest.sig`;

/** Append-only history index for one channel + platform. */
export const historyIndexKey = (channel: string, platform: string): string =>
  `updates/${channel}/${platform}/history.json`;

/** Immutable snapshot of one published manifest (view / rollback). */
export const historySnapshotKey = (
  channel: string,
  platform: string,
  runtimeVersion: string,
  updateId: string,
): string => `updates/${channel}/${platform}/${runtimeVersion}/history/${updateId}.json`;

/** Active rollback-to-embedded directive for one runtime version. */
export const rollbackDirectiveKey = (
  channel: string,
  platform: string,
  runtimeVersion: string,
): string => `updates/${channel}/${platform}/${runtimeVersion}/rollback.json`;

/**
 * One row in the per-(channel, platform) update history index. The full manifest lives in its
 * {@link historySnapshotKey} snapshot so the index stays a single cheap read for `updates list`.
 */
export type UpdateHistoryEntry = {
  id: string;
  runtimeVersion: string;
  createdAt: string;
  active: boolean;
  signed: boolean;
  kind: 'publish' | 'rollback';
};

/** Expo Updates protocol-v1 `rollBackToEmbedded` directive. */
export type RollbackDirective = {
  type: 'rollBackToEmbedded';
  parameters: {
    commitTime: string;
  };
};

/** Assemble a `rollBackToEmbedded` directive committed at `commitTime`. */
export const assembleRollbackDirective = (commitTime: string): RollbackDirective => ({
  type: 'rollBackToEmbedded',
  parameters: { commitTime },
});

/**
 * Object stored at {@link rollbackDirectiveKey}: the exact serialized {@link RollbackDirective}
 * the worker serves byte-for-byte (so its signature stays valid), optional signature, and an
 * `active` flag. Publish flips `active` to false rather than deleting - the storage seam has no delete.
 */
export type StoredRollbackDirective = {
  active: boolean;
  body: string;
  signature?: string;
};

/**
 * Cloudflare Worker that turns the static bucket layout into an Expo Updates protocol-v1 endpoint.
 * Serves multipart/mixed (manifest + optional rollback directive) with per-part signatures.
 * Bodies are served byte-for-byte as published so signatures stay valid. Deploy in the user's
 * Cloudflare account and point `updates.url` at it.
 */
export const updatesWorkerScript = (publicBaseUrl: string): string => {
  const publicBase = publicBaseUrl.replace(/\/+$/, '');
  return [
    '// Generated by `launch update` - Expo Updates protocol (v1) router over a static bucket.',
    '// Serves a multipart/mixed response (manifest + optional rollback directive), each part',
    '// independently signed. Deploy to your own Cloudflare account and point updates.url at this Worker.',
    `const PUBLIC_BASE = ${JSON.stringify(publicBase)};`,
    "const BOUNDARY = 'launch-update-boundary';",
    '',
    '// Build one multipart part. The body is embedded verbatim so its precomputed signature stays valid.',
    'function part(name, body, signature) {',
    '  const headers = [',
    "    'Content-Type: application/json; charset=utf-8',",
    '    `Content-Disposition: form-data; name="${name}"`,',
    '  ];',
    '  if (signature) headers.push(`expo-signature: ${signature}`);',
    "  return `--${BOUNDARY}\\r\\n${headers.join('\\r\\n')}\\r\\n\\r\\n${body}\\r\\n`;",
    '}',
    '',
    'export default {',
    '  async fetch(request) {',
    "    const runtimeVersion = request.headers.get('expo-runtime-version');",
    "    const platform = request.headers.get('expo-platform');",
    "    const channel = request.headers.get('expo-channel-name') || 'production';",
    '    if (!runtimeVersion || !platform) {',
    "      return new Response('Missing expo-runtime-version / expo-platform', { status: 400 });",
    '    }',
    '    const prefix = `${PUBLIC_BASE}/updates/${channel}/${platform}/${runtimeVersion}`;',
    '',
    '    // Active rollback directive (if any) - served verbatim with its precomputed signature.',
    "    let directivePart = '';",
    '    const rollbackRes = await fetch(`${prefix}/rollback.json`);',
    '    if (rollbackRes.ok) {',
    '      const rollback = await rollbackRes.json();',
    "      if (rollback && rollback.active) directivePart = part('directive', rollback.body, rollback.signature);",
    '    }',
    '',
    '    // Active manifest (if any) + its signature.',
    "    let manifestPart = '';",
    '    const manifestRes = await fetch(`${prefix}/manifest.json`);',
    '    if (manifestRes.ok) {',
    '      const body = await manifestRes.text();',
    '      const sig = await fetch(`${prefix}/manifest.sig`);',
    "      manifestPart = part('manifest', body, sig.ok ? (await sig.text()).trim() : undefined);",
    '    }',
    '',
    "    if (!manifestPart && !directivePart) return new Response('No update', { status: 404 });",
    '    return new Response(`${manifestPart}${directivePart}--${BOUNDARY}--\\r\\n`, {',
    '      headers: {',
    "        'content-type': `multipart/mixed; boundary=${BOUNDARY}`,",
    "        'expo-protocol-version': '1',",
    "        'expo-sfv-version': '0',",
    "        'cache-control': 'private, max-age=0',",
    '      },',
    '    });',
    '  },',
    '};',
  ].join('\n');
};

/** Inputs for {@link updatesAppConfigSnippet}. */
export type AppConfigSnippetInput = {
  updateUrl: string;
  runtimeVersion: string;
  signed: boolean;
};

/**
 * One-time `app.json` `expo.updates` block after first publish so the app points at the
 * self-hosted endpoint. Includes the code-signing certificate pointer when signed.
 */
export const updatesAppConfigSnippet = (input: AppConfigSnippetInput): string => {
  const updatesBlock: Record<string, unknown> = {
    url: input.updateUrl,
    enabled: true,
    fallbackToCacheTimeout: 0,
  };
  if (input.signed) {
    updatesBlock['codeSigningCertificate'] = './certs/launch-code-signing.pem';
    updatesBlock['codeSigningMetadata'] = { keyid: 'main', alg: 'rsa-v1_5-sha256' };
  }
  return JSON.stringify(
    { expo: { runtimeVersion: input.runtimeVersion, updates: updatesBlock } },
    null,
    2,
  );
};
