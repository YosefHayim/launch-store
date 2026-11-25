import { defineConfig } from '../launch-file.js';

export default defineConfig({
  apps: [
    {
      name: 'My App',
      projectPath: '.',
      ios: {
        bundleId: 'com.example.app',
        version: '1.0.0',
        buildNumber: 1,
        scheme: 'MyApp',
      },
      android: {
        packageName: 'com.example.app',
        version: '1.0.0',
        track: 'internal',
      },
    },
  ],
});
