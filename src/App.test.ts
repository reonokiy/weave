import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App as VueApp } from 'vue'
import App from './App.vue'
import { i18n } from './i18n'
import { SCOPES } from './lib/auth'
import { posts, self } from '../tests/browser/fixture'

const streams = vi.hoisted(() => ({ events: undefined as undefined | ((type: string, payload: string) => void), stop: vi.fn() }))
vi.mock('./lib/stream', () => ({ connectStream: (_session: unknown, _local: boolean, events: typeof streams.events, state: (connected: boolean) => void) => { streams.events = events; state(true); return streams.stop } }))
let app: VueApp | undefined
afterEach(() => { app?.unmount(); document.body.innerHTML = ''; sessionStorage.clear(); i18n.global.locale.value = 'en'; vi.unstubAllGlobals(); vi.clearAllMocks() })
const settle = async () => { await new Promise(resolve => setTimeout(resolve, 20)); await nextTick() }
const button = (root: HTMLElement, name: string) => [...root.querySelectorAll('button')].find(item => (item.getAttribute('aria-label') ?? item.textContent?.trim()) === name)!
async function mount(fetcher: (url: URL, init: RequestInit) => Promise<Response>, scopes: string | null = SCOPES) {
  if (scopes !== null) sessionStorage.setItem('weave.session', JSON.stringify({ origin: 'https://social.example.org', token: 'token', client_id: 'app', client_secret: 'secret', scopes }))
  vi.stubGlobal('fetch', vi.fn(fetcher))
  const root = document.createElement('div'); document.body.append(root)
  app = createApp(App); app.use(i18n).mount(root); await settle()
  return root
}
async function standard(url: URL) {
  if (url.pathname.endsWith('/verify_credentials')) return Response.json(self)
  if (url.pathname.endsWith('/instance')) return Response.json({ title: 'Local garden', version: '0.21.0' })
  if (url.pathname.includes('/timelines/')) return Response.json(posts)
  return Response.json([])
}

describe('application lifecycle', () => {
  it('validates instance metadata and allows recovery after an invalid address', async () => {
    const root = await mount(async () => Response.json({ unexpected: true }), null)
    const input = root.querySelector<HTMLInputElement>('#instance')!
    input.value = 'http://not-local.example'; input.dispatchEvent(new Event('input'))
    root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true })); await settle()
    expect(root.textContent).toContain('Use an HTTPS instance address')
    input.value = 'https://social.example.org'; input.dispatchEvent(new Event('input'))
    root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true })); await settle()
    expect(root.textContent).toContain('did not return valid instance information')
    vi.stubGlobal('fetch', vi.fn(standard))
    root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true })); await settle()
    expect(button(root, 'Authorize on your instance')).toBeDefined()
    expect(root.textContent).toContain('Local garden')
  })
  it('preserves a usable account when metadata fails and deduplicates paginated posts', async () => {
    let local = false
    const root = await mount(async url => {
      if (url.pathname.endsWith('/instance')) return Response.json({ error: 'metadata offline' }, { status: 503 })
      if (url.pathname.includes('/timelines/')) {
        local ||= url.searchParams.get('local') === 'true'
        return Response.json(url.searchParams.has('max_id') ? [posts[0], { ...posts[1], id: 'older' }] : [posts[0]], { headers: url.searchParams.has('max_id') ? {} : { Link: `<${url.origin}${url.pathname}?max_id=post-1>; rel="next"` } })
      }
      return standard(url)
    })
    expect(root.querySelector('.draft-input')).not.toBeNull()
    button(root, 'Load earlier posts').click(); await settle()
    expect(root.querySelectorAll('.status-card')).toHaveLength(2)
    button(root, 'Local').click(); await settle(); expect(local).toBe(true)
    button(root, 'Search').click(); await settle(); expect(root.querySelector('#search')).not.toBeNull()
    button(root, 'Following').click(); await settle(); expect(root.querySelector('#search')).toBeNull()
  })
  it('clears expired credentials and returns to connection UI', async () => {
    const root = await mount(async () => Response.json({ error: 'expired' }, { status: 401 }))
    expect(sessionStorage.getItem('weave.session')).toBeNull()
    expect(root.textContent).toContain('Your session has expired')
    expect(root.querySelector('#instance')).not.toBeNull()
  })
  it('refreshes after a post, processes stream deletion, and tears down streams on sign-out', async () => {
    let published = false
    const root = await mount(async (url, init) => {
      if (url.pathname === '/api/v1/statuses' && init.method === 'POST') { published = true; return Response.json({ ...posts[2], id: 'new', content: '<p>New post</p>' }) }
      if (url.pathname.includes('/timelines/') && published) return Response.json([{ ...posts[2], id: 'new', content: '<p>New post</p>' }])
      if (url.pathname === '/oauth/revoke') return new Response(null, { status: 200 })
      return standard(url)
    })
    const draft = root.querySelector<HTMLTextAreaElement>('.draft-input')!; draft.value = 'New post'; draft.dispatchEvent(new Event('input'))
    root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true })); await settle()
    expect(root.querySelector('.status-card')?.textContent).toContain('New post')
    const live = root.querySelector<HTMLInputElement>('.live-control input')!; live.checked = true; live.dispatchEvent(new Event('change')); await settle()
    streams.events?.('update', '{}'); await settle()
    streams.events?.('delete', 'new'); await settle()
    expect(root.querySelector('.status-card')).toBeNull()
    button(root, 'Sign out').click(); await settle()
    expect(streams.stop).toHaveBeenCalled()
    expect(sessionStorage.getItem('weave.session')).toBeNull()
    expect(root.querySelector('#instance')).not.toBeNull()
  })
  it('gates older authorizations and keeps local logout effective when revocation fails', async () => {
    const root = await mount(async url => url.pathname === '/oauth/revoke' ? Response.json({ error: 'offline' }, { status: 503 }) : standard(url), 'read:accounts read:statuses write:statuses')
    expect(button(root, 'Search').disabled).toBe(true)
    button(root, 'Sign out').click(); await settle()
    expect(root.textContent).toContain('Token revocation failed')
    expect(sessionStorage.getItem('weave.session')).toBeNull()
  })
})
