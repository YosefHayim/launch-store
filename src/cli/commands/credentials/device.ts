import type { Command } from '../../command.ts';
import { type DeviceAddInput, deviceCommandProgram } from '../store/apple/device-command.ts';
import { runCliProgram } from '../../run-cli-program.ts';

/** Map the optional device name without passing an explicit undefined. */
const toDeviceAddInput = (udid: string, name: string | undefined): DeviceAddInput => {
  let commandInput: DeviceAddInput = { operation: 'add', udid };
  if (name != null) commandInput = { ...commandInput, name };
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
    .action((udid: string, name: string | undefined) => {
      const deviceAdd = toDeviceAddInput(udid, name);
      const deviceProgram = deviceCommandProgram(deviceAdd);
      return runCliProgram(deviceProgram);
    });
  deviceCommand
    .command('list')
    .description('list the devices registered for ad-hoc distribution')
    .action(() => {
      const deviceProgram = deviceCommandProgram({ operation: 'list' });
      return runCliProgram(deviceProgram);
    });
};
