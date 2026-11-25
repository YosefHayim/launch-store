import { defineConfig } from 'launch-store';

export default defineConfig({
  apps: [
    {
      name: 'Hello World',
      projectPath: '.',
      ios: {
        bundleId: 'com.example.helloworld',
        version: '1.0.0',
        buildNumber: 1,
        scheme: 'HelloWorld',
      },
      android: {
        packageName: 'com.example.helloworld',
        version: '1.0.0',
        track: 'internal',
      },
    },
  ],
});
