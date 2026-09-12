// 圖片上傳共用邏輯。沒有 R2／上傳端點，直接壓成 base64 data URL 存進 D1 的 TEXT
// 欄位（景點照片 spots_meta.photo / plans.photo、設定頁的 heroPhoto/favicon/icon
// 等）。canvas 縮圖是為了避免手機原圖（常見 5–10MB）把欄位跟同步 payload 撐爆。

const MAX_DIMENSION = 1200
const JPEG_QUALITY = 0.82

/** 讀取使用者選的圖片檔案，縮圖＋壓縮後回傳 JPEG data URL。 */
export function fileToResizedDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const objectUrl = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(objectUrl)
      const scale = Math.min(1, MAX_DIMENSION / Math.max(img.width, img.height))
      const w = Math.round(img.width * scale)
      const h = Math.round(img.height * scale)
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('無法建立畫布'))
        return
      }
      ctx.drawImage(img, 0, 0, w, h)
      resolve(canvas.toDataURL('image/jpeg', JPEG_QUALITY))
    }
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('圖片讀取失敗'))
    }
    img.src = objectUrl
  })
}

/** 讀取使用者選的圖片檔案，置中裁成正方形縮圖後回傳 PNG data URL——favicon／PWA
 * icon 用，跟上面的 fileToResizedDataUrl 分開：這裡要正方形尺寸（icon 才不會被
 * 拉伸變形）、輸出 PNG（保留透明背景，JPEG 沒有 alpha channel）。 */
export function fileToSquareIconDataUrl(file: File, size: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const objectUrl = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(objectUrl)
      const side = Math.min(img.width, img.height)
      const sx = (img.width - side) / 2
      const sy = (img.height - side) / 2
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('無法建立畫布'))
        return
      }
      ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size)
      resolve(canvas.toDataURL('image/png'))
    }
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('圖片讀取失敗'))
    }
    img.src = objectUrl
  })
}
