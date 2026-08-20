import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const isDocker = process.env.DOCKER === 'true';
const apiTarget = isDocker ? 'http://172.21.0.7:3000' : 'http://localhost:3000';
const frontendOrigin = isDocker ? 'http://fte-frontend:5173' : 'http://localhost:5173';

export default defineConfig({
  plugins: [react()],
  resolve: {},
  server: {
    port: 5173,
    proxy: {
      '/auth': {
        target: apiTarget,
        changeOrigin: true,
        configure: (proxy, _options) => {
          proxy.on('proxyReq', (proxyReq, req, _res) => {
            if (req.method === 'OPTIONS') {
              proxyReq.setHeader('Origin', frontendOrigin);
            }
          });
          proxy.on('proxyRes', (proxyRes, req, _res) => {
            if (req.method === 'OPTIONS') {
              proxyRes.headers['access-control-allow-origin'] = frontendOrigin;
              proxyRes.headers['access-control-allow-methods'] = 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS';
              proxyRes.headers['access-control-allow-headers'] = 'Content-Type,Authorization';
            }
          });
        },
      },
      '/api': {
        target: apiTarget,
        changeOrigin: true,
        configure: (proxy, _options) => {
          proxy.on('proxyReq', (proxyReq, req, _res) => {
            if (req.method === 'OPTIONS') {
              proxyReq.setHeader('Origin', frontendOrigin);
            }
          });
          proxy.on('proxyRes', (proxyRes, req, _res) => {
            if (req.method === 'OPTIONS') {
              proxyRes.headers['access-control-allow-origin'] = frontendOrigin;
              proxyRes.headers['access-control-allow-methods'] = 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS';
              proxyRes.headers['access-control-allow-headers'] = 'Content-Type,Authorization';
            }
          });
        },
      },
      '/health': {
        target: apiTarget,
        changeOrigin: true,
        configure: (proxy, _options) => {
          proxy.on('proxyReq', (proxyReq, req, _res) => {
            if (req.method === 'OPTIONS') {
              proxyReq.setHeader('Origin', frontendOrigin);
            }
          });
          proxy.on('proxyRes', (proxyRes, req, _res) => {
            if (req.method === 'OPTIONS') {
              proxyRes.headers['access-control-allow-origin'] = frontendOrigin;
              proxyRes.headers['access-control-allow-methods'] = 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS';
              proxyRes.headers['access-control-allow-headers'] = 'Content-Type,Authorization';
            }
          });
        },
      },
      '/metrics': {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});