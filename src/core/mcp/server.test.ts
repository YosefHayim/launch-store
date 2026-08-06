import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import { dispatch } from './server.js';
import type { McpTool } from '../types/mcp.js';
import { expectArrayElement } from '@testkit/assertions.testkit.js';

/** A tool whose handler echoes a fixed payload - or throws - so `dispatch`'s boundary is graded in isolation. */
const tool = (overrides: Partial<McpTool> = {}): McpTool => {
  return {
    name: 'sample',
    description: 'sample',
    capability: 'read',
    inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    handler: () => Effect.succeed({ content: [{ type: 'text', text: 'ok' }] }),
    ...overrides,
  };
};

describe('dispatch', () => {
  it('returns an isError result when args fail schema validation', async () => {
    const toolOutput = await Effect.runPromise(dispatch(tool(), {}));
    expect(toolOutput.isError).toBe(true);
    expect(expectArrayElement(toolOutput.content, 0, 'toolOutput.content').text).toContain(
      'Invalid arguments for sample',
    );
  });
  it('runs the handler and returns its result for valid args', async () => {
    const toolOutput = await Effect.runPromise(dispatch(tool(), { name: 'x' }));
    expect(toolOutput.isError).toBeUndefined();
    expect(expectArrayElement(toolOutput.content, 0, 'toolOutput.content').text).toBe('ok');
  });
  it('turns a thrown handler error into an isError result carrying the message', async () => {
    const toolOutput = await Effect.runPromise(
      dispatch(
        tool({
          handler: () => Effect.fail(new Error('boom')),
        }),
        { name: 'x' },
      ),
    );
    expect(toolOutput.isError).toBe(true);
    expect(expectArrayElement(toolOutput.content, 0, 'toolOutput.content').text).toBe('boom');
  });
});
