#!/usr/bin/env bash
# 共用小函式，給 new-trip.sh／deploy-trip.sh 一起 source。
# 每支呼叫端自己先 `set -euo pipefail` 再 source 這份檔案。

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# 每趟行程的本機素材（wrangler.toml/trip.conf/favicon 等等），刻意不進 git——main
# 上因此永遠不會出現任何真實行程的痕跡，這台機器以外的裝置要部署同一趟行程，
# 這個資料夾要自己另外搬過去（見 scripts/trip-cli/README.md）。
LOCAL_TRIPS_DIR="$REPO_ROOT/local-trips"

log_info() { printf '\033[36m▸\033[0m %s\n' "$*"; }
log_warn() { printf '\033[33m⚠\033[0m %s\n' "$*"; }
log_err()  { printf '\033[31m✘\033[0m %s\n' "$*" >&2; }
log_ok()   { printf '\033[32m✔\033[0m %s\n' "$*"; }

# 印出即將執行的動作摘要後，要求輸入完整的 "yes" 才繼續——D1/Pages 建立、設
# Secrets、動 worker-cron 都是動到雲端資源的操作，不要求二次確認太危險。
confirm_yes() {
  local prompt="$1"
  local reply
  printf '%s\n輸入 "yes" 繼續，其他任何輸入都會中止： ' "$prompt"
  read -r reply
  if [ "$reply" != "yes" ]; then
    log_err "已取消。"
    exit 1
  fi
}

# 目前工作目錄必須是乾淨的（沒有未提交的變更），否則後面的 git checkout 有弄丟
# 工作的風險（deploy-trip.sh 換入行程素材、跑完又換回去，也得從乾淨狀態開始）。
require_clean_git() {
  cd "$REPO_ROOT"
  if [ -n "$(git status --short)" ]; then
    log_err "工作目錄有未提交的變更，請先處理（commit/stash）再跑這支腳本。"
    git status --short
    exit 1
  fi
}

# 讀一個行程的 trip.conf，把裡面的變數塞進目前 shell
# （PROFILE/PAGES_PROJECT/PROD_BRANCH/D1_NAME）。
# shellcheck disable=SC1090
load_trip_conf() {
  local trip="$1"
  local conf="$LOCAL_TRIPS_DIR/$trip/trip.conf"
  if [ ! -f "$conf" ]; then
    log_err "找不到 ${conf}，這個行程還沒用 new-trip.sh 設定過，或是拼字打錯了，"
    log_err "也可能是這台機器沒有 local-trips/${trip}（本機素材不進 git，換機器要自己搬過去）。"
    exit 1
  fi
  # shellcheck source=/dev/null
  source "$conf"
}

# 找出跟給定 profile 共用同一個 Cloudflare 帳號、且不是 $exclude_trip 本身的既有行程，
# 一行一個行程代號。用來判斷「這個帳號是不是第一趟行程」（決定 VAPID 要不要新產生、
# worker-cron 要不要自動接上）。直接掃本機的 local-trips/*/trip.conf，不用另外維護
# 登記檔——這些設定檔本來就在同一台機器、同一個目錄樹下，不像舊版分支模式那樣
# 「別的行程的設定檔在別的分支看不到」。
find_profile_siblings() {
  local profile="$1"
  local exclude_trip="${2:-}"
  local conf trip trip_profile
  [ -d "$LOCAL_TRIPS_DIR" ] || return 0
  while IFS= read -r conf; do
    [ -z "$conf" ] && continue
    trip="$(basename "$(dirname "$conf")")"
    [ "$trip" = "$exclude_trip" ] && continue
    trip_profile="$(grep -E '^PROFILE=' "$conf" | head -1 | cut -d= -f2- || true)"
    if [ "$trip_profile" = "$profile" ]; then
      echo "$trip"
    fi
  done < <(find "$LOCAL_TRIPS_DIR" -mindepth 2 -maxdepth 2 -name 'trip.conf' 2>/dev/null || true)
}

# 部署前把根目錄的 wrangler.toml／public/hero-photo.jpg／index.html 標題換成這趟
# 行程在 local-trips/<trip>/ 裡的版本，只換「行程資料夾裡真的有放」的檔案——沒放
# 就維持範本預設，不強迫每趟行程都要準備素材。favicon／PWA icon 不在這裡處理，
# 那兩個已經改成設定頁上傳、存 D1、動態 Function 吐出來（見 functions/icon-192.png.ts
# 開頭註解），不是本機建置時的靜態檔了。
# 回傳一個備份目錄路徑；用法：
#   backup="$(apply_local_trip "$trip")"
#   trap 'restore_local_trip "$backup"' EXIT
apply_local_trip() {
  local trip="$1"
  local trip_dir="$LOCAL_TRIPS_DIR/$trip"
  if [ ! -d "$trip_dir" ]; then
    log_err "找不到 ${trip_dir}。"
    exit 1
  fi

  local backup_dir
  backup_dir="$(mktemp -d)"
  : > "$backup_dir/manifest"

  local rel src
  for rel in public/hero-photo.jpg wrangler.toml; do
    # wrangler.toml 放在 trip_dir 根目錄，其餘素材放在 trip_dir/assets/ 底下。
    if [ "$rel" = "wrangler.toml" ]; then
      src="$trip_dir/wrangler.toml"
    else
      src="$trip_dir/assets/$(basename "$rel")"
    fi
    [ -f "$src" ] || continue
    mkdir -p "$backup_dir/$(dirname "$rel")"
    cp "$REPO_ROOT/$rel" "$backup_dir/$rel"
    cp "$src" "$REPO_ROOT/$rel"
    echo "$rel" >> "$backup_dir/manifest"
  done

  if [ -f "$trip_dir/title.txt" ]; then
    cp "$REPO_ROOT/index.html" "$backup_dir/index.html"
    echo "index.html" >> "$backup_dir/manifest"
    local title
    title="$(cat "$trip_dir/title.txt")"
    python3 - "$REPO_ROOT/index.html" "$title" <<'PYEOF'
import re, sys
path, title = sys.argv[1], sys.argv[2]
with open(path, encoding="utf-8") as f:
    content = f.read()
content = re.sub(r"<title>.*?</title>", f"<title>{title}</title>", content, count=1)
content = re.sub(
    r'(apple-mobile-web-app-title" content=")[^"]*(")',
    rf"\1{title}\2",
    content,
    count=1,
)
with open(path, "w", encoding="utf-8") as f:
    f.write(content)
PYEOF
  fi

  echo "$backup_dir"
}

restore_local_trip() {
  local backup_dir="$1"
  [ -n "$backup_dir" ] && [ -d "$backup_dir" ] || return 0
  local rel
  if [ -f "$backup_dir/manifest" ]; then
    while IFS= read -r rel; do
      [ -z "$rel" ] && continue
      cp "$backup_dir/$rel" "$REPO_ROOT/$rel"
    done < "$backup_dir/manifest"
  fi
  rm -rf "$backup_dir"
  cd "$REPO_ROOT"
  if [ -n "$(git status --short -- public/ index.html wrangler.toml)" ]; then
    log_warn "換回範本內容後跟版控內容不一致，請手動檢查："
    git status --short -- public/ index.html wrangler.toml
  else
    log_ok "本機素材已換回範本內容（git status 乾淨）。"
  fi
}

# 部署完成後確認落在 Production，不是就大聲失敗（CLAUDE.md 提過的「靜默變成
# Preview」地雷：帶錯/漏帶 --branch 時指令看起來成功，正式網域卻沒更新）。
verify_latest_is_production() {
  local project="$1"
  local profile="$2"
  local row
  row="$(npx wrangler pages deployment list --project-name "$project" --profile "$profile" 2>&1 | grep -m1 '│ Production \|│ Preview ' || true)"
  if [ -z "$row" ]; then
    log_warn "沒能從 deployment list 判斷最新一筆的環境，請自行用下面指令確認："
    echo "  wrangler pages deployment list --project-name $project --profile $profile"
    return
  fi
  if echo "$row" | grep -q 'Production'; then
    log_ok "最新部署確認落在 Production。"
  else
    log_err "最新部署落在 Preview，不是 Production！檢查 --branch 是不是帶對了。"
    exit 1
  fi
}
