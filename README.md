# Launch

Build an iOS or Android app on your machine and send it to App Store Connect or Google Play.

```bash
npm install -g launch-store
launch init
launch credentials apple --key-id KEY_ID --issuer-id ISSUER_ID --p8 AuthKey.p8
launch credentials google --package com.example.app --json play.json
launch build ios
launch build android
launch release ios
launch release android
launch plan
launch sync
launch adopt
```

`launch plan` prints what would change. `launch sync` writes the name and version from `launch.config.ts` to the live store. `launch adopt` copies the live store back into `launch.config.ts`.

The Apple `.p8` key and the Play service-account JSON stay in the OS keychain. They are not written into the repo.

Needs Node 24. iOS builds need Xcode. Android builds need the Gradle wrapper in `android/`.
