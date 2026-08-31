import { defineConfig } from 'wxt';

import baseConfig from './wxt.config';

export default defineConfig({
  ...baseConfig,
  outDir: 'dev-dist',
  outDirTemplate: 'xianyu-assistant-unpacked',
  webExt: {
    ...baseConfig.webExt,
    disabled: true
  },
  vite: () => ({
    optimizeDeps: {
      entries: ['entrypoints/sidepanel/index.html']
    }
  })
});
