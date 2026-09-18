import { expect, it } from 'vitest'
import type { App } from 'vue'

it('boots the real entry point with English as the unsaved default', async () => {
  localStorage.clear(); sessionStorage.clear()
  document.body.innerHTML = '<div id="app"></div>'
  await import('./main')
  await new Promise(resolve => setTimeout(resolve, 20))
  expect(document.documentElement.lang).toBe('en')
  expect(document.querySelector('#app')?.textContent).toContain('Start with a connection')
  const element = document.querySelector('#app') as HTMLElement & { __vue_app__: App }
  element.__vue_app__.unmount()
  document.body.innerHTML = ''
})
