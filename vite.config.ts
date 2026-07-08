import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: /^blob:/,
            handler: 'CacheFirst',
            options: { cacheName: 'tempoweb-local-blobs' }
          }
        ]
      },
      manifest: {
        name: 'TempoWeb',
        short_name: 'TempoWeb',
        description: '브라우저 안에서 음악 속도와 음정을 조절하는 연습 도구',
        theme_color: '#090b0f',
        background_color: '#090b0f',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: '/icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable'
          }
        ]
      }
    })
  ],
  server: {
    host: '0.0.0.0'
  }
});
