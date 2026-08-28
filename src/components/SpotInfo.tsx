import { useState } from 'react'
import { CheckSquare, Square, MapPin } from '@phosphor-icons/react'
import { useStore } from '../lib/store'
import { navUrl } from '../lib/nav'
import { containsUrl, linkifyText } from '../lib/linkify'
import type { Spot } from '../lib/types'

/**
 * 景點資訊區塊，兩種 variant：
 * - 'embedded'（PlanDetail 用）：kicker + 日文名 → 簡介 → 營業時間/門票/交通 →
 *   步行路線 → 美食推薦 → 已去過按鈕 → 備註。
 * - 'page'（SpotDetail 用）：日文名／簡介由頁面 header 出，已去過按鈕挪到頂部動作列，
 *   所以這裡只出營業時間/門票/交通 → 步行路線 → 美食推薦 → 備註。
 * 已去過/備註的讀寫邏輯兩種 variant 一致，'page' 只是不畫按鈕本身，state 由
 * useSpotVisited 匯出給 SpotDetail 自己渲染。
 */
export default function SpotInfo({ spot, variant = 'embedded' }: { spot: Spot; variant?: 'embedded' | 'page' }) {
  const spotsMeta = useStore((s) => s.entities.spotsMeta)
  const upsertSpotMeta = useStore((s) => s.upsertSpotMeta)

  const meta = spotsMeta[spot.id]

  // 備註用本地 state 暫存，blur 才寫回 store，避免每個按鍵都寫 IndexedDB。
  // 用 spot.id 當 key 讓切換景點時重新初始化。
  const [noteDraft, setNoteDraft] = useState<string | null>(null)
  const [noteSpotId, setNoteSpotId] = useState(spot.id)
  if (noteSpotId !== spot.id) {
    setNoteSpotId(spot.id)
    setNoteDraft(null)
  }
  const noteValue = noteDraft ?? meta?.note ?? ''

  const handleToggleVisited = () => {
    upsertSpotMeta({ id: spot.id, visited: !meta?.visited })
  }

  const handleNoteBlur = () => {
    if (noteDraft === null) return
    upsertSpotMeta({ id: spot.id, note: noteDraft })
  }

  return (
    <>
      {variant === 'embedded' && (
        <>
          <div className="detail-kicker-label">景點資訊</div>
          <p className="detail-spot-jp">{spot.jp}</p>
          <p className="detail-spot-intro">{spot.intro}</p>
        </>
      )}

      <div className="detail-spot-grid">
        <div>
          <div className="detail-grid-label">營業時間</div>
          <div className="detail-grid-value">{spot.hours}</div>
        </div>
        <div>
          <div className="detail-grid-label">門票</div>
          <div className="detail-grid-value">{spot.fee}</div>
        </div>
        <div>
          <div className="detail-grid-label">交通</div>
          <div className="detail-grid-value">{spot.access}</div>
        </div>
      </div>

      {spot.walk.length > 0 && (
        <div className="detail-walk-section">
          <div className="detail-kicker-label">步行路線</div>
          <div className="detail-walk">
            {spot.walk.map((w, i) => (
              <div key={i} className="detail-walk-row">
                <div className="detail-walk-min">{w.min}</div>
                <div className="detail-walk-text">{w.text}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {spot.food.length > 0 && (
        <div className="detail-food">
          <div className="detail-kicker-label detail-kicker-accent2">美食推薦</div>
          {spot.food.map((f, i) => (
            <div key={i} className="detail-food-row">
              <a
                className="detail-food-name detail-food-name-link"
                href={navUrl(f.address || f.name)}
                target="_blank"
                rel="noreferrer"
              >
                <MapPin size={12} weight="duotone" />
                {f.name}
              </a>
              <span className="detail-food-note">{f.note}</span>
            </div>
          ))}
        </div>
      )}

      {variant === 'embedded' && (
        <button
          type="button"
          className={`btn ${meta?.visited ? 'btn-primary' : 'btn-secondary'} detail-visited-btn`}
          onClick={handleToggleVisited}
        >
          {meta?.visited ? <CheckSquare size={16} weight="duotone" /> : <Square size={16} weight="duotone" />}
          {meta?.visited ? '已去過' : '標記已去過'}
        </button>
      )}

      <div className="field detail-note-field">
        <label>我們的備註</label>
        <textarea
          className="input detail-note-input"
          placeholder="想吃的、想拍的、開放時間變動…"
          value={noteValue}
          onChange={(e) => setNoteDraft(e.target.value)}
          onBlur={handleNoteBlur}
        />
        {containsUrl(noteValue) && <p className="detail-note-links">{linkifyText(noteValue)}</p>}
      </div>
    </>
  )
}

/** 'page' variant 下，SpotDetail 自己要在頂部動作列畫「已去過」按鈕，重用同一份讀寫邏輯。 */
export function useSpotVisited(spotId: string) {
  const meta = useStore((s) => s.entities.spotsMeta[spotId])
  const upsertSpotMeta = useStore((s) => s.upsertSpotMeta)
  const visited = Boolean(meta?.visited)
  const toggle = () => upsertSpotMeta({ id: spotId, visited: !visited })
  return { visited, toggle }
}
