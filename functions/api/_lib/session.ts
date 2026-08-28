// HMAC session cookie 簽章／驗證：payload = base64url(JSON {exp})，以 SESSION_SECRET
// 簽 HMAC-SHA256，cookie value 是 `<payload>.<hmac>`（前綴／屬性由呼叫端組）。
// cookie 只代表「通過密碼驗證」，不帶角色（角色是前端存 IndexedDB 的本地偏好）。

interface SessionPayload {
  exp: number // ms epoch
}

const MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000 // 180 天，跟 cookie 的 Max-Age=15552000 秒一致

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

/** 簽出 `<payload>.<hmac>` 字串（cookie value，不含 `sess=` 與屬性）。 */
export async function signSession(secret: string): Promise<string> {
  const payload: SessionPayload = { exp: Date.now() + MAX_AGE_MS }
  const payloadB64 = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)))
  const key = await hmacKey(secret)
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadB64))
  const sigB64 = toBase64Url(new Uint8Array(sig))
  return `${payloadB64}.${sigB64}`
}

/** 驗證 cookie value，回傳 payload 或 null（HMAC 不符／過期／格式錯誤）。 */
export async function verifySession(cookieValue: string, secret: string): Promise<SessionPayload | null> {
  const dot = cookieValue.lastIndexOf('.')
  if (dot === -1) return null
  const payloadB64 = cookieValue.slice(0, dot)
  const sigB64 = cookieValue.slice(dot + 1)

  try {
    const key = await hmacKey(secret)
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      fromBase64Url(sigB64),
      new TextEncoder().encode(payloadB64),
    )
    if (!valid) return null

    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(payloadB64))) as SessionPayload
    if (typeof payload.exp !== 'number' || Date.now() > payload.exp) return null
    return payload
  } catch {
    return null
  }
}

export const SESSION_COOKIE_NAME = 'sess'
export const SESSION_MAX_AGE_SECONDS = 15552000 // 180 天

/** 從 Cookie header 取出指定名稱的 cookie value。 */
export function getCookie(request: Request, name: string): string | null {
  const header = request.headers.get('Cookie')
  if (!header) return null
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    const key = part.slice(0, eq).trim()
    if (key === name) return part.slice(eq + 1).trim()
  }
  return null
}
