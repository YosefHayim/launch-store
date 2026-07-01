/**
 * `launch cloud [setup|status|teardown|doctor]` — manage the remote AWS EC2 Mac build host.
 *
 * The scripting surface for the cloud-Mac feature (the wizard is the interactive front door). It makes
 * the cost reality explicit at every turn: `status` shows accrued cost and the releasable-after time,
 * `teardown` warns that AWS bills until the 24h minimum, and `doctor` checks creds/quota before you
 * ever allocate. Launch stores no AWS secrets — everything resolves through the standard credential chain.
 */

import type { Command } from 'commander';
import { cancel, confirm, isCancel } from '@clack/prompts';
import { loadConfig } from '../../core/config.js';
import { getComputeHost } from '../../core/registry.js';
import { clearLiveHost, getAmiId, getLiveHost } from '../../core/cloudState.js';
import { costBanner, formatAge, isReleasable, releasableAt, usd } from '../../core/cost.js';
import { runCloudDoctor } from '../../providers/compute/awsEc2Mac.js';
import { createLogger } from '../../core/logger.js';

const log = createLogger(false);

/** Show the live host's age, accrued cost, and when AWS will let it be released. */
async function status(): Promise<void> {
  const handle = getLiveHost();
  if (!handle) {
    log.line('No live cloud host. A remote build allocates one on demand.');
    return;
  }
  const host = getComputeHost(handle.provider);
  const live = await host.status(handle);
  if (!live) {
    log.line(
      `Recorded host ${handle.instanceId ?? handle.ssh.host} is no longer live (it was released). Clearing state.`,
    );
    clearLiveHost();
    return;
  }
  if (handle.provider === 'byo-ssh') {
    log.line(
      `Connected to your Mac at ${handle.ssh.user}@${handle.ssh.host} (up ${formatAge(live.ageMs)}; not billed by Launch).`,
    );
    return;
  }
  log.line(costBanner(handle));
  log.line(
    `  region ${handle.region ?? '?'} · host ${handle.hostId ?? '?'} · ~${usd(live.estimatedCostUsd)} so far`,
  );
  log.line(
    `  releasable after ${new Date(live.releasableAt).toLocaleString()} (24h Apple-license minimum).`,
  );
}

/** Stop the instance and release the Dedicated Host, surfacing the 24h-floor rule when it applies. */
async function teardown(): Promise<void> {
  const handle = getLiveHost();
  if (!handle) {
    log.line('No live cloud host to tear down.');
    return;
  }
  if (handle.provider === 'aws-ec2-mac' && !isReleasable(handle.allocatedAt)) {
    log.line(
      `Heads up: AWS won't release the Dedicated Host until the 24h minimum elapses ` +
        `(${new Date(releasableAt(handle.allocatedAt)).toLocaleString()}). It keeps billing until then either way.`,
    );
  }
  const proceed = await confirm({ message: `Tear down ${handle.instanceId ?? handle.ssh.host}?` });
  if (isCancel(proceed) || !proceed) {
    cancel('Left the host running.');
    process.exit(0);
  }
  const host = getComputeHost(handle.provider);
  await host.teardown(handle);
  clearLiveHost();
  log.line('Host released. No further charges accrue once AWS reports it released.');
}

/** Preflight the AWS account: credentials, region, instance-type availability, quota hint, IAM actions. */
async function doctor(): Promise<void> {
  const { config } = await loadConfig();
  if (!config.aws) {
    log.line('No `aws` block in launch.config.ts. Add one and re-run:');
    log.line('  aws: { region: "us-east-1" }');
    process.exitCode = 1;
    return;
  }
  const result = await runCloudDoctor(config.aws);
  for (const check of result.checks) {
    log.line(`${check.ok ? '✓' : '✗'} ${check.label} — ${check.detail}`);
  }
  if (!result.ok) process.exitCode = 1;
}

/** Show current cloud config + state and the readiness checks, without allocating anything. */
async function setup(): Promise<void> {
  const { config } = await loadConfig();
  if (!config.aws) {
    log.line('Add an AWS block to launch.config.ts, then run `launch cloud doctor`:');
    log.line('  aws: {');
    log.line('    region: "us-east-1",');
    log.line('    // profile: "default",        // a named ~/.aws profile (optional)');
    log.line('    // amiId: "ami-…",             // BYO golden AMI with Xcode (optional)');
    log.line('    // instanceType: "mac2.metal", // default');
    log.line('  }');
    return;
  }
  log.line(
    `AWS region: ${config.aws.region}${config.aws.profile ? ` · profile ${config.aws.profile}` : ''}`,
  );
  log.line(
    `Golden AMI: ${config.aws.amiId ?? getAmiId() ?? '(none yet — bootstrapped + snapshotted on first remote build)'}`,
  );
  const handle = getLiveHost();
  log.line(handle ? `Live host: ${handle.instanceId ?? handle.ssh.host}` : 'Live host: none');
  log.line('');
  await doctor();
}

/** Attach the `cloud` command to the program. */
export function registerCloudCommand(program: Command): void {
  program
    .command('cloud')
    .description('manage the remote AWS EC2 Mac build host (setup | status | teardown | doctor)')
    .argument('[action]', 'setup | status | teardown | doctor', 'status')
    .action(async (action: string) => {
      switch (action) {
        case 'status':
          await status();
          return;
        case 'teardown':
          await teardown();
          return;
        case 'doctor':
          await doctor();
          return;
        case 'setup':
          await setup();
          return;
        default:
          throw new Error(
            `Unknown action "${action}". Use "setup", "status", "teardown", or "doctor".`,
          );
      }
    });
}
