import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, projectRoot, '');
  const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf-8'));
  const backendPort = process.env.PORT || env.PORT || '3000';
  const devHost = process.env.HOST || env.HOST || 'localhost';
  const backendHttp = `http://localhost:${backendPort}`;
  const backendWs = `ws://localhost:${backendPort}`;

  return {
    plugins: [vue()],
    define: {
      'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version),
    },
    server: {
      host: devHost,
      port: 5173,
      proxy: {
        '/api': backendHttp,
        '/ws': {
          target: backendWs,
          ws: true,
        },
      },
    },
  };
});
