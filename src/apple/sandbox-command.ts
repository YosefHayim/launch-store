// Lists StoreKit sandbox testers and clears their purchase history on App Store Connect.

import { LaunchPrompt } from '../services/platform/prompt.ts';
import { checkTerminalIsInteractive } from '../services/platform/progress.ts';
import type { SandboxTesterResource } from '../types/apple/users-and-access.ts';
import { clearPurchaseHistory, listSandboxTesters } from '../services/stores/sandbox.ts';
import { loadActiveAppleStore } from './apple-store-command.ts';
import { errorMessage } from '../services/platform/error-message.ts';
import { redactText } from '../services/platform/redact.ts';

/** One sandbox-tester operation selected by Commander. */
type SandboxCommandInput =
  | Readonly<{ operation: 'list'; json: boolean }>
  | Readonly<{
      operation: 'clear';
      emails: readonly string[];
      all: boolean;
      yes: boolean;
    }>;

function isPresentName(namePart: string | undefined): namePart is string {
  if (namePart == null) {
    return false;
  }

  return namePart.length > 0;
}

/** Render one sandbox tester as email, name, territory, and renewal rate. */
function renderSandboxTester(sandboxTester: SandboxTesterResource): string {
  const nameParts = [sandboxTester.firstName, sandboxTester.lastName].filter(isPresentName);
  const testerFields = [sandboxTester.acAccountName];

  const hasName = nameParts.length > 0;

  if (hasName) {
    testerFields.push(nameParts.join(' '));
  }

  const hasTerritory = sandboxTester.territory != null;

  if (hasTerritory) {
    testerFields.push(sandboxTester.territory);
  }

  const hasRenewalRate = sandboxTester.subscriptionRenewalRate != null;

  if (hasRenewalRate) {
    testerFields.push(`renews ${sandboxTester.subscriptionRenewalRate}`);
  }

  return testerFields.join('  ');
}

function testerLine(sandboxTester: SandboxTesterResource): string {
  return renderSandboxTester(sandboxTester);
}

function testerEmail(sandboxTester: SandboxTesterResource): string {
  return sandboxTester.acAccountName;
}

/** Ask before clearing purchase history, with an explicit non-interactive guard. */
async function confirmClear(targetLabel: string, confirmed: boolean): Promise<boolean> {
  const isConfirmed = confirmed == true;

  if (isConfirmed) {
    return true;
  }

  const terminalIsInteractive = checkTerminalIsInteractive();

  const needsATerminal = terminalIsInteractive == false;

  if (needsATerminal) {
    throw new Error(
      'Refusing to clear purchase history without confirmation. Re-run with --yes (non-interactive).',
      { cause: 'confirmation-required' },
    );
  }

  try {
    var shouldClear = await new LaunchPrompt().confirm(
      `Clear purchase history for ${targetLabel}?`,
    );
  } catch (cause) {
    throw new Error(errorMessage(cause), { cause: cause });
  }

  if (shouldClear) {
    return true;
  }

  new LaunchPrompt().cancel('Aborted - nothing cleared.');

  return false;
}

/** List the active account's StoreKit sandbox testers. */
async function listSandboxTestersProgram(json: boolean): Promise<void> {
  try {
    const sandboxStore = await loadActiveAppleStore();
    const sandboxTesters = await listSandboxTesters(sandboxStore);

    const wantsJson = json == true;

    if (wantsJson) {
      const serialized = JSON.stringify(sandboxTesters, null, 2);
      console.log(redactText(serialized));
      return;
    }

    const isEmpty = sandboxTesters.length == 0;

    if (isEmpty) {
      console.log(
        redactText(
          'No sandbox testers. Create them in App Store Connect -> Users and Access -> Sandbox Testers.',
        ),
      );
      return;
    }

    console.log(redactText(sandboxTesters.map(testerLine).join('\n')));

    let testerSuffix = 's';

    const isSingleTester = sandboxTesters.length == 1;

    if (isSingleTester) {
      testerSuffix = '';
    }

    console.log(redactText(`\n${sandboxTesters.length} sandbox tester${testerSuffix}.`));
  } catch (cause) {
    throw new Error(errorMessage(cause), { cause: cause });
  }
}

/** Clear selected or all StoreKit sandbox purchase histories. */
async function clearSandboxTestersProgram(
  commandInput: Extract<SandboxCommandInput, { operation: 'clear' }>,
): Promise<void> {
  try {
    let targetLabel = `${commandInput.emails.length} sandbox tester(s)`;

    const clearsEveryTester = commandInput.all == true;

    if (clearsEveryTester) {
      targetLabel = 'every sandbox tester';
    }

    const shouldClear = await confirmClear(targetLabel, commandInput.yes);

    const declined = shouldClear == false;

    if (declined) {
      return;
    }
    const sandboxStore = await loadActiveAppleStore();
    const clearOutcome = await clearPurchaseHistory(sandboxStore, {
      emails: [...commandInput.emails],
      all: commandInput.all,
    });

    const clearedSomeone = clearOutcome.cleared.length > 0;

    if (clearedSomeone) {
      console.log(
        redactText(
          `purchase history cleared - ${clearOutcome.cleared.map(testerEmail).join(', ')}`,
        ),
      );
    }

    const clearedNobody = clearedSomeone == false;

    if (clearedNobody) {
      console.log(redactText('No matching sandbox testers - nothing cleared.'));
    }

    const hasMissingTesters = clearOutcome.notFound.length > 0;

    if (hasMissingTesters) {
      console.log(redactText(`No sandbox tester found for: ${clearOutcome.notFound.join(', ')}`));
    }
  } catch (cause) {
    throw new Error(errorMessage(cause), { cause: cause });
  }
}

/** Run one sandbox-tester operation. */
export async function sandboxCommandProgram(commandInput: SandboxCommandInput): Promise<void> {
  if (commandInput.operation == 'list') {
    await listSandboxTestersProgram(commandInput.json);
    return;
  }

  await clearSandboxTestersProgram(commandInput);
}
