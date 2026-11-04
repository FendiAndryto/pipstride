import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

// https://astro.build/config
export default defineConfig({
  site: 'https://pipstride.homever.my.id',
  output: 'static',
  build: {
    format: 'directory'
  },
  // packages/pricing/catalog.json lives above the app root; let dev serve it.
  vite: {
    server: {
      fs: {
        allow: [repoRoot]
      }
    }
  },
  integrations: [sitemap()]
});
