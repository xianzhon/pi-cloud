import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import vue from '@vitejs/plugin-vue';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const pdfJsCMapDirectory = path.resolve(
  __dirname,
  'node_modules/pdfjs-dist/cmaps',
);
const pdfJsCMapUrlPrefix = '/pdfjs/cmaps/';

function pdfJsCMaps(): Plugin {
  return {
    name: 'pdfjs-cmaps',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const requestPath = request.url?.split('?')[0];
        if (!requestPath?.startsWith(pdfJsCMapUrlPrefix)) return next();

        const fileName = decodeURIComponent(
          requestPath.slice(pdfJsCMapUrlPrefix.length),
        );
        if (!fileName || path.basename(fileName) !== fileName) return next();

        fs.readFile(path.join(pdfJsCMapDirectory, fileName), (error, data) => {
          if (error) return next();
          response.setHeader('Content-Type', 'application/octet-stream');
          response.end(data);
        });
      });
    },
    generateBundle() {
      for (const fileName of fs.readdirSync(pdfJsCMapDirectory)) {
        const filePath = path.join(pdfJsCMapDirectory, fileName);
        if (!fs.statSync(filePath).isFile()) continue;
        this.emitFile({
          type: 'asset',
          fileName: `pdfjs/cmaps/${fileName}`,
          source: fs.readFileSync(filePath),
        });
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, projectRoot, '');
  const pkg = JSON.parse(
    fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf-8'),
  );
  const backendPort = process.env.PORT || env.PORT || '3000';
  const devHost = process.env.HOST || env.HOST || 'localhost';
  const backendHttp = `http://localhost:${backendPort}`;
  const backendWs = `ws://localhost:${backendPort}`;

  return {
    plugins: [vue(), pdfJsCMaps()],
    define: {
      'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version),
    },
    build: {
      manifest: true,
      // Monaco is an opt-in feature chunk with its own gzip budget in CI.
      chunkSizeWarningLimit: 3500,
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
