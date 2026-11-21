import { Schema } from 'effect';

export const SyncCommandInputSchema = Schema.Struct({
  app: Schema.optionalWith(Schema.String, { exact: true }),
  dryRun: Schema.Boolean,
  allowDestructive: Schema.Boolean,
  yes: Schema.Boolean,
  snapshot: Schema.Boolean,
});
