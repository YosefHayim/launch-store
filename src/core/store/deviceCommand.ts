import { Data, Effect, Schema } from 'effect';
import { createLogger, type Logger } from '../services/logger.js';
import type { DeviceResource } from '../types/appleCatalog.js';
import { loadActiveAppleStore, type ActiveAppleStoreRequirements } from './appleStoreCommand.js';

const DeviceAddInputSchema = Schema.Struct({
  operation: Schema.Literal('add'),
  udid: Schema.String,
  name: Schema.optionalWith(Schema.String, { exact: true }),
});

const DeviceListInputSchema = Schema.Struct({
  operation: Schema.Literal('list'),
});

export const DeviceCommandInputSchema = Schema.Union(DeviceAddInputSchema, DeviceListInputSchema);

export type DeviceCommandInput = Schema.Schema.Type<typeof DeviceCommandInputSchema>;
export type DeviceAddInput = Schema.Schema.Type<typeof DeviceAddInputSchema>;
export type DeviceListInput = Schema.Schema.Type<typeof DeviceListInputSchema>;

/** A device command step failed. */
export type DeviceCommandFailure = Readonly<{
  readonly _tag: 'DeviceCommandFailure';
  readonly operation: DeviceCommandInput['operation'];
  readonly message: string;
  readonly cause: unknown;
}>;
export const makeDeviceCommandFailure = Data.tagged<DeviceCommandFailure>('DeviceCommandFailure');

type DeviceCommandRequirements = ActiveAppleStoreRequirements | Logger;

/** Convert a dependency failure into the device command channel. */
const deviceCommandFailure = (
  operation: DeviceCommandInput['operation'],
  cause: unknown,
): DeviceCommandFailure => {
  let message = `Device ${operation} failed.`;
  if (typeof cause === 'string' && cause.length > 0) message = cause;
  if (cause instanceof Error) message = cause.message;
  if (typeof cause === 'object' && cause !== null && 'message' in cause) {
    const causeMessage = cause.message;
    if (typeof causeMessage === 'string') message = causeMessage;
  }
  return makeDeviceCommandFailure({ operation, message, cause });
};

/** Render one registered device for the list view. */
export const renderRegisteredDevice = (registeredDevice: DeviceResource): string => {
  let statusSuffix = '';
  if (registeredDevice.status === 'DISABLED') statusSuffix = ' (disabled)';
  return `- ${registeredDevice.name} - ${registeredDevice.udid}${statusSuffix}`;
};

/** Register one device for ad-hoc distribution. */
const addDevice = (
  commandInput: DeviceAddInput,
): Effect.Effect<void, DeviceCommandFailure, DeviceCommandRequirements> =>
  Effect.gen(function* () {
    const appleStore = yield* loadActiveAppleStore();
    let deviceName = commandInput.udid;
    if (commandInput.name !== undefined) deviceName = commandInput.name;
    const registeredDevice = yield* appleStore.registerDevice(commandInput.udid, deviceName);
    const logger = yield* createLogger(false);
    yield* logger.line(`OK Registered ${registeredDevice.name} (${registeredDevice.udid})`);
    yield* logger.line(
      "- It'll be included on the next `launch build ios --distribution internal`.",
    );
  }).pipe(Effect.mapError((cause) => deviceCommandFailure('add', cause)));

/** List devices registered for ad-hoc distribution. */
const listDevices = (): Effect.Effect<void, DeviceCommandFailure, DeviceCommandRequirements> =>
  Effect.gen(function* () {
    const appleStore = yield* loadActiveAppleStore();
    const registeredDevices = yield* appleStore.listDevices();
    const logger = yield* createLogger(false);
    if (registeredDevices.length === 0) {
      yield* logger.line('No registered devices. Add one with `launch device add <udid> [name]`.');
      return;
    }
    for (const registeredDevice of registeredDevices) {
      yield* logger.line(renderRegisteredDevice(registeredDevice));
    }
    yield* logger.line(`\n${registeredDevices.length} device(s).`);
  }).pipe(Effect.mapError((cause) => deviceCommandFailure('list', cause)));

/** Dispatch one decoded device operation. */
const runDeviceOperation = (
  commandInput: DeviceCommandInput,
): Effect.Effect<void, DeviceCommandFailure, DeviceCommandRequirements> => {
  switch (commandInput.operation) {
    case 'add':
      return addDevice(commandInput);
    case 'list':
      return listDevices();
  }
};

/** Run one schema-decoded device command. */
export const deviceCommandProgram = (
  rawCommandInput: unknown,
): Effect.Effect<void, DeviceCommandFailure, DeviceCommandRequirements> =>
  Schema.decodeUnknown(DeviceCommandInputSchema)(rawCommandInput).pipe(
    Effect.mapError((cause) => deviceCommandFailure('list', cause)),
    Effect.flatMap(runDeviceOperation),
  );
