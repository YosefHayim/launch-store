import { describe, expect, it } from 'vitest';
import { DeviceCommandInputSchema, renderRegisteredDevice } from './device-command.ts';
function describeDeviceCommandPieceSchema() {
  function decodesAddAndListInputs() {
    const deviceCommandSchema = DeviceCommandInputSchema({
      operation: 'add',
      udid: 'ABC123',
      name: 'Test iPhone',
    });
    expect(deviceCommandSchema).toEqual({ operation: 'add', udid: 'ABC123', name: 'Test iPhone' });
    expect(DeviceCommandInputSchema({ operation: 'list' })).toEqual({
      operation: 'list',
    });
  }

  it('decodes add and list inputs', decodesAddAndListInputs);
  function rejectsAnExplicitUndefinedExactOptionalName() {
    function callDeviceCommandPieceSchema() {
      return DeviceCommandInputSchema({
        operation: 'add',
        udid: 'ABC123',
        name: undefined,
      });
    }

    expect(callDeviceCommandPieceSchema).toThrow();
  }

  it(
    'rejects an explicit undefined exact optional name',
    rejectsAnExplicitUndefinedExactOptionalName,
  );
}

describe('DeviceCommandInputSchema', describeDeviceCommandPieceSchema);
function describeRenderRegisteredDevice() {
  function marksDisabledDevicesWithInlineASCIIPiece() {
    const registeredDevice = renderRegisteredDevice({
      id: 'device-1',
      udid: 'ABC123',
      name: 'Test iPhone',
      status: 'DISABLED',
    });
    expect(registeredDevice).toBe('- Test iPhone - ABC123 (disabled)');
  }

  it('marks disabled devices with inline ASCII text', marksDisabledDevicesWithInlineASCIIPiece);
}

describe('renderRegisteredDevice', describeRenderRegisteredDevice);
