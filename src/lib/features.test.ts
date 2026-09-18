import { afterEach, describe, expect, it, vi } from 'vitest'
import { GtsClient } from './api'
import { hasScope, SCOPES } from './auth'
import { policyPreset } from './policy'
import { connectStream, streamUrl } from './stream'
import type { PostBody, Session } from './types'

const session: Session = { origin: 'https://social.example.org', token: 'secret-token', client_id: 'app', client_secret: 'secret', scopes: SCOPES }
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('source-backed client operations', () => {
  it('normalizes boost wrappers while preserving returned interaction state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ id: 'boost', reblog: { id: 'original', reblogged: true, reblogs_count: 3 } })))
    expect(await new GtsClient(session.origin, session.token).statusAction('original', 'reblog')).toEqual({ id: 'original', reblogged: true, reblogs_count: 3 })
  })
  it('protects every paginated collection against another origin or endpoint', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    const api = new GtsClient(session.origin, session.token)
    await expect(api.notifications('https://evil.example/api/v1/notifications')).rejects.toThrow('another instance')
    await expect(api.bookmarks('/api/v1/accounts')).rejects.toThrow('pagination')
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('encodes search input and never invents unsupported offset pagination', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ accounts: [], statuses: [], hashtags: [] })); vi.stubGlobal('fetch', fetcher)
    await new GtsClient(session.origin, session.token).search('alice@example.org & resolve=false', true)
    const url = fetcher.mock.calls[0]![0] as URL
    expect(url.pathname).toBe('/api/v2/search')
    expect(url.searchParams.get('q')).toBe('alice@example.org & resolve=false')
    expect(url.searchParams.get('resolve')).toBe('true')
    expect(url.searchParams.has('offset')).toBe(false)
  })
  it('uploads multipart data without setting a boundary manually', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ id: 'media', url: 'https://social.example.org/image.png' })); vi.stubGlobal('fetch', fetcher)
    await new GtsClient(session.origin, session.token).upload(new File(['image'], 'image.png', { type: 'image/png' }), 'Description')
    const init = fetcher.mock.calls[0]![1] as RequestInit
    expect(init.body).toBeInstanceOf(FormData)
    expect((init.body as FormData).get('description')).toBe('Description')
    expect(new Headers(init.headers).has('Content-Type')).toBe(false)
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer secret-token')
  })
  it('uses PUT for edit and keeps the source format and explicit poll parameters', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ id: 'post' })); vi.stubGlobal('fetch', fetcher)
    const body: PostBody = { status: '**edited**', spoiler_text: 'CW', content_type: 'text/markdown', sensitive: true, media_ids: [], poll: { options: ['A', 'B'], multiple: false, expires_in: 0, hide_totals: true } }
    await new GtsClient(session.origin, session.token).savePost(body, 'key', 'post')
    const init = fetcher.mock.calls[0]![1] as RequestInit
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body as string)).toEqual(body)
    expect(JSON.parse(init.body as string)).not.toHaveProperty('visibility')
  })
  it('submits numeric poll choices and reviews follow and interaction requests through distinct routes', async () => {
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(Response.json({}))); vi.stubGlobal('fetch', fetcher)
    const api = new GtsClient(session.origin, session.token)
    await api.vote('poll', [0, 2]); await api.reviewFollow('account', 'authorize'); await api.reviewInteraction('request', 'reject')
    expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual({ choices: [0, 2] })
    expect(fetcher.mock.calls.map(call => (call[0] as URL).pathname)).toEqual(['/api/v1/polls/poll/votes', '/api/v1/follow_requests/account/authorize', '/api/v1/interaction_requests/request/reject'])
  })
  it('preserves old session capabilities without pretending old tokens have new scopes', () => {
    const old = { ...session, scopes: undefined }
    expect(hasScope(old, 'write:statuses')).toBe(true)
    expect(hasScope(old, 'write:media')).toBe(false)
    expect(hasScope(old, 'read')).toBe(false)
    expect(hasScope(session, 'read:notifications')).toBe(true)
  })
  it('never emits read-only me policy markers or infeasible public values for private replies', () => {
    expect(policyPreset('default', 'public')).toBeUndefined()
    expect(policyPreset('approval', 'private')?.can_reply.manual_approval).toEqual(['followers'])
    expect(policyPreset('approval', 'direct')?.can_reply.manual_approval).toEqual(['mentioned'])
    expect(JSON.stringify(policyPreset('automatic', 'direct'))).not.toMatch(/public|followers|"me"/)
  })
})

describe('stream transport', () => {
  it('keeps tokens out of URLs and stops reconnecting after disposal', () => {
    vi.useFakeTimers()
    class Socket {
      static sockets: Socket[] = []
      onopen: (() => void) | null = null
      onclose: (() => void) | null = null
      onmessage: ((event: { data: string }) => void) | null = null
      onerror: (() => void) | null = null
      constructor(public url: string, public protocol: string) { Socket.sockets.push(this) }
      close() { this.onclose?.() }
    }
    vi.stubGlobal('WebSocket', Socket)
    const event = vi.fn(); const state = vi.fn()
    const stop = connectStream(session, false, event, state)
    const first = Socket.sockets[0]!
    expect(first.url).toBe('wss://social.example.org/api/v1/streaming?stream=user')
    expect(first.protocol).toBe('secret-token')
    expect(streamUrl('http://localhost:8080', true)).toContain('ws://localhost:8080/api/v1/streaming?stream=public%3Alocal')
    first.onmessage?.({ data: JSON.stringify({ event: 'delete', payload: 'deleted-id' }) })
    expect(event).toHaveBeenCalledWith('delete', 'deleted-id')
    first.close(); vi.advanceTimersByTime(1000)
    expect(Socket.sockets).toHaveLength(2)
    stop(); vi.advanceTimersByTime(60000)
    expect(Socket.sockets).toHaveLength(2)
    first.onmessage?.({ data: JSON.stringify({ event: 'update', payload: '{}' }) })
    expect(event).toHaveBeenCalledTimes(1)
  })
})
