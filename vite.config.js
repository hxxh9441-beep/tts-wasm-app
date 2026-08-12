import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

// ===== نسخ ملفات Piper (ONNX runtime + phonemize WASM) إلى public/ =====
// piper-tts-web تشحن هذه الملفات داخل node_modules ويجب أن تُخدم من الجذر.
function copyPiperAssets() {
  const srcBase = resolve('node_modules/piper-tts-web/dist')
  const groups = [
    ['onnx', /\.wasm$/],
    ['piper', /\.(wasm|data)$/],
  ]
  for (const [dir, pattern] of groups) {
    const srcDir = resolve(srcBase, dir)
    const outDir = resolve('public', dir)
    mkdirSync(outDir, { recursive: true })
    for (const f of readdirSync(srcDir)) {
      if (pattern.test(f)) {
        copyFileSync(resolve(srcDir, f), resolve(outDir, f))
      }
    }
  }
}
copyPiperAssets()

export default defineConfig({
  base: './',
  plugins: [
    react(),
    tailwindcss(),
    // ===== PWA: عمل أوفلاين كامل بعد الزيارة الأولى =====
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons.svg', 'pwa-180.png'],
      manifest: {
        name: 'نص → صوت | تحويل النص إلى كلام محلي',
        short_name: 'نص → صوت',
        description: 'تحويل النص إلى كلام — محلياً 100% على جهازك دون إنترنت.',
        theme_color: '#0b1020',
        background_color: '#0b1020',
        display: 'standalone',
        orientation: 'portrait',
        dir: 'rtl',
        lang: 'ar',
        start_url: '.',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // precache خفيف: الأساسيات فقط (بدون WASM — تُخزَّن عند الطلب)
        globPatterns: ['**/*.{css,html,svg,png,ico,webmanifest}'],
        globIgnores: ['**/onnx/**', '**/piper/**'],
        maximumFileSizeToCacheInBytes: 64 * 1024 * 1024,
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            // ملفات التطبيق JS: تُخزَّن عند أول طلب — تُمكّن العمل أوفلاين تدريجياً
            urlPattern: ({ url }) =>
              url.origin === self.location.origin && /\.js$/.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'app-files',
              expiration: {
                maxEntries: 60,
                maxAgeSeconds: 365 * 24 * 60 * 60,
              },
            },
          },
          {
            // ملفات WASM/ONNX تُمرَّر مباشرة (لا يعترضها SW — تبقى في HTTP cache)
            urlPattern: /\/onnx\/.*\.wasm|\/piper\/.*/,
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  build: {
    target: 'chrome110',
    sourcemap: false,
  },
})
