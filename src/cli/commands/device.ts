import type { Command } from 'commander';
import { type DeviceAddInput, deviceCommandProgram } from '@core/store/deviceCommand.js';
import { runCliProgram } from '../runCliProgram.js';

/** Map the optional device name without passing an explicit undefined. */
const toDeviceAddInput = (udid: string, name: string | undefined): DeviceAddInput => {
  let commandInput: DeviceAddInput = { operation: 'add', udid };
  if (name !== undefined) commandInput = { ...commandInput, name };
  return commandInput;
};

/** Attach the device command group. */
export const registerDeviceCommand = (program: Command): void => {
  const deviceCommand = program
    .command('device')
    .description('manage iOS devices for ad-hoc (internal) distribution');
  deviceCommand
    .command('add')
    .description('register a device UDID so internal builds can install on it')
    .argument('<udid>', 'the device UDID (Settings -> General -> About, or Xcode -> Devices)')
    .argument('[name]', 'a label for the device (default: the UDID)')
    .action((udid: string, name: string | undefined) =>
      runCliProgram(deviceCommandProgram(toDeviceAddInput(udid, name))),
    );
  deviceCommand
    .command('list')
    .description('list the devices registered for ad-hoc distribution')
    .action(() => runCliProgram(deviceCommandProgram({ operation: 'list' })));
};
