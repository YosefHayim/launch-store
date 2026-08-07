import { Data, Effect } from 'effect';
import type { SandboxTesterResource } from '../types/appleCatalog.js';
/** The exact slice of {@link AppStoreConnectClient} the sandbox domain depends on. */
export type AscSandboxApi = {
  listSandboxTesters(): Effect.Effect<SandboxTesterResource[], unknown>;
  clearSandboxTesterPurchaseHistory(testerIds: readonly string[]): Effect.Effect<void, unknown>;
};
export type SandboxRequestFailure = Readonly<{
  readonly _tag: 'SandboxRequestFailure';
  readonly message: string;
}>;
export const makeSandboxRequestFailure =
  Data.tagged<SandboxRequestFailure>('SandboxRequestFailure');
/** What to clear: a set of tester emails, or every tester when `all` is true. */
export type ClearRequest = {
  emails: string[];
  all: boolean;
};
/** Outcome of {@link clearPurchaseHistory}: which testers were cleared, and which emails matched none. */
export type ClearResult = {
  cleared: SandboxTesterResource[];
  notFound: string[];
};
/** List the account's sandbox testers. */
export const listSandboxTesters = (
  api: AscSandboxApi,
): Effect.Effect<SandboxTesterResource[], unknown> => {
  return api.listSandboxTesters();
};
/**
 * Clear sandbox testers' StoreKit purchase history - either every tester (`all`) or the ones matching the
 * given emails (case-insensitive on `acAccountName`). Resolves emails to ids in one read, de-duplicates,
 * issues a single batched clear request, and reports both what was cleared and which emails matched nothing.
 * Throws when neither emails nor `all` are given.
 */
export const clearPurchaseHistory = (
  api: AscSandboxApi,
  request: ClearRequest,
): Effect.Effect<ClearResult, unknown> =>
  Effect.gen(function* () {
    const testers = yield* api.listSandboxTesters();
    if (request.all) {
      if (testers.length > 0)
        yield* api.clearSandboxTesterPurchaseHistory(testers.map((tester) => tester.id));
      return { cleared: testers, notFound: [] };
    }
    const emails = request.emails.map((email) => email.trim()).filter(Boolean);
    if (emails.length === 0) {
      return yield* Effect.fail(
        makeSandboxRequestFailure({
          message: 'Provide at least one sandbox tester email, or pass --all.',
        }),
      );
    }
    const byEmail = new Map(testers.map((tester) => [tester.acAccountName.toLowerCase(), tester]));
    const cleared: SandboxTesterResource[] = [];
    const seen = new Set<string>();
    const notFound: string[] = [];
    for (const email of emails) {
      const tester = byEmail.get(email.toLowerCase());
      if (!tester) {
        notFound.push(email);
        continue;
      }
      if (!seen.has(tester.id)) {
        seen.add(tester.id);
        cleared.push(tester);
      }
    }
    if (cleared.length > 0)
      yield* api.clearSandboxTesterPurchaseHistory(cleared.map((tester) => tester.id));
    return { cleared, notFound };
  });
