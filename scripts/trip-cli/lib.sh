#!/usr/bin/env bash
# 共用小函式，給 new-trip.sh／deploy-trip.sh 一起 source。
# 每支呼叫端自己先 `set -euo pipefail` 再 source 這份檔案。

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

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

# 目前工作目錄必須是乾淨的（沒有未提交的變更），否則後面的 git checkout/rebase
# 有弄丟工作的風險。
require_clean_git() {
  cd "$REPO_ROOT"
  if [ -n "$(git status --short)" ]; then
    log_err "工作目錄有未提交的變更，請先處理（commit/stash）再跑這支腳本。"
    git status --short
    exit 1
  fi
}

# deploy/<trip>/trip.conf 只存在於各自的行程分支上，main 上永遠看不到（這是刻意
# 的：main 是通用範本，不代表任何真實行程）。但 new-trip.sh 判斷「這個 profile
# 是不是已經有其他行程」這件事一定要在 main 上、開新分支之前就知道答案，沒辦法
# 靠掃 deploy/*/ 現在的工作目錄。所以另外維護一份輕量登記檔
# scripts/trip-cli/trips.registry（純粹是「行程代號=profile」的對照表，不含任何
# 密碼/database_id 之類的機密或行程資料），commit 在 main 上，被視為工具自己的
# 帳本，不算 CLAUDE.md 說的「行程資料」。
REGISTRY_FILE="$REPO_ROOT/scripts/trip-cli/trips.registry"

# 讀一個 trip.conf，把裡面的變數塞進目前 shell（PROFILE/PAGES_PROJECT/PROD_BRANCH/D1_NAME）。
# 只能在已經 checkout 到該行程分支之後呼叫（trip.conf 是那個分支才有的檔案）。
# shellcheck disable=SC1090
load_trip_conf() {
  local trip="$1"
  local conf="$REPO_ROOT/deploy/$trip/trip.conf"
  if [ ! -f "$conf" ]; then
    log_err "找不到 $conf，這個行程還沒用 new-trip.sh 設定過，或是拼字打錯了。"
    exit 1
  fi
  # shellcheck source=/dev/null
  source "$conf"
}

# 找出跟給定 profile 共用同一個 Cloudflare 帳號、且不是 $exclude_trip 本身的既有行程，
# 一行一個行程代號。用來判斷「這個帳號是不是第一趟行程」（決定 VAPID 要不要新產生、
# worker-cron 要不要自動接上）。讀的是 main 上的登記檔，不是各分支的 trip.conf。
find_profile_siblings() {
  local profile="$1"
  local exclude_trip="${2:-}"
  [ -f "$REGISTRY_FILE" ] || return 0
  local line trip trip_profile
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    case "$line" in \#*) continue ;; esac
    trip="${line%%=*}"
    trip_profile="${line#*=}"
    [ "$trip" = "$exclude_trip" ] && continue
    if [ "$trip_profile" = "$profile" ]; then
      echo "$trip"
    fi
  done < "$REGISTRY_FILE"
}

# 登記一個行程（trip=profile）到 main 上的登記檔並 commit——呼叫端負責確保目前
# checkout 在 main 上。
register_trip() {
  local trip="$1"
  local profile="$2"
  mkdir -p "$(dirname "$REGISTRY_FILE")"
  touch "$REGISTRY_FILE"
  if ! grep -qE "^${trip}=" "$REGISTRY_FILE"; then
    echo "${trip}=${profile}" >> "$REGISTRY_FILE"
    sort -o "$REGISTRY_FILE" "$REGISTRY_FILE"
  fi
  git add "$REGISTRY_FILE"
}

# 部署前把根目錄 wrangler.toml 換成該行程的版本，部署後（不管成功或失敗）換回來。
# 用法：
#   backup="$(swap_wrangler_toml "$trip")"
#   trap 'restore_wrangler_toml "$backup"' EXIT
swap_wrangler_toml() {
  local trip="$1"
  local backup
  backup="$(mktemp)"
  cp "$REPO_ROOT/wrangler.toml" "$backup"
  cp "$REPO_ROOT/deploy/$trip/wrangler.toml" "$REPO_ROOT/wrangler.toml"
  echo "$backup"
}

restore_wrangler_toml() {
  local backup="$1"
  if [ -f "$backup" ]; then
    cp "$backup" "$REPO_ROOT/wrangler.toml"
    rm -f "$backup"
  fi
  cd "$REPO_ROOT"
  if [ -n "$(git diff --stat -- wrangler.toml)" ]; then
    log_warn "wrangler.toml 換回來後跟版控內容不一致，請手動檢查："
    git diff -- wrangler.toml
  else
    log_ok "wrangler.toml 已換回原本內容（git diff 乾淨）。"
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
