import path from 'path';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { defineConfig } from 'vite';

/**
 * Vite configuration for React suitelet bundle
 * Inlines all CSS/JS into a single HTML file for NetSuite File Cabinet (no external asset requests)
 */
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        format: 'iife',
        name: 'MCGIReactSuitelet',
        inlineDynamicImports: true,
      },
    },
    target: 'es2015',
    minify: 'esbuild',
    sourcemap: false,
    outDir: 'dist',
    assetsInlineLimit: 100000000,
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
