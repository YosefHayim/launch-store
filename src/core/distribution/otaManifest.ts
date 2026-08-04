import { Path } from '@effect/platform';
import { Effect } from 'effect';
/** One asset (or the launch bundle) in an update manifest: where it lives and what it is. */
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
/** Map a file extension to the content type Expo serves it as. The single source for asset typing. */
const CONTENT_TYPES: Record<string, string> = {
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
/** Assemble a protocol-v0 {@link UpdateManifest} from its resolved parts (pure; the command supplies URLs/hashes). */
export const assembleManifest = (input: AssembleManifestInput): UpdateManifest => {
  return {
    id: input.id,
    createdAt: input.createdAt,
    runtimeVersion: input.runtimeVersion,
    launchAsset: input.launchAsset,
    assets: input.assets,
    metadata: {},
    extra: {},
  };
};
/** The static object key a manifest lives at, keyed by channel + platform + runtime version. */
export const manifestKey = (channel: string, platform: string, runtimeVersion: string): string => {
  return `updates/${channel}/${platform}/${runtimeVersion}/manifest.json`;
};
/** The object key the active manifest's `expo-signature` value lives at - the sibling of {@link manifestKey}. */
export const manifestSignatureKey = (
  channel: string,
  platform: string,
  runtimeVersion: string,
): string => {
  return `updates/${channel}/${platform}/${runtimeVersion}/manifest.sig`;
};
/** The append-only history index for a (channel, platform): every published update across all runtime versions. */
export const historyIndexKey = (channel: string, platform: string): string => {
  return `updates/${channel}/${platform}/history.json`;
};
/** The immutable snapshot of one published manifest, kept so `updates view` / `rollback` can read it back. */
export const historySnapshotKey = (
  channel: string,
  platform: string,
  runtimeVersion: string,
  id: string,
): string => {
  return `updates/${channel}/${platform}/${runtimeVersion}/history/${id}.json`;
};
/** The active rollback-to-embedded directive for a channel, platform, and runtime version. */
export const rollbackDirectiveKey = (
  channel: string,
  platform: string,
  runtimeVersion: string,
): string => {
  return `updates/${channel}/${platform}/${runtimeVersion}/rollback.json`;
};
/**
 * One row in the per-(channel, platform) update history index. Lean by design - the full manifest (asset
 * URLs included) lives in its {@link historySnapshotKey} snapshot, so the index stays a single cheap read
 * for `updates list`. The index spans every runtime version on the channel; each row carries its own.
 */
export type UpdateHistoryEntry = {
  id: string;
  runtimeVersion: string;
  createdAt: string;
  active: boolean;
  signed: boolean;
  kind: 'publish' | 'rollback';
};
/** The Expo Updates protocol-v1 `rollBackToEmbedded` directive body - instructs clients to drop to the embedded bundle. */
export type RollbackDirective = {
  type: 'rollBackToEmbedded';
  parameters: {
    commitTime: string;
  };
};
/** Assemble a `rollBackToEmbedded` directive committed at `commitTime` (clients roll back only if it post-dates their update). */
export const assembleRollbackDirective = (commitTime: string): RollbackDirective => {
  return { type: 'rollBackToEmbedded', parameters: { commitTime } };
};
/**
 * The object stored at {@link rollbackDirectiveKey}. Wraps the EXACT serialized {@link RollbackDirective}
 * body the worker must serve byte-for-byte (so its signature stays valid) plus its `expo-signature` and an
 * `active` flag. A later `launch update` publish flips `active` to false rather than deleting, since the
 * {@link StorageProvider} seam intentionally has no delete - a stale-but-inactive marker is the clear way.
 */
export type StoredRollbackDirective = {
  active: boolean;
  body: string;
  signature?: string;
};
/**
 * Generate the Cloudflare Worker that turns the static bucket layout into a protocol-compliant Expo
 * Updates endpoint. It reads the `expo-*` request headers and returns a protocol-v1 `multipart/mixed`
 * response: a `manifest` part (from the static `manifest.json` + its `.sig`) and, when a rollback is in
 * effect, a `directive` part (from `rollback.json`) - each carrying its own `expo-signature` part header
 * so the client verifies them independently. The bodies are served byte-for-byte as published so the
 * signatures stay valid (the worker holds no key and never re-serializes). Runs in the USER's own
 * Cloudflare account - Launch hosts nothing. Deploy its output and point the app's `updates.url` at it.
 */
export const updatesWorkerScript = (publicBaseUrl: string): string => {
  const base = publicBaseUrl.replace(/\/+$/, '');
  return [
    '// Generated by `launch update` - Expo Updates protocol (v1) router over a static bucket.',
    '// Serves a multipart/mixed response (manifest + optional rollback directive), each part',
    '// independently signed. Deploy to your own Cloudflare account and point updates.url at this Worker.',
    `const PUBLIC_BASE = ${JSON.stringify(base)};`,
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
 * The one-time `app.json` `expo.updates` block to print after the first publish, so the developer
 * wires the app to the self-hosted endpoint. Includes the code-signing certificate pointer when signed
 * - without it `expo-updates` would accept any manifest the URL returns.
 */
export const updatesAppConfigSnippet = (input: AppConfigSnippetInput): string => {
  const updates: Record<string, unknown> = {
    url: input.updateUrl,
    enabled: true,
    fallbackToCacheTimeout: 0,
  };
  if (input.signed) {
    updates['codeSigningCertificate'] = './certs/launch-code-signing.pem';
    updates['codeSigningMetadata'] = { keyid: 'main', alg: 'rsa-v1_5-sha256' };
  }
  return JSON.stringify({ expo: { runtimeVersion: input.runtimeVersion, updates } }, null, 2);
};
