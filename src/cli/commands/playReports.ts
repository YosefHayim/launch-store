/**
 * `launch play-reports vitals` — read Android quality vitals (crash rate, ANR rate) from the Play
 * Developer Reporting API, the Android counterpart to the iOS `launch reports` / `launch insights`
 * post-launch observability. Uses the Play service account alone (the local equivalent of the Play
 * Console's "Android vitals" dashboard).
 *
 * Scope of #226: this ships the **vitals** half only. Two pieces of the original proposal have no
 * public API and are deliberately omitted rather than stubbed:
 * - **Pre-Launch Report** (`pre-launch`): there is no public API to retrieve its contents
 *   (crashes/warnings/screenshots) — it is Play-Console-UI-only across every `androidpublisher`
 *   client library.
 * - **Ratings metric**: the Play Developer Reporting API has no ratings metric set; the closest signal
 *   is `launch play-reviews`, which already reads recent reviews + stars.
 *
 * Thin glue over {@link PlayReportingClient}: this file resolves the app + Play account, bounds the
 * default window by the metric set's freshness, drives the queries, and renders the timeline (mirroring
 * `reports.ts`). Read-only — no confirmations needed.
 */

import type { Command } from "commander";
import { parseServiceAccount } from "../../google/playClient.js";
import {
  DEFAULT_VITALS_DAYS,
  PlayReportingClient,
  resolveVitalsWindow,
  type VitalsWindow,
} from "../../google/playReporting.js";
import { loadServiceAccount } from "../../google/credentials.js";
import { loadConfig } from "../../core/config.js";
import { selectApp } from "../../core/pipeline.js";
import type { PlayVitalsMetric, PlayVitalsRow } from "../../core/types.js";

/** Options for `play-reports vitals`. */
interface VitalsOptions {
  app?: string;
  metric?: string;
  days?: string;
  json?: boolean;
}

/** Build a Play Developer Reporting client bound to the stored service account, or fail with the hint. */
async function activeClient(): Promise<PlayReportingClient> {
  const json = await loadServiceAccount();
  if (!json) throw new Error("No Play service account. Run `launch creds set-key --platform android` first.");
  return new PlayReportingClient(parseServiceAccount(json));
}

/** Resolve the selected app's Play package name, erroring when the app has none. */
async function resolvePackageName(appSelector: string | undefined): Promise<string> {
  const { apps } = await loadConfig();
  const app = await selectApp(apps, appSelector);
  if (!app.packageName) {
    throw new Error(`No Android application id for ${app.name} (set android.package in app.json).`);
  }
  return app.packageName;
}

/** Resolve which vitals to show: a single `--metric crash|anr`, or both when the flag is absent. */
export function resolveMetrics(flag: string | undefined): PlayVitalsMetric[] {
  if (flag === undefined) return ["crash", "anr"];
  const value = flag.trim().toLowerCase();
  if (value !== "crash" && value !== "anr") {
    throw new Error(`--metric must be "crash" or "anr" (got "${flag}").`);
  }
  return [value];
}

/** Parse + validate the `--days` window length (a positive whole number), defaulting when absent. */
export function resolveDays(flag: string | undefined): number {
  if (flag === undefined) return DEFAULT_VITALS_DAYS;
  const trimmed = flag.trim();
  if (!/^\d+$/.test(trimmed) || Number(trimmed) < 1) {
    throw new Error(`--days must be a positive whole number (got "${flag}").`);
  }
  return Number(trimmed);
}

/** Format a rate fraction as a percentage with two decimals (0.0123 → "1.23%"), or "—" when absent. */
function pct(rate: number | undefined): string {
  return rate === undefined ? "—" : `${(rate * 100).toFixed(2)}%`;
}

/** Human label for a metric, used in section headers. */
const METRIC_LABEL: Record<PlayVitalsMetric, string> = { crash: "Crash rate", anr: "ANR rate" };

/** Render one metric's timeline as an aligned block: a header line, then one line per day. */
function renderMetric({ metric, window, rows }: MetricResult): string {
  const header = `\n${METRIC_LABEL[metric]}  (${window.startDate} → ${window.endDate}, DAILY)`;
  if (rows.length === 0) {
    return `${header}\n  (no data — the app may be new, or below Play's reporting threshold)`;
  }
  const lines = rows.map((row) => {
    const users = row.distinctUsers !== undefined ? `  ${row.distinctUsers} users` : "";
    return `  ${row.date}  ${pct(row.rate).padStart(7)}  (user-perceived ${pct(row.userPerceivedRate)})${users}`;
  });
  return [header, ...lines].join("\n");
}

/** One metric's resolved window + its normalized timeline rows. */
interface MetricResult {
  metric: PlayVitalsMetric;
  window: VitalsWindow;
  rows: PlayVitalsRow[];
}

/** Run one metric's query: bound the window by freshness, then fetch the normalized rows. */
async function fetchMetric(
  client: PlayReportingClient,
  packageName: string,
  metric: PlayVitalsMetric,
  days: number,
): Promise<MetricResult> {
  const window = resolveVitalsWindow(await client.latestDailyDate(packageName, metric), days);
  const rows =
    metric === "crash"
      ? await client.queryCrashRate(packageName, window)
      : await client.queryAnrRate(packageName, window);
  return { metric, window, rows };
}

/** Attach the `play-reports` command (with the `vitals` subcommand) to the program. */
export function registerPlayReportsCommand(program: Command): void {
  const reports = program
    .command("play-reports")
    .description("read Android quality vitals (crash/ANR rate) from the Play Developer Reporting API");

  reports
    .command("vitals")
    .description("show crash-rate and ANR-rate trends for an Android app (DAILY)")
    .option("-a, --app <name>", "app handle (auto-selected if there's only one)")
    .option("--metric <crash|anr>", "show only one vital (default: both)")
    .option("--days <n>", `how many days of history to show (default: ${DEFAULT_VITALS_DAYS})`)
    .option("--json", "output machine-readable JSON", false)
    .action(async (options: VitalsOptions) => {
      const metrics = resolveMetrics(options.metric);
      const days = resolveDays(options.days);
      const packageName = await resolvePackageName(options.app);
      const client = await activeClient();

      const results = await Promise.all(metrics.map((metric) => fetchMetric(client, packageName, metric, days)));

      if (options.json) {
        const rows = results.flatMap((result) => result.rows);
        console.log(JSON.stringify(rows, null, 2));
        return;
      }
      console.log(results.map(renderMetric).join("\n"));
    });
}
