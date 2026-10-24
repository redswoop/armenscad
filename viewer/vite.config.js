import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: parseInt(process.env.UI_PORT ?? '5180', 10),      // tools/browse picks these when the defaults are busy
    strictPort: true,
    host: process.env.HOST ?? '127.0.0.1',   // HOST=0.0.0.0 to open it to the LAN
    proxy: {
      '/api': `http://127.0.0.1:${process.env.PORT ?? '3003'}`,
    },
  },
});
