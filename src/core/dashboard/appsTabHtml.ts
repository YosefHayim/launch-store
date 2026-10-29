import {
  describeCount,
  describeCrashRate,
  describeOwner,
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
const BAR_LINE_HEIGHT = 24;
const BAR_HEIGHT = 14;
const BAR_LABEL_GAP = 6;
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

const readHeightShare = (amount: number, lowest: number, span: number): number => {
  const isFlat = span === 0;
  if (isFlat) return 0.5;
  return (amount - lowest) / span;
};

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
      const heightShare = readHeightShare(point.amount, lowest, span);
      const yPosition = SPARK_PADDING + (1 - heightShare) * innerHeight;
      return `${xPosition.toFixed(1)},${yPosition.toFixed(1)}`;
    })
    .join(' ');
  return `<svg role="img" width="${SPARK_WIDTH}" height="${SPARK_HEIGHT}" viewBox="0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}"><title>${escapeHtml(title)}</title><polyline class="spark" points="${polylinePoints}" /></svg>`;
};

const readBarWidth = (downloads: number | null, highest: number): number => {
  if (downloads === null) return 0;
  return Math.max(1, (downloads / highest) * BAR_MAX_WIDTH);
};

const createDownloadsBarChart = (headlines: readonly AppHeadline[]): string => {
  const barLines = headlines.map((headline) => ({
    name: headline.app.name,
    downloads: headline.downloads,
  }));
  const knownDownloads = barLines.flatMap((barLine) => {
    if (barLine.downloads === null) return [];
    return [barLine.downloads];
  });
  const highest = Math.max(1, ...knownDownloads);
  const chartHeight = barLines.length * BAR_LINE_HEIGHT + BAR_LABEL_GAP;
  const barElements = barLines.map((barLine, index) => {
    const downloads = barLine.downloads;
    const barWidth = readBarWidth(downloads, highest);
    const barTop = index * BAR_LINE_HEIGHT + BAR_LABEL_GAP;
    const labelBaseline = barTop + BAR_HEIGHT - 2;
    return [
      `<text class="axis-label" x="0" y="${labelBaseline}">${escapeHtml(barLine.name)}</text>`,
      `<rect class="bar" x="${BAR_LABEL_WIDTH}" y="${barTop}" width="${barWidth.toFixed(1)}" height="${BAR_HEIGHT}" />`,
      `<text class="axis-label" x="${BAR_LABEL_WIDTH + barWidth + BAR_LABEL_GAP}" y="${labelBaseline}">${escapeHtml(describeCount(downloads))}</text>`,
    ].join('');
  });
  const title = 'Downloads per app in the chosen range';
  return `<svg role="img" width="${BAR_CHART_WIDTH}" height="${chartHeight}" viewBox="0 0 ${BAR_CHART_WIDTH} ${chartHeight}"><title>${escapeHtml(title)}</title>${barElements.join('')}</svg>`;
};

const createTable = (headers: readonly string[], rows: readonly (readonly string[])[]): string => {
  const headerCells = headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('');
  const tableLines = rows
    .map((cells) => `<tr>${cells.map((cell) => `<td>${cell}</td>`).join('')}</tr>`)
    .join('');
  return `<table><thead><tr>${headerCells}</tr></thead><tbody>${tableLines}</tbody></table>`;
};

const createNumberCell = (figure: string): string =>
  `<span class="num">${escapeHtml(figure)}</span>`;

const createAppCells = (headline: AppHeadline, days: number): string[] => {
  const app = headline.app;
  const owner = describeOwner(app.owner);
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

const createUsageLabel = (usageAmount: number | undefined): string => {
  if (usageAmount === undefined) return EMPTY_CELL;
  return createNumberCell(describeCount(usageAmount));
};

const createDailyTable = (headline: AppHeadline): string => {
  const usageAmounts = new Map(headline.usagePoints.map((point) => [point.date, point.amount]));
  const dailyLines = headline.downloadPoints.map((point) => {
    const usageAmount = usageAmounts.get(point.date);
    const usageLabel = createUsageLabel(usageAmount);
    return [escapeHtml(point.date), createNumberCell(describeCount(point.amount)), usageLabel];
  });
  const hasNoDailyLines = dailyLines.length === 0;
  if (hasNoDailyLines) return '';
  const summary = `Daily numbers for ${headline.app.name}`;
  return `<details><summary>${escapeHtml(summary)}</summary>${createTable(['Day', 'Downloads', 'Sessions or users'], dailyLines)}</details>`;
};

const createMessageList = (messages: readonly string[]): string => {
  const hasNoMessages = messages.length === 0;
  if (hasNoMessages) return '';
  const messageListLines = messages.map((message) => `<li>${escapeHtml(message)}</li>`).join('');
  return `<ul>${messageListLines}</ul>`;
};

const createStaleBanner = (report: StatsReport): string => {
  const isNotStale = !report.isStale;
  if (isNotStale) return '';
  const appMessages = report.apps.flatMap((app) => app.messages);
  const messageList = createMessageList(appMessages);
  return `<div class="warn" role="status"><b>Some numbers are old.</b> The refresh timed out or failed, so saved numbers are shown. Run <code>launch stats sync</code> to see why.${messageList}</div>`;
};

const createAppsSection = (report: StatsReport): string => {
  const headlines = report.apps.map(createAppHeadline);
  const hasNoApps = headlines.length === 0;
  if (hasNoApps)
    return '<p class="muted">No apps found. Run <code>launch apps list</code> first.</p>';
  const appCells = headlines.map((headline) => createAppCells(headline, report.days));
  const barTableLines = headlines.map((headline) => [
    escapeHtml(headline.app.name),
    createNumberCell(describeCount(headline.downloads)),
  ]);
  return [
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
      appCells,
    ),
    '<h2>Downloads per app</h2>',
    createDownloadsBarChart(headlines),
    `<details><summary>Downloads per app as a table</summary>${createTable(['App', 'Downloads'], barTableLines)}</details>`,
    ...headlines.map(createDailyTable),
  ].join('\n');
};

/** The Apps tab: one table of headline numbers, a sparkline per app, a bar chart, and table fallbacks. */
export const createAppsTabHtml = (report: StatsReport): string => {
  const appsSection = createAppsSection(report);
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
