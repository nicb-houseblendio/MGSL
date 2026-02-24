import path from 'path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Vite configuration for React suitelet bundle
 * Outputs bundle.js and bundle.css for embedding in NetSuite suitelet
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
      output: {
        entryFileNames: 'bundle.js',
        chunkFileNames: 'bundle.js',
        assetFileNames: (assetInfo) => {
          if (assetInfo.name === 'index.css') {
            return 'bundle.css';
          }
          return 'bundle.[ext]';
        },
        format: 'iife',
        name: 'MCGIReactSuitelet',
        inlineDynamicImports: true,
      },
    },
    target: 'es2015',
    minify: 'esbuild',
    sourcemap: false,
    outDir: '../src/FileCabinet/SuiteScripts/trader-screen',
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
