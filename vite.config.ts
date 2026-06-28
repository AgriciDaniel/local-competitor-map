import path from 'path';
import { defineConfig } from 'vite';


export default defineConfig(() => {
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        proxy: {
          // SHELVED: paired with dataforseo.ts for a future local-SEO ranking
          // layer (not used by the current Places-based competitor search).
          // Proxies DataForSEO server-side to avoid browser CORS; the client
          // sends Basic auth in the Authorization header and we just forward.
          '/api/dataforseo': {
            target: 'https://api.dataforseo.com',
            changeOrigin: true,
            secure: true,
            rewrite: (p) => p.replace(/^\/api\/dataforseo/, ''),
          },
        },
      },
      plugins: [],
      // Keys are resolved at runtime (Settings tab / runtime-keys.ts), so no
      // process.env injection is needed here.
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
