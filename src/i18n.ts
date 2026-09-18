import { watch } from 'vue'
import { createI18n } from 'vue-i18n'
import en from './locales/en.json'
import zhCN from './locales/zh-CN.json'

export type MessageKey = keyof typeof en
export type Locale = 'en' | 'zh-CN'
const translated: Record<MessageKey, string> = zhCN
export const i18n = createI18n({
  legacy: false,
  locale: 'en' as Locale,
  fallbackLocale: 'en',
  messages: { en, 'zh-CN': translated },
})

// Non-component API/auth errors use the same catalog as the interface.
export const t = i18n.global.t
export class LocalizedError extends Error {
  constructor(public messageKey: MessageKey, public params: Record<string, string | number> = {}) { super() }
  override get message() { return t(this.messageKey, this.params) }
}

export function errorText(error: string | Error): string {
  if (error instanceof LocalizedError) return error.message
  return error instanceof Error ? error.message : error
}
export function readLocale(): Locale {
  try { return localStorage.getItem('weave.locale') === 'zh-CN' ? 'zh-CN' : 'en' }
  catch { return 'en' }
}

export function initializeLocale(preserveMetadata = false) {
  i18n.global.locale.value = readLocale()
  return watch(i18n.global.locale, value => {
    document.documentElement.lang = value
    if (!preserveMetadata) {
      document.title = t('brandTitle')
      document.querySelector('meta[name="description"]')?.setAttribute('content', t('pageDescription'))
    }
    try { localStorage.setItem('weave.locale', value) } catch { /* Language switching still works without storage. */ }
  }, { immediate: true })
}
