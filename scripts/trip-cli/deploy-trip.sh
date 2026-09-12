#!/usr/bin/env bash
# 部署一趟已經設定過的行程（deploy/<trip>/trip.conf 已存在）。
# 流程：rebase main → build → 換入該行程的 wrangler.toml → 部署 → 換回根目錄
# wrangler.toml → 確認落在 Production。
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
require_clean_git

ORIGINAL_BRANCH="$(git branch --show-current)"

log_info "git checkout $TRIP && git rebase main ……"
git checkout "$TRIP"
if ! git rebase main; then
  log_err "rebase 有衝突，腳本不自動處理。解完衝突（git rebase --continue）後重跑這支腳本，"
  log_err "或用 git rebase --abort 放棄。"
  exit 1
fi

# deploy/<trip>/trip.conf、wrangler.toml 只存在於這個行程自己的分支上（main 上沒有），
# 一定要在 checkout 之後才讀，不能在 checkout 之前讀。
load_trip_conf "$TRIP"
log_info "行程設定：PROFILE=$PROFILE PAGES_PROJECT=$PAGES_PROJECT PROD_BRANCH=$PROD_BRANCH D1_NAME=$D1_NAME"

log_info "型別檢查／lint／build……"
npx tsc -b
npx oxlint
npm run build

BACKUP="$(swap_wrangler_toml "$TRIP")"
trap 'restore_wrangler_toml "$BACKUP"' EXIT

log_info "部署到 $PAGES_PROJECT（--branch $PROD_BRANCH --profile $PROFILE）……"
npx wrangler pages deploy dist --project-name "$PAGES_PROJECT" --branch "$PROD_BRANCH" --profile "$PROFILE"

verify_latest_is_production "$PAGES_PROJECT" "$PROFILE"

log_ok "行程 $TRIP 部署完成。"
if [ "$ORIGINAL_BRANCH" != "$TRIP" ] && [ -n "$ORIGINAL_BRANCH" ]; then
  log_info "切回原本的分支 $ORIGINAL_BRANCH。"
  git checkout "$ORIGINAL_BRANCH"
fi
