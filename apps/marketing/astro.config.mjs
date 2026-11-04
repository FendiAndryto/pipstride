import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://pipstride.homever.my.id',
  output: 'static',
  build: {
    format: 'directory'
  },
  integrations: [sitemap()]
});
