import { ArrowClockwise } from '@phosphor-icons/react'
import type { PullStatus } from '../lib/usePullToRefresh'

/**
 * 下拉更新的頂部指示區（純呈現，狀態由 usePullToRefresh 管理）。
 * 指示文字：下拉更新 → 放開更新 → 更新中…
 */
export default function PullToRefresh({ status, pull }: { status: PullStatus; pull: number }) {
  const label = status === 'refreshing' ? '更新中…' : status === 'release' ? '放開更新' : '下拉更新'
  // 拖曳中關掉 CSS transition，讓 height 跟手指 1:1 同步：0.15s 的動畫追不上快速
  // 移動的 touchmove，觀感會黏滯。只有彈回 0 或收起進 refreshing 才需要 transition。
  const isDragging = status === 'pull' || status === 'release'
  return (
    <div
      className="pull-indicator"
      style={{ height: pull, transition: isDragging ? 'none' : undefined }}
      aria-hidden={pull === 0}
    >
      <ArrowClockwise
        size={14}
        weight="bold"
        className={status === 'refreshing' ? 'pull-indicator-spin' : undefined}
      />
      <span>{label}</span>
    </div>
  )
}
