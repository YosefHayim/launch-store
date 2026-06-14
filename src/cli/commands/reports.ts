/**
 * `launch reports sales|finance|analytics` — download App Store Connect reports from the CLI with the
 * API key alone: Sales & Trends and Finance (gzipped TSV), and the multi-step Analytics Reports flow.
 * This is the bulk-data side EAS never offered.
 *
 * Thin glue over `core/reports.ts`: this file resolves the account/app and the vendor number, drives
 * the downloads, decompresses + writes the files, and prints a summary. The query shaping, gzip/TSV
 * parsing, and the analytics resource walk live in the core module and the ASC client.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import { AppStoreConnectClient } from "../../apple/ascClient.js";
import { loadConfig } from "../../core/config.js";
import { selectApp } from "../../core/pipeline.js";
import { loadActiveAscKey } from "../../core/accounts.js";
import { createLogger, type Logger } from "../../core/logger.js";
import { ensureDir } from "../../core/paths.js";
import { collectAnalyticsSegments, decompressReport, eachDate, parseTsv } from "../../core/reports.js";

/** Build a client bound to the active Apple account, or fail with the onboarding hint. */
async function activeClient(): Promise<AppStoreConnectClient> {
  const ascKey = await loadActiveAscKey();
  if (!ascKey) throw new Error("No active Apple account. Run `launch creds set-key` first.");
  return new AppStoreConnectClient(ascKey);
}

/**
 * Resolve the App Store Connect vendor number from the flag or `ASC_VENDOR_NUMBER`. It's an
 * account-level id Apple shows under "Payments and Financial Reports" — there's no API to discover it,
 * so sales/finance downloads require it explicitly.
 */
function resolveVendorNumber(flag: string | undefined): string {
  const value = flag ?? process.env["ASC_VENDOR_NUMBER"];
  if (!value) {
    throw new Error(
      "Vendor number required. Pass --vendor-number <N> or set ASC_VENDOR_NUMBER " +
        "(find it in App Store Connect → Payments and Financial Reports).",
    );
  }
  return value;
}

/** Resolve the selected app's iOS bundle id, erroring when the app has none. */
async function resolveBundleId(appSelector: string | undefined): Promise<string> {
  const { apps } = await loadConfig();
  const app = await selectApp(apps, appSelector);
  if (!app.bundleId) {
    throw new Error(`No iOS bundle identifier for ${app.name} (set ios.bundleIdentifier in app.json).`);
  }
  return app.bundleId;
}

/** Lowercase, hyphenated slug of a report name, safe for a filename. */
function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "report"
  );
}

/**
 * Write a decompressed report to `outDir` as `<baseName>.tsv`, or `<baseName>.json` (parsed rows) when
 * `asJson`. Returns the written path and the row count for the summary line.
 */
function writeReport(outDir: string, baseName: string, text: string, asJson: boolean): { path: string; rows: number } {
  ensureDir(outDir);
  const parsed = parseTsv(text);
  if (asJson) {
    const path = join(outDir, `${baseName}.json`);
    writeFileSync(path, `${JSON.stringify(parsed.rows, null, 2)}\n`);
    return { path, rows: parsed.rows.length };
  }
  const path = join(outDir, `${baseName}.tsv`);
  writeFileSync(path, text.endsWith("\n") ? text : `${text}\n`);
  return { path, rows: parsed.rows.length };
}

/** Download + write one report, surfacing Apple's "no data" 404 as a notice rather than a hard failure. */
async function downloadOne(
  log: Logger,
  baseName: string,
  asJson: boolean,
  outDir: string,
  fetchBytes: () => Promise<Buffer>,
): Promise<void> {
  try {
    const text = decompressReport(await fetchBytes());
    const { path, rows } = writeReport(outDir, baseName, text, asJson);
    log.step(baseName, `${rows} row${rows === 1 ? "" : "s"} → ${path}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Apple returns 404 with "There were no sales…" for a period with no data — a normal empty result.
    if (message.includes("(404)")) {
      log.info(`${baseName}: no data for this period.`);
      return;
    }
    throw error;
  }
}

/** Options for `reports sales`. */
interface SalesOptions {
  vendorNumber?: string;
  date?: string;
  from?: string;
  to?: string;
  frequency: string;
  reportType: string;
  subType: string;
  version?: string;
  out: string;
  json?: boolean;
}

/** Options for `reports finance`. */
interface FinanceOptions {
  vendorNumber?: string;
  date?: string;
  region: string;
  reportType: string;
  out: string;
  json?: boolean;
}

/** Options for `reports analytics`. */
interface AnalyticsOptions {
  app?: string;
  accessType: string;
  category?: string;
  name?: string;
  granularity: string;
  date?: string;
  out: string;
}

/** Resolve the sales report dates: a `--from`/`--to` span (DAILY) or a single `--date`. */
function resolveSalesDates(options: SalesOptions): string[] {
  if (options.from && options.to) return eachDate(options.from, options.to);
  if (options.date) return [options.date];
  throw new Error("A date is required. Pass --date <YYYY-MM-DD> (or --from/--to for a DAILY span).");
}

/** Attach the `reports` command (with `sales` / `finance` / `analytics` subcommands) to the program. */
export function registerReportsCommand(program: Command): void {
  const reports = program
    .command("reports")
    .description("download App Store Connect sales, finance & analytics reports");

  reports
    .command("sales")
    .description("download a Sales & Trends report (gzipped TSV)")
    .option("--vendor-number <n>", "vendor number (or set ASC_VENDOR_NUMBER)")
    .option("--date <date>", "report date; format follows --frequency (e.g. 2026-06-01 for DAILY)")
    .option("--from <date>", "start of a DAILY date range (with --to)")
    .option("--to <date>", "end of a DAILY date range (with --from)")
    .option("--frequency <f>", "DAILY | WEEKLY | MONTHLY | YEARLY", "DAILY")
    .option("--report-type <t>", "SALES | SUBSCRIPTION | SUBSCRIBER | …", "SALES")
    .option("--sub-type <s>", "SUMMARY | DETAILED", "SUMMARY")
    .option("--version <v>", "report schema version, e.g. 1_0")
    .option("--out <dir>", "directory to write the report(s) into", ".")
    .option("--json", "parse the TSV and write JSON instead of the raw .tsv", false)
    .action(async (options: SalesOptions) => {
      const log = createLogger(false);
      const vendorNumber = resolveVendorNumber(options.vendorNumber);
      const dates = resolveSalesDates(options);
      const client = await activeClient();
      for (const date of dates) {
        await downloadOne(log, `sales-${options.frequency}-${date}`, options.json === true, options.out, () =>
          client.getSalesReport({
            vendorNumber,
            frequency: options.frequency,
            reportType: options.reportType,
            reportSubType: options.subType,
            reportDate: date,
            ...(options.version ? { version: options.version } : {}),
          }),
        );
      }
    });

  reports
    .command("finance")
    .description("download a Finance report for a fiscal period (gzipped TSV)")
    .option("--vendor-number <n>", "vendor number (or set ASC_VENDOR_NUMBER)")
    .option("--date <YYYY-MM>", "fiscal period, e.g. 2026-05")
    .option("--region <code>", "region code: ZZ (all) or a specific one like US", "ZZ")
    .option("--report-type <t>", "FINANCE_DETAIL | FINANCIAL", "FINANCE_DETAIL")
    .option("--out <dir>", "directory to write the report into", ".")
    .option("--json", "parse the TSV and write JSON instead of the raw .tsv", false)
    .action(async (options: FinanceOptions) => {
      const log = createLogger(false);
      const vendorNumber = resolveVendorNumber(options.vendorNumber);
      const { date } = options;
      if (!date) throw new Error("A fiscal period is required. Pass --date <YYYY-MM>.");
      const client = await activeClient();
      await downloadOne(log, `finance-${options.region}-${date}`, options.json === true, options.out, () =>
        client.getFinanceReport({
          vendorNumber,
          reportDate: date,
          regionCode: options.region,
          reportType: options.reportType,
        }),
      );
    });

  reports
    .command("analytics")
    .description("request + download App Store Connect Analytics reports")
    .option("-a, --app <name>", "app handle (auto-selected if there's only one)")
    .option("--access-type <t>", "ONGOING | ONE_TIME_SNAPSHOT", "ONGOING")
    .option("--category <c>", "APP_USAGE | APP_STORE_ENGAGEMENT | COMMERCE | FRAMEWORK_USAGE | PERFORMANCE")
    .option("--name <name>", "filter to one report by exact name")
    .option("--granularity <g>", "DAILY | WEEKLY | MONTHLY", "DAILY")
    .option("--date <YYYY-MM-DD>", "limit to instances covering this processing date")
    .option("--out <dir>", "directory to write the report(s) into", ".")
    .action(async (options: AnalyticsOptions) => {
      const log = createLogger(false);
      const bundleId = await resolveBundleId(options.app);
      const client = await activeClient();
      const collection = await collectAnalyticsSegments(client, {
        bundleId,
        accessType: options.accessType,
        granularity: options.granularity,
        ...(options.category ? { category: options.category } : {}),
        ...(options.name ? { name: options.name } : {}),
        ...(options.date ? { processingDate: options.date } : {}),
      });

      if (collection.downloads.length === 0) {
        if (collection.requestCreated) {
          log.info(
            "Analytics report requested. Apple generates the data over the next ~1–2 days — " +
              "re-run `launch reports analytics` then to download it.",
          );
        } else {
          log.info("No analytics segments matched these filters (try a different date, granularity, or category).");
        }
        return;
      }

      let index = 0;
      for (const download of collection.downloads) {
        const datePart = download.processingDate || "all";
        const baseName = `analytics-${slug(download.reportName)}-${datePart}-${index++}`;
        await downloadOne(log, baseName, false, options.out, () => client.downloadAnalyticsSegment(download.url));
      }
      log.step(
        "analytics",
        `downloaded ${collection.downloads.length} segment(s) from ${collection.reportCount} report(s)`,
      );
    });
}
