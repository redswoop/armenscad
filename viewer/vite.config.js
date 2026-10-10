import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5180,
    host: process.env.HOST ?? '127.0.0.1',   // HOST=0.0.0.0 to open it to the LAN
    proxy: {
      '/api': 'http://127.0.0.1:3003',
    },
  },
});
