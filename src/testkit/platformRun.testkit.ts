import { NodeContext } from '@effect/platform-node';
import { Effect } from 'effect';
/**
 * Run an Effect that needs only the official platform services against the real Node implementations.
 * For tests that exercise real files in a scratch directory, where a hand layer would merely
 * re-describe the filesystem behaviour under test.
 */
export const runOnNodePlatform = <Value>(
  program: Effect.Effect<Value, unknown, NodeContext.NodeContext>,
): Promise<Value> => Effect.runPromise(program.pipe(Effect.provide(NodeContext.layer)));
