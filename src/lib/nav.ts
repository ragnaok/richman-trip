// 導航連結：
// https://www.google.com/maps/search/?api=1&query=<encodeURIComponent(地點或標題)>
//
// 用 maps/search 而非 maps/dir：先開該地點的資訊頁（評論、照片、營業時間），
// 想去再自己按導航，不預設「一定要現在導航」。

/** 產生 Google Maps 地點連結（開資訊頁，不直接進導航模式）。query 是地點名稱或行程標題。 */
export function navUrl(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
}
