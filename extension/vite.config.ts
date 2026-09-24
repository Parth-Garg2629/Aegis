import { defineConfig } from 'vite';
import { resolve } from 'path';
import { writeFileSync, mkdirSync, existsSync, copyFileSync, readdirSync, unlinkSync } from 'fs';
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

function bundleMlAssetsPlugin() {
  return {
    name: 'bundle-ml-assets',
    closeBundle() {
      const distAssets = resolve(__dirname, 'dist/assets');

      const ortSrc = resolve(__dirname, 'node_modules/onnxruntime-web/dist');
      const ortDest = resolve(distAssets, 'ort');
      mkdirSync(ortDest, { recursive: true });
      for (const file of ['ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.mjs']) {
        const src = resolve(ortSrc, file);
        if (existsSync(src)) copyFileSync(src, resolve(ortDest, file));
      }

      const mpSrc = resolve(__dirname, 'node_modules/@mediapipe/tasks-vision/wasm');
      const mpDest = resolve(distAssets, 'mediapipe/wasm');
      mkdirSync(mpDest, { recursive: true });
      if (existsSync(mpSrc)) {
        for (const file of [
          'vision_wasm_internal.js',
          'vision_wasm_internal.wasm',
          'vision_wasm_module_internal.js',
          'vision_wasm_module_internal.wasm',
          'vision_wasm_nosimd_internal.js',
          'vision_wasm_nosimd_internal.wasm',
        ]) {
          const src = resolve(mpSrc, file);
          if (existsSync(src)) copyFileSync(src, resolve(mpDest, file));
        }
      }

      const staticAssets: Array<[string, string]> = [
        ['assets/mediapipe/blaze_face_short_range.tflite', 'mediapipe/blaze_face_short_range.tflite'],
        ['assets/models/aegis-nano.onnx', 'models/aegis-nano.onnx'],
      ];
      for (const [src, destRel] of staticAssets) {
        const srcPath = resolve(__dirname, src);
        if (existsSync(srcPath)) {
          const destPath = resolve(distAssets, destRel);
          mkdirSync(resolve(destPath, '..'), { recursive: true });
          copyFileSync(srcPath, destPath);
        }
      }

      if (existsSync(distAssets)) {
        for (const entry of readdirSync(distAssets, { withFileTypes: true })) {
          if (entry.isFile() && entry.name.startsWith('ort-wasm-simd-threaded')) {
            unlinkSync(resolve(distAssets, entry.name));
          }
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [manifestPlugin(), bundleMlAssetsPlugin()],
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
