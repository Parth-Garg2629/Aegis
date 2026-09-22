import { defineConfig } from 'vite';
import { resolve } from 'path';
import { writeFileSync } from 'fs';
import { generateManifest } from './manifest';

function manifestPlugin() {
  return {
    name: 'generate-manifest',
    closeBundle() {
      const manifest = generateManifest();
      writeFileSync(
        resolve(__dirname, 'dist/manifest.json'),
        JSON.stringify(manifest, null, 2)
      );
    },
  };
}

export default defineConfig({
  plugins: [manifestPlugin()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'src/ui/popup/popup.html'),
        offscreen: resolve(__dirname, 'src/offscreen/offscreen.html'),
        sw: resolve(__dirname, 'src/background/sw.ts'),
        content: resolve(__dirname, 'src/content/extractor.ts'),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'sw') return 'sw.js';
          if (chunkInfo.name === 'content') return 'content.js';
          return '[name].js';
        },
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
      },
    },
  },
});
