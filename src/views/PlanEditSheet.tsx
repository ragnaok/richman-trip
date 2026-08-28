import { useState } from 'react'
import { BellRinging, BellSlash, X, NavigationArrow, Trash } from '@phosphor-icons/react'
import { useStore, useAllSpots } from '../lib/store'
import { navUrl } from '../lib/nav'
import { phosphorIcon } from '../lib/icons'
import { formatEditDayLabel, dayRange, mdToIso, isoToMd } from '../lib/time'
import { KIND, NA, DAYINFO, findSpot } from '../data/spots'
import Toast, { useToast } from '../components/Toast'
import SpotEditSheet from './SpotEditSheet'
import PhotoUpload from '../components/PhotoUpload'
import type { Kind, PlanItem } from '../lib/types'

const MAX_SPOT_CANDIDATES = 5

const LEAD_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 15, label: '15 分鐘' },
  { value: 30, label: '30 分鐘' },
  { value: 60, label: '1 小時' },
  { value: 120, label: '2 小時' },
]

/**
 * 行程編輯 bottom sheet，ui.edit 有值時由 App.tsx 渲染。
 * 新增／編輯共用同一份表單，isNew 靠 id 是否已存在於 store 判斷。
 */
export default function PlanEditSheet() {
  const edit = useStore((s) => s.ui.edit)
  const plans = useStore((s) => s.entities.plans)
  const setEdit = useStore((s) => s.setEdit)
  const setActiveDay = useStore((s) => s.setDay)
  const upsertPlan = useStore((s) => s.upsertPlan)
  const deletePlan = useStore((s) => s.deletePlan)
  const tripStart = useStore((s) => s.entities.settings.tripStart)
  const tripEnd = useStore((s) => s.entities.settings.tripEnd)

  const { toast, showToast } = useToast()
  const allSpots = useAllSpots()

  const draft = edit as (Partial<PlanItem> & { id: PlanItem['id']; day: string }) | null

  const [day, setDay] = useState('')
  const [t, setT] = useState('')
  const [title, setTitle] = useState('')
  const [sub, setSub] = useState('')
  const [k, setK] = useState<Kind>('s')
  const [q, setQ] = useState('')
  const [notify, setNotify] = useState(false)
  const [lead, setLead] = useState(30)
  const [remindMode, setRemindMode] = useState<'relative' | 'absolute'>('relative')
  const [remindAt, setRemindAt] = useState('')
  const [spotId, setSpotId] = useState<string | undefined>(undefined)
  const [photo, setPhoto] = useState<string | undefined>(undefined)
  const [spotQuery, setSpotQuery] = useState('')
  const [creatingSpotName, setCreatingSpotName] = useState<string | null>(null)
  const [candsCleared, setCandsCleared] = useState(false)
  const [initializedId, setInitializedId] = useState<PlanItem['id'] | null>(null)

  // draft 換了（不同筆行程/新草稿）時才重新灌入表單狀態，避免每次 render 都覆蓋使用者輸入。
  if (draft && draft.id !== initializedId) {
    setInitializedId(draft.id)
    setDay(draft.day)
    setT(draft.t === NA ? '' : (draft.t ?? ''))
    setTitle(draft.title ?? '')
    setSub(draft.sub ?? '')
    setK((draft.k as Kind) ?? 's')
    setQ(draft.q ?? '')
    setNotify(draft.notify ?? false)
    setLead(draft.lead ?? 30)
    setRemindMode(draft.remindAt ? 'absolute' : 'relative')
    setRemindAt(draft.remindAt ?? '')
    setSpotId(draft.spot)
    setPhoto(draft.photo)
    setSpotQuery('')
    setCandsCleared(false)
  }

  if (!draft) return null

  const isNew = !plans.some((p) => p.id === draft.id)
  const timeIsNA = t.trim() === ''
  const tripYear = tripStart?.slice(0, 4) ?? '2026'
  const days = tripStart && tripEnd ? dayRange(tripStart, tripEnd) : DAYINFO.map((d) => ({ d: d.d, wd: d.wd }))
  const dayInfo = days.find((d) => d.d === day)
  // 只有設定頁真的填了日期範圍才擋：沒設定時 days 退回種子 DAYINFO，那不是使用者
  // 設的範圍，不該拿來限制選日期。
  const dateOutOfRange = !!(tripStart && tripEnd && day && !dayInfo)

  const linkedSpot = findSpot(allSpots, spotId)
  const trimmedSpotQuery = spotQuery.trim()
  const spotCandidates =
    !linkedSpot && trimmedSpotQuery
      ? allSpots
          .filter((s) => s.name.includes(trimmedSpotQuery) || s.jp.includes(trimmedSpotQuery) || s.area.includes(trimmedSpotQuery))
          .slice(0, MAX_SPOT_CANDIDATES)
      : []

  // iOS Safari 的 datetime-local 在 value 為空字串時會拿「現在時間」當佔位顯示，
  // 使用者會誤以為選好了，但 remindAt 仍是空的、存檔鈕被 disable，看起來像沒反應。
  // 所以切到這個模式時直接填入實際值（優先用這筆行程自己的日期時間）。
  function switchToAbsoluteMode() {
    setRemindMode('absolute')
    if (!remindAt) {
      if (day && t) {
        setRemindAt(`${mdToIso(day, tripYear)}T${t}`)
      } else {
        const now = new Date()
        const pad = (n: number) => String(n).padStart(2, '0')
        setRemindAt(`${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`)
      }
    }
  }

  function changeDay(newDay: string) {
    setDay(newDay)
    if (tripStart && tripEnd && !days.some((d) => d.d === newDay)) {
      window.alert(`這個日期不在設定的旅遊日期範圍內（${tripStart} ~ ${tripEnd}），請重新選擇。`)
    }
  }

  function linkSpot(spotIdToLink: string, spotName: string, spotQKeyword: string) {
    setSpotId(spotIdToLink)
    if (!title.trim()) setTitle(spotName)
    if (!q.trim()) setQ(spotQKeyword)
    setSpotQuery('')
    // 明確連結景點代表候選已有答案，清掉 cands，免得跟 PlanDetail 的「只要 cands
    // 還有值就不顯示景點資訊」規則打架。
    setCandsCleared(true)
  }

  const close = () => {
    setEdit(null)
  }

  const handleSave = () => {
    if (dateOutOfRange) {
      window.alert(`這個日期不在設定的旅遊日期範圍內（${tripStart} ~ ${tripEnd}），請重新選擇。`)
      return
    }
    const row: Omit<PlanItem, 'updated_at' | 'deleted'> = {
      id: draft.id,
      day,
      t: timeIsNA ? NA : t.trim(),
      title: title.trim(),
      sub,
      k,
      q,
      spot: spotId,
      cands: candsCleared ? undefined : draft.cands,
      drive: draft.drive,
      park: draft.park,
      notify,
      lead: notify && remindMode === 'relative' ? lead : draft.lead,
      remindAt: notify && remindMode === 'absolute' ? remindAt : undefined,
      photo,
    }
    upsertPlan(row)
    // 行程可能被改到別天，存完切去那一天，才不會停在原本那天以為存檔失敗。
    setActiveDay(row.day)
    showToast(isNew ? `已加入行程 · ${row.title}` : `已更新行程 · ${row.title}`)
    close()
  }

  const handleDelete = () => {
    if (!window.confirm(`刪除「${title}」這筆行程？`)) return
    deletePlan(draft.id)
    showToast(`已刪除行程 · ${title}`)
    close()
  }

  return (
    <>
    <div
      className="edit-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <div className="edit-sheet">
        <div className="edit-head-block">
          <div className="edit-header">
            <h3 className="edit-title">{isNew ? '新增行程' : '編輯行程'}</h3>
            <button type="button" className="btn btn-ghost edit-close-btn" onClick={close} aria-label="關閉">
              <X size={16} weight="duotone" />
            </button>
          </div>
        </div>

        <div className="field edit-datetime-field">
          <label>日期時間</label>
          <div className="edit-datetime-row">
            {timeIsNA ? (
              <input
                type="date"
                className="input"
                value={day ? mdToIso(day, tripYear) : ''}
                min={tripStart || undefined}
                max={tripEnd || undefined}
                onChange={(e) => e.target.value && changeDay(isoToMd(e.target.value))}
              />
            ) : (
              <input
                type="datetime-local"
                className="input"
                value={day && t ? `${mdToIso(day, tripYear)}T${t}` : ''}
                min={tripStart ? `${tripStart}T00:00` : undefined}
                max={tripEnd ? `${tripEnd}T23:59` : undefined}
                onChange={(e) => {
                  const [isoDate, time] = e.target.value.split('T')
                  if (isoDate) changeDay(isoToMd(isoDate))
                  if (time) setT(time.slice(0, 5))
                }}
              />
            )}
            <button
              type="button"
              className="btn btn-secondary edit-time-na-toggle"
              onClick={() => setT(timeIsNA ? '09:00' : '')}
            >
              {timeIsNA ? '設定時間' : '時間未定'}
            </button>
          </div>
          {dayInfo && <div className="edit-day-label">{formatEditDayLabel(day, dayInfo.wd)}</div>}
          {dateOutOfRange && (
            <p className="edit-notify-warning">
              選擇的日期超出設定的旅遊日期範圍（{tripStart} ~ {tripEnd}），請重新選擇。
            </p>
          )}
        </div>

        <div className="field">
          <label>項目</label>
          <input className="input" placeholder="例：機場接送" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>

        <div className="field">
          <label>連結景點（可留空，直接輸入標題也可以）</label>
          {linkedSpot ? (
            <div className="edit-linked-spot">
              <span className="edit-linked-spot-name">{linkedSpot.name}</span>
              <button type="button" className="btn btn-secondary" onClick={() => setSpotId(undefined)}>
                取消連結
              </button>
            </div>
          ) : (
            <>
              <input
                className="input"
                placeholder="搜尋景點名稱、日文名或地區"
                value={spotQuery}
                onChange={(e) => setSpotQuery(e.target.value)}
              />
              {spotCandidates.map((s) => (
                <div key={s.id} className="detail-cand-row">
                  <div className="detail-cand-body">
                    <div className="detail-cand-title">{s.name}</div>
                    <div className="detail-cand-teaser">
                      {s.area} · {s.teaser}
                    </div>
                  </div>
                  <button type="button" className="btn btn-secondary" onClick={() => linkSpot(s.id, s.name, s.q)}>
                    選這個
                  </button>
                </div>
              ))}
              {trimmedSpotQuery && (
                <button
                  type="button"
                  className="btn btn-secondary edit-new-spot-btn"
                  onClick={() => setCreatingSpotName(trimmedSpotQuery)}
                >
                  ＋ 新增景點「{trimmedSpotQuery}」
                </button>
              )}
            </>
          )}
        </div>

        <div className="field">
          <label>備註（可多行）</label>
          <textarea
            className="input edit-note-textarea"
            placeholder={'交通方式、預約編號、票價…\n可以換行寫多筆'}
            value={sub}
            onChange={(e) => setSub(e.target.value)}
          />
        </div>

        <div className="edit-notify-block">
          <div className="edit-section-label">行程提醒</div>
          <button
            type="button"
            className={`btn edit-notify-btn ${notify ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setNotify(!notify)}
          >
            {notify ? (
              <>
                <BellRinging size={16} weight="duotone" /> 提醒已開啟
              </>
            ) : (
              <>
                <BellSlash size={16} weight="duotone" /> 不提醒這個行程
              </>
            )}
          </button>

          {notify && (
            <div className="edit-lead-chips">
              <button
                type="button"
                className={`edit-lead-chip${remindMode === 'relative' ? ' is-selected' : ''}`}
                onClick={() => setRemindMode('relative')}
              >
                提前時間
              </button>
              <button
                type="button"
                className={`edit-lead-chip${remindMode === 'absolute' ? ' is-selected' : ''}`}
                onClick={switchToAbsoluteMode}
              >
                指定日期時間
              </button>
            </div>
          )}

          {notify && remindMode === 'relative' && (
            <div className="edit-lead-chips">
              {LEAD_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`edit-lead-chip${lead === opt.value ? ' is-selected' : ''}`}
                  onClick={() => setLead(opt.value)}
                >
                  提前 {opt.label}
                </button>
              ))}
            </div>
          )}

          {notify && remindMode === 'relative' && timeIsNA && (
            <p className="edit-notify-warning">這筆行程還沒有時間，提醒要等你填上時間才會發送。</p>
          )}

          {notify && remindMode === 'absolute' && (
            <input
              type="datetime-local"
              className="input edit-remind-at-input"
              value={remindAt}
              onChange={(e) => setRemindAt(e.target.value)}
            />
          )}
        </div>

        <div className="edit-kind-block">
          <div className="edit-section-label">類型</div>
          <div className="edit-kind-chips">
            {(Object.keys(KIND) as Kind[]).map((kindKey) => {
              const [icon, color, label] = KIND[kindKey]
              const Icon = phosphorIcon(icon)
              const selected = k === kindKey
              return (
                <button
                  key={kindKey}
                  type="button"
                  className={`edit-kind-chip${selected ? ' is-selected' : ''}`}
                  onClick={() => setK(kindKey)}
                >
                  {Icon && <Icon size={15} weight="duotone" color={selected ? undefined : color} />}
                  {label}
                </button>
              )
            })}
          </div>
        </div>

        <div className="field">
          <label>地點（用於 Google Maps 導航）</label>
          <input
            className="input"
            placeholder="留空則用項目名稱搜尋"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        <div className="field">
          <label>此行程照片（此筆行程專屬，與景點照片不同，之後會顯示在行程資訊）</label>
          <PhotoUpload
            className="edit-plan-photo"
            photo={photo}
            alt={title || '行程照片'}
            emptyLabel="拖入或點擊上傳"
            onChange={setPhoto}
          />
        </div>

        <button
          type="button"
          className="btn btn-primary btn-block edit-save-btn"
          disabled={!title.trim() || dateOutOfRange || (notify && remindMode === 'absolute' && !remindAt)}
          onClick={handleSave}
        >
          {isNew ? '加入行程' : '儲存變更'}
        </button>

        {!isNew && (
          <div className="edit-actions">
            <a className="btn btn-secondary" href={navUrl(q || title)} target="_blank" rel="noreferrer">
              <NavigationArrow size={16} weight="duotone" /> 在 Google Maps 開啟
            </a>
            <button type="button" className="btn btn-secondary edit-delete-btn" onClick={handleDelete}>
              <Trash size={16} weight="duotone" /> 刪除
            </button>
          </div>
        )}
      </div>

      {toast && <Toast message={toast.message} />}
    </div>

    {creatingSpotName !== null && (
      <SpotEditSheet
        initialName={creatingSpotName}
        onClose={() => setCreatingSpotName(null)}
        onSaved={(spot) => {
          linkSpot(spot.id, spot.name, spot.q)
          setCreatingSpotName(null)
        }}
      />
    )}
    </>
  )
}
