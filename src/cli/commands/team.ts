/**
 * `launch team list|invite|remove` — read and manage the App Store Connect team (members + pending
 * invitations) from the CLI, using the App Store Connect API key alone (the local equivalent of the
 * "Users and Access" page; EAS has no equivalent). The team is account-wide, so nothing here is app-scoped.
 *
 * Thin glue over `core/team.ts`: this file resolves the account, renders output, and guards the two
 * outward-facing writes (inviting a person, removing access) behind a confirmation. All team logic and
 * request shaping live in the core module and the ASC client.
 */

import { cancel, confirm, isCancel } from '@clack/prompts';
import type { Command } from 'commander';
import type { UserInvitationResource, UserResource } from '../../apple/ascClient.js';
import { AppStoreConnectClient } from '../../apple/ascClient.js';
import { loadActiveAscKey } from '../../core/accounts.js';
import { createLogger } from '../../core/logger.js';
import { getTeam, inviteTeamMember, removeTeamMember, type Team } from '../../core/team.js';

/** Options for `team invite`: the required identity + roles, plus provisioning and the CI bypass. */
interface InviteOptions {
  first: string;
  last: string;
  role: string;
  provisioning?: boolean;
  yes?: boolean;
}

/** Build a client bound to the active Apple account, or fail with the onboarding hint. */
async function activeClient(): Promise<AppStoreConnectClient> {
  const ascKey = await loadActiveAscKey();
  if (!ascKey) throw new Error('No active Apple account. Run `launch creds set-key` first.');
  return new AppStoreConnectClient(ascKey);
}

/** A person's display name from their first/last name, or an empty string when neither is set. */
function fullName(person: { firstName?: string; lastName?: string }): string {
  return [person.firstName, person.lastName].filter(Boolean).join(' ');
}

/** Render one accepted member: email, name, roles. */
function renderMember(member: UserResource): string {
  const name = fullName(member);
  return [member.username, name, `[${member.roles.join(', ')}]`].filter(Boolean).join('  ');
}

/** Render one pending invitation: email, name, roles, and when it expires. */
function renderInvitation(invitation: UserInvitationResource): string {
  const name = fullName(invitation);
  const expires = invitation.expirationDate
    ? `expires ${invitation.expirationDate.slice(0, 10)}`
    : undefined;
  return [invitation.email, name, `[${invitation.roles.join(', ')}]`, expires]
    .filter(Boolean)
    .join('  ');
}

/** Render the whole team as a readable block. */
function renderTeam(team: Team): string {
  const lines = [
    `Team — ${team.members.length} member(s), ${team.invitations.length} pending invitation(s)`,
  ];
  if (team.members.length > 0) {
    lines.push('', 'Members:');
    for (const member of team.members) lines.push(`  ${renderMember(member)}`);
  }
  if (team.invitations.length > 0) {
    lines.push('', 'Pending invitations:');
    for (const invitation of team.invitations) lines.push(`  ${renderInvitation(invitation)}`);
  }
  return lines.join('\n');
}

/** Confirm an outward-facing write, refusing in CI unless `--yes` was passed. */
async function confirmWrite(message: string, yes: boolean | undefined): Promise<boolean> {
  if (yes) return true;
  if (!process.stdout.isTTY) {
    throw new Error(
      'Refusing to change team access without confirmation. Re-run with --yes (non-interactive).',
    );
  }
  const proceed = await confirm({ message });
  if (isCancel(proceed) || !proceed) {
    cancel('Aborted — no team changes made.');
    return false;
  }
  return true;
}

/** Attach the `team` command (with `list` / `invite` / `remove` subcommands) to the program. */
export function registerTeamCommand(program: Command): void {
  const team = program
    .command('team')
    .description('read and manage the App Store Connect team (members & invitations) from the CLI');

  team
    .command('list')
    .description('list team members and pending invitations')
    .option('--json', 'output machine-readable JSON', false)
    .action(async (options: { json?: boolean }) => {
      const client = await activeClient();
      const current = await getTeam(client);
      if (options.json) {
        console.log(JSON.stringify(current, null, 2));
        return;
      }
      console.log(renderTeam(current));
    });

  team
    .command('invite')
    .description('invite a new team member by email')
    .argument('<email>', "the invitee's Apple ID email")
    .requiredOption('--first <name>', "the invitee's first name")
    .requiredOption('--last <name>', "the invitee's last name")
    .requiredOption('--role <roles>', 'comma-separated roles (e.g. DEVELOPER,APP_MANAGER)')
    .option('--provisioning', 'allow the member to create signing assets', false)
    .option('-y, --yes', 'skip the confirmation prompt (for CI)', false)
    .action(async (email: string, options: InviteOptions) => {
      const log = createLogger(false);
      const roles = options.role.split(',');
      if (!(await confirmWrite(`Invite ${email} to the team (sends them an email)?`, options.yes)))
        return;

      const client = await activeClient();
      const invitation = await inviteTeamMember(client, {
        email,
        firstName: options.first,
        lastName: options.last,
        roles,
        provisioningAllowed: options.provisioning === true,
      });
      log.step('invited', `${invitation.email} — [${invitation.roles.join(', ')}]`);
    });

  team
    .command('remove')
    .description('remove a team member or cancel a pending invitation, by email')
    .argument('<email>', "the member's / invitee's email")
    .option('-y, --yes', 'skip the confirmation prompt (for CI)', false)
    .action(async (email: string, options: { yes?: boolean }) => {
      const log = createLogger(false);
      if (
        !(await confirmWrite(
          `Remove ${email} from the team (revoke access / cancel invitation)?`,
          options.yes,
        ))
      ) {
        return;
      }

      const client = await activeClient();
      const outcome = await removeTeamMember(client, email);
      switch (outcome.kind) {
        case 'member':
          log.step('removed', `${outcome.user.username} — access revoked`);
          break;
        case 'invitation':
          log.step('invitation cancelled', outcome.invitation.email);
          break;
        case 'none':
          log.info(`No team member or pending invitation matches ${email} — nothing to remove.`);
          break;
      }
    });
}
