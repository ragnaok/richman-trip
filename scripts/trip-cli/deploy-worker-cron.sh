#!/usr/bin/env bash
# 部署 worker-cron。跟 deploy-trip.sh 不同：worker-cron 是帳號層級共用的一支
# Worker，不是每趟行程一支（見 worker-cron/wrangler.toml 開頭註解、CLAUDE.md
# 「VAPID 金鑰全帳號共用」）——只改 src/ 或 functions/ 不需要跑這支，worker-cron/
# 底下有改動（提醒邏輯、清墓碑排程等）才需要。
#
# <trip-slug> 只是拿來查出這趟行程掛在哪個 Cloudflare profile（worker-cron 跟著
# profile 走、不是跟著行程走）——同一個 profile 底下傳哪個行程的 slug，部署的
# 都是同一支 Worker，一次部署會套用到該帳號底下全部行程。
#
# 刻意不做 git checkout main／git pull，也不擋工作目錄有沒有未 commit 的變更——
# 直接以當前進度（不管在哪個分支、有沒有 commit）部署。
#
# 用法：scripts/trip-cli/deploy-worker-cron.sh <trip-slug>
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib.sh
source "$SCRIPT_DIR/lib.sh"

TRIP="${1:-}"
if [ -z "$TRIP" ]; then
  log_err "用法：scripts/trip-cli/deploy-worker-cron.sh <trip-slug>"
  exit 1
fi

cd "$REPO_ROOT"
load_trip_conf "$TRIP"

SIBLINGS="$(find_profile_siblings "$PROFILE" "")"
if [ -n "$SIBLINGS" ]; then
  log_info "profile「${PROFILE}」底下的行程：${TRIP} $(echo "$SIBLINGS" | tr '\n' ' ')——worker-cron 是這些行程共用的，這次部署會一起套用到全部。"
else
  log_info "profile「${PROFILE}」底下目前只有 ${TRIP} 這一趟行程。"
fi

log_info "型別檢查（worker-cron/）……"
(cd worker-cron && npx tsc --noEmit)

log_info "lint……"
npx oxlint worker-cron/src

log_info "部署 worker-cron（--profile ${PROFILE}）……"
(cd worker-cron && npx wrangler deploy --profile "$PROFILE")

log_ok "worker-cron 部署完成。"
