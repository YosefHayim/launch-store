import { describe, expect, it } from 'vitest';
import { DeviceCommandInputSchema, renderRegisteredDevice } from './device-command.ts';

describe('DeviceCommandInputSchema', () => {
  it('decodes add and list inputs', () => {
    const deviceCommandSchema = DeviceCommandInputSchema({
      operation: 'add',
      udid: 'ABC123',
      name: 'Test iPhone',
    });
    expect(deviceCommandSchema).toEqual({ operation: 'add', udid: 'ABC123', name: 'Test iPhone' });
    expect(DeviceCommandInputSchema({ operation: 'list' })).toEqual({
      operation: 'list',
    });
  });

  it('rejects an explicit undefined exact optional name', () => {
    expect(() =>
      DeviceCommandInputSchema({
        operation: 'add',
        udid: 'ABC123',
        name: undefined,
      }),
    ).toThrow();
  });
});

describe('renderRegisteredDevice', () => {
  it('marks disabled devices with inline ASCII text', () => {
    const registeredDevice = renderRegisteredDevice({
      id: 'device-1',
      udid: 'ABC123',
      name: 'Test iPhone',
      status: 'DISABLED',
    });
    expect(registeredDevice).toBe('- Test iPhone - ABC123 (disabled)');
  });
});
