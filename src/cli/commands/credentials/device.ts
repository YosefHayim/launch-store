import type { Command } from '@/cli/command.js';
import { type DeviceAddInput, deviceCommandProgram } from '../store/apple/device-command.ts';
import { runCliProgram } from '@/cli/run-cli-program.js';

/** Map the optional device name without passing an explicit undefined. */
function readDeviceAdd(udid: string, name: string | undefined): DeviceAddInput {
  let commandInput: DeviceAddInput = { operation: 'add', udid };

  if (name != null) commandInput = { ...commandInput, name };

  return commandInput;
}

/** Attach the device command group. */
export function registerDeviceCommand(program: Command): void {
  const deviceCommand = program
    .command('device')
    .description('manage iOS devices for ad-hoc (internal) distribution');

  function runAdd(udid: string, name: string | undefined) {
    const deviceAdd = readDeviceAdd(udid, name);
    const deviceProgram = deviceCommandProgram(deviceAdd);
    return runCliProgram(deviceProgram);
  }

  deviceCommand
    .command('add')
    .description('register a device UDID so internal builds can install on it')
    .argument('<udid>', 'the device UDID (Settings -> General -> About, or Xcode -> Devices)')
    .argument('[name]', 'a label for the device (default: the UDID)')
    .action(runAdd);

  function runList() {
    const deviceProgram = deviceCommandProgram({ operation: 'list' });
    return runCliProgram(deviceProgram);
  }

  deviceCommand
    .command('list')
    .description('list the devices registered for ad-hoc distribution')
    .action(runList);
}
