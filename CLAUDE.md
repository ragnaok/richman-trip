# CLAUDE.md

給 AI 協作者的專案規則。README.md 是給人看的介紹與操作步驟，這裡放的是「改動這個 repo 之前必須先知道的事」。

## 這個 repo 是什麼

多人共用的私人旅遊 PWA **範本**。`main` 不對應任何真實行程，每趟真實行程是從 `main` 開出去的獨立 git 分支（例如 `inuyama`、`okayama`）。

**程式碼不分岔**：`src/`、`functions/`、`worker-cron/src/index.ts` 所有行程共用同一份。功能修正一律做在 `main`，行程分支用 `git rebase main` 疊上去。

## 架構不變量

改動前先讀對應檔案開頭的註解，那裡通常寫了「為什麼是這樣」。

### 資料同步（`src/lib/sync.ts`、`functions/api/pull.ts`、`push.ts`）

- 前端一律**先寫本機 IndexedDB（`src/lib/db.ts`）再非同步推雲端**，離線要能完整操作。不要為了省事改成「先打 API 再更新 UI」。
- 每張同步表都必須有 `id`（或自然鍵）、`updated_at`（毫秒時間戳）、`deleted`（0/1 墓碑）。
- **刪除一律寫墓碑，不要真的 DELETE 列**，否則對方裝置拉不到刪除事件。
- 衝突解法是 LWW：`INSERT … ON CONFLICT DO UPDATE … WHERE excluded.updated_at > 現有.updated_at`。新增同步表時要沿用這個寫法。
- 身分（`members`）／分類（`cats`）／住宿（`hotels`）改名或刪除走「舊值寫墓碑＋新值另建一列」，不是就地改 id。
- 觸發時機與退避重試都集中在 `src/lib/sync.ts`（檔頭註解有完整清單）。加新觸發點前先確認不會造成重複拉取。

### IndexedDB schema

`src/lib/db.ts` 有 `DB_VERSION`，**所有 store／index 異動都要在同一支檔案的 migration 裡處理**，不要另外散在別處。使用者裝置上有舊版資料，migration 要能從任意舊版升上來。

### D1 schema

D1 沒有自動 migration。改 schema 時：

1. 只能用**不破壞既有資料**的寫法：`ALTER TABLE … ADD COLUMN`、`CREATE TABLE IF NOT EXISTS`。**不要 `DROP`、不要改欄位型別。**
2. 本機與正式環境**各跑一次**（`--local` / `--remote`）。
3. 回頭同步更新 `schema.sql`。
4. 動正式環境前**先備份**（見 README「備份」）。

### reminders 是衍生快取（`worker-cron/src/index.ts`）

`reminders` 完全從 `plans` 衍生，**每輪整批重算**，不是在各個寫入路徑同步維護的——這樣不會因為漏掉某條寫入路徑而脫節（自我修復），資料量小、成本可忽略。

不要為了「效率」改成「只在 plans 變更時更新 reminders」。行程時間改了就重算並清掉 `sent_at` 讓它能再發一次，這個行為要保留。

### 認證

`functions/api/_middleware.ts` 統一驗證 session cookie。免認證路徑寫在該檔案的 `PUBLIC_PATHS`，加白名單前先確認回傳內容真的不是機密（參考 `public-settings.ts` 開頭註解的取捨）。

### 樣式

純 CSS 變數，token 在 `src/styles/tokens.css`。**不要引入 CSS-in-JS 或 utility framework**，也不要在元件裡寫死色值，一律用既有 token。

### design/ 資料夾

`design/*.dc.html` 是視覺設計參考，**不是可執行程式碼，也不會被建置流程用到**。`design/support.js`、`image-slot.js`、`_ds/` 是設計編輯器自己的執行環境，**絕對不要 import 進 `src/`**。

唯一從 `design/` 流進程式碼的是 `src/data/seed.json`（由 `scripts/extract-seed.mjs` 抽出）。`main` 上 `design/` 是空的且已 gitignored。

## 部署陷阱（實測過的，不要再踩）

### Pages 部署一定要帶 `--branch`

專案沒接 Git，`wrangler pages deploy` 會**依你本機當下的 git 分支名稱**決定部署到 Production 還是 Preview。沒帶 `--branch production`（或該行程專案實際設定的 production branch）會部署成 **Preview**：指令看起來成功，正式網域卻沒更新；Preview 也讀不到 Production 的 Secrets，症狀跟「密碼設錯」一模一樣。

確認方式：

```bash
wrangler pages deployment list --project-name <project>
```

### `wrangler pages deploy` 不支援 `--config`，也不能用 `--cwd` 繞

- `--config <自訂路徑>`：直接報錯拒絕。
- `--cwd <別的目錄>`：會讓 wrangler 找不到 repo 根目錄的 `functions/`，整個 `/api/*` 不會被打包進部署。網站靜態頁面照常打開，但所有 API 呼叫回 405 —— 很容易誤判成密碼或 Secret 設錯。

多行程部署唯一可行做法是**暫時覆蓋根目錄 `wrangler.toml`、部署完立刻換回來**（步驟見 README「多行程部署」）。換回來後務必 `git diff wrangler.toml` 確認沒有輸出。

### Cloudflare Cron Trigger 在這個帳號上不會觸發

`worker-cron/wrangler.toml` 的 `[triggers] crons` **完全沒有被 Cloudflare 觸發**，這是查證過的平台端問題（2026 年反覆回報、官方未修），不是設定錯誤：`/schedules` API 顯示排程正確登記、binding 正確、手動打 HTTP 進得去，但 `workersInvocationsAdaptive` 查到的 cron 觸發次數是 0。

因此 `worker-cron/src/index.ts` 除了 `scheduled()` 還有 `fetch` handler 當備援：外部 cron 服務打 `GET /trigger?key=<CRON_SECRET>` 執行同一份 `runAllTrips()`；key 不對回 404（不透露路徑存在）。

**`scheduled()` 不要拔掉**——Cloudflare 修好會自動接手，兩邊同時觸發也不會重複發送（`sent_at` 天然去重）。

### VAPID 金鑰全帳號共用

`worker-cron/` 是**帳號層級共用的一支 Worker**，不是每個行程一支。所有行程共用同一組 VAPID 金鑰對——VAPID 代表「這個 Worker 的身分」，不是每趟行程的身分。

**開新行程時不要重新產生 VAPID 金鑰**，那會讓所有既有訂閱一次失效；新行程 Pages 專案的 `VAPID_PUBLIC_KEY`／`VAPID_PRIVATE_KEY` 必須跟 `worker-cron` 用的是同一組，否則訂閱建得起來但收不到通知（push 服務會拒絕簽章不符的請求）。

開新行程只需要：`worker-cron/wrangler.toml` 加一組 `[[d1_databases]]`（binding 用 `DB_<行程代號>`）、`src/index.ts` 的 `TRIPS` 加一筆、重跑一次 `wrangler deploy`。不用另開 Worker，也不用另設 cron-job.org。

只有**跨 Cloudflare 帳號**才需要各自獨立部署一份 `worker-cron`（各自的 VAPID、`CRON_SECRET`、cron-job.org 設定）。

### 為什麼推播要另開一個 Worker

Cloudflare Pages Functions **不支援 Cron Trigger**（`scheduled()` 是 Workers 專屬），這是查證過的平台限制，不是繞遠路。`worker-cron/` 是完全獨立的部署單位，跟 Pages 部署互不影響。

## 刻意的取捨（不要「順手修好」）

以下都是明知道的取捨，改之前先問：

- **密碼比對用明文**（Secret 存 `PW_SHARED` 明文，雙方各自 SHA-256 再比雜湊）而非 bcrypt/argon2 —— 原因是 argon2/bcrypt 在 Workers runtime 要額外 WASM/polyfill。SHA-256 只是把逐字元短路比對換成定長比對，擋不了 env 外洩。這是現況取捨不是最終答案（`functions/api/login.ts` 註解也寫了「正式上線建議升級」）；真要改就整組換掉：Secret 改存雜湊值、login 端改用 argon2/bcrypt 驗證，不要只換一半。
- **單一推播訂閱送失敗不重試**（網路錯誤，非 404/410）—— 偶爾漏一則比重試風暴可接受，見 `worker-cron/src/index.ts` 開頭註解。
- **通知點擊只開/聚焦 App 首頁**，不深連結到單筆行程 —— 這個 App 沒有單筆行程的 URL 路由。
- **單一行程設計**（單一共用密碼、schema 沒有 trip 概念）—— 開新行程是複製成新 Pages 專案 + 新 D1，不要試圖讓一份部署同時服務兩趟行程。

## 慣例

- 註解寫「為什麼」，不寫「做了什麼」。既有檔案開頭的取捨註解不要刪。
- `main` 上不放任何真實行程的資料、照片、設計稿或備份。
- 行程差異一律優先做成 settings-driven（存 D1、設定頁可改），只有瀏覽器在載入 D1 資料前就要讀到的東西（favicon、PWA icon、`vite.config.ts` 的 manifest 靜態欄位、預設主視覺圖）才留在行程分支。
- 只改 `src/`／`functions/` 不需要重新部署 `worker-cron/`。
