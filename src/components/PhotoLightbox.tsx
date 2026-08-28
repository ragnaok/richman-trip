import { X } from '@phosphor-icons/react'

/**
 * 照片全螢幕放大檢視（目前只有 PlanPhotoCarousel 會開）：看的是原圖，不套 CMYK
 * 印刷效果。由 store.ui.photoLightbox 控制，在 App.tsx 頂層渲染。
 */
export default function PhotoLightbox({
  src,
  alt,
  onClose,
}: {
  src: string
  alt: string
  onClose: () => void
}) {
  return (
    <div className="photo-lightbox" onClick={onClose}>
      <button type="button" className="btn btn-secondary btn-icon photo-lightbox-close" onClick={onClose} aria-label="關閉">
        <X size={18} weight="duotone" />
      </button>
      <img className="photo-lightbox-img" src={src} alt={alt} />
    </div>
  )
}
