import { describe, it, expect } from 'vitest';
import {
  REQUIRED_TOOLS,
  ensureCcacheInstalled,
  ensureToolchain,
  fixHint,
  missingRequiredTools,
  planInstall,
  remoteToolchainPreflight,
  type ToolchainIo,
} from './toolchain.ts';
import { expectDefined } from '../testkit/assertions-testkit.ts';

function listBrewPair(tool: {
  label: string;
  command: string;
  tier: 'required' | 'recommended';
  install: { kind: 'brew'; formula: string } | { kind: 'guide'; how: string };
}) {
  if (tool.install.kind == 'brew') return [[tool.install.formula, tool.command] as const];

  return [];
}

/** Map each brew formula back to the command it provides, so the fake can mark it present after install. */
const formulaToCommand = new Map(REQUIRED_TOOLS.flatMap(listBrewPair));

/** Build a fake IO over a mutable "present on PATH" set, recording prompts/runs for assertions. */
function makeIo(toolchainOptions: {
  present: string[];
  confirm?: boolean;
  confirmText?: boolean;
}): {
  io: ToolchainIo;
  logs: string[];
  runs: string[][];
} {
  const present = new Set(toolchainOptions.present);
  const logs: string[] = [];
  const runs: string[][] = [];
  let confirmation = true;

  if (toolchainOptions.confirm != null) confirmation = toolchainOptions.confirm;

  let textConfirmation = true;

  if (toolchainOptions.confirmText != null) textConfirmation = toolchainOptions.confirmText;

  const io: ToolchainIo = {
    async exists(command) {
      return present.has(command);
    },
    async run(command, args) {
      runs.push([command, ...args]);

      const isBrewInstall = command == 'brew';

      if (isBrewInstall) {
        const isInstall = args[0] == 'install';

        if (isInstall) {
          for (const formula of args.slice(1)) {
            const provided = formulaToCommand.get(formula);

            if (provided != null) {
              present.add(provided);
            }
          }
        }
      }

      const isBash = command == '/bin/bash';

      if (isBash) {
        present.add('brew');
      }
    },
    async confirm() {
      return confirmation;
    },
    async confirmText() {
      return textConfirmation;
    },
    async log(message) {
      logs.push(message);
    },
  };

  return { io, logs, runs };
}

/** Run a toolchain program with an isolated logger capability. */
async function runToolchainEffect<TValue>(toolchainWork: Promise<TValue>): Promise<TValue> {
  return toolchainWork;
}

function readCommand(tool: {
  label: string;
  command: string;
  tier: 'required' | 'recommended';
  install: { kind: 'brew'; formula: string } | { kind: 'guide'; how: string };
}) {
  return tool.command;
}

const ALL_COMMANDS = REQUIRED_TOOLS.map(readCommand);

function describeFixHint() {
  function rendersABrewToolAsBrewInstallFormula() {
    function isPodCommand(tool: {
      label: string;
      command: string;
      tier: 'required' | 'recommended';
      install: { kind: 'brew'; formula: string } | { kind: 'guide'; how: string };
    }) {
      return tool.command == 'pod';
    }

    const cocoapods = expectDefined(REQUIRED_TOOLS.find(isPodCommand), 'pod tool');

    expect(fixHint(cocoapods)).toBe('brew install cocoapods');
  }

  it('renders a brew tool as `brew install <formula>`', rendersABrewToolAsBrewInstallFormula);

  function rendersAGuidedToolAsItsGuidePiece() {
    function isXcodebuildCommand(tool: {
      label: string;
      command: string;
      tier: 'required' | 'recommended';
      install: { kind: 'brew'; formula: string } | { kind: 'guide'; how: string };
    }) {
      return tool.command == 'xcodebuild';
    }

    const xcode = expectDefined(REQUIRED_TOOLS.find(isXcodebuildCommand), 'xcodebuild tool');

    expect(fixHint(xcode)).toMatch(/App Store/);
  }

  it('renders a guided tool as its guide text', rendersAGuidedToolAsItsGuidePiece);
}

describe('fixHint', describeFixHint);

function describePlanInstall() {
  function splitsMissingToolsIntoBrewInstallableAndGuided() {
    const { brew, guided } = planInstall(REQUIRED_TOOLS);

    function readCommand2(tool: {
      label: string;
      command: string;
      tier: 'required' | 'recommended';
      install: { kind: 'brew'; formula: string } | { kind: 'guide'; how: string };
    }) {
      return tool.command;
    }

    expect(guided.map(readCommand2)).toEqual(['xcodebuild']);

    function readCommand3(tool: {
      label: string;
      command: string;
      tier: 'required' | 'recommended';
      install: { kind: 'brew'; formula: string } | { kind: 'guide'; how: string };
    }) {
      return tool.command;
    }

    expect(brew.map(readCommand3)).toEqual(['pod', 'openssl', 'node', 'ccache']);
  }

  it(
    'splits missing tools into brew-installable and guided',
    splitsMissingToolsIntoBrewInstallableAndGuided,
  );
}

describe('planInstall', describePlanInstall);

function describeMissingRequiredToolsTheIsAHomebrewInstallEvenRelevantSignalIssue117() {
  async function isEmptyWhenEveryRequiredToolIsPresent() {
    const { io } = makeIo({ present: ALL_COMMANDS });
    const toolchainEffect = await runToolchainEffect(missingRequiredTools(io));
    expect(toolchainEffect).toEqual([]);
  }

  it('is empty when every required tool is present', isEmptyWhenEveryRequiredToolIsPresent);

  async function ignoresAMissingRecommendedToolCcacheAbsentIsNotAnInstallPromptGap() {
    function dropsCcache(command: string) {
      return command != 'ccache';
    }

    const { io } = makeIo({ present: ALL_COMMANDS.filter(dropsCcache) });
    const toolchainEffect = await runToolchainEffect(missingRequiredTools(io));

    expect(toolchainEffect).toEqual([]);
  }

  it(
    'ignores a missing recommended tool - ccache absent is not an install-prompt gap',
    ignoresAMissingRecommendedToolCcacheAbsentIsNotAnInstallPromptGap,
  );

  async function reportsOnlyTheMissingRequiredToolsNeverTheRecommendedOnes() {
    const { io } = makeIo({ present: ['xcodebuild', 'pod', 'node'] });

    function readCommand4(tool: {
      label: string;
      command: string;
      tier: 'required' | 'recommended';
      install: { kind: 'brew'; formula: string } | { kind: 'guide'; how: string };
    }) {
      return tool.command;
    }

    // openssl + ccache absent
    expect((await runToolchainEffect(missingRequiredTools(io))).map(readCommand4)).toEqual([
      'openssl',
    ]);
  }

  it(
    'reports only the missing required tools, never the recommended ones',
    reportsOnlyTheMissingRequiredToolsNeverTheRecommendedOnes,
  );
}

describe(
  "missingRequiredTools - the 'is a Homebrew install even relevant?' signal (issue #117)",
  describeMissingRequiredToolsTheIsAHomebrewInstallEvenRelevantSignalIssue117,
);

function describeRemoteToolchainPreflightTheOnHostDoctorGeneratedFromTheCanonicalList() {
  function checksEveryRequiredToolAndSignsOffWithTheSuccessMarker() {
    const script = remoteToolchainPreflight('assert');

    for (const tool of REQUIRED_TOOLS) expect(script).toContain(`command -v ${tool.command} `);

    expect(script).toContain('LAUNCH_PREFLIGHT_OK');
    // A missing REQUIRED tool flips MISSING=1 and exits non-zero; a recommended one only warns.
    expect(script).toMatch(/MISSING=1.*pod|pod.*MISSING=1/s);
    expect(script).toContain('- ccache (recommended)');
  }

  it(
    'checks every required tool and signs off with the success marker',
    checksEveryRequiredToolAndSignsOffWithTheSuccessMarker,
  );

  function neverMutatesABYOHostAssertButInstallsGapsOnAnAWSHostInstall() {
    const assert = remoteToolchainPreflight('assert');

    // "brew install ..." still appears as advice text inside a hint, but is never EXECUTED on a BYO host.
    expect(assert).not.toContain('-> installing');
    expect(assert).not.toContain('if ! brew install');
    expect(assert).not.toContain('brew shellenv');

    const install = remoteToolchainPreflight('install');

    expect(install).toContain('if ! brew install cocoapods');
    expect(install).toContain('if ! brew install openssl');
    expect(install).toContain('-> installing');
    expect(install).toContain('brew shellenv'); // brew put on PATH first
  }

  it(
    'never mutates a BYO host (assert) but installs gaps on an AWS host (install)',
    neverMutatesABYOHostAssertButInstallsGapsOnAnAWSHostInstall,
  );

  function keepsXcodeSBacktickBearingHintLiteralSingleQuotedNeverACommandSubstitution() {
    const script = remoteToolchainPreflight('assert');
    // The hint contains `xcode-select --install`; it must appear inside a single-quoted echo, not bare.
    expect(script).toContain("'x Xcode (xcodebuild) missing -");
    expect(script).not.toMatch(/echo "[^"]*`xcode-select/);
  }

  it(
    "keeps Xcode's backtick-bearing hint literal (single-quoted), never a command substitution",
    keepsXcodeSBacktickBearingHintLiteralSingleQuotedNeverACommandSubstitution,
  );
}

describe(
  'remoteToolchainPreflight - the on-host doctor, generated from the canonical list',
  describeRemoteToolchainPreflightTheOnHostDoctorGeneratedFromTheCanonicalList,
);

function describeEnsureToolchain() {
  async function isANoOpSuccessOnANonMacOSHost() {
    const { io, runs } = makeIo({ present: [] });
    const toolchain = ensureToolchain({ io, platform: 'linux' });
    const toolchainEffect = await runToolchainEffect(toolchain);

    expect(toolchainEffect).toBe(true);
    expect(runs).toEqual([]);
  }

  it('is a no-op success on a non-macOS host', isANoOpSuccessOnANonMacOSHost);

  async function succeedsWithoutInstallingWhenEverythingIsPresent() {
    const { io, runs } = makeIo({ present: [...ALL_COMMANDS, 'brew'] });
    const toolchain = ensureToolchain({ io, platform: 'darwin' });
    const toolchainEffect = await runToolchainEffect(toolchain);

    expect(toolchainEffect).toBe(true);
    expect(runs).toEqual([]);
  }

  it(
    'succeeds without installing when everything is present',
    succeedsWithoutInstallingWhenEverythingIsPresent,
  );

  async function installsTheMissingBrewToolsAsOneBatchThenReVerifiesGreen() {
    function dropsOpenSslAndPod(command: string) {
      return command != 'openssl' && command != 'pod';
    }

    const present = ALL_COMMANDS.filter(dropsOpenSslAndPod);
    const { io, runs } = makeIo({ present: [...present, 'brew'] });
    const toolchain = ensureToolchain({ io, platform: 'darwin', assumeYes: true });
    const toolchainEffect = await runToolchainEffect(toolchain);

    expect(toolchainEffect).toBe(true);
    expect(runs).toContainEqual(['brew', 'install', 'cocoapods', 'openssl']);
  }

  it(
    'installs the missing brew tools as one batch, then re-verifies green',
    installsTheMissingBrewToolsAsOneBatchThenReVerifiesGreen,
  );

  async function bootstrapsHomebrewFirstWhenItSMissingThenInstalls() {
    function dropsPodOnly(command: string) {
      return command != 'pod';
    }

    const present = ALL_COMMANDS.filter(dropsPodOnly); // no pod, no brew
    const { io, runs } = makeIo({ present });
    const toolchain = ensureToolchain({ io, platform: 'darwin', assumeYes: true });
    const toolchainEffect = await runToolchainEffect(toolchain);

    expect(toolchainEffect).toBe(true);
    expect(runs[0]?.[0]).toBe('/bin/bash'); // Homebrew installer ran first
    expect(runs).toContainEqual(['brew', 'install', 'cocoapods']);
  }

  it(
    "bootstraps Homebrew first when it's missing, then installs",
    bootstrapsHomebrewFirstWhenItSMissingThenInstalls,
  );

  async function returnsFalseAndInstallsNothingWhenTheUserDeclinesTheHomebrewInstaller() {
    function dropsPodCommand(command: string) {
      return command != 'pod';
    }

    const present = ALL_COMMANDS.filter(dropsPodCommand); // no pod, no brew
    const { io, runs, logs } = makeIo({ present, confirmText: false });
    const toolchain = ensureToolchain({ io, platform: 'darwin' });
    const toolchainEffect = await runToolchainEffect(toolchain);

    expect(toolchainEffect).toBe(false);
    expect(runs).toEqual([]);
    expect(logs.join('\n')).toMatch(/Homebrew isn't available/);
  }

  it(
    'returns false and installs nothing when the user declines the Homebrew installer',
    returnsFalseAndInstallsNothingWhenTheUserDeclinesTheHomebrewInstaller,
  );

  async function returnsFalseAndInstallsNothingWhenTheUserDeclinesTheBrewBatch() {
    function skipsPodBinary(command: string) {
      return command != 'pod';
    }

    const present = ALL_COMMANDS.filter(skipsPodBinary);
    const { io, runs, logs } = makeIo({ present: [...present, 'brew'], confirm: false });
    const toolchain = ensureToolchain({ io, platform: 'darwin' });
    const toolchainEffect = await runToolchainEffect(toolchain);

    expect(toolchainEffect).toBe(false);
    expect(runs).toEqual([]);
    expect(logs.join('\n')).toMatch(/Install them yourself/);
  }

  it(
    'returns false and installs nothing when the user declines the brew batch',
    returnsFalseAndInstallsNothingWhenTheUserDeclinesTheBrewBatch,
  );

  async function onlyGuidesNeverAutoInstallsWhenTheLoneGapIsXcode() {
    function dropsXcodebuild(command: string) {
      return command != 'xcodebuild';
    }

    const present = ALL_COMMANDS.filter(dropsXcodebuild);
    const { io, runs, logs } = makeIo({ present: [...present, 'brew'], confirm: true });
    const toolchain = ensureToolchain({ io, platform: 'darwin', assumeYes: true });
    const toolchainEffect = await runToolchainEffect(toolchain);

    expect(toolchainEffect).toBe(false);
    expect(runs).toEqual([]);
    expect(logs.join('\n')).toMatch(/App Store/);
  }

  it(
    'only guides (never auto-installs) when the lone gap is Xcode',
    onlyGuidesNeverAutoInstallsWhenTheLoneGapIsXcode,
  );

  async function installsANDConfiguresCcacheWhenItSTheLoneRecommendedGapStillSucceeding() {
    function skipsCcacheBinary(command: string) {
      return command != 'ccache';
    }

    const present = ALL_COMMANDS.filter(skipsCcacheBinary);
    const { io, runs } = makeIo({ present: [...present, 'brew'], confirm: true });
    const toolchain = ensureToolchain({ io, platform: 'darwin', assumeYes: true });
    const toolchainEffect = await runToolchainEffect(toolchain);

    expect(toolchainEffect).toBe(true);
    expect(runs).toContainEqual(['brew', 'install', 'ccache']);
    expect(runs).toContainEqual(['ccache', '--max-size', '10G']);

    function runsCcacheSet(r: string[]) {
      return r[0] == 'ccache' && r[1] == '--set-config';
    }

    expect(runs.some(runsCcacheSet)).toBe(true);
  }

  it(
    "installs AND configures ccache when it's the lone (recommended) gap, still succeeding",
    installsANDConfiguresCcacheWhenItSTheLoneRecommendedGapStillSucceeding,
  );

  async function stillSucceedsOnlyWarnsWhenCcacheStaysMissingRecommendedNeverFailsTheToolchain() {
    function omitsCcacheBinary(command: string) {
      return command != 'ccache';
    }

    // brew batch declined, so ccache is never installed; the required tools are all present.
    const present = ALL_COMMANDS.filter(omitsCcacheBinary);
    const { io, logs } = makeIo({ present: [...present, 'brew'], confirm: false });
    const toolchain = ensureToolchain({ io, platform: 'darwin' });
    const toolchainEffect = await runToolchainEffect(toolchain);

    expect(toolchainEffect).toBe(true);
    expect(logs.join('\n')).toMatch(/ccache \(recommended/);
  }

  it(
    'still succeeds (only warns) when ccache stays missing - recommended never fails the toolchain',
    stillSucceedsOnlyWarnsWhenCcacheStaysMissingRecommendedNeverFailsTheToolchain,
  );
}

describe('ensureToolchain', describeEnsureToolchain);

function describeEnsureCcacheInstalledTheInlineBuildTimeCcacheOffer() {
  async function installsAndConfiguresCcacheWhenAcceptedReusingDoctorSPiece() {
    const { io, runs } = makeIo({ present: ['brew'], confirm: true });
    const ccacheInstalled = ensureCcacheInstalled({ interactive: true, io });
    const toolchainEffect = await runToolchainEffect(ccacheInstalled);

    expect(toolchainEffect).toBe('installed');
    expect(runs).toContainEqual(['brew', 'install', 'ccache']);
    expect(runs).toContainEqual(['ccache', '--max-size', '10G']);

    function runsCcacheSetAgain(r: string[]) {
      return r[0] == 'ccache' && r[1] == '--set-config';
    }

    expect(runs.some(runsCcacheSetAgain)).toBe(true);
  }

  it(
    "installs and configures ccache when accepted, reusing doctor's config",
    installsAndConfiguresCcacheWhenAcceptedReusingDoctorSPiece,
  );

  async function remembersNothingAndInstallsNothingWhenDeclined() {
    const { io, runs } = makeIo({ present: ['brew'], confirm: false });
    const ccacheInstalled = ensureCcacheInstalled({ interactive: true, io });
    const toolchainEffect = await runToolchainEffect(ccacheInstalled);

    expect(toolchainEffect).toBe('declined');
    expect(runs).toEqual([]);
  }

  it(
    'remembers nothing and installs nothing when declined',
    remembersNothingAndInstallsNothingWhenDeclined,
  );

  async function skipsSilentlyNeverBlocksABuildWhenNonInteractive() {
    const { io, runs } = makeIo({ present: ['brew'], confirm: true });
    const ccacheInstalled = ensureCcacheInstalled({ interactive: false, io });
    const toolchainEffect = await runToolchainEffect(ccacheInstalled);

    expect(toolchainEffect).toBe('skipped-noninteractive');
    expect(runs).toEqual([]);
  }

  it(
    'skips silently (never blocks a build) when non-interactive',
    skipsSilentlyNeverBlocksABuildWhenNonInteractive,
  );

  async function skipsPointingAtDoctorWhenHomebrewIsMissingNoBrewBootstrapInsideABuild() {
    const { io, runs } = makeIo({ present: [], confirm: true });
    const ccacheInstalled = ensureCcacheInstalled({ interactive: true, io });
    const toolchainEffect = await runToolchainEffect(ccacheInstalled);

    expect(toolchainEffect).toBe('skipped-no-brew');
    expect(runs).toEqual([]);
  }

  it(
    'skips when Homebrew is missing - no brew bootstrap inside a build',
    skipsPointingAtDoctorWhenHomebrewIsMissingNoBrewBootstrapInsideABuild,
  );
}

describe(
  'ensureCcacheInstalled - the inline build-time ccache offer',
  describeEnsureCcacheInstalledTheInlineBuildTimeCcacheOffer,
);
