import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as bundle, type Plugin } from 'esbuild';
import { escapeHtml } from './page/miniMarkup.js';
import {
  compareRowsHtml,
  faqItemsHtml,
  featureCopyHtml,
  featureDemoHtml,
  featureTabsHtml,
  heroConfigHtml,
  heroTerminalHtml,
  pipelineNodesHtml,
} from './page/pageMarkup.js';
import { DEFAULT_FEATURE_INDEX, PIPELINE_STEPS } from './page/pageContent.js';
import { controlsHtml, outputHtml } from './playground/playgroundMarkup.js';
import { INITIAL_PRESET_ID, settingsForPreset } from './playground/presets.js';
import { runSamplePlan } from './playground/runSamplePlan.js';
import { readSiteStats } from './siteStats.js';

const SITE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SITE_DIRECTORY, '..');
const DIST_DIRECTORY = join(SITE_DIRECTORY, 'dist');
const FIRST_FAQ_OPEN_INDEX = 0;

const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="32" height="32"><rect width="24" height="24" rx="6" fill="#c6f36b"/><g fill="none" stroke="#0b1220" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 19c5 0 9.5-3.5 12-11"/><path d="M13 7.5 17.5 6.5 18.5 11"/></g><circle cx="5" cy="19" r="1.6" fill="#0b1220"/></svg>
`;

const nodeCryptoShimPlugin: Plugin = {
  name: 'nodeCryptoShim',
  setup: (pluginBuild) => {
    pluginBuild.onResolve({ filter: /^node:crypto$/ }, () => ({
      path: join(SITE_DIRECTORY, 'nodeCryptoShim.ts'),
    }));
  },
};

const fillSlots = (template: string, slotHtml: Readonly<Record<string, string>>): string =>
  template.replace(/<!--slot:(\w+)-->/g, (_marker, slotName: string) => {
    const filled = slotHtml[slotName];
    if (filled === undefined) throw new Error(`Unknown slot ${slotName}`);
    return filled;
  });

const run = async (): Promise<void> => {
  mkdirSync(DIST_DIRECTORY, { recursive: true });
  await bundle({
    entryPoints: [join(SITE_DIRECTORY, 'page/main.ts')],
    outfile: join(DIST_DIRECTORY, 'app.js'),
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    minify: true,
    plugins: [nodeCryptoShimPlugin],
    logLevel: 'warning',
  });
  const initialSettings = settingsForPreset(INITIAL_PRESET_ID);
  const initialPlan = await runSamplePlan(initialSettings);
  const firstStep = PIPELINE_STEPS[0];
  if (firstStep === undefined) throw new Error('No pipeline steps');
  const siteStats = readSiteStats(REPO_ROOT);
  const pageHtml = fillSlots(readFileSync(join(SITE_DIRECTORY, 'index.html'), 'utf8'), {
    heroTerminal: heroTerminalHtml(),
    heroConfig: heroConfigHtml(),
    operations: String(siteStats.operations),
    tests: siteStats.tests.toLocaleString('en-US'),
    pipeNodes: pipelineNodesHtml(),
    pipeLogTag: `[${firstStep.tag}]`,
    pipeLogText: escapeHtml(firstStep.log),
    pipeTitle: `${escapeHtml(firstStep.title)}.`,
    pipeCaption: escapeHtml(firstStep.caption),
    featureTabs: featureTabsHtml(DEFAULT_FEATURE_INDEX),
    featureCopy: featureCopyHtml(DEFAULT_FEATURE_INDEX),
    featureDemo: featureDemoHtml(DEFAULT_FEATURE_INDEX),
    playControls: controlsHtml(initialSettings),
    playOutput: outputHtml(initialSettings, initialPlan),
    compareRows: compareRowsHtml(),
    faqItems: faqItemsHtml(FIRST_FAQ_OPEN_INDEX),
  });
  writeFileSync(join(DIST_DIRECTORY, 'index.html'), pageHtml);
  writeFileSync(
    join(DIST_DIRECTORY, 'styles.css'),
    readFileSync(join(SITE_DIRECTORY, 'styles.css')),
  );
  writeFileSync(join(DIST_DIRECTORY, 'favicon.svg'), FAVICON_SVG);
};

await run();
