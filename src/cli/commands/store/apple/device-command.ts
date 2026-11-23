// Adds one iOS device on App Store Connect for internal installs, and lists devices already there.

import { createLogger } from '@/services/platform/logger.js';
import type { DeviceResource } from '@/types/apple-catalog.js';
import { loadActiveAppleStore } from './apple-store-command.ts';
import { hasMessage } from '@/services/platform/error-message.js';
import { readPlainObject } from '@/services/platform/plain-object.js';

export type DeviceAddInput = Readonly<{
  operation: 'add';
  udid: string;
  name?: string;
}>;

type DeviceListInput = Readonly<{
  operation: 'list';
}>;

type DeviceCommandInput = DeviceAddInput | DeviceListInput;

/** A device command step failed. */
type DeviceCommandFailure = Readonly<{
  readonly _tag: 'DeviceCommandFailure';
  readonly operation: DeviceCommandInput['operation'];
  readonly message: string;
  readonly cause: unknown;
}>;

function makeDeviceCommandFailure(fields: {
  operation: DeviceCommandInput['operation'];
  message: string;
  cause: unknown;
}): DeviceCommandFailure {
  return { _tag: 'DeviceCommandFailure', ...fields };
}

function readRequiredString(record: Record<string, unknown>, fieldName: string): string {
  const field = record[fieldName];
  const isString = typeof field == 'string';

  if (isString == false) {
    throw new Error(`Expected ${fieldName} to be a string.`);
  }

  return field;
}

/** Decode one device command. Rejects an explicit undefined exact optional name. */
export function DeviceCommandInputSchema(rawCommandInput: unknown): DeviceCommandInput {
  const rawCommandInputObject = readPlainObject(rawCommandInput);

  if (rawCommandInputObject == null) {
    throw new Error('Device command input must be an object.');
  }

  const operation = rawCommandInputObject['operation'];

  const isAdd = operation == 'add';

  if (isAdd) {
    const udid = readRequiredString(rawCommandInputObject, 'udid');
    const hasName = Object.hasOwn(rawCommandInputObject, 'name');

    if (hasName == false) {
      return { operation: 'add', udid };
    }

    const name = readRequiredString(rawCommandInputObject, 'name');

    return { operation: 'add', udid, name };
  }

  const isList = operation == 'list';

  if (isList) {
    return { operation: 'list' };
  }

  throw new Error('Device command operation must be add or list.');
}

function readNonEmptyText(cause: unknown): string | null {
  const isNotText = typeof cause != 'string';

  if (isNotText) return null;

  const isEmpty = cause.length == 0;

  if (isEmpty) return null;

  return cause;
}

function readCauseMessage(cause: unknown, fallback: string): string {
  const textMessage = readNonEmptyText(cause);

  if (textMessage != null) return textMessage;

  const hasCauseMessage = hasMessage(cause);

  if (hasCauseMessage) return cause.message;

  return fallback;
}

/** Convert a dependency failure into the device command channel. */
function deviceCommandFailure(
  operation: DeviceCommandInput['operation'],
  cause: unknown,
): DeviceCommandFailure {
  const message = readCauseMessage(cause, `Device ${operation} failed.`);
  return makeDeviceCommandFailure({ operation, message, cause });
}

/** Render one registered device for the list view. */
export function renderRegisteredDevice(registeredDevice: DeviceResource): string {
  let statusSuffix = '';

  if (registeredDevice.status == 'DISABLED') statusSuffix = ' (disabled)';

  return `- ${registeredDevice.name} - ${registeredDevice.udid}${statusSuffix}`;
}

/** Register one device for ad-hoc distribution. */
async function addDevice(commandInput: DeviceAddInput): Promise<void> {
  try {
    const appleStore = await loadActiveAppleStore();
    let deviceName = commandInput.udid;

    if (commandInput.name != null) deviceName = commandInput.name;

    const registeredDevice = await appleStore.registerDevice(commandInput.udid, deviceName);
    const logger = createLogger(false);

    logger.line(`OK Registered ${registeredDevice.name} (${registeredDevice.udid})`);
    logger.line(
      "- It'll be included on the next `launch-store build ios --distribution internal`.",
    );
  } catch (cause) {
    throw deviceCommandFailure('add', cause);
  }
}

/** List devices registered for ad-hoc distribution. */
async function listDevices(): Promise<void> {
  try {
    const appleStore = await loadActiveAppleStore();
    const registeredDevices = await appleStore.listDevices();
    const logger = createLogger(false);

    const isDeviceListEmpty = registeredDevices.length == 0;

    if (isDeviceListEmpty) {
      logger.line('No registered devices. Add one with `launch-store device add <udid> [name]`.');
      return;
    }

    for (const registeredDevice of registeredDevices) {
      logger.line(renderRegisteredDevice(registeredDevice));
    }

    logger.line(`\n${registeredDevices.length} device(s).`);
  } catch (cause) {
    throw deviceCommandFailure('list', cause);
  }
}

/** Dispatch one decoded device operation. */
async function runDeviceOperation(commandInput: DeviceCommandInput): Promise<void> {
  switch (commandInput.operation) {
    case 'add':
      return addDevice(commandInput);
    case 'list':
      return listDevices();
  }
}

/** Run one schema-decoded device command. */
export async function deviceCommandProgram(rawCommandInput: unknown): Promise<void> {
  let commandInput: DeviceCommandInput;

  try {
    commandInput = DeviceCommandInputSchema(rawCommandInput);
  } catch (cause) {
    throw deviceCommandFailure('list', cause);
  }

  await runDeviceOperation(commandInput);
}
