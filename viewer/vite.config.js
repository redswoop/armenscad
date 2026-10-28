import { defineConfig } from 'vite';

// CYBERDOS=<checkout> serves CyberDOS from that checkout instead of node_modules, live, to develop the two
// together (its own dep cache, so a normal instance on the same folder is left alone).
const cyberdos = process.env.CYBERDOS;

export default defineConfig({
  // CyberDOS ships TypeScript source; nothing to pre-bundle
  optimizeDeps: { exclude: ['@redswoop/cyberdos'] },
  resolve: { alias: cyberdos ? [{ find: /^@redswoop\/cyberdos/, replacement: cyberdos }] : [] },
  cacheDir: cyberdos ? 'node_modules/.vite-cyberdos' : undefined,
  server: {
    port: parseInt(process.env.UI_PORT ?? '5180', 10),      // tools/browse picks these when the defaults are busy
    strictPort: true,
    host: process.env.HOST ?? '127.0.0.1',   // HOST=0.0.0.0 to open it to the LAN
    fs: cyberdos ? { allow: ['..', cyberdos] } : undefined,
    proxy: {
      '/api': `http://127.0.0.1:${process.env.PORT ?? '3003'}`,
    },
  },
});
