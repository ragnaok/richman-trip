# Richman Trip

四個功能分頁（行程／景點／行李／記帳）+ 設定頁，共用密碼登入、資料即時跨裝置同步、支援離線使用。

`main` 不對應任何真實行程，實際行程各自開 git 分支（見「多行程部署」）。

> 改動這個 repo 前請先讀 [CLAUDE.md](CLAUDE.md)：架構不變量、資料同步規則、schema 異動流程、部署陷阱與刻意的取捨都在那裡。

## 功能

- **行程**：每日行程列表、天氣、下一站、返回飯店導航、行程編輯與提醒（可推播到手機）
- **景點**：景點資訊、步行路線、美食推薦、備註、已去過標記、地區篩選；「用 Gemini 帶入景點資訊」一鍵補齊欄位
- **行李**：可分類、多人共用打包清單，依持有人篩選
- **記帳**：日幣／台幣雙幣共同帳本、代購標記、分類統計、明細
- **設定**（右緣滑入）：目的地標題／副標題／主視覺照片、旅遊日期、住宿地點、Gemini 地區提示、匯率、身分管理

## 技術棧

- 前端：React 18 + TypeScript + Vite + Zustand，`idb` 做本機 IndexedDB 持久化
- 後端：Cloudflare Pages Functions + D1
- PWA：`vite-plugin-pwa`（`injectManifest`，自寫 `src/sw.ts`）
- 推播：獨立的 Cloudflare Worker（`worker-cron/`）+ `@pushforge/builder`
- 樣式：純 CSS 變數（`src/styles/`）
- 圖示：`@phosphor-icons/react`

## 本機開發

```bash
npm install
```

在根目錄建立 `.dev.vars`（`wrangler pages dev` 自動讀取）：

```
SESSION_SECRET=<任意隨機字串，簽 session cookie 用>
PW_SHARED=<本機測試用的登入密碼，明文>
GEMINI_API_KEY=<沒有的話「用 Gemini 帶入景點資訊」會失敗，其他功能不受影響>
VAPID_PUBLIC_KEY=<Web Push 用的 VAPID 公鑰，見下方「推播提醒」>
```

`worker-cron/` 是獨立的 Worker 專案，要另外準備 `worker-cron/.dev.vars`：

```
VAPID_PRIVATE_KEY=<跟上面公鑰同一組金鑰對的私鑰，JWK JSON 字串>
```

兩份 `.dev.vars` 都已 gitignored。

```bash
npm run dev      # 純前端，Vite HMR，/api/* 打不通（沒有後端）
npm run dev:cf   # 前端 build 一次 + wrangler pages dev，含 Functions 與本機 D1，但沒有 HMR
```

**推薦兩個一起開**：`npm run dev:cf`（8788，後端）+ `npm run dev`（5173，HMR）同時開，用 5173 開發，`vite.config.ts` 已把 `/api/*` proxy 到 8788。

本機資料庫：

```bash
wrangler d1 execute my-trip --local --file=schema.sql   # 首次建表
wrangler d1 execute my-trip --local --file=seed.sql     # 灌種子資料（可選，先跑 node scripts/seed-d1.mjs 產生）
```

`my-trip` 換成 `wrangler.toml` 裡實際的 `database_name`。本機資料存在 `.wrangler/state/v3/d1`（gitignored），砍掉即清空，重跑上面兩行可重建。

## 部署（Cloudflare Pages）

下面所有 `wrangler` 指令都可以換成 `npx wrangler`（專案已經把 wrangler 裝在 devDependencies，不需要另外全域安裝）。

### 首次設置

```bash
# 0. 登入 Cloudflare 帳號（沒登入過或換了帳號才需要，會開瀏覽器走 OAuth）
wrangler login

# 1. 建立 D1，把 wrangler.toml 的 database_id 換成印出的真實 id
wrangler d1 create my-trip

# 2. 灌 schema（正式環境）
wrangler d1 execute my-trip --remote --file=schema.sql

# 3. 建立 Pages 專案
wrangler pages project create my-trip

# 4. 設定 Secrets（互動輸入，不會存進任何檔案）
wrangler pages secret put SESSION_SECRET --project-name my-trip
wrangler pages secret put PW_SHARED --project-name my-trip
wrangler pages secret put GEMINI_API_KEY --project-name my-trip
```

### 之後每次部署

```bash
npm run build
wrangler pages deploy dist --project-name my-trip --branch production
```

⚠️ **一定要帶 `--branch`，且要帶對這個專案實際設定的 production branch 名稱**（不一定叫 `production`，用下面指令查）。帶錯／漏帶會靜默部署成 Preview：指令看起來成功，正式網域沒更新，Preview 也讀不到 Production 的 Secrets，症狀跟密碼設錯一樣難查。

```bash
wrangler pages deployment list --project-name my-trip   # 確認最新一筆落在 Production 還是 Preview
```

部署後建議清一次 Service Worker 快取再驗證（PWA 預快取了舊的 JS/CSS）：DevTools → Application → Service Workers → Unregister，重新整理。

### Schema 異動

D1 不支援自動 migration，本機與正式環境要手動各跑一次，且只能用不破壞既有資料的寫法（不要 `DROP`、不要改欄位型別）：

```bash
wrangler d1 execute my-trip --local  --command "ALTER TABLE ... ADD COLUMN ..."
wrangler d1 execute my-trip --remote --command "ALTER TABLE ... ADD COLUMN ..."
```

改完務必同步更新 `schema.sql`。完整規則見 [CLAUDE.md](CLAUDE.md)。

### 備份

```bash
wrangler d1 export my-trip --remote --output backups/my-trip-remote-backup-$(date +%Y%m%d-%H%M%S).sql
```

改動正式環境 schema 或跑任何批次資料修正前**先備份**。`backups/` 在 `main` 上是 gitignored；各行程分支自行決定是否進版控。

## 推播提醒（Web Push）部署

行程編輯面板的「提醒」開關會在時間到時推播到手機，架構分兩塊：Pages Functions 負責訂閱與測試推播；獨立的 `worker-cron/`（帳號層級共用，不是每行程一支）每分鐘掃過所有行程的 D1、送實際的 Web Push。

```bash
# 1. 產生一組 VAPID 金鑰
npx @pushforge/builder vapid

# 2. Pages 專案設公鑰 + 私鑰（私鑰給 push-test 立即送測試推播用）
wrangler pages secret put VAPID_PUBLIC_KEY --project-name my-trip
wrangler pages secret put VAPID_PRIVATE_KEY --project-name my-trip

# 3. worker-cron 設私鑰 + CRON_SECRET（在 worker-cron/ 目錄下）
cd worker-cron
wrangler secret put VAPID_PRIVATE_KEY
wrangler secret put CRON_SECRET   # 隨機字串即可，例如 openssl rand -base64 24

# 4. 部署 worker-cron（跟主專案的 Pages 部署完全分開，只改 src/／functions/ 不用重跑這步）
wrangler deploy
```

⚠️ 所有行程共用同一組 VAPID 金鑰對，開新行程**不要**重新產生（會讓既有訂閱全部失效）。

**外部 cron 備援**：Cloudflare 原生 Cron Trigger 在這個帳號上不會被觸發（平台端已知問題），所以 `worker-cron` 另外提供 `GET /trigger?key=<CRON_SECRET>`，由外部服務定時打。目前用 [cron-job.org](https://cron-job.org)（免費、支援每分鐘）設一個排程，URL 填 `https://<worker>.<你的-workers-子網域>.workers.dev/trigger?key=<CRON_SECRET>`，Schedule 選「每分鐘」。**金鑰在網址上，這個排程設定不要分享或截圖給別人看。**

**iOS 限制**：Web Push 需要 iOS 16.4+，且網站要先「加入主畫面」、從主畫面圖示以 standalone 模式打開才收得到通知。

## 多行程部署

這個 App 是單一行程設計（單一共用密碼、schema 沒有 trip 概念），開新行程請整個複製成新的 Pages 專案 + 新的 D1，不要讓一份部署同時服務兩趟行程。**程式碼所有行程共用同一份**，只有三塊依行程不同：

1. **D1 裡的資料**：`destTitle`/`tripStart`/`tripEnd`/`hotels`/`geminiRegionHint` 都是 settings-driven，部署完在設定頁填即可。
2. **建置時寫死的靜態資源**（favicon、PWA icon、`vite.config.ts` 的 manifest 靜態欄位、`public/hero-photo.jpg`）：瀏覽器要在任何 D1 資料載入前就讀到，沒辦法 settings-driven，所以每個行程開一個**只放這些差異的 git 分支**；部署前 `git checkout <trip> && git rebase main`。
3. **Pages 部署設定**（D1 binding、專案名稱）：`wrangler pages deploy` 不支援 `--config`，`--cwd` 也不能用（會讓 `functions/` 沒被打包，API 全部 405）。做法是部署前暫時覆蓋根目錄 `wrangler.toml`、部署完立刻換回：

   ```bash
   npm run build
   cp wrangler.toml /tmp/wrangler.toml.backup
   cp deploy/<trip>/wrangler.toml wrangler.toml
   wrangler pages deploy "$(pwd)/dist" --project-name <trip>-trip --branch <trip>
   cp /tmp/wrangler.toml.backup wrangler.toml       # 一定要做
   git diff wrangler.toml                            # 應該沒有輸出，確認真的換回來了
   ```

   `deploy/<trip>/wrangler.toml` 只是存放該行程設定的地方，`main` 上沒有這個目錄，內容留在各行程分支。`--branch` 要帶該專案實際設定的 production branch 名稱（用 `wrangler pages deployment list` 查，帶錯會被歸類成 Preview）。

**`worker-cron/` 不用比照辦理**：同一個 Cloudflare 帳號下只要在 `worker-cron/wrangler.toml` 加一組 `[[d1_databases]]`、`src/index.ts` 的 `TRIPS` 加一筆，重跑一次 `wrangler deploy` 即可。跨帳號才需要各自獨立部署。

## 專案結構

```
functions/api/    Cloudflare Pages Functions（登入、同步、天氣、推播、Gemini）
worker-cron/       獨立 Worker，每分鐘發推播
src/views/         各分頁與 bottom sheet 元件
src/lib/           store（Zustand + IndexedDB write-through）、db、sync、auth、push
src/data/          seed.json 種子資料（由 design/ 抽出）
scripts/           extract-seed.mjs、seed-d1.mjs
schema.sql         D1 表結構
deploy/<trip>/      各行程的 wrangler.toml（見「多行程部署」）
```

`design/*.dc.html` 是視覺設計參考（畫布編輯器產物），不是要執行的程式碼。`main` 上 `design/` 是空的且已 gitignored，實際內容留在各行程分支。

## 已知限制

- 密碼比對用明文 Secret + SHA-256 雜湊比對，而非 bcrypt/argon2——見 `functions/api/login.ts` 註解。
- 單一推播訂閱送失敗（非 404/410）不重試。
- Cloudflare 原生 Cron Trigger 不會觸發，靠 cron-job.org 打 `/trigger` 備援——該帳號過期或設定被清掉，提醒會**安靜地**停止，要記得回去檢查。
- 通知點擊只會打開／聚焦 App 首頁，不會深連結到單筆行程。

## 授權

[MIT](LICENSE)
