import { Effect, Random } from 'effect';

export const randomHexSecret = (byteCount: number): Effect.Effect<string> => {
  const bytePositions = Array.from({ length: byteCount }, (_, byteOffset) => byteOffset);
  return Effect.forEach(bytePositions, () => Random.nextIntBetween(0, 256), {
    concurrency: 1,
  }).pipe(
    Effect.map((randomBytes) =>
      randomBytes.map((randomByte) => randomByte.toString(16).padStart(2, '0')).join(''),
    ),
  );
};
