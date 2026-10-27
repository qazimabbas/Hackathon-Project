import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
export default defineConfig(({ mode }) => {
  // Read server ports for the local proxy, without exposing secrets to the client.
  const env = loadEnv(mode, root, '');
  return {
    plugins: [react()],
    server: {
      host: '127.0.0.1',
      port: Number(env.CLIENT_PORT || 5173),
      strictPort: true,
      proxy: { '/api': { target: `http://127.0.0.1:${env.PORT || 3001}`, changeOrigin: true } },
    },
    preview: { host: '127.0.0.1', port: Number(env.CLIENT_PORT || 5173), strictPort: true },
  };
});
