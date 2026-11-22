import type { SandboxTesterResource } from '../../types/appleCatalog.ts';

/** The exact slice of App Store Connect the sandbox domain depends on. */
export type AscSandboxApi = {
  listSandboxTesters(): Promise<SandboxTesterResource[]>;
  clearSandboxTesterPurchaseHistory(testerIds: readonly string[]): Promise<void>;
};

type ClearRequest = {
  emails: string[];
  all: boolean;
};

type ClearResult = {
  cleared: SandboxTesterResource[];
  notFound: string[];
};

export async function listSandboxTesters(api: AscSandboxApi): Promise<SandboxTesterResource[]> {
  return api.listSandboxTesters();
}

function trimmedEmail(email: string): string {
  return email.trim();
}

function isNonEmptyEmail(email: string): boolean {
  return email.length > 0;
}

function testerId(tester: SandboxTesterResource): string {
  return tester.id;
}

async function clearEveryTester(
  api: AscSandboxApi,
  testers: SandboxTesterResource[],
): Promise<ClearResult> {
  const hasTesters = testers.length > 0;

  if (hasTesters) {
    const testerIds = testers.map(testerId);
    await api.clearSandboxTesterPurchaseHistory(testerIds);
  }

  return { cleared: testers, notFound: [] };
}

/**
 * Clear sandbox testers' StoreKit purchase history - either every tester (`all`) or the ones matching the
 * given emails (case-insensitive on `acAccountName`). Throws when neither emails nor `all` are given.
 */
export async function clearPurchaseHistory(
  api: AscSandboxApi,
  request: ClearRequest,
): Promise<ClearResult> {
  const testers = await api.listSandboxTesters();

  if (request.all) {
    return clearEveryTester(api, testers);
  }

  const emails = request.emails.map(trimmedEmail).filter(isNonEmptyEmail);

  if (emails.length == 0) {
    throw {
      _tag: 'SandboxRequestFailure',
      message: 'Provide at least one sandbox tester email, or pass --all.',
    };
  }

  const byEmail = new Map(
    testers.map(function testerByEmail(tester: SandboxTesterResource) {
      return [tester.acAccountName.toLowerCase(), tester] as const;
    }),
  );
  const cleared: SandboxTesterResource[] = [];
  const seen = new Set<string>();
  const notFound: string[] = [];

  for (const email of emails) {
    const tester = byEmail.get(email.toLowerCase());
    const isMissing = tester == null;

    if (isMissing) {
      notFound.push(email);
      continue;
    }

    const alreadySeen = seen.has(tester.id);

    if (alreadySeen) {
      continue;
    }

    seen.add(tester.id);
    cleared.push(tester);
  }

  const hasCleared = cleared.length > 0;

  if (hasCleared) {
    await api.clearSandboxTesterPurchaseHistory(cleared.map(testerId));
  }

  return { cleared, notFound };
}
