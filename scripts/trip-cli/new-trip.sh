#!/usr/bin/env bash
# 開一趟新行程：建 D1、灌 schema、建 Pages 專案、寫 local-trips/<trip>/ 設定、
# 設 Secrets、視情況接上 worker-cron 推播。跑完用 scripts/trip-cli/deploy-trip.sh
# 部署。
#
# 每趟行程的素材（wrangler.toml/trip.conf/favicon 等）只存在本機 local-trips/
# 底下，刻意不進 git——main 上不會出現任何真實行程的痕跡，換一台機器部署同一趟
# 行程要自己把 local-trips/<trip>/ 搬過去（見 scripts/trip-cli/README.md）。
#
# 用法：scripts/trip-cli/new-trip.sh <trip-slug>
# 例如：scripts/trip-cli/new-trip.sh hokkaido
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib.sh
source "$SCRIPT_DIR/lib.sh"

TRIP="${1:-}"
if [ -z "$TRIP" ]; then
  log_err "用法：scripts/trip-cli/new-trip.sh <trip-slug>（例如 hokkaido）"
  exit 1
fi
if ! [[ "$TRIP" =~ ^[a-z0-9][a-z0-9-]*$ ]]; then
  log_err "行程代號只能用小寫英數字與連字號（會拿去當 D1 名稱、Pages 專案名的一部分）。"
  exit 1
fi

cd "$REPO_ROOT"

if [ -d "$LOCAL_TRIPS_DIR/$TRIP" ]; then
  log_err "$LOCAL_TRIPS_DIR/$TRIP 已經存在，這趟行程是不是已經開過了？"
  exit 1
fi

require_clean_git
log_info "切到 main 並更新到最新……"
git checkout main
if ! git pull --ff-only; then
  log_err "git pull 失敗（可能離線，或本機 main 跟遠端分岔了），手動處理後再重跑。"
  exit 1
fi

# --- 1. 選 Cloudflare profile ---
log_info "目前機器上已有的 Cloudflare profile："
npx wrangler auth list 2>&1 | grep -v '^$' || true
printf '要用哪個 profile？（輸入既有名稱，或輸入新名稱建立一個）： '
read -r PROFILE
if [ -z "$PROFILE" ]; then
  log_err "profile 名稱不能空白。"
  exit 1
fi
if ! npx wrangler auth list 2>&1 | grep -qE "│ *${PROFILE} *│"; then
  log_info "沒看到 profile「${PROFILE}」，建立一個新的（會開瀏覽器走 OAuth）……"
  npx wrangler auth create "$PROFILE"
fi

PAGES_PROJECT="${TRIP}-trip"
PROD_BRANCH="$TRIP"
D1_NAME="$TRIP"

SIBLINGS="$(find_profile_siblings "$PROFILE" "")"
if [ -n "$SIBLINGS" ]; then
  log_info "profile「${PROFILE}」底下已經有其他行程：$(echo "$SIBLINGS" | tr '\n' ' ')"
  SAME_ACCOUNT=1
else
  log_info "profile「${PROFILE}」底下目前沒有其他行程，視為這個帳號的第一趟行程。"
  SAME_ACCOUNT=0
fi

cat <<SUMMARY

即將執行：
  1. wrangler d1 create $D1_NAME --profile $PROFILE
  2. wrangler d1 execute $D1_NAME --remote --profile $PROFILE --file=schema.sql
  3. wrangler pages project create $PAGES_PROJECT --production-branch $PROD_BRANCH --profile $PROFILE
  4. 寫 local-trips/$TRIP/（wrangler.toml、trip.conf、title.txt；不進 git）
  5. 設 Secrets：SESSION_SECRET（自動產生）、PW_SHARED、GEMINI_API_KEY（互動輸入）
  6. VAPID：$([ "$SAME_ACCOUNT" = 1 ] && echo "沿用同帳號既有金鑰（會請你貼上）" || echo "產生新的一組")
  7. worker-cron：$([ "$SAME_ACCOUNT" = 1 ] && echo "自動加 D1 binding + TRIPS 項目並部署、commit 到 main" || echo "印手動步驟，不自動執行")
SUMMARY
confirm_yes "上面這些會建立雲端資源並寫入本機檔案。"

# --- 2. D1 ---
log_info "建立 D1「${D1_NAME}」……"
D1_OUTPUT="$(npx wrangler d1 create "$D1_NAME" --profile "$PROFILE" 2>&1)" || {
  echo "$D1_OUTPUT"
  log_err "wrangler d1 create 失敗（如果是「already exists」，這個名稱可能被用過，換一個行程代號）。"
  exit 1
}
echo "$D1_OUTPUT"
DATABASE_ID="$(echo "$D1_OUTPUT" | grep -oE '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}' | head -1 || true)"
if [ -z "$DATABASE_ID" ]; then
  log_err "沒能從輸出裡解析出 database_id，去上面的輸出手動複製，填進 local-trips/$TRIP/wrangler.toml。"
  DATABASE_ID="REPLACE_WITH_REAL_D1_DATABASE_ID"
fi
log_ok "database_id = $DATABASE_ID"

# --- 3. 灌 schema ---
log_info "對 $D1_NAME 灌 schema.sql（正式環境）……"
npx wrangler d1 execute "$D1_NAME" --remote --profile "$PROFILE" --file=schema.sql

# --- 4. Pages 專案 ---
log_info "建立 Pages 專案 ${PAGES_PROJECT}（production branch: ${PROD_BRANCH}）……"
npx wrangler pages project create "$PAGES_PROJECT" --production-branch "$PROD_BRANCH" --profile "$PROFILE"

# --- 5. local-trips/<trip>/ 設定檔 ---
mkdir -p "$LOCAL_TRIPS_DIR/$TRIP/assets"
cat > "$LOCAL_TRIPS_DIR/$TRIP/wrangler.toml" <<TOML
# ${TRIP} 的部署設定，由 scripts/trip-cli/new-trip.sh 產生。本機檔案，不進 git。
name = "${PAGES_PROJECT}"
compatibility_date = "2026-01-01"
pages_build_output_dir = "dist"

[[d1_databases]]
binding = "DB"
database_name = "${D1_NAME}"
database_id = "${DATABASE_ID}"
TOML

cat > "$LOCAL_TRIPS_DIR/$TRIP/trip.conf" <<CONF
# ${TRIP} 的部署身分設定，由 scripts/trip-cli/new-trip.sh 產生。本機檔案，不進 git。
PROFILE=${PROFILE}
PAGES_PROJECT=${PAGES_PROJECT}
PROD_BRANCH=${PROD_BRANCH}
D1_NAME=${D1_NAME}
CONF

printf '這趟行程的標題（index.html <title>／加到主畫面的名稱，之後也可以在設定頁改）： '
read -r TRIP_TITLE
echo "$TRIP_TITLE" > "$LOCAL_TRIPS_DIR/$TRIP/title.txt"

log_ok "已寫入 local-trips/$TRIP/（wrangler.toml、trip.conf、title.txt）。"
log_warn "hero-photo.jpg 想換的話記得手動放進 local-trips/$TRIP/assets/（沒放就維持"
log_warn "範本預設圖）；favicon／PWA icon 部署後直接在 App 的設定頁上傳即可，不用放檔案。"

# --- 6. Secrets ---
log_info "設定 Secrets……"
SESSION_SECRET="$(openssl rand -base64 32)"
echo "$SESSION_SECRET" | npx wrangler pages secret put SESSION_SECRET --project-name "$PAGES_PROJECT" --profile "$PROFILE"
log_ok "SESSION_SECRET 已自動產生並設定。"

printf '請輸入這趟行程的共用密碼（PW_SHARED，必填，輸入時不會顯示）： '
read -rs PW_SHARED
echo
if [ -z "$PW_SHARED" ]; then
  log_err "PW_SHARED 不能空白（沒有這個沒辦法登入）。"
  exit 1
fi
echo "$PW_SHARED" | npx wrangler pages secret put PW_SHARED --project-name "$PAGES_PROJECT" --profile "$PROFILE"

printf '請輸入 Gemini API Key（沒有就直接按 Enter，之後再用 wrangler pages secret put 補）： '
read -r GEMINI_API_KEY
if [ -n "$GEMINI_API_KEY" ]; then
  echo "$GEMINI_API_KEY" | npx wrangler pages secret put GEMINI_API_KEY --project-name "$PAGES_PROJECT" --profile "$PROFILE"
else
  log_warn "GEMINI_API_KEY 先跳過，「用 Gemini 帶入景點資訊」那個功能會不能用，之後再補。"
fi

# --- 7. VAPID ---
CACHE_DIR="$REPO_ROOT/.trip-cli-cache/$PROFILE"
mkdir -p "$CACHE_DIR"
VAPID_CACHE="$CACHE_DIR/vapid.json"

if [ "$SAME_ACCOUNT" = 1 ]; then
  log_warn "這個帳號已經有其他行程在用同一組 VAPID 金鑰——所有行程的 Pages 專案跟"
  log_warn "worker-cron 都要是同一組，亂產生新的會讓既有訂閱全部失效。"
  if [ -f "$VAPID_CACHE" ]; then
    log_info "本機快取找到上次存的 VAPID 金鑰（${VAPID_CACHE}），直接沿用。"
    VAPID_PUBLIC_KEY="$(grep -oE '"public" *: *"[^"]*"' "$VAPID_CACHE" | sed -E 's/.*"([^"]*)"$/\1/' || true)"
    VAPID_PRIVATE_KEY_JSON="$(grep -oE '"private" *: *".*"' "$VAPID_CACHE" | sed -E 's/^"private" *: *//' || true)"
    if [ -z "$VAPID_PUBLIC_KEY" ] || [ -z "$VAPID_PRIVATE_KEY_JSON" ]; then
      log_err "本機快取 $VAPID_CACHE 格式看起來壞了，手動檢查或刪掉這個檔案後重跑。"
      exit 1
    fi
  else
    log_info "本機沒有快取，請貼上這個帳號既有的 VAPID 金鑰（跟其他行程共用的那組）。"
    printf 'VAPID_PUBLIC_KEY： '
    read -r VAPID_PUBLIC_KEY
    printf 'VAPID_PRIVATE_KEY（npx @pushforge/builder vapid 產生的 JWK JSON 字串）： '
    read -r VAPID_PRIVATE_KEY_JSON
    printf '{"public":"%s","private":%s}\n' "$VAPID_PUBLIC_KEY" "$VAPID_PRIVATE_KEY_JSON" > "$VAPID_CACHE"
  fi
else
  log_info "產生新的 VAPID 金鑰組（這個帳號第一趟行程）……"
  VAPID_OUTPUT="$(npx @pushforge/builder vapid 2>&1)"
  echo "$VAPID_OUTPUT"
  log_warn "上面是 npx @pushforge/builder vapid 的原始輸出，腳本沒辦法保證格式穩定解析。"
  printf '請貼上 Public Key： '
  read -r VAPID_PUBLIC_KEY
  printf '請貼上 Private Key（JWK JSON 字串）： '
  read -r VAPID_PRIVATE_KEY_JSON
  printf '{"public":"%s","private":%s}\n' "$VAPID_PUBLIC_KEY" "$VAPID_PRIVATE_KEY_JSON" > "$VAPID_CACHE"
fi

echo "$VAPID_PUBLIC_KEY" | npx wrangler pages secret put VAPID_PUBLIC_KEY --project-name "$PAGES_PROJECT" --profile "$PROFILE"
echo "$VAPID_PRIVATE_KEY_JSON" | npx wrangler pages secret put VAPID_PRIVATE_KEY --project-name "$PAGES_PROJECT" --profile "$PROFILE"
log_ok "VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY 已設定。"

# --- 8. worker-cron ---
BINDING="DB_$(echo "$TRIP" | tr '[:lower:]-' '[:upper:]_')"
if [ "$SAME_ACCOUNT" = 1 ]; then
  log_info "同帳號已有既有行程，自動接上 worker-cron……"
  cat >> worker-cron/wrangler.toml <<WCTOML

[[d1_databases]]
binding = "${BINDING}"
database_name = "${D1_NAME}"
database_id = "${DATABASE_ID}"
WCTOML

  # TRIPS 陣列插入一筆，靠字串取代 `const TRIPS: TripConfig[] = [` 這行。
  python3 - "$TRIP" "$BINDING" <<'PYEOF'
import re, sys
trip, binding = sys.argv[1], sys.argv[2]
path = "worker-cron/src/index.ts"
with open(path) as f:
    content = f.read()
entry = f"{{ name: '{trip}', db: (env) => env.{binding} }}"
def repl(m):
    body = m.group(1).strip()
    if body:
        return f"const TRIPS: TripConfig[] = [\n  {body},\n  {entry},\n]"
    return f"const TRIPS: TripConfig[] = [\n  {entry},\n]"
new_content, n = re.subn(r"const TRIPS: TripConfig\[\] = \[(.*?)\]", repl, content, count=1, flags=re.S)
if n == 0:
    print("找不到 TRIPS 陣列，請手動編輯 worker-cron/src/index.ts", file=sys.stderr)
    sys.exit(1)
with open(path, "w") as f:
    f.write(new_content)
PYEOF

  log_info "部署 worker-cron……"
  (cd worker-cron && npx wrangler deploy --profile "$PROFILE")

  log_info "把 worker-cron 的改動 commit 到 main……"
  git add worker-cron/wrangler.toml worker-cron/src/index.ts
  git commit -m "worker-cron: 加上 ${TRIP} 的 D1 binding"
  log_ok "worker-cron 已更新並部署，改動已 commit 到 main。"
else
  log_warn "全新帳號，worker-cron 需要獨立部署一份（跟其他帳號完全獨立），自動處理……"

  CRON_SECRET="$(openssl rand -base64 24)"
  echo "$CRON_SECRET" > "$CACHE_DIR/cron-secret.txt"
  WORKER_NAME="${PROFILE}-trip-cron"

  # worker-cron/wrangler.toml、src/index.ts 在 main 上代表的是別的帳號的部署狀態，
  # 這裡只是暫時本機改寫、部署完立刻換回來，絕對不 commit（跟 apply_local_trip
  # 換素材、deploy-trip.sh 換 wrangler.toml 是同一種「借用、用完歸還」手法）。
  WC_BACKUP_DIR="$(mktemp -d)"
  cp worker-cron/wrangler.toml "$WC_BACKUP_DIR/wrangler.toml"
  cp worker-cron/src/index.ts "$WC_BACKUP_DIR/index.ts"
  trap 'cp "$WC_BACKUP_DIR/wrangler.toml" worker-cron/wrangler.toml; cp "$WC_BACKUP_DIR/index.ts" worker-cron/src/index.ts; rm -rf "$WC_BACKUP_DIR"' EXIT

  cat > worker-cron/wrangler.toml <<WCTOML
# ${PROFILE} 這個 Cloudflare 帳號專用的暫時本機版本，由 new-trip.sh 產生，部署完
# 就會換回 main 上的版本，不會 commit（見 scripts/trip-cli/new-trip.sh 這一段）。
name = "${WORKER_NAME}"
main = "src/index.ts"
compatibility_date = "2026-01-01"

[triggers]
crons = ["* * * * *"]

[[d1_databases]]
binding = "${BINDING}"
database_name = "${D1_NAME}"
database_id = "${DATABASE_ID}"
WCTOML

  python3 - "$TRIP" "$BINDING" <<'PYEOF'
import re, sys
trip, binding = sys.argv[1], sys.argv[2]
path = "worker-cron/src/index.ts"
with open(path) as f:
    content = f.read()
entry = f"{{ name: '{trip}', db: (env) => env.{binding} }}"
new_content, n = re.subn(
    r"const TRIPS: TripConfig\[\] = \[.*?\]",
    f"const TRIPS: TripConfig[] = [\n  {entry},\n]",
    content, count=1, flags=re.S,
)
if n == 0:
    print("找不到 TRIPS 陣列，請手動編輯 worker-cron/src/index.ts", file=sys.stderr)
    sys.exit(1)
with open(path, "w") as f:
    f.write(new_content)
PYEOF

  log_info "部署 worker-cron（--profile ${PROFILE}，全新獨立的 Worker，不影響其他帳號）……"
  DEPLOY_OUTPUT="$(cd worker-cron && npx wrangler deploy --profile "$PROFILE" 2>&1)"
  echo "$DEPLOY_OUTPUT"
  WORKER_URL="$(echo "$DEPLOY_OUTPUT" | grep -oE 'https://[^[:space:]]*\.workers\.dev' | head -1 || true)"

  log_info "設定 worker-cron 的 Secrets……"
  echo "$VAPID_PRIVATE_KEY_JSON" | (cd worker-cron && npx wrangler secret put VAPID_PRIVATE_KEY --profile "$PROFILE")
  echo "$CRON_SECRET" | (cd worker-cron && npx wrangler secret put CRON_SECRET --profile "$PROFILE")

  cp "$WC_BACKUP_DIR/wrangler.toml" worker-cron/wrangler.toml
  cp "$WC_BACKUP_DIR/index.ts" worker-cron/src/index.ts
  rm -rf "$WC_BACKUP_DIR"
  trap - EXIT

  if [ -n "$(git status --short -- worker-cron/)" ]; then
    log_err "worker-cron/ 換回 main 版本後跟版控不一致，手動檢查！絕對不要 commit："
    git status --short -- worker-cron/
  else
    log_ok "worker-cron/（${WORKER_NAME}）部署完成，本機已換回 main 版本（git status 乾淨）。"
  fi

  if [ -n "$WORKER_URL" ]; then
    ENCODED_SECRET="$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1], safe=''))" "$CRON_SECRET")"
    log_warn "最後一步要你自己去 cron-job.org 設定（沒辦法幫你開帳號代勞）："
    echo "  1. 到 https://cron-job.org 設一個每分鐘排程"
    echo "  2. URL 貼：${WORKER_URL}/trigger?key=${ENCODED_SECRET}"
  else
    log_warn "沒能從部署輸出解析出 workers.dev 網址，去上面的輸出手動複製，CRON_SECRET 存在 $CACHE_DIR/cron-secret.txt。"
  fi
fi

cat <<DONE

$(log_ok "行程 $TRIP 設定完成。")
下一步：
  - 想換 hero-photo 的話放進 local-trips/$TRIP/assets/（可以先跳過，之後再放）
  - 跑 scripts/trip-cli/deploy-trip.sh $TRIP 做第一次部署
  - 部署完，登入後到設定頁填目的地標題／旅遊日期／住宿地點／favicon／PWA icon
DONE
