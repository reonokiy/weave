// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed, createApp, nextTick, reactive, ref, type App, type Component } from 'vue'
import StatusCard from './StatusCard.vue'
import PreferencesView from './PreferencesView.vue'
import { i18n } from '../i18n'
import { GtsClient } from '../lib/api'
import { SCOPES } from '../lib/auth'
import { policyPreset } from '../lib/policy'
import { workspaceKey, type Workspace } from '../lib/workspace'
import type { Status } from '../lib/types'

let app: App | undefined
afterEach(() => { app?.unmount(); document.body.innerHTML = ''; vi.unstubAllGlobals() })
const status: Status = { id: 'post', account: { id: 'other', username: 'other', display_name: 'Other', acct: 'other', avatar: '', url: 'https://social.example.org/@other' }, content: '<p>Hello</p>', created_at: '2026-09-12T00:00:00Z', url: null, visibility: 'public', sensitive: false, spoiler_text: '', media_attachments: [{ id: 'image', type: 'image', url: 'https://social.example.org/image.png', preview_url: null, description: 'Alt text' }], reblog: null, replies_count: 0, favourites_count: 0, reblogs_count: 0, interaction_policy: { can_favourite: { automatic_approval: ['me'], manual_approval: [] }, can_reblog: { automatic_approval: [], manual_approval: [] } } }
async function settle() { await new Promise(resolve => setTimeout(resolve, 10)); await nextTick() }
async function mount(component: Component, props = {}) {
  const session = ref({ origin: 'https://social.example.org', token: 'token', client_id: 'app', client_secret: 'secret', scopes: SCOPES })
  const workspace: Workspace = { session, client: computed(() => new GtsClient(session.value.origin, session.value.token)), account: ref({ ...status.account!, id: 'self' }), instance: ref(null), updates: reactive(new Map()), deleted: reactive(new Set()), pending: reactive(new Set()), drafts: reactive(new Set()), report: vi.fn(), openProfile: vi.fn() }
  const root = document.createElement('div'); document.body.append(root)
  app = createApp(component, props); app.use(i18n).provide(workspaceKey, workspace).mount(root); await settle()
  return { root, workspace }
}

describe('interaction and settings behavior', () => {
  it('renders GoToSocial deleted-thread placeholders without author access or action controls', async () => {
    const { root } = await mount(StatusCard, { status: { ...status, account: null, content: '<p><em>ℹ️ deleted status ℹ️</em></p>' } })
    expect(root.textContent).toContain(i18n.global.t('postUnavailable'))
    expect(root.querySelectorAll('button, a')).toHaveLength(0)
  })
  it('recognizes the real tombstone shape with an author and null policy arrays', async () => {
    const rules = { automatic_approval: null, manual_approval: null }
    const { root } = await mount(StatusCard, { status: { ...status, interaction_policy: { can_reply: rules, can_favourite: rules, can_reblog: rules }, content: '<p><em>ℹ️ deleted status ℹ️</em></p>' } })
    expect(root.textContent).toContain(i18n.global.t('postUnavailable'))
    expect(root.querySelectorAll('button, a')).toHaveLength(0)
  })
  it('requires confirmation for deletion and keeps failed deletions visible', async () => {
    let fail = true
    const fetcher = vi.fn(async () => fail ? Response.json({ error: 'Try later' }, { status: 503 }) : new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetcher)
    const { root, workspace } = await mount(StatusCard, { status: { ...status, account: { ...status.account!, id: 'self' } } })
    const remove = () => [...root.querySelectorAll('button')].find(button => button.textContent === 'Delete post')!
    remove().click(); await nextTick(); expect(fetcher).not.toHaveBeenCalled()
    root.querySelector<HTMLButtonElement>('.warning-box .btn-primary')!.click(); await settle()
    expect(root.textContent).toContain('Try later'); expect(workspace.deleted.size).toBe(0)
    fail = false; remove().click(); await nextTick()
    root.querySelector<HTMLButtonElement>('.warning-box .btn-primary')!.click(); await settle()
    expect(workspace.deleted.has('post')).toBe(true)
    expect(root.querySelector('article')).toBeNull()
  })
  it('submits selected poll indexes and refreshes server results', async () => {
    const poll = { id: 'poll', expired: false, expires_at: '2030-01-01T00:00:00Z', multiple: true, votes_count: 0, voted: false, options: [{ title: 'Tea', votes_count: 0 }, { title: 'Coffee', votes_count: 0 }] }
    const writes: number[][] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: URL, init: RequestInit) => { if (init.method === 'POST') writes.push(JSON.parse(init.body as string).choices); return Response.json({ ...poll, voted: true, votes_count: 1 }) }))
    const { root, workspace } = await mount(StatusCard, { status: { ...status, poll } })
    const choices = root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
    choices[0]!.click(); choices[1]!.click(); choices[0]!.click(); await nextTick()
    const vote = [...root.querySelectorAll('button')].find(button => button.textContent === 'Vote')!
    vote.click(); await settle()
    expect(writes).toEqual([[1]])
    expect(workspace.updates.get('post')?.poll?.voted).toBe(true)
    expect(root.textContent).toContain('Your vote has been submitted')
    const refresh = [...root.querySelectorAll('button')].find(button => button.textContent === 'Refresh poll')!
    refresh.click(); await settle()
    expect(writes).toHaveLength(1)
  })
  it('saves profile changes and creates, updates, and deletes keyword filters', async () => {
    let filters: { id: string; title: string; filter_action: string; context: string[] }[] = []
    const writes: { path: string; method: string; body: Record<string, unknown> }[] = []
    const policies = Object.fromEntries(['direct', 'private', 'unlisted', 'public'].map(visibility => [visibility, policyPreset('author', 'public')]))
    vi.stubGlobal('fetch', vi.fn(async (url: URL, init: RequestInit) => {
      if (init.method && init.method !== 'GET') {
        const body = init.body ? JSON.parse(init.body as string) : {}
        writes.push({ path: url.pathname, method: init.method, body })
        if (url.pathname.endsWith('/update_credentials')) return Response.json({ ...status.account!, id: 'self', display_name: body.display_name })
        if (init.method === 'POST') filters = [{ ...body, id: 'filter', keywords: body.keywords_attributes }]
        if (init.method === 'PUT') filters[0]!.filter_action = body.filter_action
        if (init.method === 'DELETE') filters = []
        return Response.json(filters[0] ?? {})
      }
      return Response.json(url.pathname === '/api/v2/filters' ? filters : policies)
    }))
    const { root, workspace } = await mount(PreferencesView)
    const forms = root.querySelectorAll('form')
    const name = forms[0]!.querySelector('input')!; name.value = 'Updated name'; name.dispatchEvent(new Event('input'))
    forms[0]!.dispatchEvent(new Event('submit', { cancelable: true })); await settle()
    expect(workspace.account.value?.display_name).toBe('Updated name')
    const title = forms[2]!.querySelector('input')!; title.value = 'Quiet'; title.dispatchEvent(new Event('input'))
    const keywords = forms[2]!.querySelector('textarea')!; keywords.value = 'noise\n\n spam '; keywords.dispatchEvent(new Event('input'))
    forms[2]!.dispatchEvent(new Event('submit', { cancelable: true })); await settle()
    expect(writes.find(write => write.method === 'POST')?.body.keywords_attributes).toEqual([{ keyword: 'noise', whole_word: false }, { keyword: 'spam', whole_word: false }])
    const filterCard = [...root.querySelectorAll('.composer')].find(card => card.textContent?.includes('Quiet'))!
    const select = filterCard.querySelector('select')!; select.value = 'hide'; select.dispatchEvent(new Event('change')); await settle()
    expect(writes.some(write => write.method === 'PUT' && write.body.filter_action === 'hide')).toBe(true)
    const remove = [...filterCard.querySelectorAll('button')].find(button => button.textContent === 'Remove')!; remove.click(); await settle()
    expect(filters).toHaveLength(0); expect(workspace.pending.size).toBe(0)
  })
  it('uses server permission, prevents concurrent writes, and retains view-specific filters after an action', async () => {
    let finish!: (response: Response) => void
    const fetcher = vi.fn(() => new Promise<Response>(resolve => { finish = resolve }))
    vi.stubGlobal('fetch', fetcher)
    const { root, workspace } = await mount(StatusCard, { status: { ...status, filtered: [{ filter: { title: 'Media', filter_action: 'blur' } }] } })
    expect(root.textContent).toContain('Hello')
    expect(root.querySelector('.post-image')).toBeNull()
    const boost = root.querySelector<HTMLButtonElement>('button[aria-label="Boost"]')!
    expect(boost.disabled).toBe(true)
    const like = root.querySelector<HTMLButtonElement>('button[aria-label="Favourite"]')!
    like.click(); like.click(); await nextTick()
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(like.disabled).toBe(true)
    finish(Response.json({ ...status, favourited: true, favourites_count: 1 })); await settle()
    expect(workspace.updates.get('post')?.favourited).toBe(true)
    expect(root.querySelector('button[aria-label="Undo favourite"]')?.getAttribute('aria-pressed')).toBe('true')
    expect(root.querySelector('.post-image')).toBeNull()
  })
  it('does not cache action results for an account that has signed out', async () => {
    let finish!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { finish = resolve })))
    const { root, workspace } = await mount(StatusCard, { status })
    root.querySelector<HTMLButtonElement>('button[aria-label="Favourite"]')!.click(); await nextTick()
    workspace.session.value = null
    finish(Response.json({ ...status, favourited: true })); await settle()
    expect(workspace.updates.size).toBe(0)
  })
  it('reads fresh default policies and includes all four visibilities when changing just one', async () => {
    const policies = { direct: policyPreset('author', 'direct'), private: policyPreset('approval', 'private'), unlisted: policyPreset('automatic', 'unlisted'), public: policyPreset('approval', 'public') }
    const writes: Record<string, unknown>[] = []
    let policyReads = 0
    vi.stubGlobal('fetch', vi.fn(async (url: URL, init: RequestInit) => {
      if (url.pathname === '/api/v2/filters') return Response.json([])
      if (init.method === 'PATCH') { writes.push(JSON.parse(init.body as string)); return Response.json(policies) }
      policyReads++; return Response.json(policies)
    }))
    const { root } = await mount(PreferencesView)
    const form = root.querySelectorAll('form')[1]!
    form.dispatchEvent(new Event('submit', { cancelable: true })); await settle()
    expect(policyReads).toBe(2)
    expect(writes[0]).toEqual({ ...policies, unlisted: null })
  })
})
