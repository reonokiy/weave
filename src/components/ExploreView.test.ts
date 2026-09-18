import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed, createApp, h, nextTick, reactive, ref, type App } from 'vue'
import ExploreView from './ExploreView.vue'
import { i18n } from '../i18n'
import { GtsClient } from '../lib/api'
import { SCOPES } from '../lib/auth'
import { workspaceKey, type Workspace } from '../lib/workspace'
import { posts, self } from '../../tests/browser/fixture'

let app: App | undefined
afterEach(() => { app?.unmount(); document.body.innerHTML = ''; vi.unstubAllGlobals() })
const settle = async () => { await new Promise(resolve => setTimeout(resolve, 15)); await nextTick() }
const button = (root: HTMLElement, name: string) => [...root.querySelectorAll('button')].find(item => item.textContent?.trim() === name)!
async function mount(view: 'notifications' | 'search' | 'bookmarks' | 'requests' | 'profile', fetcher: (url: URL, init: RequestInit) => Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(fetcher))
  const session = ref({ origin: 'https://social.example.org', token: 'token', client_id: 'app', client_secret: 'secret', scopes: SCOPES })
  const workspace: Workspace = { session, client: computed(() => new GtsClient(session.value.origin, session.value.token)), account: ref(self), instance: ref(null), updates: reactive(new Map()), deleted: reactive(new Set()), pending: reactive(new Set()), drafts: reactive(new Set()), report: vi.fn(), openProfile: vi.fn() }
  const props = reactive({ view, accountId: 'maya' })
  const root = document.createElement('div'); document.body.append(root)
  app = createApp({ render: () => h(ExploreView, props) }); app.use(i18n).provide(workspaceKey, workspace).mount(root); await settle()
  return { root, workspace, props }
}

describe('exploration flows', () => {
  it('paginates notifications without duplicates and retains unknown event types', async () => {
    const notification = { id: '1', type: 'favourite', account: posts[0]!.account, status: posts[0], created_at: posts[0]!.created_at }
    const { root } = await mount('notifications', async url => Response.json(url.searchParams.has('max_id') ? [notification, { ...notification, id: '2', type: 'future.event' }] : [notification], { headers: url.searchParams.has('max_id') ? {} : { Link: '<https://social.example.org/api/v1/notifications?max_id=1>; rel="next"' } }))
    expect(root.textContent).toContain('Favourited your post')
    button(root, 'Load earlier posts').click(); await settle()
    expect(root.textContent).toContain('future.event')
    expect(root.querySelectorAll('.status-card')).toHaveLength(2)
  })
  it('searches explicitly and routes account selection through the workspace', async () => {
    const calls: URL[] = []
    const { root, workspace } = await mount('search', async url => { calls.push(url); return Response.json({ accounts: [posts[0]!.account], statuses: [posts[0]], hashtags: [{ name: 'garden', url: 'https://social.example.org/tags/garden' }] }) })
    expect(calls).toHaveLength(0)
    const input = root.querySelector<HTMLInputElement>('#search')!; input.value = '  maya  '; input.dispatchEvent(new Event('input'))
    root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true })); await settle()
    expect(calls[0]!.searchParams.get('q')).toBe('maya')
    expect(calls[0]!.searchParams.has('offset')).toBe(false)
    expect(root.textContent).toContain('#garden')
    button(root, 'Maya Chen · @maya@studio.social').click()
    expect(workspace.openProfile).toHaveBeenCalledWith('maya')
  })
  it('reviews interaction and follow requests only after the server accepts them', async () => {
    const writes: string[] = []
    const { root, workspace } = await mount('requests', async (url, init) => {
      if (init.method === 'POST') { writes.push(url.pathname); return Response.json({}) }
      if (url.pathname === '/api/v1/follow_requests') return Response.json([posts[0]!.account])
      return Response.json([{ id: 'request', type: 'reply', account: posts[0]!.account, status: posts[0], reply: posts[1] }])
    })
    button(root, 'Approve').click(); await settle()
    expect(writes).toContain('/api/v1/interaction_requests/request/authorize')
    expect(button(root, 'Approve')).toBeUndefined()
    button(root, 'Follow requests').click(); await settle()
    button(root, 'Reject').click(); await settle()
    expect(writes).toContain('/api/v1/follow_requests/maya/reject')
    expect(workspace.pending.size).toBe(0)
  })
  it('updates follow/mute/block state and still renders profile information when one endpoint fails', async () => {
    const relation = { id: 'maya', following: false, requested: false, followed_by: true, muting: false, blocking: false }
    const { root } = await mount('profile', async (url, init) => {
      if (init.method === 'POST') {
        const action = url.pathname.split('/').at(-1)!
        if (action.includes('follow')) relation.following = action === 'follow'
        if (action.includes('mute')) relation.muting = action === 'mute'
        if (action.includes('block')) relation.blocking = action === 'block'
        return Response.json(relation)
      }
      if (url.pathname.endsWith('/relationships')) return Response.json([relation])
      if (url.pathname.endsWith('/statuses')) return Response.json({ error: 'Posts temporarily unavailable' }, { status: 503 })
      return Response.json({ ...posts[0]!.account, note: '<p>A profile biography</p>' })
    })
    expect(root.textContent).toContain('A profile biography')
    expect(root.textContent).toContain('Posts temporarily unavailable')
    for (const name of ['Follow', 'Unfollow', 'Mute', 'Unmute', 'Block', 'Unblock']) { button(root, name).click(); await settle() }
    expect(relation).toMatchObject({ following: false, muting: false, blocking: false })
  })
  it('ignores stale bookmark responses after navigation and reports expired sessions', async () => {
    let finish!: (response: Response) => void
    const { root, props, workspace } = await mount('bookmarks', async url => url.pathname.endsWith('/bookmarks') ? new Promise(resolve => { finish = resolve }) : Response.json({ error: 'expired' }, { status: 401 }))
    props.view = 'notifications'; await settle()
    finish(Response.json(posts)); await settle()
    expect(workspace.report).toHaveBeenCalled()
    expect(root.querySelectorAll('.status-card')).toHaveLength(0)
  })
})
