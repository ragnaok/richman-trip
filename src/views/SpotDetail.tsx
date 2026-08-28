import { ArrowLeft, CalendarPlus, NavigationArrow, Check, PencilSimple } from '@phosphor-icons/react'
import { useStore, useAllSpots } from '../lib/store'
import { navUrl } from '../lib/nav'
import { genId } from '../lib/id'
import { findSpot } from '../data/spots'
import SpotInfo, { useSpotVisited } from '../components/SpotInfo'
import PhotoUpload from '../components/PhotoUpload'

/**
 * 景點詳情頁，由 App.tsx 依 ui.spot 是否有值渲染（行程頁「景點」按鈕也是設 ui.spot
 * 進來的）。
 * 已去過／加入行程／Google Maps 是同一列的三個 chip，放在簡介之後、營業時間 grid 之前。
 * swipeX/swipeDragging 是左緣滑動返回的即時位移，只有這頁在最上層時才非 0。
 */
export default function SpotDetail({
  swipeX = 0,
  swipeDragging = false,
}: {
  swipeX?: number
  swipeDragging?: boolean
}) {
  const spotId = useStore((s) => s.ui.spot)
  const day = useStore((s) => s.ui.day)
  const closeSpot = useStore((s) => s.closeSpot)
  const setEdit = useStore((s) => s.setEdit)
  const openSpotEditor = useStore((s) => s.openSpotEditor)
  const meta = useStore((s) => s.entities.spotsMeta[spotId ?? ''])
  const upsertSpotMeta = useStore((s) => s.upsertSpotMeta)

  const allSpots = useAllSpots()
  const spot = findSpot(allSpots, spotId ?? undefined)
  const { visited, toggle: toggleVisited } = useSpotVisited(spot?.id ?? '')
  if (!spot) return null

  const hasCustomPhoto = Boolean(meta?.photo)
  const handlePhotoChange = (dataUrl: string) => upsertSpotMeta({ id: spot.id, photo: dataUrl })

  // 「加入行程」不代替使用者決定插入哪個時段：只開行程編輯面板並預填 title/q/spot，
  // 時間由使用者自己選。
  const handleAddToItinerary = () => {
    setEdit({
      id: genId(),
      day,
      t: '',
      title: spot.name,
      sub: spot.teaser,
      k: 's',
      q: spot.q,
      spot: spot.id,
    })
  }

  // 沒有照片時整個 hero 區塊隱藏、不留占位框，返回鈕改用非疊圖樣式；
  // 上傳照片後才出現大圖 + 編輯鉛筆。
  return (
    <div
      className="detail-page"
      style={{
        transform: `translateX(${swipeX}px)`,
        transition: swipeDragging ? 'none' : 'transform 220ms ease-out',
      }}
    >
      {spot.real ? (
        <div className="spot-detail-hero">
          <figure className="cmyk spot-cmyk">
            <img src="/hero-photo.jpg" alt={spot.name} />
            <img src="/hero-photo.jpg" className="sep-c" alt="" aria-hidden="true" />
            <img src="/hero-photo.jpg" className="sep-m" alt="" aria-hidden="true" />
            <img src="/hero-photo.jpg" className="sep-y" alt="" aria-hidden="true" />
            <img src="/hero-photo.jpg" className="sep-k" alt="" aria-hidden="true" />
          </figure>
          <button type="button" className="btn btn-secondary btn-icon spot-detail-back" onClick={closeSpot}>
            <ArrowLeft size={18} weight="duotone" />
          </button>
        </div>
      ) : hasCustomPhoto ? (
        <div className="spot-detail-hero">
          <PhotoUpload className="spot-detail-photo" photo={meta?.photo} alt={spot.name} onChange={handlePhotoChange} />
          <button type="button" className="btn btn-secondary btn-icon spot-detail-back" onClick={closeSpot}>
            <ArrowLeft size={18} weight="duotone" />
          </button>
        </div>
      ) : (
        <button type="button" className="btn btn-secondary btn-icon detail-back" onClick={closeSpot}>
          <ArrowLeft size={18} weight="duotone" />
        </button>
      )}

      <div className="spot-detail-body">
        <div className="detail-kicker-label spot-detail-area">{spot.area}</div>
        <h2 className="spot-detail-title">{spot.name}</h2>
        <p className="spot-detail-jp">{spot.jp}</p>
        <p className="detail-spot-intro spot-detail-intro">{spot.intro}</p>

        {!spot.real && !hasCustomPhoto && (
          <PhotoUpload
            className="spot-detail-photo-add"
            alt={spot.name}
            emptyLabel="新增照片"
            onChange={handlePhotoChange}
          />
        )}

        <div className="spot-detail-actions">
          <button
            type="button"
            className={`btn ${visited ? 'btn-primary' : 'btn-secondary'} spot-detail-action-btn`}
            onClick={toggleVisited}
          >
            <Check size={15} weight="duotone" />
            {visited ? '已去過' : '標記已去過'}
          </button>
          <button type="button" className="btn btn-secondary spot-detail-action-btn" onClick={handleAddToItinerary}>
            <CalendarPlus size={15} weight="duotone" />
            加入行程
          </button>
          <a
            className="btn btn-secondary spot-detail-action-btn"
            href={navUrl(spot.q)}
            target="_blank"
            rel="noreferrer"
          >
            <NavigationArrow size={15} weight="duotone" />
            Google Maps
          </a>
          <button
            type="button"
            className="btn btn-secondary spot-detail-action-btn"
            onClick={() => openSpotEditor(spot.id)}
          >
            <PencilSimple size={15} weight="duotone" />
            編輯
          </button>
        </div>

        <SpotInfo spot={spot} variant="page" />
      </div>
    </div>
  )
}
