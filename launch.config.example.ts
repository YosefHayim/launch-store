import { defineConfig } from 'launch-store';

export default defineConfig({
  credentials: 'local',
  storage: 'local',
  buildEngine: 'fastlane',
  profiles: {
    production: {
      name: 'production',
      envFile: '.env.production',
      ssl: true,
      sizeBudgetMB: 200,
    },
    preview: {
      name: 'preview',
      envFile: '.env.preview',
      sizeBudgetMB: 200,
    },
  },
});
