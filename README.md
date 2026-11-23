# Launch

Open-source, self-hosted alternative to [Expo EAS](https://docs.expo.dev/eas/) for people who ship Expo and [React Native](https://reactnative.dev/) apps to the [App Store](https://developer.apple.com/app-store/) and [Google Play](https://play.google.com/console/about/).

[Releases and changelog](https://github.com/YosefHayim/launch-store/releases)

## Why

Shipping an app is more than a build: signing setup, [App Store Connect](https://developer.apple.com/app-store-connect/) / [Play Console](https://play.google.com/console) config, in-app purchases, subscriptions, capabilities, and listing metadata. EAS builds and submits, then leaves all of that to Apple's and Google's portals. Launch makes the **whole path, store config included, declarative**: from one typed `launch.config.ts` it provisions your signing, reconciles your App Store Connect and Google Play catalog, generates the native project, builds and signs the binary, and uploads an Android bundle. Keys stay in your local keychain. **iOS signing needs a Mac** on the machine that runs the build.

Launch is an end-to-end release tool: it owns the path from source to store for both iOS and Android, on hardware you own. It is not just an App Store Connect SDK or an ASC MCP server. Those wrap a slice of Apple's API. Launch drives the release across Apple and Google.

## Install

**Node.js 24+** ([nodejs.org](https://nodejs.org/en)). **iOS needs a Mac** with [Xcode](https://developer.apple.com/xcode/), [CocoaPods](https://cocoapods.org/), an [Apple Developer Program](https://developer.apple.com/programs/enroll/) membership, and an [App Store Connect API key](https://appstoreconnect.apple.com/access/integrations/api). **Android** needs a [JDK](https://openjdk.org/), the [Android SDK](https://developer.android.com/studio) with `ANDROID_HOME` set, and a [Google Play Developer](https://play.google.com/console/signup) account. An iOS build can run on another Mac over SSH.

Install from [npm](https://www.npmjs.com/package/launch-store):

```bash
npm install --save-dev launch-store
```

`launch-store --help` lists every command. `launch-store <command> --help` explains that command. Every field is set in the root [`launch.config.ts`](./launch.config.ts).

## Configuration

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

Bugs and questions go to [GitHub issues](https://github.com/YosefHayim/launch-store/issues).

## Development

```bash
pnpm install
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

npm, yarn, and pnpm can each install this repo. Lockfiles stay untracked. [Vitest](https://vitest.dev/) runs the tests. [Biome](https://biomejs.dev/) lints and formats. See [`AGENTS.md`](./AGENTS.md) for module ownership and how to add a backend.

## License

MIT
