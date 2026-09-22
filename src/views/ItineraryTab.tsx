import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { BellRinging, CaretRight, Bed, DotsSixVertical } from '@phosphor-icons/react'
import { useStore, useTripDayRange, useHotels } from '../lib/store'
import type { PlanItem } from '../lib/types'
import { sortPlans, tkey, formatMastheadDate, todayKey, mdToIso } from '../lib/time'
import { navUrl } from '../lib/nav'
import { linkifyText } from '../lib/linkify'
import { genId } from '../lib/id'
import { phosphorIcon } from '../lib/icons'
import { useWeather } from '../lib/useWeather'
import { refreshWeather } from '../lib/weather'
import { useMasthead } from '../lib/useMasthead'
import { refreshMasthead } from '../lib/geo'
import { usePullToRefresh } from '../lib/usePullToRefresh'
import { pull as syncPull, push as syncPush } from '../lib/sync'
import PullToRefresh from '../components/PullToRefresh'
import Toast, { useToast } from '../components/Toast'
import { DAYINFO, HOTELS, KIND, NA } from '../data/spots'

export default function ItineraryTab() {
  const day = useStore((s) => s.ui.day)
  const setDay = useStore((s) => s.setDay)
  const openDetail = useStore((s) => s.openDetail)
  const setEdit = useStore((s) => s.setEdit)
  const plans = useStore((s) => s.entities.plans)
  const reorderPlan = useStore((s) => s.reorderPlan)

  const { toast, showToast } = useToast()

  const tripStart = useStore((s) => s.entities.settings.tripStart)
  const heroPhoto = useStore((s) => s.entities.settings.heroPhoto)
  const hotels = useHotels()
  const tripDays = useTripDayRange()
  const knownDayInfo = DAYINFO.find((d) => d.d === day)
  const dayInfo = knownDayInfo ?? tripDays.find((d) => d.d === day) ?? tripDays[0]
  const weather = useWeather(day)
  const masthead = useMasthead()
  // 設定頁「住宿地點」優先，依入住/退房日期比對當天住哪一間。年份取 tripStart 的年份
  // （沒設定時退回 2026，跟 db.ts 種子化的常數一致）。
  const dayIso = mdToIso(day, tripStart?.slice(0, 4) ?? '2026')
  const storedHotel = hotels.find((h) => h.checkin && h.checkout && h.checkin <= dayIso && dayIso < h.checkout)
  const hotel = storedHotel ?? (knownDayInfo ? HOTELS[knownDayInfo.hotel] : undefined)

  // 每分鐘 tick 一次，讓「今天」「下一站」「現在幾點」隨真實時間推進——不能只靠同步
  // 輪詢觸發的重渲染，離線時 sync.ts 的 pull() 會直接 return，不會呼叫 hydrate()。
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])
  const realToday = todayKey(now)

  // 跨午夜自動把選中的 day chip 換到新的一天——但只在使用者原本就停在「今天」時才跟著
  // 換，手動選了別的日期就不要打斷他；換到的新日期要真的在行程範圍內才換，行程已經
  // 結束就維持現狀（跟 store.ts hydrate() 的 defaultDay 落地判斷一致）。
  const prevRealTodayRef = useRef(realToday)
  useEffect(() => {
    if (prevRealTodayRef.current !== realToday) {
      if (day === prevRealTodayRef.current && tripDays.some((d) => d.d === realToday)) {
        setDay(realToday)
      }
      prevRealTodayRef.current = realToday
    }
  }, [realToday, day, setDay, tripDays])

  const dayPlans = useMemo(
    () => sortPlans(plans.filter((p) => p.day === day && p.deleted !== 1)),
    [plans, day],
  )

  // 未定行程（t === NA）拖曳排序：手刻 pointer events，不用 HTML5 draggable——
  // 那組 API 在手機觸控上不會觸發，這支 App 只跑手機。drag 記幾件事：fromIndex（拖曳
  // 開始時的原始位置，固定不變，用來判斷哪些列該讓開）、overIndex（插入位置，對齊
  // dayPlans 的 index 空間，放開時才真的算新 order 並寫回）、rowHeight（拖曳開始時量
  // 到的列高，讓開的列要位移這個距離）、deltaY（手指移動的距離，直接拿來 translateY
  // 讓被拖的列跟著手指走，不然只有一條插入線在動，使用者會覺得「東西沒有真的被拿
  // 起來」，回饋感很低）。
  const [drag, setDrag] = useState<{
    id: PlanItem['id']
    fromIndex: number
    overIndex: number
    rowHeight: number
    startY: number
    deltaY: number
  } | null>(null)
  const dragPointerRef = useRef<{ id: PlanItem['id']; pointerId: number } | null>(null)
  const plansListRef = useRef<HTMLDivElement>(null)

  // 長按滿 LONG_PRESS_MS 才真的進入拖曳模式，不然手指從把手上滑過想捲動頁面，會被
  // 誤判成拖曳（把手就卡在行程列表中間，手勢起點很容易剛好壓到）。pointerdown 當下
  // 只記錄起點、開一個計時器；等待期間手指移動超過門檻就視為使用者不是要長按，取消
  // 計時器、什麼都不做。計時器真的到點了才呼叫 armDrag 進入原本的拖曳邏輯。
  //
  // 注意：這個長按門檻只能防止「誤判成拖曳」，沒辦法順便讓等待期間可以正常捲動
  // 頁面——試過把把手的 touch-action 從 none 改成 pan-y 想讓等待期捲動照常運作，
  // 結果連長按到點後真的開始拖曳，瀏覽器都會把那個移動當成原生捲動接管走，
  // preventDefault 已經來不及擋（touch-action 是手指碰到那一刻就整段手勢鎖定的，
  // 中途沒辦法用 JS 切換）。所以把手還是 touch-action:none，手勢起點壓在這 48px
  // 寬的把手上時，就算沒到門檻放開，那次觸控也不會有捲動效果，只是不會誤觸拖曳。
  const LONG_PRESS_MS = 500
  const MOVE_CANCEL_PX = 10
  const pendingRef = useRef<{
    id: PlanItem['id']
    pointerId: number
    startX: number
    startY: number
    target: HTMLSpanElement
    timer: ReturnType<typeof setTimeout>
  } | null>(null)

  useEffect(() => () => clearTimeout(pendingRef.current?.timer), [])

  function armDrag(id: PlanItem['id'], pointerId: number, startY: number, target: HTMLSpanElement) {
    pendingRef.current = null
    dragPointerRef.current = { id, pointerId }
    const idx = dayPlans.findIndex((p) => p.id === id)
    const rowHeight = target.parentElement?.getBoundingClientRect().height ?? 0
    setDrag({ id, fromIndex: idx, overIndex: idx, rowHeight, startY, deltaY: 0 })
  }

  function handlePointerDown(e: ReactPointerEvent<HTMLSpanElement>, id: PlanItem['id']) {
    e.stopPropagation()
    // 立刻 capture 只是為了不管手指之後滑到哪裡，move/up 事件都還是會送到這個把手
    // 上，方便我們自己判斷「有沒有超過移動門檻」；把手是 touch-action:none，這次
    // 觸控本來就不會有原生捲動可言，capture 跟這件事無關。
    e.currentTarget.setPointerCapture(e.pointerId)
    const target = e.currentTarget
    const { pointerId, clientX: startX, clientY: startY } = e
    const timer = setTimeout(() => armDrag(id, pointerId, startY, target), LONG_PRESS_MS)
    pendingRef.current = { id, pointerId, startX, startY, target, timer }
  }

  function handleDragMove(e: ReactPointerEvent<HTMLSpanElement>) {
    const pending = pendingRef.current
    if (pending && pending.pointerId === e.pointerId) {
      const dx = e.clientX - pending.startX
      const dy = e.clientY - pending.startY
      if (Math.hypot(dx, dy) > MOVE_CANCEL_PX) {
        clearTimeout(pending.timer)
        pendingRef.current = null
      }
      return
    }
    const dragging = dragPointerRef.current
    const list = plansListRef.current
    if (!dragging || dragging.pointerId !== e.pointerId || !list) return
    e.preventDefault()
    const rows = Array.from(list.querySelectorAll<HTMLElement>('.itin-plan-row'))
    let overIndex = rows.length
    for (let i = 0; i < rows.length; i++) {
      // 跳過被拖的那一列自己：它現在用 translateY 跟著手指移動，rect 幾乎跟指標黏在
      // 一起，拿來當插入門檻會把插入點焊在原位附近，要用力拖過頭才會偶然跳掉，
      // 體感就是「要一直來回試」。門檻只該看不動的那些列。
      if (dayPlans[i]?.id === dragging.id) continue
      const rect = rows[i].getBoundingClientRect()
      if (e.clientY < rect.top + rect.height / 2) {
        overIndex = i
        break
      }
    }
    setDrag((d) => (d ? { ...d, overIndex, deltaY: e.clientY - d.startY } : d))
  }

  function handleDragEnd(e: ReactPointerEvent<HTMLSpanElement>) {
    const pending = pendingRef.current
    if (pending && pending.pointerId === e.pointerId) {
      // 長按門檻還沒到就放開了：純粹一次點擊或太快的滑動，根本沒進入拖曳模式，
      // 不用做任何事（沒 preventDefault 過，原生行為——含可能的捲動——照常發生）。
      clearTimeout(pending.timer)
      pendingRef.current = null
      return
    }
    const dragging = dragPointerRef.current
    if (!dragging || dragging.pointerId !== e.pointerId) return
    dragPointerRef.current = null
    // 手指放開的地方這時候多半已經不是把手，而是別筆行程的列（拖曳中手指移動到
    // 那邊去了）；瀏覽器會在 pointerup 後補一個 click 事件，目標是放開當下那個元素，
    // 不是把手，所以把手自己的 onClick stopPropagation 攔不到，會被當成「點開那筆
    // 行程」誤觸開詳情頁（iPhone 13 mini 實測會發生）。這裡直接把下一個 click 事件
    // 整個吃掉；400ms 內沒等到就自動解除，避免萬一沒有補 click 時卡住之後真正的點擊。
    const swallow = (ev: Event) => {
      ev.stopPropagation()
      ev.preventDefault()
    }
    document.addEventListener('click', swallow, { capture: true, once: true })
    setTimeout(() => document.removeEventListener('click', swallow, { capture: true }), 400)

    const finished = drag
    setDrag(null)
    if (!finished) return
    const fromIndex = dayPlans.findIndex((p) => p.id === finished.id)
    if (fromIndex === -1) return
    const rest = dayPlans.filter((p) => p.id !== finished.id)
    // overIndex 是含自己在內的原始陣列位置；移除自己後，落在自己原位之後的
    // 位置都要往前修正一格，才能對齊 rest 的 index 空間。
    const insertAt = Math.max(0, Math.min(fromIndex < finished.overIndex ? finished.overIndex - 1 : finished.overIndex, rest.length))
    const before = rest[insertAt - 1]
    const after = rest[insertAt]
    const newOrder = before && after ? (before.order + after.order) / 2 : before ? before.order + 1 : after ? after.order - 1 : 0
    if (newOrder !== dayPlans[fromIndex].order) reorderPlan(finished.id, newOrder)
  }

  // 「下一站」：今天用現在時間找第一筆還沒到的行程；其他天（過去／未來）維持顯示
  // 第一筆。今天但所有行程時間都過了 → nextPlan 是 undefined，顯示「今日行程已結束」
  // （下面 JSX），不再像以前退回最後一筆已過去的行程。
  const nowKey = tkey(`${now.getHours()}:${now.getMinutes()}`)
  const nextPlan = day === realToday ? dayPlans.find((p) => tkey(p.t) > nowKey) : dayPlans[0]
  const todayIsOver = day === realToday && dayPlans.length > 0 && !nextPlan

  const { containerRef, pull, status } = usePullToRefresh({
    // 重抓天氣與定位刊頭，兩者互不影響，任一失敗都各自走自己的 fallback 鏈；
    // 順便補一次雲端同步（pull+push），跟其他觸發點（App 開啟、回前景、online、輪詢）一致。
    onRefresh: async () => {
      await Promise.all([refreshWeather(), refreshMasthead(), syncPull().then(() => syncPush())])
    },
    onDone: () => showToast('已更新 · 天氣與所在位置'),
  })

  function handleAddPlan() {
    // 開一份草稿，交給 PlanEditSheet 渲染。
    setEdit({ id: genId(), day, t: '', title: '', sub: '', k: 's', q: '' })
  }

  const WeatherIcon = phosphorIcon(weather.icon)
  const dayHeaderText =
    day === realToday
      ? `今天 · ${day} · ${dayInfo.wd} · 共 ${dayPlans.length} 項`
      : `${day} · ${dayInfo.wd} · 共 ${dayPlans.length} 項`

  return (
    <div className="itin" ref={containerRef}>
      <PullToRefresh status={status} pull={pull} />

      <div className="itin-hero">
        <div className="itin-hero-photo">
          <img src={heroPhoto || '/hero-photo.jpg'} alt="行程主視覺" />
        </div>

        <div className="itin-masthead">
          <span>{masthead}</span>
          <span className="itin-masthead-date">{formatMastheadDate()}</span>
        </div>

        <div className="itin-weather">
          <div className="itin-weather-row">
            {WeatherIcon && (
              <WeatherIcon size={44} weight="duotone" color="var(--color-accent-700)" className="itin-weather-icon" />
            )}
            <div className="itin-weather-text">
              <h1 className="itin-weather-temp">{weather.temp}</h1>
              <div className="itin-weather-desc">{weather.desc}</div>
            </div>
          </div>
          <p className="itin-weather-hint">{weather.hint}</p>
        </div>
      </div>

      <div className="itin-days">
        {tripDays.map((d) => {
          const selected = d.d === day
          return (
            <button
              key={d.d}
              type="button"
              className={`itin-day-chip${selected ? ' is-selected' : ''}`}
              onClick={() => setDay(d.d)}
            >
              <div className="itin-day-chip-date">{d.d}</div>
              <div className="itin-day-chip-wd">
                {d.wd}
                {d.d === realToday ? ' ·今' : ''}
              </div>
            </button>
          )
        })}
      </div>

      <div className="itin-next">
        <div className="itin-next-kicker">下一站</div>
        <div className="itin-next-row">
          {nextPlan ? (
            <div
              className="itin-next-main"
              role="button"
              tabIndex={0}
              onClick={() => openDetail(day, nextPlan.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') openDetail(day, nextPlan.id)
              }}
            >
              <div className={`itin-next-time${nextPlan.t === NA ? ' is-na' : ''}`}>{nextPlan.t}</div>
              <div className="itin-next-body">
                <div className="itin-next-title">{nextPlan.title}</div>
                {nextPlan.sub && <div className="itin-next-sub">{linkifyText(nextPlan.sub)}</div>}
              </div>
            </div>
          ) : todayIsOver ? (
            <div className="itin-next-empty">
              <div className="itin-next-title">今日行程已結束</div>
              <div className="itin-next-sub">明天見！</div>
            </div>
          ) : (
            <div className="itin-next-empty">
              <div className="itin-next-title">尚無行程</div>
              <div className="itin-next-sub">點下方新增</div>
            </div>
          )}
          {hotel && (
            <a
              className="btn btn-secondary btn-icon itin-hotel-nav-btn"
              href={navUrl(hotel.q)}
              target="_blank"
              rel="noreferrer"
              aria-label={`返回飯店 · 導航至 ${hotel.name}`}
              title={`返回飯店 · 導航至 ${hotel.name}`}
            >
              <Bed size={22} weight="duotone" />
            </a>
          )}
        </div>
      </div>

      <div className="itin-day-header">
        <span>{dayHeaderText}</span>
        <span className="itin-day-header-hint">點一下可編輯</span>
      </div>

      <div className="itin-plans" ref={plansListRef}>
        {dayPlans.map((p, i) => {
          const [icon, color] = KIND[p.k]
          const Icon = phosphorIcon(icon)
          const untimed = p.t === NA
          const isDragged = drag?.id === p.id
          // 佔位高度跟著拖曳位置移動：被拖的列自己用 translateY 跟手指走（見上），
          // 其餘列依「會不會被插入點跨過」讓開一個 rowHeight 的空間，體感才像有
          // 真的空間在移動，不是只有一條線在動。
          let shift = 0
          if (drag && !isDragged) {
            if (drag.fromIndex < drag.overIndex && i > drag.fromIndex && i < drag.overIndex) shift = -drag.rowHeight
            else if (drag.overIndex <= drag.fromIndex && i >= drag.overIndex && i < drag.fromIndex) shift = drag.rowHeight
          }
          return (
            <div
              key={p.id}
              className={`itin-plan-row${isDragged ? ' is-dragging' : ''}`}
              style={
                isDragged && drag
                  ? { transform: `translateY(${drag.deltaY}px) scale(1.03)` }
                  : shift !== 0
                    ? { transform: `translateY(${shift}px)` }
                    : undefined
              }
              role="button"
              tabIndex={0}
              onClick={() => openDetail(day, p.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') openDetail(day, p.id)
              }}
            >
              {untimed ? (
                <span
                  className="itin-plan-drag-handle"
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => handlePointerDown(e, p.id)}
                  onPointerMove={handleDragMove}
                  onPointerUp={handleDragEnd}
                  onPointerCancel={handleDragEnd}
                >
                  <DotsSixVertical size={16} weight="bold" />
                </span>
              ) : (
                <div className="itin-plan-time">{p.t}</div>
              )}
              {Icon && <Icon size={19} weight="duotone" color={color} className="itin-plan-icon" />}
              <div className="itin-plan-body">
                <div className="itin-plan-title-row">
                  <span className="itin-plan-title">{p.title}</span>
                  {p.notify && <BellRinging size={13} weight="duotone" color="var(--color-accent-700)" />}
                </div>
                {p.sub && <div className="itin-plan-sub">{linkifyText(p.sub)}</div>}
                {(p.drive || p.park) && (
                  <div className="itin-plan-drive">
                    {p.drive && `車程 ${p.drive}`}
                    {p.drive && p.park && ' · '}
                    {p.park && `停車 ${p.park}`}
                  </div>
                )}
              </div>
              <CaretRight size={14} weight="bold" className="itin-plan-caret" />
            </div>
          )
        })}
      </div>

      <button type="button" className="btn btn-secondary btn-block itin-add" onClick={handleAddPlan}>
        ＋ 新增 {day} 行程
      </button>

      {toast && <Toast message={toast.message} />}
    </div>
  )
}
