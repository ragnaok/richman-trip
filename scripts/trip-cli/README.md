# trip-cli

開新行程、之後每次部署的兩支腳本，取代 README「多行程部署」那節手動指令。
**單一分支模式**：所有行程都在 `main` 上開發／部署，沒有行程專屬的 git 分支，
每趟行程的素材只存在本機 `local-trips/<trip>/`（gitignored，不進版控）。

## 用法

```bash
# 第一次開一趟新行程（互動式，會問 Cloudflare profile、共用密碼、標題等）
scripts/trip-cli/new-trip.sh <trip-slug>

# 之後每次要部署這趟行程（typecheck/lint → 換入行程素材 → build → 部署 → 換回 → 驗證落在 Production）
scripts/trip-cli/deploy-trip.sh <trip-slug>
```

`<trip-slug>` 只能用小寫英數字與連字號，會拿去當 D1 名稱、Pages 專案名
（`<trip-slug>-trip`）、production branch 名稱。

## `local-trips/<trip>/` 放什麼

```
local-trips/<trip>/
  wrangler.toml   # D1 binding、Pages 專案名（deploy-trip.sh 部署前後會換入/換回根目錄那份）
  trip.conf       # PROFILE / PAGES_PROJECT / PROD_BRANCH / D1_NAME
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

## 這兩支腳本做了什麼

`new-trip.sh`：

1. 選/建立 Cloudflare profile（`wrangler auth create`），支援多帳號。
2. 建 D1、灌 `schema.sql`、建 Pages 專案。
3. 寫 `local-trips/<trip>/wrangler.toml`／`trip.conf`／`title.txt`。
4. 設 Secrets：`SESSION_SECRET` 自動產生，`PW_SHARED`／`GEMINI_API_KEY` 互動輸入。
5. VAPID：跟已有行程同一個 Cloudflare 帳號時**沿用同一組**（不會自動產生新的
   ——亂產生會讓那個帳號底下所有行程的 Web Push 訂閱全部失效），全新帳號才產生
   新的一組。本機快取在 `.trip-cli-cache/<profile>/vapid.json`（gitignored）。
6. `worker-cron/`：同帳號自動加 D1 binding、`TRIPS` 項目、部署、commit 到
   `main`；全新帳號印手動步驟，**不會**自動 commit（`worker-cron/wrangler.toml`
   同一份檔案同時只能代表一個 Cloudflare 帳號的部署狀態，不同帳號的 binding
   混在一起 commit 上去會互相污染）。

`deploy-trip.sh`：確保本機 `main` 是最新的 → `tsc -b && oxlint` → 暫時把
`local-trips/<trip>/` 的 `wrangler.toml`／`public/*` 素材／`index.html` 標題
換進根目錄 → `npm run build` → `wrangler pages deploy` → 換回範本內容（無論
成功失敗都會換回，見 `lib.sh` 的 `apply_local_trip`/`restore_local_trip` 與
`trap`）→ 確認最新一筆部署落在 Production。

## 判斷「這個帳號是不是已經有其他行程」

直接掃本機 `local-trips/*/trip.conf` 裡的 `PROFILE`——因為所有行程的設定檔
現在都在同一台機器、同一個目錄樹下，不像舊的分支模式那樣「別的行程的設定檔
在別的分支看不到」，不需要另外維護登記檔。

## 犬山／岡山（既有行程）

兩趟既有行程原本是 git 分支，已經遷移到 `local-trips/inuyama/`、
`local-trips/okayama/`，可以直接用 `deploy-trip.sh inuyama` / `deploy-trip.sh
okayama` 部署。舊的 `inuyama`／`okayama` git 分支確認新流程沒問題後即可刪除。
