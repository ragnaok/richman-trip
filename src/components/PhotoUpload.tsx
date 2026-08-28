import { useRef, useState } from 'react'
import { Camera, PencilSimple } from '@phosphor-icons/react'
import { fileToResizedDataUrl } from '../lib/imageUpload'

/**
 * 景點照片上傳。沒有照片時顯示「＋ 新增照片」占位按鈕，有照片時顯示照片本身並在
 * 右上角疊一顆編輯按鈕；兩種情境用 `photo` 有沒有值切換，不需要編輯模式開關。
 */
export default function PhotoUpload({
  photo,
  onChange,
  alt,
  className,
  emptyLabel = '新增照片',
}: {
  photo?: string
  onChange: (dataUrl: string) => void
  alt: string
  className?: string
  emptyLabel?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  const handlePick = (e: React.MouseEvent) => {
    e.stopPropagation()
    inputRef.current?.click()
  }

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // 允許同一個檔案再選一次也會觸發 onChange
    if (!file) return
    setUploading(true)
    try {
      const dataUrl = await fileToResizedDataUrl(file)
      onChange(dataUrl)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className={`photo-upload${className ? ` ${className}` : ''}`} onClick={(e) => e.stopPropagation()}>
      <input ref={inputRef} type="file" accept="image/*" className="photo-upload-input" onChange={handleFile} />
      {photo ? (
        <div className="photo-upload-filled">
          <img src={photo} alt={alt} />
          <button type="button" className="photo-upload-edit-btn" onClick={handlePick} aria-label="更換照片">
            <PencilSimple size={13} weight="duotone" />
          </button>
        </div>
      ) : (
        <button type="button" className="photo-upload-empty" onClick={handlePick} disabled={uploading}>
          <Camera size={20} weight="duotone" />
          <span>{uploading ? '上傳中…' : emptyLabel}</span>
        </button>
      )}
    </div>
  )
}
