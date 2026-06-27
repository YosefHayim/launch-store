/**
 * The Expo Updates protocol layer for `launch update` — building the update manifest, mapping file
 * extensions to content types, and generating the edge-routing worker + the one-time app config.
 *
 * Launch publishes OTA updates as STATIC files on the user's own bucket (the locked "BYO bucket, no
 * Launch server" decision). But the Expo Updates protocol is header-driven: the `expo-updates` client
 * sends `expo-runtime-version` / `expo-platform` / `expo-channel-name` to one fixed URL and expects the
 * matching manifest back — which a bare bucket can't branch on. So Launch also emits a tiny edge worker
 * (runs in the user's OWN Cloudflare/edge account) that maps those headers to the right static manifest.
 * This module is the pure builder; the `launch update` command exports the bundle, uploads, and signs.
 *
 * NOTE: the worker speaks Expo Updates protocol v1 — a `multipart/mixed` response carrying a `manifest`
 * part and, when a rollback is active, a `directive` part (`rollBackToEmbedded`), each independently
 * code-signed via its own `expo-signature` part header. The manifest body itself is identical to v0; v1
 * only governs transport, which is precisely what lets the worker serve directives (the rollback path).
 */

import { extname } from 'node:path';

/** One asset (or the launch bundle) in an update manifest: where it lives and what it is. */
export interface ManifestAsset {
  /** Stable key the client uses to cache/dedupe the asset (Launch uses the exported file's basename). */
  key: string;
  /** MIME type, e.g. `application/javascript` for the bundle or `image/png` for an asset. */
  contentType: string;
  /** Public URL the asset is served from. */
  url: string;
  /** File extension without the dot (assets only; omitted for the launch bundle). */
  fileExtension?: string;
}

/** An Expo Updates protocol v0 manifest for one platform + runtime version. */
export interface UpdateManifest {
  /** Unique id for this update (a UUID). */
  id: string;
  /** ISO-8601 creation instant. */
  createdAt: string;
  /** The runtime version this update is compatible with — must match the installed app's. */
  runtimeVersion: string;
  /** The JS bundle to launch. */
  launchAsset: ManifestAsset;
  /** Every other asset (images, fonts) the bundle references. */
  assets: ManifestAsset[];
  /** Reserved protocol fields, kept empty unless a future need appears. */
  metadata: Record<string, never>;
  extra: Record<string, never>;
}

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
export function contentTypeFor(filePath: string): string {
  return CONTENT_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

/** Inputs for {@link assembleManifest}. */
export interface AssembleManifestInput {
  id: string;
  createdAt: string;
  runtimeVersion: string;
  launchAsset: ManifestAsset;
  assets: ManifestAsset[];
}

/** Assemble a protocol-v0 {@link UpdateManifest} from its resolved parts (pure; the command supplies URLs/hashes). */
export function assembleManifest(input: AssembleManifestInput): UpdateManifest {
  return {
    id: input.id,
    createdAt: input.createdAt,
    runtimeVersion: input.runtimeVersion,
    launchAsset: input.launchAsset,
    assets: input.assets,
    metadata: {},
    extra: {},
  };
}

/** The static object key a manifest lives at, keyed by channel + platform + runtime version. */
export function manifestKey(channel: string, platform: string, runtimeVersion: string): string {
  return `updates/${channel}/${platform}/${runtimeVersion}/manifest.json`;
}

/** The object key the active manifest's `expo-signature` value lives at — the sibling of {@link manifestKey}. */
export function manifestSignatureKey(
  channel: string,
  platform: string,
  runtimeVersion: string,
): string {
  return `updates/${channel}/${platform}/${runtimeVersion}/manifest.sig`;
}

/** The append-only history index for a (channel, platform): every published update across all runtime versions. */
export function historyIndexKey(channel: string, platform: string): string {
  return `updates/${channel}/${platform}/history.json`;
}

/** The immutable snapshot of one published manifest, kept so `updates view` / `rollback` can read it back. */
export function historySnapshotKey(
  channel: string,
  platform: string,
  runtimeVersion: string,
  id: string,
): string {
  return `updates/${channel}/${platform}/${runtimeVersion}/history/${id}.json`;
}

/** The active rollback-to-embedded directive for a (channel, platform, runtime version); absent ⇒ none in effect. */
export function rollbackDirectiveKey(
  channel: string,
  platform: string,
  runtimeVersion: string,
): string {
  return `updates/${channel}/${platform}/${runtimeVersion}/rollback.json`;
}

/**
 * One row in the per-(channel, platform) update history index. Lean by design — the full manifest (asset
 * URLs included) lives in its {@link historySnapshotKey} snapshot, so the index stays a single cheap read
 * for `updates list`. The index spans every runtime version on the channel; each row carries its own.
 */
export interface UpdateHistoryEntry {
  /** The update's UUID — matches both the manifest `id` and its snapshot filename. */
  id: string;
  /** Runtime version this update targets. */
  runtimeVersion: string;
  /** ISO-8601 instant the update was published (or republished, for a rollback). */
  createdAt: string;
  /** Whether this update is the one currently served as the active manifest for its runtime version. */
  active: boolean;
  /** Whether the manifest was code-signed when published. */
  signed: boolean;
  /** How the entry entered history: a normal `publish`, or a `rollback` republish of a prior update. */
  kind: 'publish' | 'rollback';
}

/** The Expo Updates protocol-v1 `rollBackToEmbedded` directive body — instructs clients to drop to the embedded bundle. */
export interface RollbackDirective {
  /** The only directive type Launch emits: drop the client to the bundle baked into the binary. */
  type: 'rollBackToEmbedded';
  /** Roll-back parameters: clients apply this only if `commitTime` post-dates their running update. */
  parameters: { commitTime: string };
}

/** Assemble a `rollBackToEmbedded` directive committed at `commitTime` (clients roll back only if it post-dates their update). */
export function assembleRollbackDirective(commitTime: string): RollbackDirective {
  return { type: 'rollBackToEmbedded', parameters: { commitTime } };
}

/**
 * The object stored at {@link rollbackDirectiveKey}. Wraps the EXACT serialized {@link RollbackDirective}
 * body the worker must serve byte-for-byte (so its signature stays valid) plus its `expo-signature` and an
 * `active` flag. A later `launch update` publish flips `active` to false rather than deleting, since the
 * {@link StorageProvider} seam intentionally has no delete — a stale-but-inactive marker is the clear way.
 */
export interface StoredRollbackDirective {
  /** Whether the directive is in effect; false ⇒ the worker serves no directive part (cleared by a newer publish). */
  active: boolean;
  /** The exact JSON string of {@link RollbackDirective} that was signed — the worker serves this verbatim. */
  body: string;
  /** The `expo-signature` header value over `body`; omitted on unsigned channels. */
  signature?: string;
}

/**
 * Generate the Cloudflare Worker that turns the static bucket layout into a protocol-compliant Expo
 * Updates endpoint. It reads the `expo-*` request headers and returns a protocol-v1 `multipart/mixed`
 * response: a `manifest` part (from the static `manifest.json` + its `.sig`) and, when a rollback is in
 * effect, a `directive` part (from `rollback.json`) — each carrying its own `expo-signature` part header
 * so the client verifies them independently. The bodies are served byte-for-byte as published so the
 * signatures stay valid (the worker holds no key and never re-serializes). Runs in the USER's own
 * Cloudflare account — Launch hosts nothing. Deploy its output and point the app's `updates.url` at it.
 */
export function updatesWorkerScript(publicBaseUrl: string): string {
  const base = publicBaseUrl.replace(/\/+$/, '');
  return [
    '// Generated by `launch update` — Expo Updates protocol (v1) router over a static bucket.',
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
    '    // Active rollback directive (if any) — served verbatim with its precomputed signature.',
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
}

/** Inputs for {@link updatesAppConfigSnippet}. */
export interface AppConfigSnippetInput {
  /** The Worker route the app polls for updates. */
  updateUrl: string;
  runtimeVersion: string;
  /** Whether updates are code-signed (adds the codeSigning block + cert pointer). */
  signed: boolean;
}

/**
 * The one-time `app.json` `expo.updates` block to print after the first publish, so the developer
 * wires the app to the self-hosted endpoint. Includes the code-signing certificate pointer when signed
 * — without it `expo-updates` would accept any manifest the URL returns.
 */
export function updatesAppConfigSnippet(input: AppConfigSnippetInput): string {
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
}
