# trip-cli

開新行程、之後每次部署的兩支腳本，取代 README「多行程部署」那節手動指令。
**單一分支模式**：所有行程都在 `main` 上開發／部署，沒有行程專屬的 git 分支，
每趟行程的素材只存在本機 `local-trips/<trip>/`（gitignored，不進版控）；
worker-cron 是帳號層級共用的 Worker，設定同樣不進版控，存在本機
`local-worker-cron/<profile>/`（見下方「`worker-cron` 是帳號層級共用」）。

## 用法

```bash
# 第一次開一趟新行程（互動式，會問 Cloudflare profile、共用密碼、標題等）
scripts/trip-cli/new-trip.sh <trip-slug>

# 之後每次要部署這趟行程（typecheck/lint → 換入行程素材 → build → 部署 → 換回 → 驗證落在 Production）
scripts/trip-cli/deploy-trip.sh <trip-slug>

# worker-cron/ 底下有改動時單獨部署（提醒邏輯、清墓碑排程等；只改 src/ 或
# functions/ 不需要跑這支）。<trip-slug> 只是用來查出 Cloudflare profile——
# worker-cron 是帳號層級共用的一支 Worker，會套用到該 profile 底下全部行程。
scripts/trip-cli/deploy-worker-cron.sh <trip-slug>
```

`<trip-slug>` 只能用小寫英數字與連字號，會拿去當 D1 名稱、Pages 專案名
（`<trip-slug>-trip`）、production branch 名稱。

## `local-trips/<trip>/` 放什麼

```
local-trips/<trip>/
  wrangler.toml   # D1 binding、Pages 專案名（deploy-trip.sh 部署前後會換入/換回根目錄那份）
  trip.conf       # PROFILE / PAGES_PROJECT / PROD_BRANCH / D1_NAME / ACCOUNT_ID（選填）
  title.txt       # index.html <title> 跟 apple-mobile-web-app-title 的值
  assets/
    hero-photo.jpg  # 沒放就維持範本預設圖，可以先跳過之後再放
```

favicon／PWA icon（加到主畫面用的圖示）**不在這裡**——那兩個已經改成設定頁上傳、
存進 D1、由 `functions/icon-192.png.ts`／`icon-512.png.ts` 動態吐出來，部署完
登入後直接在設定頁上傳即可，不需要準備檔案放進 `local-trips/`。

**這整個資料夾不進 git**，換一台機器部署同一趟行程要自己把它搬過去（例如放
雲端硬碟、或用密碼管理器的附件功能）。這是刻意的取捨：main 上因此永遠不會
出現任何真實行程的標題、照片或部署身分，代價是這份素材沒有 git 版本備份。

## `worker-cron` 是帳號層級共用，設定另外放 `local-worker-cron/<profile>/`

`worker-cron/`（獨立 Worker，每分鐘發推播提醒）不是每趟行程一支，是同一個
Cloudflare 帳號底下所有行程共用同一支——`worker-cron/wrangler.toml` 的
`name`／D1 binding／`database_id` 因此是「帳號層級」的設定，不是「行程層級」
的，跟 `local-trips/<trip>/` 用行程代號當 key 不是同一個維度，所以獨立開一個
用 `PROFILE` 當 key 的資料夾：

```
local-worker-cron/<profile>/
  wrangler.toml   # 這個帳號要部署的 worker-cron 設定（name、D1 binding、database_id）
```

`worker-cron/src/index.ts` 完全不用跟著帳號改——它是所有帳號共用的同一份程式碼，
main 上永遠只 commit 這一份；D1 binding 掛了哪些行程完全由 `wrangler.toml`
決定，`src/index.ts` 在執行時掃過 `env` 上所有 `DB_` 開頭的 key 動態算出來（見
該檔開頭註解）。main 上 commit 的 `worker-cron/wrangler.toml` 因此刻意不含任何
帳號的 D1 binding，只是一份會被部署前換掉的佔位版本（見該檔開頭註解）。

**這個資料夾同樣不進 git**，理由跟 `local-trips/` 一樣。跟 `local-trips/` 不同
的地方：`local-trips/<trip>/` 每趟行程都有一份（換機器要逐一搬），但共用同一個
Cloudflare 帳號的行程（例如 inuyama、okayama）只對應**一份** `local-worker-cron/
<profile>/wrangler.toml`——換機器只要搬這一份，不用照行程數量各搬一份。

### 什麼時候需要 `ACCOUNT_ID`

`PROFILE` 只決定用哪組 Cloudflare 登入憑證，不是帳號本身——如果這組憑證同時
能存取多個 Cloudflare account（例如受邀成為別人帳號的協作者），`wrangler`
大部分指令在非互動模式下會直接失敗，噴 `More than one account available`。
`new-trip.sh` 建立新行程時會自動探測、需要的話讓你選一個並存進
`trip.conf`；如果是手動修 `trip.conf`（例如舊行程原本沒有這欄），可以用
`wrangler d1 list --profile <profile>` 觸發同樣的錯誤訊息，把想用的
`account_id` 貼進 `ACCOUNT_ID=`。單一帳號的 profile 不會遇到這個問題，留空
即可。

## 這兩支腳本做了什麼

`new-trip.sh`：

1. 選/建立 Cloudflare profile（`wrangler auth create`），支援多帳號。
2. 建 D1、灌 `schema.sql`、建 Pages 專案。
3. 寫 `local-trips/<trip>/wrangler.toml`／`trip.conf`／`title.txt`。
4. 設 Secrets：`SESSION_SECRET` 自動產生，`PW_SHARED`／`GEMINI_API_KEY` 互動輸入。
5. VAPID：跟已有行程同一個 Cloudflare 帳號時**沿用同一組**（不會自動產生新的
   ——亂產生會讓那個帳號底下所有行程的 Web Push 訂閱全部失效），全新帳號才產生
   新的一組。本機快取在 `.trip-cli-cache/<profile>/vapid.json`（gitignored）。
6. `worker-cron/`：同帳號在既有的 `local-worker-cron/<profile>/wrangler.toml`
   加一組 `[[d1_databases]]`；全新帳號則新建這份檔案（自動產生 `CRON_SECRET`），
   兩種情況都用 `apply_worker_cron_conf`/`restore_worker_cron_conf`（見 `lib.sh`）
   把這份換進 `worker-cron/wrangler.toml`、部署、換回，全程不 commit 任何東西
   （`src/index.ts` 不用跟著改，見上方「`worker-cron` 是帳號層級共用」）。全新
   帳號額外設好 `VAPID_PRIVATE_KEY`／`CRON_SECRET` 兩個 Secret，最後印出
   cron-job.org 要貼的網址（`CRON_SECRET` 已 URL-encode）——這一步無法自動化，
   需要你自己的 cron-job.org 帳號。

`deploy-trip.sh`：確保本機 `main` 是最新的 → `tsc -b && oxlint` → 暫時把
`local-trips/<trip>/` 的 `wrangler.toml`／`public/*` 素材／`index.html` 標題
換進根目錄 → `npm run build` → `wrangler pages deploy` → 換回範本內容（無論
成功失敗都會換回，見 `lib.sh` 的 `apply_local_trip`/`restore_local_trip` 與
`trap`）→ 確認最新一筆部署落在 Production。

`deploy-worker-cron.sh`：讀 `<trip-slug>` 的 `trip.conf` 查出 `PROFILE` →
`apply_worker_cron_conf` 把 `local-worker-cron/<profile>/wrangler.toml` 換進
`worker-cron/wrangler.toml` → `tsc --noEmit`／`oxlint`（只檢查 `worker-cron/
src`）→ `wrangler deploy --profile $PROFILE` → `restore_worker_cron_conf` 換回
main 版本並確認 `git status` 乾淨。不動 `local-trips/` 素材、不動 Pages；因為是
帳號層級共用的 Worker，部署對該 profile 底下所有行程都生效，不是只有
`<trip-slug>` 這一趟。同帳號、跨帳號走的是同一套邏輯，不用另外判斷——差別只在
`local-worker-cron/<profile>/wrangler.toml` 裡的內容不同。這個 profile 還沒有
對應的 `local-worker-cron/<profile>/wrangler.toml`（例如全新帳號第一次還沒跑過
`new-trip.sh`）會直接報錯，需要先手動建立這份檔案。

## 判斷「這個帳號是不是已經有其他行程」

直接掃本機 `local-trips/*/trip.conf` 裡的 `PROFILE`——因為所有行程的設定檔
現在都在同一台機器、同一個目錄樹下，不像舊的分支模式那樣「別的行程的設定檔
在別的分支看不到」，不需要另外維護登記檔。

## 犬山／岡山（既有行程）

兩趟既有行程原本是 git 分支，已經遷移到 `local-trips/inuyama/`、
`local-trips/okayama/`，可以直接用 `deploy-trip.sh inuyama` / `deploy-trip.sh
okayama` 部署。舊的 `inuyama`／`okayama` git 分支確認新流程沒問題後即可刪除。
