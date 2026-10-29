export const escapeHtml = (markupText: string): string =>
  markupText
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export const DASHBOARD_STYLE = `
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
nav{margin:0 0 1rem;font-size:.9rem}
nav a{margin-right:1rem;color:#0b5cad}
nav a[aria-current=page]{font-weight:600;color:inherit;text-decoration:none}
.warn{background:#fff4d6;border:1px solid #e0b43a;border-radius:6px;padding:.5rem .8rem;margin:1rem 0;color:#3d2e00}
.spark{stroke:#0b5cad;fill:none;stroke-width:1.5}
.bar{fill:#0b5cad}
.axis-label{font-size:11px;fill:#666}
.num{text-align:right;font-variant-numeric:tabular-nums}
details{margin:.4rem 0 1rem;font-size:.85rem}
@media(prefers-color-scheme:dark){body{color:#e6e6e6}.sub,.muted{color:#999}.chip b,th{color:#aaa}h2{border-color:#333}th,td{border-color:#2a2a2a}.ok{color:#3fb950}nav a{color:#6cb2ff}.warn{background:#3a3115;border-color:#8a6d1a;color:#f3e3b0}.spark{stroke:#6cb2ff}.bar{fill:#6cb2ff}.axis-label{fill:#aaa}}
`.trim();

const NAV_LINKS = [
  { path: '/', label: 'Overview' },
  { path: '/apps', label: 'Apps' },
] as const;

const createCurrentAttribute = (linkPath: string, currentPath: string): string => {
  const isCurrentPage = linkPath === currentPath;
  if (isCurrentPage) return ' aria-current="page"';
  return '';
};

export const createDashboardNav = (currentPath: '/' | '/apps'): string => {
  const links = NAV_LINKS.map((link) => {
    const currentAttribute = createCurrentAttribute(link.path, currentPath);
    return `<a href="${link.path}"${currentAttribute}>${escapeHtml(link.label)}</a>`;
  });
  return `<nav>${links.join('')}</nav>`;
};
