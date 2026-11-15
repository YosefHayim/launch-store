import { parseMarkupBlock, parseMarkupLine, type MarkupLine } from './miniMarkup.js';

export const INSTALL_COMMAND = 'npm i -g launch-store';

export type PipelineLane = Readonly<{ label: string; iconId: string; isPlatform: boolean }>;

export type PipelineStep = Readonly<{
  title: string;
  iconId: string;
  tag: 'RUN' | 'OK';
  log: string;
  caption: string;
  lanes: readonly [PipelineLane, PipelineLane];
}>;

const plainLane = (label: string): PipelineLane => ({ label, iconId: '', isPlatform: false });

export const PIPELINE_STEPS: readonly PipelineStep[] = [
  {
    title: 'Config',
    iconId: 'i-config',
    tag: 'RUN',
    log: 'launch release --platform all',
    caption:
      'Launch reads launch.config.ts, compares it with both live stores, and lists every change before anything is sent.',
    lanes: [
      { label: 'iOS', iconId: 'i-apple', isPlatform: true },
      { label: 'Android', iconId: 'i-googleplay', isPlatform: true },
    ],
  },
  {
    title: 'Build',
    iconId: 'i-build',
    tag: 'RUN',
    log: 'xcodebuild archive  +  gradle bundleRelease',
    caption:
      'Runs the native build on your Mac: an Xcode archive for iOS and a Gradle app bundle for Android. No queue, no build minutes.',
    lanes: [plainLane('xcodebuild archive'), plainLane('gradle bundle')],
  },
  {
    title: 'Sign',
    iconId: 'i-sign',
    tag: 'OK',
    log: 'Signed with the certificate, profile and upload key from the keychain',
    caption:
      'Signs with the certificate, profile and upload key from your OS keychain. Key files never touch the repo.',
    lanes: [plainLane('cert + profile'), plainLane('upload keystore')],
  },
  {
    title: 'Check',
    iconId: 'i-preflight',
    tag: 'OK',
    log: 'Preflight passed: download size, privacy answers, listing',
    caption: 'Checks the download size, the privacy answers and the store listing before upload.',
    lanes: [plainLane('size + privacy'), plainLane('listing check')],
  },
  {
    title: 'Upload',
    iconId: 'i-upload',
    tag: 'RUN',
    log: 'Waiting for App Store Connect and Google Play to process the build',
    caption:
      'Sends the build to App Store Connect and the Play internal track, then waits until it is processed.',
    lanes: [plainLane('App Store Connect'), plainLane('internal track')],
  },
  {
    title: 'Review',
    iconId: 'i-review',
    tag: 'OK',
    log: 'Submitted for review on both stores',
    caption: 'Attaches the build and submits it for review. launch status --watch follows it.',
    lanes: [plainLane('App Review'), plainLane('Play review')],
  },
  {
    title: 'Live',
    iconId: 'i-live',
    tag: 'OK',
    log: 'Phased release on iOS, 10% rollout on Android',
    caption:
      'Releases in steps: a phased release on iOS and a staged rollout on Android, which you can pause or widen.',
    lanes: [
      { label: 'phased release', iconId: 'i-appstore', isPlatform: false },
      { label: '10% rollout', iconId: 'i-googleplay', isPlatform: false },
    ],
  },
];

export type TerminalLine = Readonly<{ line: MarkupLine; waitMs: number }>;

const terminalSource: readonly (readonly [string, number])[] = [
  ['[s]$[/] launch release ios --profile production', 700],
  ['[run][RUN][/] Reading launch.config.ts', 400],
  ['[ok][OK][/]  Signing ready: certificate and profile in keychain', 500],
  ['[run][RUN][/] Building com.example.helloworld 1.4.0 (27)', 900],
  ['[ok][OK][/]  Built and signed in 6m 12s', 400],
  ['[ok][OK][/]  Download size 38.2 MB, budget 200 MB', 500],
  ['[run][RUN][/] Uploading to App Store Connect', 800],
  ['[ok][OK][/]  Build 27 processed', 400],
  ['[ok][OK][/]  Version 1.4.0: notes, compliance, build attached', 500],
  ['[ok][OK][/]  Submitted for review', 600],
  ['[c]Next: launch status --watch[/]', 2600],
];

export const TERMINAL_LINES: readonly TerminalLine[] = terminalSource.map(([source, waitMs]) => ({
  line: parseMarkupLine(source),
  waitMs,
}));

export const HERO_CONFIG_LINES: readonly MarkupLine[] = parseMarkupBlock(
  [
    '[k]import[/] { defineConfig } [k]from[/] [s]"launch-store"[/];',
    '',
    '[k]export default[/] [p]defineConfig[/]({',
    '  credentials: [s]"local"[/],   [c]// OS keychain[/]',
    '  storage: [s]"r2"[/],         [c]// your own bucket[/]',
    '  buildEngine: [s]"xcode"[/],',
    '  products: {',
    '    [s]"com.example.helloworld"[/]: {',
    '      subscriptionGroups: [{',
    '        referenceName: [s]"Hello Pro"[/],',
    '        subscriptions: [{',
    '          productId: [s]"pro.monthly"[/],',
    '          subscriptionPeriod: [s]"ONE_MONTH"[/],',
    '          price: { customerPrice: [n]4.99[/] },',
    '        }],',
    '      }],',
    '    },',
    '  },',
    '});',
  ].join('\n'),
);

export type Feature = Readonly<{
  tab: string;
  title: string;
  body: string;
  points: readonly string[];
  lines: readonly MarkupLine[];
}>;

export const DEFAULT_FEATURE_INDEX = 1;

export const FEATURES: readonly Feature[] = [
  {
    tab: 'Set up',
    title: 'Ready to ship in one pass.',
    body: 'Launch reads your Expo config, keeps your keys in the OS keychain, and fixes what is missing.',
    points: [
      'launch init writes the config and stores the API key',
      'launch doctor --fix checks Xcode, JDK, signing and keys',
      'launch adopt imports an app that already ships',
    ],
    lines: parseMarkupBlock(
      '[s]$[/] launch doctor --fix\n[ok][OK][/]   Node 22.11.0\n[ok][OK][/]   Xcode 26.1 and command-line tools\n[ok][OK][/]   App Store Connect API key in keychain\n[warn][WARN][/] CocoaPods not found\n[run][RUN][/]  Installing CocoaPods\n[ok][OK][/]   CocoaPods 1.16.2\n[ok][OK][/]   Ready to build iOS and Android',
    ),
  },
  {
    tab: 'Store as code',
    title: 'Products and prices, in code.',
    body: 'launch sync makes App Store Connect match your config: in-app purchases, subscriptions, prices, offers and capabilities. Google Play uses the same file.',
    points: [
      'Only the change is sent, nothing else is touched',
      'launch metadata pushes the listing to both stores',
      'launch drift shows what changed by hand in a portal',
    ],
    lines: parseMarkupBlock(
      '[s]$[/] launch sync\n[run][RUN][/] Comparing with App Store Connect\n[add]+ create[/]  subscription pro.yearly  $39.99\n[chg]~ update[/]  pro.monthly price  $3.99 -> $4.99\n[same]= keep  [/]  capability Push Notifications\n[ok][OK][/]  2 changes applied',
    ),
  },
  {
    tab: 'Build',
    title: 'Builds on your hardware.',
    body: 'xcodebuild and Gradle on your own machine. No queue and no timeout. No Mac? Use a cloud Mac in your own AWS account, any Mac over SSH, or hand off to eas build.',
    points: [
      'Real per-device download size, with a size budget',
      'Artifacts go to local disk, S3, R2 or Supabase',
      '--print-env shows where each value came from',
    ],
    lines: parseMarkupBlock(
      '[s]$[/] launch build android --profile production\n[run][RUN][/] Generating the native project\n[run][RUN][/] Gradle bundleRelease\n[ok][OK][/]  Signed with the upload key from keychain\n[ok][OK][/]  app-release.aab  24.6 MB\n[ok][OK][/]  Stored in r2://builds/helloworld/1.4.0',
    ),
  },
  {
    tab: 'Release',
    title: 'The release, not just the upload.',
    body: 'launch release fills in the version, export compliance and notes over the API, then submits. Track it and steer a phased rollout from the terminal.',
    points: [
      'launch status --watch follows review and processing',
      'launch rollout pauses, resumes or completes',
      'launch play-tracks moves Android builds between tracks',
    ],
    lines: parseMarkupBlock(
      '[s]$[/] launch status --watch\n[c]  ios      1.4.0 (27)   [/][run]Waiting for review[/]\n[c]  ios      1.4.0 (27)   [/][run]In review[/]\n[c]  ios      1.4.0 (27)   [/][ok]Ready for distribution[/]\n[c]  android  1.4.0 (27)   [/][ok]production 20%[/]\n\n[s]$[/] launch rollout ios --complete',
    ),
  },
  {
    tab: 'Updates',
    title: 'Updates from your own bucket.',
    body: 'launch update speaks the Expo Updates protocol your app already uses. Updates are code-signed and served from S3, R2 or Supabase instead of Expo servers.',
    points: [
      'Rollback to a known-good update in one command',
      'Internal builds hosted on your own storage',
      'Works with expo-updates as it is',
    ],
    lines: parseMarkupBlock(
      '[s]$[/] launch update --channel production\n[run][RUN][/] Bundling JS and assets\n[ok][OK][/]  Signed update 7f3c1a\n[ok][OK][/]  Uploaded to r2://updates/production\n\n[s]$[/] launch updates rollback\n[ok][OK][/]  production now serves 2b91e0',
    ),
  },
];

export type CompareRow = Readonly<{ label: string; eas: string; launch: string }>;

export const COMPARE_ROWS: readonly CompareRow[] = [
  {
    label: 'Cost',
    eas: '$19 to $199 a month plus build fees',
    launch: '$0 compute, unlimited builds',
  },
  { label: 'Build start', eas: 'Shared cloud queue', launch: 'Starts now on your hardware' },
  { label: 'Timeout', eas: '45 minutes on the free tier', launch: 'None' },
  { label: 'Apple sign-in', eas: 'Apple ID with 2FA prompts', launch: 'App Store Connect API key' },
  {
    label: 'Purchases',
    eas: 'By hand in App Store Connect',
    launch: 'launch sync from your config',
  },
  { label: 'Listing', eas: 'eas metadata, iOS only', launch: 'launch metadata, iOS and Android' },
  { label: 'OTA updates', eas: 'Hosted on Expo servers', launch: 'Your own S3, R2 or Supabase' },
  {
    label: 'Signing keys',
    eas: 'Can live on Expo servers',
    launch: 'OS keychain, only a CSR leaves',
  },
  { label: 'License', eas: 'Closed SaaS', launch: 'MIT, open source' },
];

export type FaqItem = Readonly<{ question: string; answer: string }>;

export const FAQ_ITEMS: readonly FaqItem[] = [
  {
    question: 'Is Launch free?',
    answer:
      'Yes. Launch is MIT licensed. You pay only what you would pay anyway: your own hardware, plus the Apple Developer ($99 a year) and Google Play ($25 once) fees.',
  },
  {
    question: 'Can I build iOS apps without a Mac?',
    answer:
      'A Mac has to be in the loop, but it does not have to be yours. Launch can start a cloud Mac in your own AWS account, build on any Mac over SSH, or hand off to eas build. Android builds anywhere a JDK runs.',
  },
  {
    question: 'How do I move from EAS?',
    answer:
      'Swap the commands one for one: eas build to launch build, eas submit to launch release, eas update to launch update. If your app already ships, launch adopt writes your live store setup into the config.',
  },
  {
    question: 'Where are my keys stored?',
    answer:
      'In your OS keychain. Launch only sends a certificate signing request to Apple. Nothing goes to a Launch server, because there is none.',
  },
  {
    question: 'Does it run in CI?',
    answer:
      'Yes. launch ci init writes a GitHub Actions workflow, and every command runs without prompts when it detects CI, a pipe or an agent.',
  },
];
