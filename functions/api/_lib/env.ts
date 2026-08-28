// Pages Function 共用的 Env 型別（D1 binding + secrets）。
// 本機開發的值來自 .dev.vars；正式部署用 `wrangler pages secret put` 設定。
// PW_SHARED 是單一共用密碼：只驗證「是不是自己人」，不驗證「是哪一個人」，
// 角色是登入後前端選的本地偏好。
export interface Env {
  DB: D1Database
  SESSION_SECRET: string
  PW_SHARED: string
  GEMINI_API_KEY: string
  // VAPID_PUBLIC_KEY 不是機密（前端訂閱要用），但一樣走 Secret 存，避免散在程式碼裡。
  VAPID_PUBLIC_KEY: string
  // 排程送出（worker-cron/）用同一組私鑰；這裡這份只給 /api/push-test 做即時測試。
  VAPID_PRIVATE_KEY: string
}
