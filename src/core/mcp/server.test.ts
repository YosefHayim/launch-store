import { describe, expect, it } from 'vitest';
import { dispatch } from './server.js';
import type { McpTool } from '../types.js';

/** A tool whose handler echoes a fixed payload — or throws — so `dispatch`'s boundary is graded in isolation. */
function tool(overrides: Partial<McpTool> = {}): McpTool {
  return {
    name: 'sample',
    description: 'sample',
    capability: 'read',
    inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    handler: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
    ...overrides,
  };
}

describe('dispatch', () => {
  it('returns an isError result when args fail schema validation', async () => {
    const result = await dispatch(tool(), {});
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Invalid arguments for sample');
  });

  it('runs the handler and returns its result for valid args', async () => {
    const result = await dispatch(tool(), { name: 'x' });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toBe('ok');
  });

  it('turns a thrown handler error into an isError result carrying the message', async () => {
    const result = await dispatch(
      tool({
        handler: () => {
          throw new Error('boom');
        },
      }),
      { name: 'x' },
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe('boom');
  });
});
