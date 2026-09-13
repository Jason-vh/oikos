import { defineConfig } from 'vite';

const authorityTarget = `http://127.0.0.1:${process.env.OIKOS_AUTHORITY_PORT ?? '3000'}`;
const authorityProxy = { '/api': { target: authorityTarget, ws: true, changeOrigin: true } };

export default defineConfig({
  server: { port: 5180, proxy: authorityProxy },
  preview: { proxy: authorityProxy },
  build: {
    target: 'es2022',
    rollupOptions: { input: { game: 'index.html', art: 'art.html', shared: 'shared.html' } },
  },
});
