// Adds one iOS device on App Store Connect for internal installs, and lists devices already there.

import type { DeviceResource } from '../types/apple/provisioning.ts';
import { loadActiveAppleStore } from './apple-store-command.ts';
import { errorMessage } from '../services/platform/error-message.ts';
import { readPlainObject } from '../services/platform/plain-object.ts';
import { redactText } from '../services/platform/redact.ts';

export type DeviceAddInput = Readonly<{
  operation: 'add';
  udid: string;
  name?: string;
}>;

type DeviceListInput = Readonly<{
  operation: 'list';
}>;

type DeviceCommandInput = DeviceAddInput | DeviceListInput;

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
    console.log(redactText(`OK Registered ${registeredDevice.name} (${registeredDevice.udid})`));
    console.log(
      redactText(
        "- It'll be included on the next `launch-store build ios --distribution internal`.",
      ),
    );
  } catch (cause) {
    throw new Error(errorMessage(cause), { cause: cause });
  }
}

/** List devices registered for ad-hoc distribution. */
async function listDevices(): Promise<void> {
  try {
    const appleStore = await loadActiveAppleStore();
    const registeredDevices = await appleStore.listDevices();
    const isDeviceListEmpty = registeredDevices.length == 0;

    if (isDeviceListEmpty) {
      console.log(
        redactText('No registered devices. Add one with `launch-store device add <udid> [name]`.'),
      );
      return;
    }

    for (const registeredDevice of registeredDevices) {
      console.log(redactText(renderRegisteredDevice(registeredDevice)));
    }

    console.log(redactText(`\n${registeredDevices.length} device(s).`));
  } catch (cause) {
    throw new Error(errorMessage(cause), { cause: cause });
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
  try {
    var commandInput = DeviceCommandInputSchema(rawCommandInput);
  } catch (cause) {
    throw new Error(errorMessage(cause), { cause: cause });
  }

  await runDeviceOperation(commandInput);
}
