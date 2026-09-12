// 免認證（不在 functions/api/ 底下，不受 _middleware.ts 管）。詳見 _lib/serveIcon.ts。
import type { Env } from './api/_lib/env'
import { serveIcon } from './_lib/serveIcon'

export const onRequestGet: PagesFunction<Env> = (context) => serveIcon(context, 'icon512', '/default-icon-512.png')
