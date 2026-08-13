import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../src/shared'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        configure: (proxy, _options) => {
          proxy.on('proxyReq', (proxyReq, req, _res) => {
            if (req.method === 'OPTIONS') {
              proxyReq.setHeader('Origin', 'http://localhost:5173');
            }
          });
          proxy.on('proxyRes', (proxyRes, req, _res) => {
            if (req.method === 'OPTIONS') {
              proxyRes.headers['access-control-allow-origin'] = 'http://localhost:5173';
              proxyRes.headers['access-control-allow-methods'] = 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS';
              proxyRes.headers['access-control-allow-headers'] = 'Content-Type,Authorization';
            }
          });
        },
      },
      '/health': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        configure: (proxy, _options) => {
          proxy.on('proxyReq', (proxyReq, req, _res) => {
            if (req.method === 'OPTIONS') {
              proxyReq.setHeader('Origin', 'http://localhost:5173');
            }
          });
          proxy.on('proxyRes', (proxyRes, req, _res) => {
            if (req.method === 'OPTIONS') {
              proxyRes.headers['access-control-allow-origin'] = 'http://localhost:5173';
              proxyRes.headers['access-control-allow-methods'] = 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS';
              proxyRes.headers['access-control-allow-headers'] = 'Content-Type,Authorization';
            }
          });
        },
      },
      '/metrics': {
        target: 'http://localhost:9090',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});