import { useState } from 'react'
import { X, Trash, Sparkle, CircleNotch } from '@phosphor-icons/react'
import { useStore } from '../lib/store'
import { genId } from '../lib/id'
import { apiFetchJson, ApiError } from '../lib/api'
import { SPOTS } from '../data/spots'
import Toast, { useToast } from '../components/Toast'
import type { CustomSpot, Spot, WalkStep, FoodRec } from '../lib/types'

/** functions/api/spot-import.ts 回傳的形狀，等同 Spot 扣掉 id（id 由前端 genId()）。
 * photo 是後端查維基條目首圖得到的，查不到就不會有這個欄位。 */
type GeminiSpotResult = Omit<CustomSpot, 'id' | 'updated_at' | 'deleted'> & { photo?: string }

/**
 * 新增／編輯景點面板，三種開法共用：PlanEditSheet 的「連結景點 → 找不到就新增」
 * （帶 initialName）、SpotsTab 的「＋新增」（什麼都不帶）、SpotDetail 的「編輯」
 * （帶 existingSpot）。
 *
 * 種子景點能編輯但不能刪除：存檔寫的是同 id 的 customSpots 覆蓋列，而靜態種子資料
 * 沒有「已刪除」這種狀態可以表達，所以刪除鈕只在非種子景點時顯示。
 *
 * 頂部「用 Gemini 帶入景點資訊」打 /api/spot-import，只補目前還空著的欄位，
 * 不覆蓋使用者手動填過的字。
 */
export default function SpotEditSheet({
  initialName,
  existingSpot,
  onClose,
  onSaved,
  onDeleted,
}: {
  initialName?: string
  existingSpot?: Spot
  onClose: () => void
  onSaved: (spot: CustomSpot) => void
  onDeleted?: () => void
}) {
  const upsertSpot = useStore((s) => s.upsertSpot)
  const deleteSpot = useStore((s) => s.deleteSpot)
  const upsertSpotMeta = useStore((s) => s.upsertSpotMeta)
  const { toast, showToast } = useToast()

  // real 旗標一律從原始種子資料讀，不看可能已被覆蓋的 existingSpot，這樣先前存檔
  // 弄丟過 real 也能救回來。
  const seedMatch = existingSpot ? SPOTS.find((s) => s.id === existingSpot.id) : undefined
  const isSeedSpot = Boolean(seedMatch)

  const [name, setName] = useState(existingSpot?.name ?? initialName ?? '')
  const [jp, setJp] = useState(existingSpot?.jp ?? '')
  const [area, setArea] = useState(existingSpot?.area ?? '')
  const [teaser, setTeaser] = useState(existingSpot?.teaser ?? '')
  const [intro, setIntro] = useState(existingSpot?.intro ?? '')
  const [hours, setHours] = useState(existingSpot?.hours ?? '')
  const [fee, setFee] = useState(existingSpot?.fee ?? '')
  const [access, setAccess] = useState(existingSpot?.access ?? '')
  const [q, setQ] = useState(existingSpot?.q ?? '')
  const [walk, setWalk] = useState<WalkStep[]>(existingSpot?.walk ?? [])
  const [food, setFood] = useState<FoodRec[]>(existingSpot?.food ?? [])
  const [importing, setImporting] = useState(false)
  const [geminiPhoto, setGeminiPhoto] = useState<string | undefined>(undefined)

  const handleGeminiImport = async () => {
    const trimmedName = name.trim()
    if (!trimmedName || importing) return
    setImporting(true)
    try {
      const result = await apiFetchJson<GeminiSpotResult>('/api/spot-import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: trimmedName }),
      })
      // 只補空欄位，已經手動填過的不覆蓋。
      if (!name.trim()) setName(result.name)
      if (!jp.trim()) setJp(result.jp)
      if (!area.trim()) setArea(result.area)
      if (!teaser.trim()) setTeaser(result.teaser)
      if (!intro.trim()) setIntro(result.intro)
      if (!hours.trim()) setHours(result.hours)
      if (!fee.trim()) setFee(result.fee)
      if (!access.trim()) setAccess(result.access)
      if (!q.trim()) setQ(result.q)
      if (walk.length === 0) setWalk(result.walk)
      if (food.length === 0) setFood(result.food)
      if (!geminiPhoto && result.photo) setGeminiPhoto(result.photo)
      showToast(
        result.photo ? '已帶入 Gemini 的建議內容（含維基百科代表圖），記得核對' : '已帶入 Gemini 的建議內容，記得核對',
      )
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Gemini 匯入失敗，稍後再試')
    } finally {
      setImporting(false)
    }
  }

  const handleSave = () => {
    const trimmedName = name.trim()
    if (!trimmedName) return
    const row: Omit<CustomSpot, 'updated_at' | 'deleted'> = {
      id: existingSpot?.id ?? genId(),
      name: trimmedName,
      jp,
      area,
      teaser,
      intro,
      hours,
      fee,
      access,
      walk: walk.filter((w) => w.min.trim() || w.text.trim()),
      food: food.filter((f) => f.name.trim() || f.note.trim() || f.address?.trim()),
      q: q.trim() || trimmedName,
      // 覆蓋列要保留 real（CMYK 大圖旗標）：表單沒有對應欄位，不帶過去就會弄丟。
      real: seedMatch?.real,
    }
    upsertSpot(row)
    // 維基百科代表圖存進 spotsMeta.photo，跟手動上傳的照片同一個欄位，景點列表/詳情頁
    // 本來就是讀那裡。
    if (geminiPhoto) upsertSpotMeta({ id: row.id, photo: geminiPhoto })
    onSaved({ ...row, updated_at: Date.now(), deleted: 0 })
    showToast(existingSpot ? '已更新景點' : '已新增景點')
  }

  const handleDelete = () => {
    if (!existingSpot || isSeedSpot) return
    if (!window.confirm(`刪除「${existingSpot.name}」這個景點？`)) return
    deleteSpot(existingSpot.id)
    showToast('已刪除景點')
    if (onDeleted) onDeleted()
    else onClose()
  }

  return (
    <div
      className="edit-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="edit-sheet">
        <div className="edit-head-block">
          <div className="edit-header">
            <h3 className="edit-title">{existingSpot ? '編輯景點' : '新增景點'}</h3>
            <button type="button" className="btn btn-ghost edit-close-btn" onClick={onClose} aria-label="關閉">
              <X size={16} weight="duotone" />
            </button>
          </div>
        </div>

        <button
          type="button"
          className="btn btn-secondary btn-block"
          disabled={!name.trim() || importing}
          onClick={() => void handleGeminiImport()}
        >
          {importing ? (
            <CircleNotch size={15} weight="bold" className="spot-import-spin" />
          ) : (
            <Sparkle size={15} weight="duotone" />
          )}
          {importing ? '帶入中…' : '用 Gemini 帶入景點資訊'}
        </button>

        {geminiPhoto && (
          <div className="field">
            <label>代表圖（維基百科，存檔後可在景點頁換掉）</label>
            <img className="spot-import-photo-preview" src={geminiPhoto} alt="" />
          </div>
        )}

        <div className="edit-row">
          <div className="field edit-title-field">
            <label>名稱</label>
            <input className="input" placeholder="例：淺草寺" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field edit-title-field">
            <label>日文名</label>
            <input className="input" placeholder="せんそうじ" value={jp} onChange={(e) => setJp(e.target.value)} />
          </div>
        </div>

        <div className="field">
          <label>地區</label>
          <input className="input" placeholder="例：東京" value={area} onChange={(e) => setArea(e.target.value)} />
        </div>

        <div className="field">
          <label>一句話介紹</label>
          <input className="input" value={teaser} onChange={(e) => setTeaser(e.target.value)} />
        </div>

        <div className="field">
          <label>簡介</label>
          <textarea className="input edit-note-textarea" value={intro} onChange={(e) => setIntro(e.target.value)} />
        </div>

        <div className="edit-row">
          <div className="field edit-title-field">
            <label>營業時間</label>
            <input className="input" value={hours} onChange={(e) => setHours(e.target.value)} />
          </div>
          <div className="field edit-title-field">
            <label>門票</label>
            <input className="input" value={fee} onChange={(e) => setFee(e.target.value)} />
          </div>
        </div>

        <div className="field">
          <label>交通</label>
          <input className="input" value={access} onChange={(e) => setAccess(e.target.value)} />
        </div>

        <div className="field">
          <label>地點（用於 Google Maps 導航）</label>
          <input className="input" placeholder="留空則用名稱搜尋" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>

        <div className="field">
          <label>步行路線</label>
          {walk.map((row, i) => (
            <div key={i} className="edit-list-row">
              <input
                className="input edit-list-row-narrow"
                placeholder="分鐘"
                value={row.min}
                onChange={(e) => setWalk((rows) => rows.map((r, idx) => (idx === i ? { ...r, min: e.target.value } : r)))}
              />
              <input
                className="input"
                placeholder="說明"
                value={row.text}
                onChange={(e) => setWalk((rows) => rows.map((r, idx) => (idx === i ? { ...r, text: e.target.value } : r)))}
              />
              <button
                type="button"
                className="btn btn-ghost edit-list-row-remove"
                aria-label="刪除這一列"
                onClick={() => setWalk((rows) => rows.filter((_, idx) => idx !== i))}
              >
                <Trash size={14} weight="duotone" />
              </button>
            </div>
          ))}
          <button type="button" className="btn btn-secondary" onClick={() => setWalk((rows) => [...rows, { min: '', text: '' }])}>
            ＋ 新增一筆
          </button>
        </div>

        <div className="field">
          <label>美食推薦</label>
          {food.map((row, i) => (
            <div key={i} className="edit-list-row-group">
              <div className="edit-list-row">
                <input
                  className="input"
                  placeholder="店名"
                  value={row.name}
                  onChange={(e) => setFood((rows) => rows.map((r, idx) => (idx === i ? { ...r, name: e.target.value } : r)))}
                />
                <input
                  className="input"
                  placeholder="備註"
                  value={row.note}
                  onChange={(e) => setFood((rows) => rows.map((r, idx) => (idx === i ? { ...r, note: e.target.value } : r)))}
                />
                <button
                  type="button"
                  className="btn btn-ghost edit-list-row-remove"
                  aria-label="刪除這一列"
                  onClick={() => setFood((rows) => rows.filter((_, idx) => idx !== i))}
                >
                  <Trash size={14} weight="duotone" />
                </button>
              </div>
              <input
                className="input"
                placeholder="地址（可留空，留空則用店名搜尋 Google Maps）"
                value={row.address ?? ''}
                onChange={(e) => setFood((rows) => rows.map((r, idx) => (idx === i ? { ...r, address: e.target.value } : r)))}
              />
            </div>
          ))}
          <button type="button" className="btn btn-secondary" onClick={() => setFood((rows) => [...rows, { name: '', note: '' }])}>
            ＋ 新增一筆
          </button>
        </div>

        <button type="button" className="btn btn-primary btn-block" disabled={!name.trim()} onClick={handleSave}>
          {existingSpot ? '儲存變更' : '新增景點'}
        </button>
        {existingSpot && !isSeedSpot && (
          <button type="button" className="btn btn-secondary btn-block edit-delete-btn" onClick={handleDelete}>
            <Trash size={16} weight="duotone" /> 刪除這個景點
          </button>
        )}
      </div>

      {toast && <Toast message={toast.message} />}
    </div>
  )
}
