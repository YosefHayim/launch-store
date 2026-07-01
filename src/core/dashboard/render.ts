/**
 * Render a {@link DashboardState} into one self-contained HTML page — inline CSS, no client framework,
 * no external requests, no separate API route. The thin server in `cli/commands/dashboard.ts` serves
 * exactly this string; everything the page shows is baked in at render time.
 *
 * Two safety notes: every interpolated value goes through {@link escapeHtml} (the snapshot includes
 * user-controlled strings — app names, profile names, secret env-var names — that must not be able to
 * inject markup), and the machine-readable copy of the state is embedded in a `type="application/json"`
 * script (inert in browsers) with `<` additionally escaped, so it can't break out into executable code.
 */

import type {
  DashboardAccount,
  DashboardApp,
  DashboardArtifact,
  DashboardSecret,
  DashboardState,
} from '../types.js';

/** Escape the five HTML/XML special characters so interpolated values can't inject markup. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Render a value, escaped, falling back to a muted em-dash when it's null/empty. */
function cell(value: string | number | null): string {
  if (value === null || value === '') return '<span class="muted">—</span>';
  return escapeHtml(String(value));
}

/** A `<table>` with a header row and body rows, or a muted "none" line when there are no rows. */
function table(headers: string[], rows: string[][], emptyNote: string): string {
  if (rows.length === 0) return `<p class="muted">${escapeHtml(emptyNote)}</p>`;
  const head = headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('');
  const body = rows
    .map((row) => `<tr>${row.map((value) => `<td>${value}</td>`).join('')}</tr>`)
    .join('');
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

/** A titled section card wrapping its inner HTML. */
function section(title: string, inner: string): string {
  return `<section><h2>${escapeHtml(title)}</h2>${inner}</section>`;
}

/** A short label · value definition line (used for the providers row). */
function chip(label: string, value: string): string {
  return `<span class="chip"><b>${escapeHtml(label)}</b> ${escapeHtml(value)}</span>`;
}

function appsTable(apps: DashboardApp[]): string {
  const rows = apps.map((app) => [
    cell(app.name),
    cell(app.version),
    cell(app.bundleId),
    cell(app.packageName),
  ]);
  return table(['App', 'Version', 'Bundle id', 'Package'], rows, 'No apps discovered.');
}

function accountsTable(accounts: DashboardAccount[]): string {
  const rows = accounts.map((account) => [
    cell(account.label),
    cell(account.keyId),
    cell(account.teamId),
    cell(account.appCount),
    account.active ? '<span class="ok">active</span>' : cell(null),
  ]);
  return table(['Account', 'Key id', 'Team id', 'Apps', ''], rows, 'No Apple accounts onboarded.');
}

function artifactsTable(artifacts: DashboardArtifact[]): string {
  const rows = artifacts.map((artifact) => [
    cell(artifact.app),
    cell(artifact.platform),
    cell(artifact.version),
    cell(artifact.buildNumber),
    cell(artifact.sizeMB === null ? null : `${artifact.sizeMB} MB`),
    cell(artifact.createdAt),
    artifact.pruned ? '<span class="muted">pruned</span>' : '<span class="ok">on disk</span>',
  ]);
  return table(
    ['App', 'Platform', 'Version', 'Build', 'Size', 'Built', 'Binary'],
    rows,
    'No builds recorded yet.',
  );
}

function secretsTable(secrets: DashboardSecret[]): string {
  const rows = secrets.map((secret) => [
    cell(secret.app),
    cell(secret.profile ?? 'all profiles'),
    cell(secret.name),
  ]);
  return table(['App', 'Scope', 'Env var'], rows, 'No build secrets stored.');
}

function cloudHostSection(state: DashboardState): string {
  const host = state.cloudHost;
  if (!host) return section('Remote build host', '<p class="muted">No remote host allocated.</p>');
  const rows = [
    [
      cell(host.provider),
      cell(host.region),
      cell(host.instanceType),
      cell(host.instanceId),
      cell(host.allocatedAt),
    ],
  ];
  return section(
    'Remote build host',
    table(['Provider', 'Region', 'Type', 'Instance', 'Allocated'], rows, ''),
  );
}

/** Inline stylesheet — small, system-font, dark-on-light; no external assets. */
const STYLE = `
:root{color-scheme:light dark}
body{font-family:-apple-system,system-ui,Segoe UI,Roboto,sans-serif;max-width:60rem;margin:2rem auto;padding:0 1rem;line-height:1.5;color:#1a1a1a}
h1{margin:0 0 .25rem;font-size:1.6rem}
.sub{color:#666;margin:0 0 1.5rem;font-size:.9rem}
section{margin:2rem 0}
h2{font-size:1.1rem;border-bottom:1px solid #e3e3e3;padding-bottom:.3rem}
table{border-collapse:collapse;width:100%;font-size:.9rem}
th,td{text-align:left;padding:.4rem .6rem;border-bottom:1px solid #eee;vertical-align:top}
th{color:#666;font-weight:600}
.chip{display:inline-block;margin:.2rem .6rem .2rem 0;font-size:.9rem}
.chip b{color:#666;font-weight:600}
.muted{color:#999}
.ok{color:#1a7f37;font-weight:600}
@media(prefers-color-scheme:dark){body{color:#e6e6e6}.sub,.muted{color:#999}.chip b,th{color:#aaa}h2{border-color:#333}th,td{border-color:#2a2a2a}.ok{color:#3fb950}}
`.trim();

/**
 * Build the complete dashboard HTML for a snapshot. Pure and deterministic — the same state always
 * renders the same bytes — so the renderer is unit-testable and the server stays a trivial pass-through.
 */
export function renderDashboardHtml(state: DashboardState): string {
  const { providers } = state.project;
  const providerChips = [
    chip('credentials', providers.credentials),
    chip('storage', providers.storage),
    chip('build', providers.buildEngine),
    chip('submit', providers.submit),
  ].join('');
  const profiles = state.project.profiles.length > 0 ? state.project.profiles.join(', ') : 'none';

  // Inert (`type="application/json"`) and `<`-escaped so an injected `</script>` can't break out.
  const embeddedState = JSON.stringify(state).replace(/</g, '\\u003c');

  return [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    '<title>launch dashboard</title>',
    `<style>${STYLE}</style></head><body>`,
    '<h1>launch dashboard</h1>',
    `<p class="sub">Local state as of ${cell(state.generatedAt)} · ${cell(state.launchHome)}</p>`,
    section('Project', `<p>${providerChips}</p><p><b>Profiles:</b> ${escapeHtml(profiles)}</p>`),
    section('Apps', appsTable(state.project.apps)),
    section('Apple accounts', accountsTable(state.accounts)),
    section('Recent builds', artifactsTable(state.artifacts)),
    section('Build secrets', secretsTable(state.secrets)),
    cloudHostSection(state),
    `<script id="launch-dashboard-state" type="application/json">${embeddedState}</script>`,
    '</body></html>',
  ].join('\n');
}
