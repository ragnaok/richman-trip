import { useEffect, useState } from 'react'
import { X, UserSwitch, SignOut, Bed, Plus, PencilSimple, Trash, BellRinging, BellSlash } from '@phosphor-icons/react'
import { useStore, useHotels } from '../lib/store'
import { dayRange } from '../lib/time'
import { switchRole, logout } from '../lib/auth'
import { genId } from '../lib/id'
import {
  isPushSupported,
  getExistingSubscription,
  enablePushReminders,
  disablePushReminders,
  sendTestPush,
} from '../lib/push'
import PhotoUpload from '../components/PhotoUpload'
import { apiFetchJson } from '../lib/api'
import type { StoredHotel } from '../lib/types'

interface HotelDraft {
  id: string | null
  name: string
  q: string
  checkin: string
  checkout: string
  lat: string
  lon: string
}

/**
 * 設定頁：從最右緣往左滑開啟，跟其他全螢幕頁面共用左緣滑動關閉的手勢與動畫；
 * openX/dragging 由 App.tsx 算好傳進來，這裡只負責套用。
 *
 * 欄位都直接寫回 entities.settings（跟匯率同一張表），全站讀同一份 store，改了立刻
 * 連動：主視覺/標題/副標題 → AuthGate 與行程頁主視覺，旅遊日期 → 日期標題與日期橫排，
 * 匯率 → 記帳換算。照片走 lib/imageUpload 壓成 data URL 存進 settings.heroPhoto。
 */
export default function SettingsSheet({ openX, dragging }: { openX: number; dragging: boolean }) {
  const closeSettings = useStore((s) => s.closeSettings)
  const role = useStore((s) => s.ui.auth.role)
  const destTitle = useStore((s) => s.entities.settings.destTitle ?? '')
  const destSubtitle = useStore((s) => s.entities.settings.destSubtitle ?? '')
  const geminiRegionHint = useStore((s) => s.entities.settings.geminiRegionHint ?? '')
  const heroPhoto = useStore((s) => s.entities.settings.heroPhoto)
  const tripStart = useStore((s) => s.entities.settings.tripStart ?? '')
  const tripEnd = useStore((s) => s.entities.settings.tripEnd ?? '')
  const rate = useStore((s) => s.entities.settings.rate ?? '0.216')
  const plans = useStore((s) => s.entities.plans)
  const setSetting = useStore((s) => s.setSetting)
  const setRate = useStore((s) => s.setRate)
  const deletePlansForDay = useStore((s) => s.deletePlansForDay)
  const hotels = useHotels()
  const upsertHotel = useStore((s) => s.upsertHotel)
  const deleteHotel = useStore((s) => s.deleteHotel)

  const [pendingDates, setPendingDates] = useState<{ start: string; end: string } | null>(null)
  const [droppedDays, setDroppedDays] = useState<string[]>([])
  const [pushEnabled, setPushEnabled] = useState(false)
  const [pushBusy, setPushBusy] = useState(false)
  const [pushError, setPushError] = useState<string | null>(null)
  const [testPushBusy, setTestPushBusy] = useState(false)
  const [testPushError, setTestPushError] = useState<string | null>(null)
  const [testPushSent, setTestPushSent] = useState(false)

  useEffect(() => {
    if (!isPushSupported()) return
    getExistingSubscription().then((sub) => setPushEnabled(!!sub))
  }, [])

  // 有沒有新版本：比對本機 bundle 的 __GIT_HASH__（build 當下）跟伺服器現在部署的
  // commit（/api/version 讀 wrangler 自動注入的 CF_PAGES_COMMIT_SHA）。開設定頁才查一次，
  // 不用另外排輪詢。
  const [remoteCommit, setRemoteCommit] = useState<string | null>(null)
  const [updating, setUpdating] = useState(false)
  useEffect(() => {
    apiFetchJson<{ commit: string | null }>('/api/version')
      .then((res) => setRemoteCommit(res.commit))
      .catch(() => {})
  }, [])
  const hasUpdate = remoteCommit != null && remoteCommit !== __GIT_HASH__

  // 手動觸發更新：解除註冊 SW + 清 Cache Storage 再整頁重載，不用等「重開兩次」讓
  // autoUpdate 自然生效。只動 SW 快取，session cookie／IndexedDB 都不碰，不用重新登入。
  async function handleUpdateNow() {
    setUpdating(true)
    try {
      const regs = await navigator.serviceWorker.getRegistrations()
      await Promise.all(regs.map((r) => r.unregister()))
      if (window.caches) {
        const keys = await caches.keys()
        await Promise.all(keys.map((k) => caches.delete(k)))
      }
    } finally {
      window.location.reload()
    }
  }

  async function handleTogglePush() {
    setPushBusy(true)
    setPushError(null)
    try {
      if (pushEnabled) {
        await disablePushReminders()
        setPushEnabled(false)
      } else {
        const error = await enablePushReminders(role ?? '')
        if (error) setPushError(error)
        else setPushEnabled(true)
      }
    } finally {
      setPushBusy(false)
    }
  }

  async function handleTestPush() {
    setTestPushBusy(true)
    setTestPushError(null)
    setTestPushSent(false)
    try {
      const error = await sendTestPush()
      if (error) setTestPushError(error)
      else setTestPushSent(true)
    } finally {
      setTestPushBusy(false)
    }
  }
  const [hotelDraft, setHotelDraft] = useState<HotelDraft | null>(null)

  // 改旅遊日期時先算出新範圍會排除掉哪些「已經有排行程」的日期：有的話跳二次確認，
  // 沒有就直接套用，不要每次改日期都打斷使用者。
  function handleDateChange(field: 'start' | 'end', value: string) {
    if (!value) return
    const draft = { start: field === 'start' ? value : tripStart, end: field === 'end' ? value : tripEnd }
    if (!draft.start || !draft.end) {
      setSetting(field === 'start' ? 'tripStart' : 'tripEnd', value)
      return
    }
    const oldDays = new Set(dayRange(tripStart, tripEnd).map((d) => d.d))
    const newDays = new Set(dayRange(draft.start, draft.end).map((d) => d.d))
    const dropped = [...oldDays].filter((d) => !newDays.has(d) && plans.some((p) => p.day === d && p.deleted !== 1))
    if (dropped.length > 0) {
      setPendingDates(draft)
      setDroppedDays(dropped)
    } else {
      setSetting('tripStart', draft.start)
      setSetting('tripEnd', draft.end)
    }
  }

  function confirmDateChange() {
    if (!pendingDates) return
    for (const d of droppedDays) deletePlansForDay(d)
    setSetting('tripStart', pendingDates.start)
    setSetting('tripEnd', pendingDates.end)
    setPendingDates(null)
    setDroppedDays([])
  }

  function cancelDateChange() {
    setPendingDates(null)
    setDroppedDays([])
  }

  function handleSwitchRole() {
    closeSettings()
    switchRole()
  }

  function handleLogout() {
    closeSettings()
    void logout()
  }

  function openNewHotel() {
    setHotelDraft({ id: null, name: '', q: '', checkin: tripStart, checkout: tripEnd, lat: '', lon: '' })
  }

  function openEditHotel(h: StoredHotel) {
    setHotelDraft({
      id: h.id,
      name: h.name,
      q: h.q,
      checkin: h.checkin,
      checkout: h.checkout,
      lat: h.lat != null ? String(h.lat) : '',
      lon: h.lon != null ? String(h.lon) : '',
    })
  }

  function saveHotel() {
    if (!hotelDraft || !hotelDraft.name.trim()) return
    const lat = hotelDraft.lat.trim() ? Number(hotelDraft.lat) : undefined
    const lon = hotelDraft.lon.trim() ? Number(hotelDraft.lon) : undefined
    upsertHotel({
      id: hotelDraft.id ?? genId(),
      name: hotelDraft.name.trim(),
      q: hotelDraft.q.trim(),
      checkin: hotelDraft.checkin,
      checkout: hotelDraft.checkout,
      lat: lat != null && Number.isFinite(lat) ? lat : undefined,
      lon: lon != null && Number.isFinite(lon) ? lon : undefined,
    })
    setHotelDraft(null)
  }

  function removeHotel() {
    if (!hotelDraft?.id) return
    deleteHotel(hotelDraft.id)
    setHotelDraft(null)
  }

  function hotelDaysLabel(h: StoredHotel): string {
    if (!h.checkin || !h.checkout) return '尚未指定日期'
    return `入住 ${h.checkin} · 退房 ${h.checkout}`
  }

  return (
    <div
      className="settings-page"
      style={{
        transform: `translateX(${openX}px)`,
        transition: dragging ? 'none' : 'transform 220ms ease-out',
      }}
    >
      <div className="settings-header">
        <h2 className="settings-title">設定</h2>
        <button type="button" className="btn btn-ghost settings-close-btn" onClick={closeSettings} aria-label="關閉">
          <X size={16} weight="duotone" />
        </button>
      </div>

      <div className="settings-section">
        <div className="edit-section-label">目的地</div>
        <div className="field" style={{ marginTop: 10 }}>
          <label>主視覺照片</label>
          <PhotoUpload
            className="settings-hero-photo"
            photo={heroPhoto}
            alt="主視覺照片"
            emptyLabel="上傳主視覺照片"
            onChange={(dataUrl) => setSetting('heroPhoto', dataUrl)}
          />
          <p className="settings-hero-photo-hint">會替換登入、切換身分、行程頁的主視覺照片。</p>
        </div>
        <div className="field" style={{ marginTop: 14 }}>
          <label>標題</label>
          <input className="input" value={destTitle} onChange={(e) => setSetting('destTitle', e.target.value)} />
        </div>
        <div className="field" style={{ marginTop: 10 }}>
          <label>副標題</label>
          <input
            className="input"
            value={destSubtitle}
            onChange={(e) => setSetting('destSubtitle', e.target.value)}
          />
        </div>
        <div className="field" style={{ marginTop: 10 }}>
          <label>地區提示（景點頁「用 Gemini 帶入景點資訊」查詢用）</label>
          <input
            className="input"
            value={geminiRegionHint}
            onChange={(e) => setSetting('geminiRegionHint', e.target.value)}
            placeholder="例：日本東京都周邊"
          />
        </div>
      </div>

      <div className="settings-section">
        <div className="edit-section-label">旅遊日期</div>
        <div className="settings-date-row">
          <div className="field">
            <label>開始日期</label>
            <input
              className="input"
              type="date"
              value={tripStart}
              onChange={(e) => handleDateChange('start', e.target.value)}
            />
          </div>
          <div className="field">
            <label>結束日期</label>
            <input
              className="input"
              type="date"
              value={tripEnd}
              onChange={(e) => handleDateChange('end', e.target.value)}
            />
          </div>
        </div>
        {pendingDates && (
          <div className="settings-date-warning">
            <p>
              <b>{droppedDays.join('、')}</b> 已不在新的日期範圍內，這些日期的行程將會被整批移除，此動作無法復原。
            </p>
            <div className="settings-date-warning-row">
              <button type="button" className="btn btn-secondary" onClick={cancelDateChange}>
                取消
              </button>
              <button type="button" className="btn btn-primary settings-date-danger-btn" onClick={confirmDateChange}>
                確定變更
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="settings-section">
        <div className="settings-section-header">
          <div className="edit-section-label">住宿地點</div>
          <button type="button" className="btn btn-secondary settings-add-hotel-btn" onClick={openNewHotel}>
            <Plus size={13} weight="duotone" /> 新增飯店
          </button>
        </div>
        {hotels.length === 0 && !hotelDraft && <p className="settings-hotel-empty">還沒有設定住宿</p>}
        {hotels.map((h) => (
          <button key={h.id} type="button" className="settings-hotel-row" onClick={() => openEditHotel(h)}>
            <Bed size={20} weight="duotone" color="var(--color-accent-700)" />
            <div className="settings-hotel-row-body">
              <div className="settings-hotel-row-name">{h.name}</div>
              <div className="settings-hotel-row-days">{hotelDaysLabel(h)}</div>
            </div>
            <PencilSimple size={15} weight="duotone" />
          </button>
        ))}
        {hotelDraft && (
          <div className="settings-hotel-edit">
            <div className="field" style={{ marginTop: 10 }}>
              <label>飯店名稱</label>
              <input
                className="input"
                value={hotelDraft.name}
                onChange={(e) => setHotelDraft({ ...hotelDraft, name: e.target.value })}
                placeholder="範例飯店"
              />
            </div>
            <div className="field" style={{ marginTop: 10 }}>
              <label>地點（用於 Google Maps 導航，可用日文店名）</label>
              <input
                className="input"
                value={hotelDraft.q}
                onChange={(e) => setHotelDraft({ ...hotelDraft, q: e.target.value })}
                placeholder="留空則用名稱搜尋"
              />
            </div>
            <div className="settings-date-row">
              <div className="field">
                <label>入住日期</label>
                <input
                  className="input"
                  type="date"
                  value={hotelDraft.checkin}
                  onChange={(e) => setHotelDraft({ ...hotelDraft, checkin: e.target.value })}
                />
              </div>
              <div className="field">
                <label>退房日期</label>
                <input
                  className="input"
                  type="date"
                  value={hotelDraft.checkout}
                  onChange={(e) => setHotelDraft({ ...hotelDraft, checkout: e.target.value })}
                />
              </div>
            </div>
            <div className="settings-date-row">
              <div className="field">
                <label>緯度</label>
                <input
                  className="input"
                  inputMode="decimal"
                  value={hotelDraft.lat}
                  onChange={(e) => setHotelDraft({ ...hotelDraft, lat: e.target.value })}
                  placeholder="35.388"
                />
              </div>
              <div className="field">
                <label>經度</label>
                <input
                  className="input"
                  inputMode="decimal"
                  value={hotelDraft.lon}
                  onChange={(e) => setHotelDraft({ ...hotelDraft, lon: e.target.value })}
                  placeholder="136.941"
                />
              </div>
            </div>
            <p className="settings-hotel-latlon-hint">
              有填座標，行程頁的天氣才會查這間飯店入住期間的當地天氣（不填就那幾天沒有天氣資料）。
            </p>
            <div className="settings-hotel-edit-row">
              <button type="button" className="btn btn-secondary" onClick={() => setHotelDraft(null)}>
                取消
              </button>
              <button type="button" className="btn btn-primary" disabled={!hotelDraft.name.trim()} onClick={saveHotel}>
                儲存
              </button>
              {hotelDraft.id && (
                <button
                  type="button"
                  className="btn btn-secondary settings-hotel-del-btn"
                  onClick={removeHotel}
                  aria-label="刪除這間飯店"
                >
                  <Trash size={16} weight="duotone" />
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="settings-section">
        <div className="edit-section-label">記帳</div>
        <div className="field settings-rate-field" style={{ marginTop: 10 }}>
          <label>匯率 JPY→TWD</label>
          <input className="input" value={rate} onChange={(e) => setRate(e.target.value)} />
        </div>
      </div>

      <div className="settings-section">
        <div className="edit-section-label">通知</div>
        {isPushSupported() ? (
          <>
            <p className="settings-role-current">
              {pushEnabled ? '這台裝置已開啟行程提醒推播。' : '開啟後，有設提醒的行程會在時間到時推播通知到這台裝置。'}
            </p>
            <button
              type="button"
              className={`btn btn-block settings-push-btn${pushEnabled ? ' btn-secondary' : ' btn-primary'}`}
              disabled={pushBusy}
              onClick={handleTogglePush}
            >
              {pushEnabled ? (
                <>
                  <BellSlash size={16} weight="duotone" /> 關閉這台裝置的提醒推播
                </>
              ) : (
                <>
                  <BellRinging size={16} weight="duotone" /> 開啟行程提醒推播
                </>
              )}
            </button>
            {pushError && <p className="settings-push-error">{pushError}</p>}
            {pushEnabled && (
              <>
                <button
                  type="button"
                  className="btn btn-block btn-secondary settings-push-btn"
                  disabled={testPushBusy}
                  onClick={handleTestPush}
                >
                  {testPushBusy ? '發送中…' : '測試推播'}
                </button>
                {testPushError && <p className="settings-push-error">{testPushError}</p>}
                {testPushSent && <p className="settings-role-current">已送出，稍等一下看看有沒有收到通知。</p>}
              </>
            )}
            <p className="settings-hero-photo-hint">
              iPhone 上要先把這個網站「加入主畫面」、從主畫面圖示打開才收得到通知，一般瀏覽器分頁收不到。
            </p>
          </>
        ) : (
          <p className="settings-hero-photo-hint">這個瀏覽器不支援推播通知。</p>
        )}
      </div>

      <div className="settings-section">
        <div className="edit-section-label">身分</div>
        <p className="settings-role-current">目前身分：{role}</p>
        <div className="settings-role-row">
          <button type="button" className="btn btn-secondary settings-role-btn" onClick={handleSwitchRole}>
            <UserSwitch size={16} weight="duotone" /> 切換身分
          </button>
          <button
            type="button"
            className="btn btn-secondary settings-role-btn settings-role-logout"
            onClick={handleLogout}
          >
            <SignOut size={16} weight="duotone" /> 登出
          </button>
        </div>
      </div>

      <div className="settings-section">
        <div className="edit-section-label">版本</div>
        <p className="settings-role-current">
          目前版本 {__GIT_HASH__}
          {hasUpdate && <span className="settings-version-badge">有新版本</span>}
        </p>
        {hasUpdate && (
          <button
            type="button"
            className="btn btn-block btn-primary settings-push-btn"
            disabled={updating}
            onClick={handleUpdateNow}
          >
            {updating ? '更新中…' : `更新到 ${remoteCommit}`}
          </button>
        )}
      </div>
    </div>
  )
}
