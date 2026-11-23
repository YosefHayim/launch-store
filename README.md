# Launch

Open-source, self-hosted alternative to [Expo EAS](https://docs.expo.dev/eas/) for people who ship Expo and [React Native](https://reactnative.dev/) apps to the [App Store](https://developer.apple.com/app-store/) and [Google Play](https://play.google.com/console/about/).

[Releases and changelog](https://github.com/YosefHayim/launch-store/releases)

## Why

Shipping an app is more than a build: signing setup, [App Store Connect](https://developer.apple.com/app-store-connect/) / [Play Console](https://play.google.com/console) config, in-app purchases, subscriptions, capabilities, and listing metadata. EAS builds and submits, then leaves all of that to Apple's and Google's portals. Launch makes the **whole path, store config included, declarative**: from one typed `launch.config.ts` it provisions your signing, reconciles your App Store Connect and Google Play catalog, generates the native project, builds and signs the binary, and uploads an Android bundle. Keys stay in your local keychain. **iOS signing needs a Mac** on the machine that runs the build.

Launch is an end-to-end release tool: it owns the path from source to store for both iOS and Android, on hardware you own. It is not just an App Store Connect SDK or an ASC MCP server. Those wrap a slice of Apple's API. Launch drives the release across Apple and Google.

## Quick start

**Node.js 24+** ([nodejs.org](https://nodejs.org/en)). **iOS needs a Mac** with [Xcode](https://developer.apple.com/xcode/), [CocoaPods](https://cocoapods.org/), an [Apple Developer Program](https://developer.apple.com/programs/enroll/) membership, and an [App Store Connect API key](https://appstoreconnect.apple.com/access/integrations/api). **Android** needs a [JDK](https://openjdk.org/), the [Android SDK](https://developer.android.com/studio) with `ANDROID_HOME` set, and a [Google Play Developer](https://play.google.com/console/signup) account. **iOS on another Mac** uses `launch-store build ios --remote aws` or `launch-store build ios --remote user@host`.

Install from [npm](https://www.npmjs.com/package/launch-store):

```bash
npm install --save-dev launch-store
```

Then, from the app:

```bash
npx launch-store init
npx launch-store creds set-key
npx launch-store creds setup
npx launch-store build ios --dry-run
npx launch-store build ios
```

The dry run prints `Dry run` and changes nothing. A real iOS run leaves the signed archive on disk after it checks that the app exists. `npx launch-store build android` uploads the bundle unless you pass `--no-submit`.

## Usage

### Commands

| Command | What it does |
| --- | --- |
| `launch-store build <ios\|android>` | Prebuild and sign. Android uploads the bundle. iOS leaves the signed archive on disk. |
| `launch-store release <ios\|android>` | Ship the latest build to the public store, with confirmation. |
| `launch-store update` | Publish an over-the-air JS update ([Expo Updates](https://docs.expo.dev/versions/latest/sdk/updates/)). |
| `launch-store sync` | Reconcile App Store Connect products, pricing, and the listing from `launch.config.ts`. |
| `launch-store adopt` | Import a live App Store Connect setup into `launch.config.ts`. |
| `launch-store creds` | Inspect credentials, import the API key, and switch Apple accounts. |
| `launch-store plan` | Show what `sync` would change. `launch-store drift --check` exits 2 when the store has drifted. |
| `launch-store doctor` | Check that the local toolchain and store account are ready. |

`launch-store --help` lists every command. Every field is set in the root [`launch.config.ts`](./launch.config.ts). Hover a name to read what it does.

### Configuration

App facts (bundle id, version) are read from each app's Expo config, `app.json` or `app.config.{ts,js}`. `launch.config.ts` is the only Launch config. Put one in an app folder, or one at the repo root with sections keyed by bundle id. The nearest file wins: running inside an app folder uses that folder's file when it exists, and otherwise the file found by walking up. The two files are never merged. The root [`launch.config.ts`](./launch.config.ts) is a full example. `defineConfig` is the public helper. The published [JSON Schema](https://json-schema.org/) is `schema/launch.config.schema.json`. `launch-store config schema` prints it, and `launch-store config schema --out launch.config.schema.json` writes a copy for your editor.

```ts
import { defineConfig } from 'launch-store';

export default defineConfig({
  appRoots: ['./examples'],
  credentials: 'local',
  storage: 'local',
  buildEngine: 'xcode',
  profiles: {
    production: { name: 'production', envFile: '.env', sizeBudgetMB: 200 },
  },
});
```

Unknown keys are kept so `launch-store config validate` can flag them.

### Credentials

- The API key (`.p8`), distribution private key, and Android upload key live in your **OS keychain**.
- The iOS certificate is also backed up as a password-protected `.p12` under `~/.launch/credentials/` (chmod 600). The password is stored in the keychain, never beside the file.
- Your private key is generated locally. Only a CSR is ever sent to Apple.
- Launch reuses an existing distribution certificate instead of creating new ones.

## How it works

`launch.config.ts` is the desired state. `launch-store plan` diffs it against the live store and changes nothing. `launch-store sync` applies that diff after you confirm. `launch-store adopt` reads a live App Store Connect setup back into the file.

`launch-store build` accepts `ios`, `android`, `tvos`, `macos`, and `visionos`. Android upload goes through the Play API. The iOS path stops once the signed archive is on disk. `--remote aws` and `--remote user@host` run that iOS build on another Mac. `launch-store cloud` sets up the EC2 Mac. Android does not need a Mac.

`launch-store update` publishes a code-signed JS update. `launch-store release` is the confirmed public ship.

## Status and scope

Launch is active, MIT-licensed, and published as [`launch-store`](https://www.npmjs.com/package/launch-store).

**`launch-store build` accepts `ios`, `android`, `tvos`, `macos`, and `visionos`.** `--remote`, `--clean`, `--no-ccache`, and `--distribution` are real flags. **iOS does not upload the IPA.** The command checks that the app exists and leaves the signed archive on disk. **Android uploads the bundle** unless you pass `--no-submit`.

**`release`, `sync`, and `adopt` change the live store.** They refuse to run without a terminal unless you pass `--yes`.

`plan` is read-only. `drift --check` exits 2 when the store does not match the file.

## Help

`launch-store doctor` checks the toolchain and the store account. `launch-store --help` lists the commands. `launch-store explain <topic>` and `--explain` expand a step in plain English.

Bugs and questions go to [GitHub issues](https://github.com/YosefHayim/launch-store/issues).

## Development

```bash
pnpm install
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

npm, yarn, and pnpm can each install this repo. Lockfiles stay untracked. [Vitest](https://vitest.dev/) runs the tests. [Biome](https://biomejs.dev/) lints and formats. See [`AGENTS.md`](./AGENTS.md) for module ownership and how to add a backend.

## License

MIT
