// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, reactive, type App } from 'vue'
import ThreadView from './ThreadView.vue'
import { i18n } from '../i18n'
import type { Status } from '../lib/types'

let app: App | undefined
afterEach(() => { app?.unmount(); document.body.innerHTML = ''; i18n.global.locale.value = 'en'; vi.unstubAllGlobals() })
const post = (id: string): Status => ({
  id, account: { id: 'alice', username: 'alice', display_name: 'Alice', acct: 'alice@remote.test', avatar: '', url: '' },
  content: `<p>${id}</p>`, created_at: '2026-09-12T09:00:00Z', url: null,
  visibility: 'private', local_only: true, sensitive: true, spoiler_text: 'CW', media_attachments: [],
  reblog: null, replies_count: 0, favourites_count: 0, reblogs_count: 0,
  interaction_policy: { can_reply: { automatic_approval: ['author'], manual_approval: ['me'] } },
})
async function settle() { await new Promise(resolve => setTimeout(resolve, 10)); await nextTick() }
async function mount() {
  const props = reactive({ statusId: 'parent', session: { origin: 'https://social.example.org', token: 'token', client_id: 'client', client_secret: 'secret' }, account: { id: 'self', username: 'self', acct: 'self', display_name: '', avatar: '', url: '' }, instance: null })
  const root = document.createElement('div'); document.body.append(root)
  app = createApp({ render: () => h(ThreadView, props) }); app.use(i18n).mount(root); await settle()
  return { root, props }
}
function button(root: HTMLElement, text: string) {
  return Array.from(root.querySelectorAll('button')).find(item => item.textContent?.includes(text))!
}

describe('thread reply flow', () => {
  it('keeps readable detail when context fails and blocks leaving an unfinished reply', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: URL) => url.pathname.endsWith('/context') ? Response.json({ error: 'Conversation offline' }, { status: 503 }) : Response.json(post('readable'))))
    const { root } = await mount()
    expect(root.textContent).toContain('Conversation offline')
    button(root, 'Show content').click(); await nextTick()
    expect(root.textContent).toContain('readable')
    button(root, 'Request to reply').click(); await settle()
    button(root, 'Back to timeline').click(); await nextTick()
    expect(root.textContent).toContain(i18n.global.t('finishReplyBeforeBack'))
    button(root, 'Cancel').click(); await settle()
    expect(root.querySelector('.post-composer')).toBeNull()
  })
  it('reports unavailable detail without rendering reply controls', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: URL) => url.pathname.endsWith('/context') ? Response.json({ ancestors: [], descendants: [] }) : Response.json({ error: 'not found' }, { status: 404 })))
    const { root } = await mount()
    expect(root.textContent).toContain(i18n.global.t('postUnavailable'))
    expect(root.querySelector('.post-composer')).toBeNull()
  })
  it('switches interface language without losing a reply draft or changing server content', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: URL) => Response.json(url.pathname.endsWith('/context') ? { ancestors: [], descendants: [] } : post('parent'))))
    const { root } = await mount()
    button(root, 'Request to reply').click(); await settle()
    const draft = root.querySelector<HTMLTextAreaElement>('textarea')!
    draft.value = 'My unchanged reply'; draft.dispatchEvent(new Event('input')); await nextTick()
    i18n.global.locale.value = 'zh-CN'; await nextTick()
    expect(root.textContent).toContain('发送回复')
    expect(root.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('My unchanged reply')
    expect(root.querySelector<HTMLInputElement>('input[placeholder]')!.value).toBe('CW')
    i18n.global.locale.value = 'en'; await nextTick()
    expect(root.textContent).toContain('Send reply')
  })
  it('shows approval, keeps failed drafts and reuses the request key for an unchanged retry', async () => {
    const writes: RequestInit[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: URL, init: RequestInit) => {
      if (init.method === 'POST') { writes.push(init); throw new TypeError('Network unavailable') }
      return Response.json(url.pathname.endsWith('/context') ? { ancestors: [], descendants: [] } : post('parent'))
    }))
    const { root } = await mount()
    button(root, 'Request to reply').click(); await settle()
    expect(root.textContent).toContain('needs the author’s approval')
    expect(root.querySelector<HTMLInputElement>('input[placeholder]')!.value).toBe('CW')
    expect(Array.from(root.querySelector('select')!.options).map(item => item.value)).toEqual(['private', 'direct'])
    const draft = root.querySelector<HTMLTextAreaElement>('textarea')!
    draft.value += 'Hello'; draft.dispatchEvent(new Event('input')); await nextTick()
    const submit = async () => { root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true })); await settle() }
    await submit()
    expect(root.textContent).toContain('submission result is uncertain')
    expect(draft.value).toBe('@alice@remote.test Hello')
    await submit()
    expect(writes).toHaveLength(2)
    expect(new Headers(writes[0]!.headers).get('Idempotency-Key')).toBe(new Headers(writes[1]!.headers).get('Idempotency-Key'))
    expect(JSON.parse(writes[0]!.body as string)).toMatchObject({ in_reply_to_id: 'parent', local_only: true, visibility: 'private' })
  })
  it('ignores a stale detail response after selecting another post', async () => {
    let resolveOld!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn(async (url: URL) => {
      if (url.pathname.endsWith('/context')) return Response.json({ ancestors: [], descendants: [] })
      if (url.pathname.endsWith('/parent')) return new Promise<Response>(resolve => { resolveOld = resolve })
      return Response.json(post('newer'))
    }))
    const { root, props } = await mount()
    props.statusId = 'newer'; await settle()
    resolveOld(Response.json(post('obsolete'))); await settle()
    button(root, 'Show content').click(); await nextTick()
    expect(root.textContent).toContain('newer')
    expect(root.textContent).not.toContain('obsolete')
  })
})
