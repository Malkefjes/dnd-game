import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Relative base so the build works on GitHub Pages under /<repo>/.
export default defineConfig({
  base: './',
  server: { host: '127.0.0.1', port: 5173 },
  build: {
    rollupOptions: {
      input: {
        game: resolve(__dirname, 'index.html'),
        gallery: resolve(__dirname, 'mockups/index.html'),
        minis: resolve(__dirname, 'mockups/minis.html'),
        toon: resolve(__dirname, 'mockups/toon.html'),
        pixel: resolve(__dirname, 'mockups/pixel.html'),
        parchment: resolve(__dirname, 'mockups/parchment.html'),
      },
    },
  },
});
