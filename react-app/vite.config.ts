import path from 'path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Vite config for Trader Screen React app (Option A: bundle.js + bundle.css).
 * Output goes to File Cabinet path for Suitelet to load via N/file.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      input: path.resolve(__dirname, 'index.html'),
      output: {
        format: 'iife',
        name: 'MCGIReactSuitelet',
        inlineDynamicImports: true,
        entryFileNames: 'bundle.js',
        assetFileNames: 'bundle.[ext]',
      },
    },
    target: 'es2015',
    minify: 'esbuild',
    sourcemap: false,
    outDir: path.resolve(__dirname, '../src/FileCabinet/SuiteScripts/mcgi_services/trader_screen/react-app/dist'),
    assetsInlineLimit: 0,
    cssCodeSplit: false,
    chunkSizeWarningLimit: 1000,
  },
  server: {
    port: 3000,
    open: false,
  },
  optimizeDeps: {
    include: ['react', 'react-dom'],
  },
});
