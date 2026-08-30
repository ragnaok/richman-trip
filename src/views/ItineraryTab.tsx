import { useMemo } from 'react'
import { BellRinging, CaretRight, Bed } from '@phosphor-icons/react'
import { useStore, useTripDayRange, useHotels } from '../lib/store'
import { sortPlans, formatMastheadDate, todayKey, mdToIso } from '../lib/time'
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
  const realToday = todayKey()

  const dayPlans = useMemo(
    () => sortPlans(plans.filter((p) => p.day === day && p.deleted !== 1)),
    [plans, day],
  )

  // 「下一站」用簡化邏輯：今天顯示第 2 筆、其他日顯示第 1 筆，不做真正的時間比對。
  // 「今天」以裝置真實日期（realToday）判斷。
  const nextIndex = day === realToday ? 1 : 0
  const nextPlan = dayPlans[nextIndex] ?? dayPlans[dayPlans.length - 1]

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

      <div className="itin-plans">
        {dayPlans.map((p) => {
          const [icon, color] = KIND[p.k]
          const Icon = phosphorIcon(icon)
          return (
            <div
              key={p.id}
              className="itin-plan-row"
              role="button"
              tabIndex={0}
              onClick={() => openDetail(day, p.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') openDetail(day, p.id)
              }}
            >
              <div className={`itin-plan-time${p.t === NA ? ' is-na' : ''}`}>{p.t}</div>
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
