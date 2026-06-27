/**
 * The `launch sandbox` domain: list the account's **sandbox testers** (StoreKit testing Apple IDs) and
 * clear their purchase history, through the App Store Connect API key (no portal session). Clearing a
 * tester's purchase history resets their StoreKit state so a purchase/subscription flow can be re-tested
 * from scratch — the CLI equivalent of the per-tester "Clear Purchase History" button.
 *
 * Scope: **list + clear**. Apple exposes no API to *create* a sandbox tester (they're created in App Store
 * Connect), so this domain is read + the one reset action — which is exactly the issue's ask.
 *
 * Design (mirrors `core/team.ts`): the {@link AscSandboxApi} slice names the exact client surface this
 * module needs, so the logic is unit-testable with a hand-rolled fake and `AppStoreConnectClient` satisfies
 * it structurally. Testers are account-wide, so nothing here is app-scoped.
 */

import type { SandboxTesterResource } from '../apple/ascClient.js';

/** The exact slice of {@link AppStoreConnectClient} the sandbox domain depends on. */
export interface AscSandboxApi {
  listSandboxTesters(): Promise<SandboxTesterResource[]>;
  clearSandboxTesterPurchaseHistory(testerIds: string[]): Promise<void>;
}

/** What to clear: a set of tester emails, or every tester when `all` is true. */
export interface ClearRequest {
  /** Sandbox tester emails to clear; ignored when `all` is true. */
  emails: string[];
  /** Clear every sandbox tester's purchase history. */
  all: boolean;
}

/** Outcome of {@link clearPurchaseHistory}: which testers were cleared, and which emails matched none. */
export interface ClearResult {
  cleared: SandboxTesterResource[];
  /** Emails that matched no sandbox tester (empty when clearing all). */
  notFound: string[];
}

/** List the account's sandbox testers. */
export async function listSandboxTesters(api: AscSandboxApi): Promise<SandboxTesterResource[]> {
  return api.listSandboxTesters();
}

/**
 * Clear sandbox testers' StoreKit purchase history — either every tester (`all`) or the ones matching the
 * given emails (case-insensitive on `acAccountName`). Resolves emails to ids in one read, de-duplicates,
 * issues a single batched clear request, and reports both what was cleared and which emails matched nothing.
 * Throws when neither emails nor `all` are given.
 */
export async function clearPurchaseHistory(
  api: AscSandboxApi,
  request: ClearRequest,
): Promise<ClearResult> {
  const testers = await api.listSandboxTesters();

  if (request.all) {
    if (testers.length > 0)
      await api.clearSandboxTesterPurchaseHistory(testers.map((tester) => tester.id));
    return { cleared: testers, notFound: [] };
  }

  const emails = request.emails.map((email) => email.trim()).filter(Boolean);
  if (emails.length === 0) {
    throw new Error('Provide at least one sandbox tester email, or pass --all.');
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
    await api.clearSandboxTesterPurchaseHistory(cleared.map((tester) => tester.id));
  return { cleared, notFound };
}
