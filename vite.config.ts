import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// 用 injectManifest 而非 generateSW：Web Push 的 `push`／`notificationclick` 監聽器
// 沒辦法用宣告式設定表達。precache manifest 注入 src/sw.ts 的 `self.__WB_MANIFEST`，
// runtime caching／navigation fallback 則在 src/sw.ts 用 workbox-routing 手寫。
export default defineConfig({
  server: {
    // `npm run dev` 本身沒有 /api/* 後端，proxy 到另外跑的 `npm run dev:cf`（8788），
    // 前端維持 HMR，API/登入則打到真正的 Functions + D1。
    proxy: {
      '/api': 'http://localhost:8788',
    },
  },
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      // devOptions 不開：`npm run dev` 維持純 UI 熱重載，SW 只在 production build 生效。
      //
      // manifest 不自動產生：name/short_name/description 要是這趟行程真正的設定，
      // 改由 functions/manifest.webmanifest.ts 查 D1 動態產生，index.html 手動指過去。
      manifest: false,
      injectManifest: {
        // build 輸出的 HTML/CSS/JS/字體收進 precache manifest：預快取 + 背景更新。
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        // 單一 JS bundle 未做 code splitting，已超過 workbox 預設 2MB 上限，調高讓它
        // 仍能被預快取。
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
      },
    }),
  ],
})
