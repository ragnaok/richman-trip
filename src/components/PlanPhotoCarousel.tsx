import { useRef, useState } from 'react'
import { useStore } from '../lib/store'

export interface PlanPhotoSlide {
  src: string
  alt: string
  /** 種子的「真實」景點縮圖要套 CMYK 印刷效果；放大看的仍是 src 原圖，不套效果。 */
  cmyk?: boolean
}

/**
 * 行程資訊頁的照片區塊：行程自己的照片＋連結景點的照片，兩者都有時左右滑動切換
 * （含下方圓點），只有一張就單張顯示，都沒有則整塊不渲染。點縮圖（非滑動）開放大檢視。
 * resetKey（通常是行程 id）改變時索引歸零，免得切到另一筆行程還停在第二張。
 */
export default function PlanPhotoCarousel({
  resetKey,
  ownPhoto,
  spotPhoto,
}: {
  resetKey: string | number
  ownPhoto?: PlanPhotoSlide
  spotPhoto?: PlanPhotoSlide
}) {
  const openPhotoLightbox = useStore((s) => s.openPhotoLightbox)
  const [idx, setIdx] = useState(0)
  const [activeKey, setActiveKey] = useState(resetKey)
  if (activeKey !== resetKey) {
    setActiveKey(resetKey)
    setIdx(0)
  }

  const touchX = useRef<number | null>(null)
  // 用來分辨「點一下」跟「滑動切換」：滑動途中觸發的 click 不該再彈出放大檢視。
  const dragged = useRef(false)

  const renderSlide = (slide: PlanPhotoSlide) => (
    <button
      type="button"
      className="detail-photo-tap"
      onClick={() => {
        if (dragged.current) return
        openPhotoLightbox(slide.src, slide.alt)
      }}
    >
      {slide.cmyk ? (
        <figure className="cmyk">
          <img src={slide.src} alt={slide.alt} />
          <img src={slide.src} className="sep-c" alt="" aria-hidden="true" />
          <img src={slide.src} className="sep-m" alt="" aria-hidden="true" />
          <img src={slide.src} className="sep-y" alt="" aria-hidden="true" />
          <img src={slide.src} className="sep-k" alt="" aria-hidden="true" />
        </figure>
      ) : (
        <img src={slide.src} alt={slide.alt} />
      )}
    </button>
  )

  if (ownPhoto && spotPhoto) {
    return (
      <div className="detail-photo-carousel">
        <div
          className="detail-photo-track"
          style={{ transform: `translateX(-${idx * 100}%)` }}
          onTouchStart={(e) => {
            touchX.current = e.touches[0].clientX
            dragged.current = false
          }}
          onTouchMove={(e) => {
            if (touchX.current == null) return
            if (Math.abs(e.touches[0].clientX - touchX.current) > 10) dragged.current = true
          }}
          onTouchEnd={(e) => {
            const dx = e.changedTouches[0].clientX - (touchX.current ?? 0)
            if (dx < -40) setIdx((i) => Math.min(1, i + 1))
            else if (dx > 40) setIdx((i) => Math.max(0, i - 1))
          }}
        >
          <div className="detail-photo-slide">{renderSlide(ownPhoto)}</div>
          <div className="detail-photo-slide">{renderSlide(spotPhoto)}</div>
        </div>
        <div className="detail-photo-dots">
          {[0, 1].map((i) => (
            <div key={i} className={`detail-photo-dot${idx === i ? ' is-active' : ''}`} />
          ))}
        </div>
      </div>
    )
  }

  const single = ownPhoto ?? spotPhoto
  if (single) return <div className="detail-photo-single">{renderSlide(single)}</div>
  return null
}
