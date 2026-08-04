import { Effect } from 'effect';
import type {
  DashboardAccount,
  DashboardApp,
  DashboardArtifact,
  DashboardSecret,
  DashboardState,
} from '../types/dashboard.js';

const escapeHtml = (markupText: string): string =>
  markupText
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const renderTableCell = (cellContent: string | number | null): string => {
  if (cellContent === null) return '<span class="muted">-</span>';
  if (cellContent === '') return '<span class="muted">-</span>';
  return escapeHtml(String(cellContent));
};

const renderTable = (
  headers: string[],
  tableRows: string[][],
  emptyTableMessage: string,
): string => {
  if (tableRows.length === 0) {
    return `<p class="muted">${escapeHtml(emptyTableMessage)}</p>`;
  }
  const tableHeaderHtml = headers
    .map((headerLabel) => `<th>${escapeHtml(headerLabel)}</th>`)
    .join('');
  const tableBodyHtml = tableRows
    .map(
      (tableCells) => `<tr>${tableCells.map((tableCell) => `<td>${tableCell}</td>`).join('')}</tr>`,
    )
    .join('');
  return `<table><thead><tr>${tableHeaderHtml}</tr></thead><tbody>${tableBodyHtml}</tbody></table>`;
};

const renderSection = (sectionTitle: string, sectionHtml: string): string =>
  `<section><h2>${escapeHtml(sectionTitle)}</h2>${sectionHtml}</section>`;

const renderProviderChip = (providerLabel: string, providerName: string): string =>
  `<span class="chip"><b>${escapeHtml(providerLabel)}</b> ${escapeHtml(providerName)}</span>`;

const renderAppsTable = (apps: DashboardApp[]): string => {
  const appTableRows = apps.map((app) => [
    renderTableCell(app.name),
    renderTableCell(app.version),
    renderTableCell(app.bundleId),
    renderTableCell(app.packageName),
  ]);
  return renderTable(
    ['App', 'Version', 'Bundle id', 'Package'],
    appTableRows,
    'No apps discovered.',
  );
};

const renderAccountStatus = (account: DashboardAccount): string => {
  if (account.active) return '<span class="ok">active</span>';
  return renderTableCell(null);
};

const renderAccountsTable = (accounts: DashboardAccount[]): string => {
  const accountTableRows = accounts.map((account) => [
    renderTableCell(account.label),
    renderTableCell(account.keyId),
    renderTableCell(account.teamId),
    renderTableCell(account.appCount),
    renderAccountStatus(account),
  ]);
  return renderTable(
    ['Account', 'Key id', 'Team id', 'Apps', ''],
    accountTableRows,
    'No Apple accounts onboarded.',
  );
};

const renderArtifactSize = (buildArtifact: DashboardArtifact): string => {
  if (buildArtifact.sizeMB === null) return renderTableCell(null);
  return renderTableCell(`${buildArtifact.sizeMB} MB`);
};

const renderArtifactStatus = (buildArtifact: DashboardArtifact): string => {
  if (buildArtifact.pruned) return '<span class="muted">pruned</span>';
  return '<span class="ok">on disk</span>';
};

const renderArtifactsTable = (buildArtifacts: DashboardArtifact[]): string => {
  const artifactTableRows = buildArtifacts.map((buildArtifact) => [
    renderTableCell(buildArtifact.app),
    renderTableCell(buildArtifact.platform),
    renderTableCell(buildArtifact.version),
    renderTableCell(buildArtifact.buildNumber),
    renderArtifactSize(buildArtifact),
    renderTableCell(buildArtifact.createdAt),
    renderArtifactStatus(buildArtifact),
  ]);
  return renderTable(
    ['App', 'Platform', 'Version', 'Build', 'Size', 'Built', 'Binary'],
    artifactTableRows,
    'No builds recorded yet.',
  );
};

const renderSecretScope = (buildSecret: DashboardSecret): string => {
  if (buildSecret.profile === null) return renderTableCell('all profiles');
  return renderTableCell(buildSecret.profile);
};

const renderSecretsTable = (buildSecrets: DashboardSecret[]): string => {
  const secretTableRows = buildSecrets.map((buildSecret) => [
    renderTableCell(buildSecret.app),
    renderSecretScope(buildSecret),
    renderTableCell(buildSecret.name),
  ]);
  return renderTable(['App', 'Scope', 'Env var'], secretTableRows, 'No build secrets stored.');
};

const renderCloudHostSection = (dashboardState: DashboardState): string => {
  const cloudHost = dashboardState.cloudHost;
  if (cloudHost === null) {
    return renderSection('Remote build host', '<p class="muted">No remote host allocated.</p>');
  }
  const hostTableRows = [
    [
      renderTableCell(cloudHost.provider),
      renderTableCell(cloudHost.region),
      renderTableCell(cloudHost.instanceType),
      renderTableCell(cloudHost.instanceId),
      renderTableCell(cloudHost.allocatedAt),
    ],
  ];
  return renderSection(
    'Remote build host',
    renderTable(['Provider', 'Region', 'Type', 'Instance', 'Allocated'], hostTableRows, ''),
  );
};

const DASHBOARD_STYLE = `
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

/** Render one dashboard snapshot as a self-contained HTML document. */
export const renderDashboardHtml = (dashboardState: DashboardState): Effect.Effect<string> =>
  Effect.sync(() => {
    const providerChips = [
      renderProviderChip('credentials', dashboardState.project.providers.credentials),
      renderProviderChip('storage', dashboardState.project.providers.storage),
      renderProviderChip('build', dashboardState.project.providers.buildEngine),
      renderProviderChip('submit', dashboardState.project.providers.submit),
    ].join('');
    let profileNames = 'none';
    if (dashboardState.project.profiles.length > 0) {
      profileNames = dashboardState.project.profiles.join(', ');
    }
    // The inert JSON script escapes `<`, preventing a user-controlled `</script>` breakout.
    const embeddedDashboardState = JSON.stringify(dashboardState).replace(/</g, '\\u003c');
    return [
      '<!doctype html>',
      '<html lang="en"><head><meta charset="utf-8" />',
      '<meta name="viewport" content="width=device-width, initial-scale=1" />',
      '<title>launch dashboard</title>',
      `<style>${DASHBOARD_STYLE}</style></head><body>`,
      '<h1>launch dashboard</h1>',
      `<p class="sub">Local state as of ${renderTableCell(dashboardState.generatedAt)} - ${renderTableCell(dashboardState.launchHome)}</p>`,
      renderSection(
        'Project',
        `<p>${providerChips}</p><p><b>Profiles:</b> ${escapeHtml(profileNames)}</p>`,
      ),
      renderSection('Apps', renderAppsTable(dashboardState.project.apps)),
      renderSection('Apple accounts', renderAccountsTable(dashboardState.accounts)),
      renderSection('Recent builds', renderArtifactsTable(dashboardState.artifacts)),
      renderSection('Build secrets', renderSecretsTable(dashboardState.secrets)),
      renderCloudHostSection(dashboardState),
      `<script id="launch-dashboard-state" type="application/json">${embeddedDashboardState}</script>`,
      '</body></html>',
    ].join('\n');
  });
