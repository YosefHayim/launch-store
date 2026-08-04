import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';
import { DeviceCommandInputSchema, renderRegisteredDevice } from './deviceCommand.js';

describe('DeviceCommandInputSchema', () => {
  it('decodes add and list inputs', () => {
    expect(
      Schema.decodeUnknownSync(DeviceCommandInputSchema)({
        operation: 'add',
        udid: 'ABC123',
        name: 'Test iPhone',
      }),
    ).toEqual({ operation: 'add', udid: 'ABC123', name: 'Test iPhone' });
    expect(Schema.decodeUnknownSync(DeviceCommandInputSchema)({ operation: 'list' })).toEqual({
      operation: 'list',
    });
  });

  it('rejects an explicit undefined exact optional name', () => {
    expect(() =>
      Schema.decodeUnknownSync(DeviceCommandInputSchema)({
        operation: 'add',
        udid: 'ABC123',
        name: undefined,
      }),
    ).toThrow();
  });
});

describe('renderRegisteredDevice', () => {
  it('marks disabled devices with inline ASCII text', () => {
    expect(
      renderRegisteredDevice({
        id: 'device-1',
        udid: 'ABC123',
        name: 'Test iPhone',
        status: 'DISABLED',
      }),
    ).toBe('- Test iPhone - ABC123 (disabled)');
  });
});
