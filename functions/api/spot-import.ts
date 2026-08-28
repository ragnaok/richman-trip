// 「用 Gemini 帶入景點資訊」的後端。POST {name} → Gemini structured output（直接指定
// JSON schema）→ 回一筆 Spot 形狀的 JSON，前端只補使用者還沒填的欄位（SpotEditSheet）。
//
// 跟 /api/weather 同樣是「Pages Function 代理外部 API」：金鑰存 Secret、不進前端 bundle，
// 且不在 _middleware.ts 的公開白名單裡，需要登入。
//
// 代表圖不叫 Gemini 直接生網址（純文字模型只會捏出死連結），而是請它給「日文維基百科的
// 精準條目標題」，再用維基公開 REST API 查首圖；查不到就不回 photo，讓前端退回手動上傳。
import type { Env } from './_lib/env'

const MODEL = 'gemini-3.5-flash-lite' // 之後如果 Gemini 把這個模型名字換掉/退役，改這裡就好

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    name: { type: 'STRING' },
    jp: { type: 'STRING' },
    area: { type: 'STRING' },
    teaser: { type: 'STRING' },
    intro: { type: 'STRING' },
    hours: { type: 'STRING' },
    fee: { type: 'STRING' },
    access: { type: 'STRING' },
    q: { type: 'STRING' },
    wikipedia: { type: 'STRING' },
    walk: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { min: { type: 'STRING' }, text: { type: 'STRING' } },
        required: ['min', 'text'],
      },
    },
    food: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { name: { type: 'STRING' }, note: { type: 'STRING' }, address: { type: 'STRING' } },
        required: ['name', 'note', 'address'],
      },
    },
  },
  required: ['name', 'jp', 'area', 'teaser', 'intro', 'hours', 'fee', 'access', 'q', 'wikipedia', 'walk', 'food'],
}

// 地區不寫死：regionHint 來自設定頁的 settings.geminiRegionHint，換城市只要改設定。
// 沒填時用不預設任何地區的通用措辭——猜錯地區比措辭模糊更糟。
function buildPrompt(name: string, regionHint: string): string {
  const region = regionHint.trim()
  const intro = region
    ? `你是旅遊行程助理。使用者正在規劃${region}的自由行，
現在要新增一個景點條目，景點名稱是「${name}」（如果這個名字在${region}找不到
明確對應的地方，就以最接近、最合理的解讀回答，不要留白）。`
    : `你是旅遊行程助理。使用者正在規劃一趟日本自由行，
現在要新增一個景點條目，景點名稱是「${name}」。`
  return `${intro}

請用繁體中文（台灣用語）回答，只有「jp」這個欄位用日文原名。欄位說明：
- name：景點正式中文名稱
- jp：這個名字的日文讀音（ふりがな），漢字部分**用平假名**標音（不要直接照抄漢字），
  例如「熱田神宮」要給「あつたじんぐう」；如果名字
  本身含外來語，那部分維持片假名（例如「〜ミュージアム」「〜タワー」不要硬轉平假名），
  跟種子資料裡既有景點的 jp 欄位是同一種格式
- area：所在地區（例如「岐阜」「京都」）
- teaser：一句話介紹（15 字以內）
- intro：簡介，2–3 句話，講清楚這個地方是什麼、有什麼特色
- hours：營業時間（沒有固定營業時間就寫「無公休」或類似說明）
- fee：門票／費用（免費就寫「免費」）
- access：交通方式（怎麼從最近的車站/景點過去）
- q：適合拿去 Google Maps 搜尋的關鍵字（通常用日文原名最準）
- wikipedia：這個地點在「日文維基百科」（ja.wikipedia.org）上的精準條目標題（例如
  「熱田神宮」或「白鳥庭園 (名古屋市)」這種實際存在、可以直接查到頁面的標題格式，
  不要自己改寫或翻譯）；如果你不確定這個地點有沒有日文維基條目，就給你覺得最可能的標題，
  真的完全想不到就回空字串，不要瞎猜一個不存在的標題硬湊
- walk：從最近車站出發的簡易步行路線，2–4 個步驟，每步驟含累計分鐘數（min）與說明（text）
- food：附近 1–3 個美食推薦，含店名（name）、一句話備註（note）、地址（address，
  盡量給實際門牌地址；真的不確定就給最精確的位置描述，不要留空）

這些資訊可能會隨時間變動（營業時間、票價尤其如此），使用者會自己核對，你只要給出
合理、目前已知最新的參考資訊即可。`
}

interface GeminiPart {
  text?: string
}

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: GeminiPart[] } }>
}

interface WikipediaImageInfo {
  source?: string
  width?: number
}

interface WikipediaSummary {
  thumbnail?: WikipediaImageInfo
  originalimage?: WikipediaImageInfo
}

// app 最大顯示寬度 430px，3x 螢幕約 1290px。summary API 的 thumbnail 固定 330px（太糊），
// originalimage 又是完整原始檔（常 1500px+、好幾 MB），兩個都不直接用，改用 Wikimedia
// 縮圖服務指定寬度：把 thumbnail.source 網址裡的 `{寬度}px-` 數字換掉即可。
// 寬度只能填標準尺寸（20/40/60/120/250/330/500/960/1280/1920/3840），其他數字會被
// Varnish 回 400（詳見 mediawiki.org/wiki/Common_thumbnail_sizes）。960 是最合適的一檔。
const TARGET_WIDTH = 960

function resizeWikimediaThumb(thumb: WikipediaImageInfo): string | undefined {
  if (!thumb.source || !thumb.width) return thumb.source
  return thumb.source.replace(`/${thumb.width}px-`, `/${TARGET_WIDTH}px-`)
}

/** 查日文維基的公開 REST API（免金鑰）拿條目首圖。查不到／沒有配圖就回 undefined，
 * 呼叫端就不會帶著一個死連結——寧可沒有圖，不要有個打不開的圖。 */
async function lookupWikipediaImage(title: string): Promise<string | undefined> {
  if (!title.trim()) return undefined
  try {
    const res = await fetch(`https://ja.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`, {
      headers: {
        // Wikimedia 的 User-Agent policy 要求帶有意義的識別，沒帶可能被當成濫用擋掉。
        'user-agent': 'TripPWA/1.0 (personal 2-person travel app; Cloudflare Pages Function)',
      },
    })
    if (!res.ok) return undefined
    const data = (await res.json()) as WikipediaSummary
    if (data.thumbnail) return resizeWikimediaThumb(data.thumbnail)
    return data.originalimage?.source
  } catch {
    return undefined
  }
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context

  let body: { name?: unknown }
  try {
    body = await request.json()
  } catch {
    return jsonError(400, '請求格式錯誤')
  }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return jsonError(400, '請先填寫景點名稱')
  if (!env.GEMINI_API_KEY) return jsonError(500, '尚未設定 GEMINI_API_KEY')

  const regionRow = await env.DB.prepare("SELECT v FROM settings WHERE k = 'geminiRegionHint'").first<{ v: string }>()
  const regionHint = regionRow?.v ?? ''

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${env.GEMINI_API_KEY}`

  let geminiRes: Response
  try {
    geminiRes = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildPrompt(name, regionHint) }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
        },
      }),
    })
  } catch {
    return jsonError(502, '連不到 Gemini，稍後再試一次')
  }

  if (!geminiRes.ok) {
    return jsonError(502, `Gemini 回應錯誤（${geminiRes.status}）`)
  }

  let data: GeminiResponse
  try {
    data = await geminiRes.json()
  } catch {
    return jsonError(502, 'Gemini 回應格式錯誤')
  }

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) return jsonError(502, 'Gemini 沒有回傳內容')

  let spot: Record<string, unknown>
  try {
    spot = JSON.parse(text)
  } catch {
    return jsonError(502, 'Gemini 回傳的內容不是有效的 JSON')
  }

  const wikipediaTitle = typeof spot.wikipedia === 'string' ? spot.wikipedia : ''
  delete spot.wikipedia // 內部欄位，前端不需要知道維基標題，只需要最後解析出的圖片網址
  const photo = await lookupWikipediaImage(wikipediaTitle)
  if (photo) spot.photo = photo

  return new Response(JSON.stringify(spot), { status: 200, headers: { 'content-type': 'application/json' } })
}

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
