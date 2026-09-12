# trip-cli

開新行程、之後每次部署的兩支腳本，取代 README「多行程部署」那節手動指令。

## 用法

```bash
# 第一次開一趟新行程（互動式，會問 Cloudflare profile、共用密碼等）
scripts/trip-cli/new-trip.sh <trip-slug>

# 之後每次要部署這趟行程（rebase main → build → 部署 → 驗證落在 Production）
scripts/trip-cli/deploy-trip.sh <trip-slug>
```

`<trip-slug>` 只能用小寫英數字與連字號，會拿去當 D1 名稱、Pages 專案名
（`<trip-slug>-trip`）、production branch 名稱。

## 這兩支腳本做了什麼

`new-trip.sh`：

1. 選/建立 Cloudflare profile（`wrangler auth create`），支援多帳號。
2. 建 D1、灌 `schema.sql`、建 Pages 專案。
3. 寫 `deploy/<trip>/wrangler.toml`、`deploy/<trip>/trip.conf`（後者記錄
   profile／Pages 專案名／production branch／D1 名稱，非機密，進版控）。
4. 設 Secrets：`SESSION_SECRET` 自動產生，`PW_SHARED`／`GEMINI_API_KEY` 互動輸入。
5. VAPID：跟已有行程同一個 Cloudflare 帳號時**沿用同一組**（不會自動產生新的
   ——亂產生會讓那個帳號底下所有行程的 Web Push 訂閱全部失效），全新帳號才產生
   新的一組。本機快取在 `.trip-cli-cache/<profile>/vapid.json`（gitignored）。
6. `worker-cron/`：同帳號自動加 D1 binding、`TRIPS` 項目、部署、commit 到
   `main`；全新帳號印手動步驟，**不會**自動 commit（`worker-cron/wrangler.toml`
   同一份檔案同時只能代表一個 Cloudflare 帳號的部署狀態，不同帳號的 binding
   混在一起 commit 上去會互相污染）。

`deploy-trip.sh`：`git rebase main` → `tsc -b && oxlint && build` → 暫時把
根目錄 `wrangler.toml` 換成 `deploy/<trip>/wrangler.toml`、部署、換回來（無論
成功失敗都會換回，見 `lib.sh` 的 `trap`）→ 確認最新一筆部署落在 Production。

## `scripts/trip-cli/trips.registry`

純文字的「行程代號=profile」對照表，commit 在 `main` 上。`deploy/<trip>/`
只存在各自的行程分支，`main` 上看不到，`new-trip.sh` 需要在開新分支**之前**
（也就是還在 `main` 上時）就知道「這個 profile 底下是不是已經有其他行程」，
所以另外維護這份輕量登記檔，純粹是工具自己的帳本，不含密碼或
`database_id` 之類的機密／行程資料。

## 犬山／岡山已經遷移過

兩趟既有行程的 `deploy/<trip>/wrangler.toml`、`trip.conf` 已經補齊，可以直接用
`deploy-trip.sh inuyama` / `deploy-trip.sh okayama` 部署，不用再手動改根目錄
`wrangler.toml`。
