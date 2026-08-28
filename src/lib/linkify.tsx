import { Fragment, type ReactNode } from 'react'

const URL_RE = /https?:\/\/[^\s]+/g

export function containsUrl(text: string): boolean {
  return /https?:\/\//.test(text)
}
// 常見的中英文標點常常緊接在網址後面（句尾句號、括號…），這些不該算進網址本身。
const TRAILING_PUNCT_RE = /[)\]}.,;:!?，。！？、」』”]+$/

/** 把文字裡的 http(s) 網址換成可點擊的連結，其餘文字（含換行）原樣保留。 */
export function linkifyText(text: string): ReactNode[] {
  const parts = text.split(URL_RE)
  const urls = text.match(URL_RE) ?? []
  const nodes: ReactNode[] = []

  parts.forEach((part, i) => {
    if (part) nodes.push(part)
    const rawUrl = urls[i]
    if (!rawUrl) return
    const trailingMatch = rawUrl.match(TRAILING_PUNCT_RE)
    const trailing = trailingMatch ? trailingMatch[0] : ''
    const url = trailing ? rawUrl.slice(0, -trailing.length) : rawUrl
    nodes.push(
      <a key={i} href={url} target="_blank" rel="noreferrer" className="linkify-link" onClick={(e) => e.stopPropagation()}>
        {url}
      </a>,
    )
    if (trailing) nodes.push(trailing)
  })

  return nodes.map((node, i) => (typeof node === 'string' ? <Fragment key={`t${i}`}>{node}</Fragment> : node))
}
