import { defineConfig } from 'vite';
import { resolve } from 'path';

// Manifest content scripts are classic scripts. Build this entry separately as
// an IIFE so it has no ESM imports when Chrome injects it into a web page.
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, 'src/content/extractor.ts'),
      name: 'AegisContent',
      formats: ['iife'],
      fileName: () => 'content.js',
    },
    rollupOptions: {
      output: {
        entryFileNames: 'content.js',
      },
    },
  },
});
