import { useMemo, useState } from 'react'
import { Plus } from '@phosphor-icons/react'
import { useStore, useAllSpots } from '../lib/store'
import { usePullToRefresh } from '../lib/usePullToRefresh'
import PullToRefresh from '../components/PullToRefresh'
import PhotoUpload from '../components/PhotoUpload'
import Toast, { useToast } from '../components/Toast'

const ALL_AREA = '全部'

// 景點的 area 欄位可能帶「· 補充說明」（例：「岐阜 · 自駕」「名古屋 · 9/6–7」），
// 頁籤只取前段分組，補充說明留在卡片上的完整標籤裡。
const areaGroup = (area: string) => area.split(' · ')[0]

/**
 * 景點分頁，點列表進 SpotDetail（由 App.tsx 依 ui.spot 渲染）。
 * 標題旁「＋新增」跟行程編輯面板的「連結景點→新增」是兩條入口、同一個 SpotEditSheet，
 * 但那個面板必須在 App.tsx 頂層渲染（見 store.ts 的 addingSpotOpen 註解），
 * 這裡只呼叫 openAddSpot()。
 */
export default function SpotsTab() {
  const spotsMeta = useStore((s) => s.entities.spotsMeta)
  const openSpot = useStore((s) => s.openSpot)
  const openAddSpot = useStore((s) => s.openAddSpot)
  const upsertSpotMeta = useStore((s) => s.upsertSpotMeta)
  const allSpots = useAllSpots()

  const { toast, showToast } = useToast()
  const { containerRef, pull, status } = usePullToRefresh({
    onRefresh: () => new Promise((resolve) => setTimeout(resolve, 300)),
    onDone: () => showToast('已更新'),
  })

  const [areaFilter, setAreaFilter] = useState<string>(ALL_AREA)

  const visitedCount = allSpots.filter((s) => spotsMeta[s.id]?.visited).length

  const areaTabs = useMemo(
    () => [ALL_AREA, ...new Set(allSpots.map((s) => areaGroup(s.area)))],
    [allSpots],
  )

  const filteredSpots = useMemo(
    () => (areaFilter === ALL_AREA ? allSpots : allSpots.filter((s) => areaGroup(s.area) === areaFilter)),
    [allSpots, areaFilter],
  )

  return (
    <div className="spots" ref={containerRef}>
      <PullToRefresh status={status} pull={pull} />

      <div className="spots-header">
        <h2 className="spots-h2">景點</h2>
        <button type="button" className="btn btn-secondary spots-add-btn" onClick={openAddSpot}>
          <Plus size={14} weight="bold" /> 新增
        </button>
      </div>
      <p className="spots-sub">
        {allSpots.length} 個候選 · 已去過 {visitedCount} · 點入可寫備註
      </p>

      <div className="spots-area-tabs">
        {areaTabs.map((area) => (
          <button
            key={area}
            type="button"
            className={`spots-area-tab${areaFilter === area ? ' is-selected' : ''}`}
            onClick={() => setAreaFilter(area)}
          >
            {area}
          </button>
        ))}
      </div>

      <div className="spots-list">
        {filteredSpots.map((spot) => {
          const visited = Boolean(spotsMeta[spot.id]?.visited)
          const photo = spotsMeta[spot.id]?.photo ?? (spot.real ? '/hero-photo.jpg' : undefined)
          return (
            <div
              key={spot.id}
              className="spots-row"
              role="button"
              tabIndex={0}
              onClick={() => openSpot(spot.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') openSpot(spot.id)
              }}
            >
              <PhotoUpload
                className="spots-thumb"
                photo={photo}
                alt={spot.name}
                emptyLabel="上傳"
                onChange={(dataUrl) => upsertSpotMeta({ id: spot.id, photo: dataUrl })}
              />
              <div className="spots-row-body">
                <div className="spots-row-head">
                  <div className="spots-row-name">{spot.name}</div>
                  <div className="spots-row-jp">{spot.jp}</div>
                </div>
                <div className="spots-row-teaser">{spot.teaser}</div>
                <div className="spots-row-tags">
                  <span className="tag tag-neutral">{spot.area}</span>
                  {visited ? (
                    <span className="tag tag-accent">已去過</span>
                  ) : (
                    <span className="tag tag-outline">未去</span>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {toast && <Toast message={toast.message} />}
    </div>
  )
}
