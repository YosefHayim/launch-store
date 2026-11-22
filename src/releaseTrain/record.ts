import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pathExists } from '../path-exists.js';
import { errorMessage } from '../services/platform/errorMessage.js';
import {
  readDocumentFile,
  writeDocumentFileAtomically,
} from '../services/platform/atomicDocumentFile.js';
import {
  resolveReleaseTrainFilePath,
  resolveReleaseTrainsDirectory,
} from '../services/platform/paths.js';
import type {
  Car,
  NativeCar,
  NativeCarState,
  OtaCar,
  TrainRecord,
  TrainState,
} from '../types/releaseTrain.js';
import { isTrainPlatform } from './guards.js';

const TRAIN_RECORD_SUFFIX = '.json';

type TrainRecordFailure = Readonly<{
  _tag: 'TrainRecordFailure';
  operation: string;
  message: string;
  cause: unknown;
}>;

type OptionalText =
  | Readonly<{ status: 'absent' }>
  | Readonly<{ status: 'invalid' }>
  | Readonly<{ status: 'present'; text: string }>;

function recordFailure(operation: string, cause: unknown): TrainRecordFailure {
  let message = errorMessage(cause);
  const isMessageEmpty = message.length == 0;

  if (isMessageEmpty) {
    message = `${operation} failed.`;
  }

  return { _tag: 'TrainRecordFailure', operation, message, cause };
}

function isRecord(candidate: unknown): candidate is Record<string, unknown> {
  if (typeof candidate != 'object') {
    return false;
  }

  if (candidate == null) {
    return false;
  }

  return Array.isArray(candidate) == false;
}

function isNativeKind(kind: unknown): kind is NativeCar['kind'] {
  if (kind == 'ios') {
    return true;
  }

  return kind == 'android';
}

function isNativeCarState(state: unknown): state is NativeCarState {
  if (state == 'building') {
    return true;
  }

  if (state == 'submitted') {
    return true;
  }

  if (state == 'in-review') {
    return true;
  }

  if (state == 'approved') {
    return true;
  }

  if (state == 'released') {
    return true;
  }

  if (state == 'rejected') {
    return true;
  }

  return state == 'failed';
}

function isOtaState(state: unknown): state is OtaCar['state'] {
  if (state == 'pending') {
    return true;
  }

  return state == 'published';
}

function isTrainState(state: unknown): state is TrainState {
  if (state == 'running') {
    return true;
  }

  if (state == 'blocked') {
    return true;
  }

  if (state == 'done') {
    return true;
  }

  return state == 'aborted';
}

function readOptionalText(record: Record<string, unknown>, fieldName: string): OptionalText {
  if (Object.hasOwn(record, fieldName) == false) {
    return { status: 'absent' };
  }

  const fieldText = record[fieldName];

  if (typeof fieldText != 'string') {
    return { status: 'invalid' };
  }

  return { status: 'present', text: fieldText };
}

function readRequiredText(record: Record<string, unknown>, fieldName: string): string | null {
  const fieldText = record[fieldName];

  if (typeof fieldText != 'string') {
    return null;
  }

  return fieldText;
}

function readNativeCar(candidate: Record<string, unknown>): NativeCar | null {
  const kind = candidate['kind'];
  const carPhase = candidate['state'];

  if (isNativeKind(kind) == false) {
    return null;
  }

  if (isNativeCarState(carPhase) == false) {
    return null;
  }

  const updatedAt = readRequiredText(candidate, 'updatedAt');

  if (updatedAt == null) {
    return null;
  }

  const buildId = readOptionalText(candidate, 'buildId');

  if (buildId.status == 'invalid') {
    return null;
  }

  const errorText = readOptionalText(candidate, 'error');

  if (errorText.status == 'invalid') {
    return null;
  }

  let nativeCar: NativeCar = {
    kind,
    state: carPhase,
    updatedAt,
  };

  if (buildId.status == 'present') {
    nativeCar = { ...nativeCar, buildId: buildId.text };
  }

  if (errorText.status == 'present') {
    nativeCar = { ...nativeCar, error: errorText.text };
  }

  return nativeCar;
}

function readOtaCar(candidate: Record<string, unknown>): OtaCar | null {
  const platformText = candidate['platform'];
  const carPhase = candidate['state'];

  if (typeof platformText != 'string') {
    return null;
  }

  if (isTrainPlatform(platformText) == false) {
    return null;
  }

  if (isOtaState(carPhase) == false) {
    return null;
  }

  const channel = readRequiredText(candidate, 'channel');

  if (channel == null) {
    return null;
  }

  const runtimeVersion = readRequiredText(candidate, 'runtimeVersion');

  if (runtimeVersion == null) {
    return null;
  }

  const updatedAt = readRequiredText(candidate, 'updatedAt');

  if (updatedAt == null) {
    return null;
  }

  const manifestId = readOptionalText(candidate, 'manifestId');

  if (manifestId.status == 'invalid') {
    return null;
  }

  let otaCar: OtaCar = {
    kind: 'ota',
    platform: platformText,
    channel,
    runtimeVersion,
    state: carPhase,
    updatedAt,
  };

  if (manifestId.status == 'present') {
    otaCar = { ...otaCar, manifestId: manifestId.text };
  }

  return otaCar;
}

function readCar(candidate: unknown): Car | null {
  if (isRecord(candidate) == false) {
    return null;
  }

  if (candidate['kind'] == 'ota') {
    return readOtaCar(candidate);
  }

  return readNativeCar(candidate);
}

function readCars(candidate: unknown): Car[] | null {
  if (Array.isArray(candidate) == false) {
    return null;
  }

  const cars: Car[] = [];

  for (const carCandidate of candidate) {
    const trainCar = readCar(carCandidate);

    if (trainCar == null) {
      return null;
    }

    cars.push(trainCar);
  }

  return cars;
}

function readTrainRecordShape(candidate: unknown): TrainRecord | null {
  if (isRecord(candidate) == false) {
    return null;
  }

  const id = readRequiredText(candidate, 'id');

  if (id == null) {
    return null;
  }

  const app = readRequiredText(candidate, 'app');

  if (app == null) {
    return null;
  }

  const hold = candidate['hold'];

  if (typeof hold != 'boolean') {
    return null;
  }

  const trainPhase = candidate['state'];

  if (isTrainState(trainPhase) == false) {
    return null;
  }

  const createdAt = readRequiredText(candidate, 'createdAt');

  if (createdAt == null) {
    return null;
  }

  const updatedAt = readRequiredText(candidate, 'updatedAt');

  if (updatedAt == null) {
    return null;
  }

  const cars = readCars(candidate['cars']);

  if (cars == null) {
    return null;
  }

  return {
    id,
    app,
    hold,
    state: trainPhase,
    createdAt,
    updatedAt,
    cars,
  };
}

function parseJsonDocument(documentText: string): unknown {
  return JSON.parse(documentText);
}

function decodeTrainRecordText(documentText: string): TrainRecord | null {
  try {
    var parsedDocument = parseJsonDocument(documentText);
  } catch {
    return null;
  }

  return readTrainRecordShape(parsedDocument);
}

/** Whether a train is still live (running or blocked). */
export function isLiveTrain(trainRecord: TrainRecord): boolean {
  if (trainRecord.state == 'running') {
    return true;
  }

  return trainRecord.state == 'blocked';
}

/** Sanitize a train id before it becomes a filename. */
export function safeTrainId(trainId: string): string {
  // Keeps letters, digits, underscores, and dashes so the id can be a filename.
  const sanitizedTrainId = trainId.replace(/[^A-Za-z0-9_-]/g, '');
  const isEmpty = sanitizedTrainId.length == 0;

  if (isEmpty) {
    return 'train';
  }

  return sanitizedTrainId;
}

function releaseTrainDirectory(directoryOverride: string | undefined): string {
  if (directoryOverride != null) {
    return directoryOverride;
  }

  return resolveReleaseTrainsDirectory();
}

function trainRecordPath(trainId: string, directoryOverride: string | undefined): string {
  if (directoryOverride != null) {
    const fileName = `${safeTrainId(trainId)}${TRAIN_RECORD_SUFFIX}`;

    return join(directoryOverride, fileName);
  }

  return resolveReleaseTrainFilePath(trainId);
}

/** Persist a train record, creating the release-trains directory when needed. */
export async function writeTrainRecord(
  trainRecord: TrainRecord,
  directoryOverride?: string,
): Promise<void> {
  const filePath = trainRecordPath(trainRecord.id, directoryOverride);

  try {
    await writeDocumentFileAtomically(filePath, trainRecord);
  } catch (cause) {
    throw recordFailure('write release-train record', cause);
  }
}

/** Read one train by id, returning null for absent, unreadable, or malformed files. */
export async function readTrainRecord(
  trainId: string,
  directoryOverride?: string,
): Promise<TrainRecord | null> {
  const filePath = trainRecordPath(trainId, directoryOverride);

  try {
    return await readDocumentFile(filePath, decodeTrainRecordText);
  } catch {
    return null;
  }
}

function isPresentTrain(trainRecord: TrainRecord | null): trainRecord is TrainRecord {
  return trainRecord != null;
}

function compareNewestFirst(firstTrain: TrainRecord, secondTrain: TrainRecord): number {
  return secondTrain.createdAt.localeCompare(firstTrain.createdAt);
}

async function readTrainEntry(
  directoryEntry: string,
  directoryPath: string,
): Promise<TrainRecord | null> {
  const isTrainFile = directoryEntry.endsWith(TRAIN_RECORD_SUFFIX);

  if (isTrainFile == false) {
    return null;
  }

  const trainId = directoryEntry.slice(0, -TRAIN_RECORD_SUFFIX.length);

  return readTrainRecord(trainId, directoryPath);
}

async function readListedTrains(
  directoryEntries: readonly string[],
  directoryPath: string,
): Promise<Array<TrainRecord | null>> {
  async function readEntry(directoryEntry: string): Promise<TrainRecord | null> {
    return readTrainEntry(directoryEntry, directoryPath);
  }

  return Promise.all(directoryEntries.map(readEntry));
}

/** List every valid persisted train newest-first. */
export async function listTrainRecords(directoryOverride?: string): Promise<TrainRecord[]> {
  const directoryPath = releaseTrainDirectory(directoryOverride);
  let directoryPresent = false;

  try {
    directoryPresent = await pathExists(directoryPath);
  } catch (cause) {
    throw recordFailure('list release-train records', cause);
  }

  if (directoryPresent == false) {
    return [];
  }

  let directoryEntries: string[];

  try {
    directoryEntries = await readdir(directoryPath);
  } catch (cause) {
    throw recordFailure('list release-train records', cause);
  }

  const trainRecords = await readListedTrains(directoryEntries, directoryPath);

  return trainRecords.filter(isPresentTrain).sort(compareNewestFirst);
}

/** Resolve the newest live train, then the newest train of any state. */
export async function latestTrainRecord(directoryOverride?: string): Promise<TrainRecord | null> {
  const trainRecords = await listTrainRecords(directoryOverride);
  const liveTrain = trainRecords.find(isLiveTrain);

  if (liveTrain != null) {
    return liveTrain;
  }

  const newestTrain = trainRecords[0];

  if (newestTrain == null) {
    return null;
  }

  return newestTrain;
}

/** Remove one persisted train record when it exists. */
export async function removeTrainRecord(
  trainId: string,
  directoryOverride?: string,
): Promise<void> {
  const filePath = trainRecordPath(trainId, directoryOverride);

  try {
    await rm(filePath, { force: true });
  } catch (cause) {
    throw recordFailure('remove release-train record', cause);
  }
}
