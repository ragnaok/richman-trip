#!/usr/bin/env bash
# 部署一趟已經設定過的行程（local-trips/<trip>/trip.conf 已存在）。
# 流程：typecheck/lint/build → 換入該行程的素材（wrangler.toml、
# hero-photo、index.html 標題）→ 套用還沒套用過的 D1 migration（見 migrations/README.md）
# → 部署 → 換回範本內容 → 確認落在 Production。
# favicon／PWA icon 不在這裡處理，那兩個是設定頁上傳、存 D1、動態 Function 吐出來。
#
# 刻意不做 git checkout main／git pull，也不擋工作目錄有沒有未 commit 的變更——
# 直接以當前進度（不管在哪個分支、有沒有 commit）部署，方便部署還沒推上去的改動。
#
# 用法：scripts/trip-cli/deploy-trip.sh <trip-slug>
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib.sh
source "$SCRIPT_DIR/lib.sh"

TRIP="${1:-}"
if [ -z "$TRIP" ]; then
  log_err "用法：scripts/trip-cli/deploy-trip.sh <trip-slug>"
  exit 1
fi

cd "$REPO_ROOT"
load_trip_conf "$TRIP"
log_info "行程設定：PROFILE=$PROFILE PAGES_PROJECT=$PAGES_PROJECT PROD_BRANCH=$PROD_BRANCH D1_NAME=$D1_NAME"

log_info "型別檢查／lint……"
npx tsc -b
npx oxlint

log_info "換入 local-trips/$TRIP/ 的素材（wrangler.toml、靜態圖檔、標題）……"
BACKUP="$(apply_local_trip "$TRIP")"
trap 'restore_local_trip "$BACKUP"' EXIT

log_info "build……"
npm run build

log_info "套用 D1 migration（有的話）……"
run_pending_migrations "$D1_NAME" "$PROFILE"

log_info "部署到 ${PAGES_PROJECT}（--branch ${PROD_BRANCH} --profile ${PROFILE}）……"
npx wrangler pages deploy dist --project-name "$PAGES_PROJECT" --branch "$PROD_BRANCH" --profile "$PROFILE"

verify_latest_is_production "$PAGES_PROJECT" "$PROFILE"

log_ok "行程 $TRIP 部署完成。"
