// Prints TestFlight crash and screenshot feedback and can save the screenshots.

import type { AppStoreConnectClient } from '../apple/app-store-connect-client.ts';
import { loadActiveAppleStore } from '../apple/apple-store-command.ts';
import type { BetaFeedback, BetaFeedbackKind } from '../types/app.ts';
import {
  downloadFeedbackAttachments,
  listBetaFeedback,
  type FeedbackFilters,
} from './testflight-feedback.ts';
import { countLabel, loadSelectedAppleApp } from './testflight-group.ts';
import { redactText } from '../services/platform/redact.ts';

const FEEDBACK_KINDS: readonly BetaFeedbackKind[] = ['crash', 'screenshot'];

export interface FeedbackCommandInput {
  operation: 'feedback';
  app?: string;
  build?: string;
  type?: string;
  out?: string;
  json: boolean;
}

export async function parseFeedbackType(
  requestedType: string | undefined,
): Promise<BetaFeedbackKind | undefined> {
  if (requestedType == null) {
    return undefined;
  }

  const normalizedType = requestedType.trim().toLowerCase();

  function isRequestedKind(feedbackKind: BetaFeedbackKind): boolean {
    return feedbackKind == normalizedType;
  }

  const matchedKind = FEEDBACK_KINDS.find(isRequestedKind);

  if (matchedKind != null) {
    return matchedKind;
  }

  throw new Error(`--type must be one of ${FEEDBACK_KINDS.join(' | ')} (got "${requestedType}").`);
}

function cleanTerminalText(unsafeText: string): string {
  // Drops ASCII and Latin-1 control characters, including terminal escapes.
  return unsafeText.replace(/[\u0000-\u001F\u007F-\u009F]/g, '');
}

function optionalCleanedText(unsafeText: string | undefined): string | undefined {
  if (unsafeText == null) {
    return undefined;
  }

  return cleanTerminalText(unsafeText);
}

export function renderFeedback(feedbackEntry: BetaFeedback): string {
  const deviceModel = optionalCleanedText(feedbackEntry.deviceModel);
  const operatingSystemText = optionalCleanedText(feedbackEntry.osVersion);
  let operatingSystem: string | undefined;

  if (operatingSystemText != null) {
    operatingSystem = `iOS ${operatingSystemText}`;
  }

  const deviceParts: string[] = [];

  if (deviceModel != null) {
    deviceParts.push(deviceModel);
  }

  if (operatingSystem != null) {
    deviceParts.push(operatingSystem);
  }

  const deviceDescription = deviceParts.join(' - ');
  const metadataParts: string[] = [];

  if (feedbackEntry.buildVersion != null) {
    metadataParts.push(`build ${feedbackEntry.buildVersion}`);
  }

  const hasDeviceDescription = deviceDescription.length > 0;

  if (hasDeviceDescription) {
    metadataParts.push(deviceDescription);
  }

  if (feedbackEntry.email != null) {
    const cleanTerminal = cleanTerminalText(feedbackEntry.email);
    metadataParts.push(cleanTerminal);
  }

  if (feedbackEntry.createdDate != null) {
    const isoDateLength = 10;
    metadataParts.push(feedbackEntry.createdDate.slice(0, isoDateLength));
  }

  const isCrash = feedbackEntry.kind == 'crash';
  let feedbackMarker = '[SCREENSHOT]';

  if (isCrash) {
    feedbackMarker = '[ERROR] crash';
  }
  const feedbackLines = [`${feedbackEntry.id}  ${feedbackMarker}`, `  ${metadataParts.join('  ')}`];

  if (feedbackEntry.comment != null) {
    const cleanTerminal = cleanTerminalText(feedbackEntry.comment);
    feedbackLines.push(`  "${cleanTerminal}"`);
  }

  const screenshots = feedbackEntry.screenshots ?? [];

  for (const screenshot of screenshots) {
    const cleanTerminal = cleanTerminalText(screenshot.url);
    feedbackLines.push(`  ${cleanTerminal}`);
  }

  return feedbackLines.join('\n');
}

function withBuildFilter(filters: FeedbackFilters, build: string | undefined): FeedbackFilters {
  if (build == null) {
    return filters;
  }

  return { ...filters, build };
}

function withKindFilter(
  filters: FeedbackFilters,
  feedbackKind: BetaFeedbackKind | undefined,
): FeedbackFilters {
  if (feedbackKind == null) {
    return filters;
  }

  return { ...filters, kind: feedbackKind };
}

async function downloadRequestedAttachments(
  appleStore: AppStoreConnectClient,
  feedbackEntries: readonly BetaFeedback[],
  outputDirectory: string | undefined,
  wantsJson: boolean,
): Promise<void> {
  if (outputDirectory == null) {
    return;
  }

  const downloadedAttachments = await downloadFeedbackAttachments(
    appleStore,
    feedbackEntries,
    outputDirectory,
  );

  if (wantsJson) {
    return;
  }

  const label = countLabel(downloadedAttachments.length, 'screenshot');

  console.log(redactText(`Downloaded ${label} to ${outputDirectory}.`));
}

export async function showFeedback(commandInput: FeedbackCommandInput): Promise<void> {
  const feedbackKind = await parseFeedbackType(commandInput.type);
  const filters = withKindFilter(withBuildFilter({}, commandInput.build), feedbackKind);
  const appleStore = await loadActiveAppleStore();
  const selectedApp = await loadSelectedAppleApp(appleStore, commandInput.app);
  const feedbackEntries = await listBetaFeedback(appleStore, selectedApp.bundleId, filters);
  const wantsJson = commandInput.json == true;

  await downloadRequestedAttachments(appleStore, feedbackEntries, commandInput.out, wantsJson);

  if (wantsJson) {
    const serialized = JSON.stringify(feedbackEntries, null, 2);
    console.log(redactText(serialized));
    return;
  }

  const hasNoFeedback = feedbackEntries.length == 0;

  if (hasNoFeedback) {
    console.log(
      redactText('No TestFlight feedback yet. Testers submit it from the TestFlight app.'),
    );
    return;
  }

  const feedbackBlocks = feedbackEntries.map(renderFeedback);

  console.log(redactText(feedbackBlocks.join('\n\n')));

  const label = countLabel(feedbackEntries.length, 'feedback item');

  console.log(redactText(`\n${label}.`));
}
