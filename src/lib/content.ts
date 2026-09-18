import DOMPurify from 'dompurify'
import { safeUrl } from './api'
import type { Emoji } from './types'

export function sanitizeContent(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p', 'br', 'a', 'span', 'strong', 'em', 'b', 'i', 'u', 's', 'del', 'blockquote', 'pre', 'code', 'ul', 'ol', 'li'],
    ALLOWED_ATTR: ['href', 'title', 'class', 'rel'],
    ALLOW_DATA_ATTR: false,
    ALLOWED_URI_REGEXP: /^https?:\/\//i,
  })
}

export function renderContent(html: string, emojis: Emoji[] = []): string {
  const clean = sanitizeContent(html)
  if (!emojis.length) return clean
  const template = document.createElement('template')
  template.innerHTML = clean
  const lookup = new Map(emojis.map(emoji => [emoji.shortcode, emoji]))
  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  while (walker.nextNode()) nodes.push(walker.currentNode as Text)
  for (const node of nodes) {
    if (node.parentElement?.closest('code, pre')) continue
    const parts = node.data.split(/(:[a-zA-Z0-9_]+:)/g)
    if (parts.length === 1) continue
    const fragment = document.createDocumentFragment()
    for (const part of parts) {
      const emoji = lookup.get(part.slice(1, -1))
      const url = emoji && part.startsWith(':') && part.endsWith(':') ? safeUrl(emoji.static_url) : undefined
      if (!url) { fragment.append(document.createTextNode(part)); continue }
      const img = document.createElement('img')
      img.src = url; img.alt = part; img.className = 'custom-emoji'; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer'
      fragment.append(img)
    }
    node.replaceWith(fragment)
  }
  return template.innerHTML
}

// Server-side validation is authoritative (URL shortening and Unicode counting differ).
export function approximateLength(text: string, spoiler: string, reserved = 23): number {
  return Array.from(`${spoiler}${text}`.replace(/https?:\/\/[^\s]+/g, match => 'x'.repeat(Math.min(Array.from(match).length, reserved)))).length
}
