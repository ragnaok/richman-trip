import { ArrowLeft, CaretRight, BellRinging } from '@phosphor-icons/react'
import { useStore, useAllSpots } from '../lib/store'
import { navUrl } from '../lib/nav'
import { linkifyText } from '../lib/linkify'
import { sortPlans } from '../lib/time'
import { phosphorIcon } from '../lib/icons'
import { DAYINFO, KIND, NA, findSpot, findSpotForPlan } from '../data/spots'
import Toast, { useToast } from '../components/Toast'
import SpotInfo from '../components/SpotInfo'
import PlanPhotoCarousel, { type PlanPhotoSlide } from '../components/PlanPhotoCarousel'

/**
 * 行程資訊頁：點行程列開啟的全螢幕覆蓋層，ui.detail 有值時由 App.tsx 渲染。
 * swipeX/swipeDragging 是左緣滑動返回的即時位移，只有這頁在最上層時才非 0。
 */
export default function PlanDetail({
  swipeX = 0,
  swipeDragging = false,
}: {
  swipeX?: number
  swipeDragging?: boolean
}) {
  const detail = useStore((s) => s.ui.detail)
  const plans = useStore((s) => s.entities.plans)
  const closeDetail = useStore((s) => s.closeDetail)
  const openDetail = useStore((s) => s.openDetail)
  const setEdit = useStore((s) => s.setEdit)
  const upsertPlan = useStore((s) => s.upsertPlan)
  const deletePlan = useStore((s) => s.deletePlan)

  const { toast, showToast } = useToast()
  const allSpots = useAllSpots()
  const spotsMeta = useStore((s) => s.entities.spotsMeta)

  if (!detail) return null
  // 只用 id 比對：行程可能被編輯改到別天，這時 detail.day 是開啟當下的舊值，
  // 拿來比對會找不到這筆、整頁變空白。
  const plan = plans.find((p) => p.id === detail.id && p.deleted !== 1)
  if (!plan) return null

  const dayInfo = DAYINFO.find((d) => d.d === plan.day)
  const [, , kindLabel] = KIND[plan.k]
  // 未定項目（cands 還沒選定）不做模糊比對：標題常是概稱，容易誤中某個候選景點的
  // 名字子字串。等使用者選定後 cands 清空、spot 寫死，下次渲染才走明確比對。
  const spot = plan.cands && plan.cands.length > 0 ? undefined : findSpotForPlan(allSpots, plan)

  // 行程自己的照片＋連結景點的照片，兩者都有就左右滑切換。種子的「真實」景點固定有
  // 內建大圖，其餘要看使用者有沒有上傳（spotsMeta.photo，跟景點頁同一份）。
  const spotPhoto = spot ? spotsMeta[spot.id]?.photo : undefined
  const spotSlide: PlanPhotoSlide | undefined = spot?.real
    ? { src: '/hero-photo.jpg', alt: spot.name, cmyk: true }
    : spotPhoto
      ? { src: spotPhoto, alt: spot?.name ?? '' }
      : undefined
  const ownSlide: PlanPhotoSlide | undefined = plan.photo ? { src: plan.photo, alt: plan.title } : undefined

  const sameDayPlans = sortPlans(plans.filter((p) => p.day === plan.day && p.deleted !== 1))

  const handleSelectCandidate = (candSpot: NonNullable<ReturnType<typeof findSpot>>) => {
    const { cands: _cands, updated_at: _updatedAt, deleted: _deleted, ...rest } = plan
    upsertPlan({
      ...rest,
      title: candSpot.name,
      sub: candSpot.teaser,
      q: candSpot.q,
      spot: candSpot.id,
    })
    showToast(`已選擇 ${candSpot.name}`)
  }

  const handleDelete = () => {
    if (!window.confirm(`刪除「${plan.title}」這筆行程？`)) return
    const title = plan.title
    deletePlan(plan.id)
    closeDetail()
    showToast(`已刪除行程 · ${title}`)
  }

  return (
    <div
      className="detail-page"
      style={{
        transform: `translateX(${swipeX}px)`,
        transition: swipeDragging ? 'none' : 'transform 220ms ease-out',
      }}
    >
      <button type="button" className="btn btn-secondary btn-icon detail-back" onClick={closeDetail}>
        <ArrowLeft size={18} weight="duotone" />
      </button>

      <div className="detail-header">
        <div className="detail-header-row">
          <span className={`detail-time${plan.t === NA ? ' is-na' : ''}`}>{plan.t}</span>
          <span className="tag tag-neutral">{kindLabel}</span>
        </div>
        <h2 className="detail-title">{plan.title}</h2>
        <p className="detail-kicker">
          {plan.day} {dayInfo?.wd ?? ''}
        </p>
      </div>

      <p className="detail-note">{plan.sub ? linkifyText(plan.sub) : '還沒有備註 · 點編輯補上'}</p>

      {plan.notify !== undefined && (
        <p className="detail-notify">
          {plan.notify
            ? plan.remindAt
              ? `${plan.remindAt.replace('T', ' ')}　提醒`
              : `出發前 ${plan.lead ?? 30} 分鐘　提醒`
            : '未設定提醒'}
        </p>
      )}

      {(plan.drive || plan.park) && (
        <div className="detail-drive-grid">
          {plan.drive && (
            <div>
              <div className="detail-grid-label">車程</div>
              <div className="detail-grid-value">{plan.drive}</div>
            </div>
          )}
          {plan.park && (
            <div>
              <div className="detail-grid-label">停車</div>
              <div className="detail-grid-value">{plan.park}</div>
            </div>
          )}
        </div>
      )}

      <div className="detail-actions">
        <a
          className="btn btn-primary"
          href={navUrl(plan.q || plan.title)}
          target="_blank"
          rel="noreferrer"
        >
          Google Maps
        </a>
        <button type="button" className="btn btn-secondary" onClick={() => setEdit({ ...plan })}>
          編輯此行程
        </button>
      </div>

      {plan.cands && plan.cands.length > 0 && (
        <div className="detail-section">
          <div className="detail-kicker-label">候選景點 · 選一個填進這格</div>
          {plan.cands.map((candId) => {
            const candSpot = findSpot(allSpots, candId)
            if (!candSpot) return null
            return (
              <div key={candId} className="detail-cand-row">
                <div className="detail-cand-body">
                  <div className="detail-cand-title">{candSpot.name}</div>
                  <div className="detail-cand-teaser">{candSpot.teaser}</div>
                </div>
                <button type="button" className="btn btn-secondary" onClick={() => handleSelectCandidate(candSpot)}>
                  選這個
                </button>
              </div>
            )
          })}
        </div>
      )}

      {(ownSlide || spotSlide) && (
        <PlanPhotoCarousel resetKey={plan.id} ownPhoto={ownSlide} spotPhoto={spotSlide} />
      )}

      {spot && (
        <div className="detail-section">
          <SpotInfo spot={spot} />
        </div>
      )}

      {sameDayPlans.length > 1 && (
        <div className="detail-section">
          <div className="detail-kicker-label">同一天</div>
          {sameDayPlans.map((p) => {
            const [icon] = KIND[p.k]
            const Icon = phosphorIcon(icon)
            const isCurrent = p.id === plan.id
            return (
              <button
                key={p.id}
                type="button"
                className={`detail-sameday-row${isCurrent ? '' : ' is-dim'}`}
                onClick={() => openDetail(plan.day, p.id)}
              >
                <span className="detail-sameday-time">{p.t}</span>
                {Icon && <Icon size={16} weight="duotone" />}
                <span className="detail-sameday-title">{p.title}</span>
                {p.notify && <BellRinging size={13} weight="duotone" color="var(--color-accent-700)" />}
                <CaretRight size={12} weight="bold" className="detail-sameday-caret" />
              </button>
            )
          })}
        </div>
      )}

      <button type="button" className="btn btn-secondary btn-block detail-delete-btn" onClick={handleDelete}>
        刪除這個行程
      </button>

      {toast && <Toast message={toast.message} />}
    </div>
  )
}
