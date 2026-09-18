// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { errorText, i18n, initializeLocale, LocalizedError, readLocale, t } from './i18n'
import { ApiError } from './lib/api'
import en from './locales/en.json'
import zhCN from './locales/zh-CN.json'

afterEach(() => { i18n.global.locale.value = 'en'; localStorage.clear(); vi.restoreAllMocks() })

describe('English-first internationalization', () => {
  it('uses English without an explicit supported preference, regardless of browser language', () => {
    localStorage.clear()
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('zh-CN')
    expect(readLocale()).toBe('en')
    localStorage.setItem('weave.locale', 'unknown')
    expect(readLocale()).toBe('en')
    localStorage.setItem('weave.locale', 'zh-CN')
    expect(readLocale()).toBe('zh-CN')
  })
  it('updates document language and saved preference without touching the session', async () => {
    sessionStorage.setItem('weave.session', 'unchanged')
    const stop = initializeLocale()
    try {
      expect(document.documentElement.lang).toBe('en')
      i18n.global.locale.value = 'zh-CN'; await nextTick()
      expect(document.documentElement.lang).toBe('zh-CN')
      expect(document.title).toBe(zhCN.brandTitle)
      expect(localStorage.getItem('weave.locale')).toBe('zh-CN')
      expect(sessionStorage.getItem('weave.session')).toBe('unchanged')
    } finally { stop() }
  })
  it('handles disabled local storage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Blocked') })
    expect(readLocale()).toBe('en')
    expect(() => { const stop = initializeLocale(); stop() }).not.toThrow()
  })
  it('keeps catalogs complete and compiles every translation including interpolations', () => {
    expect(Object.keys(zhCN).sort()).toEqual(Object.keys(en).sort())
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    for (const locale of ['en', 'zh-CN'] as const) {
      i18n.global.locale.value = locale
      for (const key of Object.keys(en)) {
        expect(t(key, { name: 'Alice', account: '@alice', filters: 'Filter', count: 2, status: 500 })).not.toBe(key)
      }
    }
    expect(warn).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled()
  })
  it('retranslates existing client errors while preserving server details', () => {
    const error = new LocalizedError('authExpired')
    const limited = new ApiError(429, '')
    expect(errorText(error)).toBe(en.authExpired)
    i18n.global.locale.value = 'zh-CN'
    expect(errorText(error)).toBe(zhCN.authExpired)
    expect(errorText(limited)).toBe(zhCN.rateLimited)
    expect(errorText(new ApiError(403, 'Upstream policy explanation'))).toBe('Upstream policy explanation')
  })
})
