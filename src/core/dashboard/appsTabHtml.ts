import {
  describeCount,
  describeCrashRate,
  describeProceeds,
  describeRating,
  DOWNLOAD_METRICS,
  USAGE_METRICS,
} from '../stats/statsReportText.js';
import { mergeHeadlinePoints, readHeadlineTotal } from '../stats/statsReportLogic.js';
import type { AppStatsReport, DailyPoint, StatsReport } from '../types/statsReport.js';
import { createDashboardNav, DASHBOARD_STYLE, escapeHtml } from './htmlParts.js';

const SPARK_WIDTH = 140;
const SPARK_HEIGHT = 32;
const SPARK_PADDING = 3;
const BAR_LABEL_WIDTH = 190;
const BAR_MAX_WIDTH = 360;
const BAR_ROW_HEIGHT = 24;
const BAR_HEIGHT = 14;
const BAR_VALUE_GAP = 6;
const BAR_CHART_WIDTH = 720;
const EMPTY_CELL = '<span class="muted">-</span>';

interface AppHeadline {
  readonly app: AppStatsReport;
  readonly downloadPoints: readonly DailyPoint[];
  readonly usagePoints: readonly DailyPoint[];
  readonly downloads: number | null;
  readonly usage: number | null;
}

const createAppHeadline = (app: AppStatsReport): AppHeadline => ({
  app,
  downloadPoints: mergeHeadlinePoints(app.series, DOWNLOAD_METRICS),
  usagePoints: mergeHeadlinePoints(app.series, USAGE_METRICS),
  downloads: readHeadlineTotal(app.totals, DOWNLOAD_METRICS),
  usage: readHeadlineTotal(app.totals, USAGE_METRICS),
});

const createSparklineSvg = (points: readonly DailyPoint[], title: string): string => {
  const hasTooFewPoints = points.length < 2;
  if (hasTooFewPoints) return EMPTY_CELL;
  const amounts = points.map((point) => point.amount);
  const lowest = Math.min(...amounts);
  const highest = Math.max(...amounts);
  const span = highest - lowest;
  const innerWidth = SPARK_WIDTH - 2 * SPARK_PADDING;
  const innerHeight = SPARK_HEIGHT - 2 * SPARK_PADDING;
  const polylinePoints = points
    .map((point, index) => {
      const xPosition = SPARK_PADDING + (index / (points.length - 1)) * innerWidth;
      let heightShare = 0.5;
      if (span > 0) heightShare = (point.amount - lowest) / span;
      const yPosition = SPARK_PADDING + (1 - heightShare) * innerHeight;
      return `${xPosition.toFixed(1)},${yPosition.toFixed(1)}`;
    })
    .join(' ');
  return `<svg role="img" width="${SPARK_WIDTH}" height="${SPARK_HEIGHT}" viewBox="0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}"><title>${escapeHtml(title)}</title><polyline class="spark" points="${polylinePoints}" /></svg>`;
};

const createDownloadsBarChart = (headlines: readonly AppHeadline[]): string => {
  const barRows = headlines.map((headline) => ({
    name: headline.app.name,
    downloads: headline.downloads,
  }));
  const knownDownloads = barRows.flatMap((barRow) => {
    if (barRow.downloads === null) return [];
    return [barRow.downloads];
  });
  const highest = Math.max(1, ...knownDownloads);
  const chartHeight = barRows.length * BAR_ROW_HEIGHT + BAR_VALUE_GAP;
  const barElements = barRows.map((barRow, index) => {
    const downloads = barRow.downloads;
    let barWidth = 0;
    if (downloads !== null) barWidth = Math.max(1, (downloads / highest) * BAR_MAX_WIDTH);
    const rowTop = index * BAR_ROW_HEIGHT + BAR_VALUE_GAP;
    const textBaseline = rowTop + BAR_HEIGHT - 2;
    return [
      `<text class="axis-label" x="0" y="${textBaseline}">${escapeHtml(barRow.name)}</text>`,
      `<rect class="bar" x="${BAR_LABEL_WIDTH}" y="${rowTop}" width="${barWidth.toFixed(1)}" height="${BAR_HEIGHT}" />`,
      `<text class="axis-label" x="${BAR_LABEL_WIDTH + barWidth + BAR_VALUE_GAP}" y="${textBaseline}">${escapeHtml(describeCount(downloads))}</text>`,
    ].join('');
  });
  const title = 'Downloads per app in the chosen range';
  return `<svg role="img" width="${BAR_CHART_WIDTH}" height="${chartHeight}" viewBox="0 0 ${BAR_CHART_WIDTH} ${chartHeight}"><title>${escapeHtml(title)}</title>${barElements.join('')}</svg>`;
};

const createTable = (headers: readonly string[], rows: readonly (readonly string[])[]): string => {
  const headerCells = headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('');
  const bodyRows = rows
    .map((cells) => `<tr>${cells.map((cell) => `<td>${cell}</td>`).join('')}</tr>`)
    .join('');
  return `<table><thead><tr>${headerCells}</tr></thead><tbody>${bodyRows}</tbody></table>`;
};

const createNumberCell = (text: string): string => `<span class="num">${escapeHtml(text)}</span>`;

const createAppRow = (headline: AppHeadline, days: number): string[] => {
  const app = headline.app;
  let owner = 'untagged';
  if (app.owner !== null) owner = app.owner;
  const crashRate = readHeadlineTotal(app.totals, ['crashRate']);
  const rating = readHeadlineTotal(app.totals, ['ratingAverage']);
  const downloadsTitle = `Downloads per day for ${app.name}, last ${days} days`;
  const usageTitle = `Sessions or active users per day for ${app.name}, last ${days} days`;
  return [
    `${escapeHtml(app.name)}<br /><span class="muted">${escapeHtml(app.platform)}, ${escapeHtml(owner)}, ${escapeHtml(app.accountLabel)}</span>`,
    createNumberCell(describeCount(headline.downloads)),
    createSparklineSvg(headline.downloadPoints, downloadsTitle),
    createNumberCell(describeProceeds(app.totals)),
    createNumberCell(describeCount(headline.usage)),
    createSparklineSvg(headline.usagePoints, usageTitle),
    createNumberCell(describeCrashRate(crashRate)),
    createNumberCell(describeRating(rating)),
  ];
};

const createDailyTable = (headline: AppHeadline): string => {
  const usageAmounts = new Map(headline.usagePoints.map((point) => [point.date, point.amount]));
  const dailyRows = headline.downloadPoints.map((point) => {
    const usageAmount = usageAmounts.get(point.date);
    let usageText = EMPTY_CELL;
    if (usageAmount !== undefined) usageText = createNumberCell(describeCount(usageAmount));
    return [escapeHtml(point.date), createNumberCell(describeCount(point.amount)), usageText];
  });
  const hasNoDailyRows = dailyRows.length === 0;
  if (hasNoDailyRows) return '';
  const summary = `Daily numbers for ${headline.app.name}`;
  return `<details><summary>${escapeHtml(summary)}</summary>${createTable(['Day', 'Downloads', 'Sessions or users'], dailyRows)}</details>`;
};

const createStaleBanner = (report: StatsReport): string => {
  if (!report.isStale) return '';
  const appMessages = report.apps.flatMap((app) => app.messages);
  const messageItems = appMessages.map((message) => `<li>${escapeHtml(message)}</li>`).join('');
  let messageList = '';
  if (appMessages.length > 0) messageList = `<ul>${messageItems}</ul>`;
  return `<div class="warn" role="status"><b>Some numbers are old.</b> The refresh timed out or failed, so saved numbers are shown. Run <code>launch stats sync</code> to see why.${messageList}</div>`;
};

/** The Apps tab: one table of headline numbers, a sparkline per app, a bar chart, and table fallbacks. */
export const createAppsTabHtml = (report: StatsReport): string => {
  const headlines = report.apps.map(createAppHeadline);
  const hasNoApps = headlines.length === 0;
  let appsSection = '<p class="muted">No apps found. Run <code>launch apps list</code> first.</p>';
  if (!hasNoApps) {
    const appRows = headlines.map((headline) => createAppRow(headline, report.days));
    const barTableRows = headlines.map((headline) => [
      escapeHtml(headline.app.name),
      createNumberCell(describeCount(headline.downloads)),
    ]);
    appsSection = [
      createTable(
        [
          'App',
          'Downloads',
          'Downloads per day',
          'Proceeds',
          'Sessions or users',
          'Usage per day',
          'Crash rate',
          'Rating',
        ],
        appRows,
      ),
      '<h2>Downloads per app</h2>',
      createDownloadsBarChart(headlines),
      `<details><summary>Downloads per app as a table</summary>${createTable(['App', 'Downloads'], barTableRows)}</details>`,
      ...headlines.map(createDailyTable),
    ].join('\n');
  }
  return [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    '<title>launch dashboard - apps</title>',
    `<style>${DASHBOARD_STYLE}</style></head><body>`,
    '<h1>launch dashboard</h1>',
    createDashboardNav('/apps'),
    `<p class="sub">Last ${report.days} days, ${escapeHtml(report.range.from)} to ${escapeHtml(report.range.to)}</p>`,
    createStaleBanner(report),
    `<section><h2>Apps</h2>${appsSection}</section>`,
    '</body></html>',
  ].join('\n');
};
