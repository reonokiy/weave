import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, GtsClient, normalizeOrigin, safeUrl } from './api'

afterEach(() => vi.unstubAllGlobals())
describe('instance and token boundaries', () => {
  it('recovers multiple pages of arrivals omitted by a warm server cache without skipping IDs', async () => {
    const all = Array.from({ length: 45 }, (_, index) => ({ id: String(45 - index).padStart(3, '0') }))
    const cached = all.slice(25)
    const observed: URL[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: URL) => {
      observed.push(url)
      const upper = url.searchParams.get('max_id') ?? '999'
      const lower = url.searchParams.get('since_id')
      const items = (lower ? all : cached).filter(item => item.id < upper && (!lower || item.id > lower)).slice(0, 20)
      const next = items.length ? `${url.origin}${url.pathname}?local=true&max_id=${items.at(-1)!.id}` : null
      return Response.json(items, { headers: next ? { Link: `<${next}>; rel="next"` } : {} })
    }))
    const client = new GtsClient('https://social.example.org')
    const first = await client.timeline('local')
    expect(first.items.map(item => item.id)).toEqual(all.slice(0, 20).map(item => item.id))
    const second = await client.timeline('local', first.next)
    expect([...first.items, ...second.items].map(item => item.id)).toEqual(all.map(item => item.id))
    expect(observed[3]!.searchParams.get('max_id')).toBe('026')
    expect(observed[3]!.searchParams.get('since_id')).toBe('020')
    expect((await client.timeline('local', second.next)).items).toEqual([])
  })
  it('reads authenticated status and context without sorting server thread order', async () => {
    const context = { ancestors: [{ id: 'Z' }, { id: 'A' }], descendants: [{ id: 'X' }] }
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ id: 'parent' })).mockResolvedValueOnce(Response.json(context))
    vi.stubGlobal('fetch', fetcher)
    const api = new GtsClient('https://social.example.org', 'secret')
    expect(await api.status('parent')).toEqual({ id: 'parent' })
    expect(await api.context('parent')).toEqual(context)
    expect(String(fetcher.mock.calls[1]![0])).toBe('https://social.example.org/api/v1/statuses/parent/context')
    expect(new Headers(fetcher.mock.calls[1]![1].headers).get('Authorization')).toBe('Bearer secret')
  })
  it('posts a reply to the local status ID and preserves local-only distribution', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ id: 'reply' }))
    vi.stubGlobal('fetch', fetcher)
    await new GtsClient('https://social.example.org', 'secret').publish('@alice hello', 'CW', 'private', 'retry-key', 'zh', { id: 'parent', localOnly: true })
    const body = JSON.parse(fetcher.mock.calls[0]![1].body)
    expect(body).toMatchObject({ in_reply_to_id: 'parent', local_only: true, visibility: 'private', spoiler_text: 'CW' })
    expect(body).not.toHaveProperty('interaction_policy')
  })
  it('accepts domains and local development, rejects credential URLs and non-HTTPS remote origins', () => {
    expect(normalizeOrigin('social.example.org')).toBe('https://social.example.org')
    expect(normalizeOrigin('http://localhost:8080')).toBe('http://localhost:8080')
    for (const value of ['http://social.example.org', 'https://user:password@example.org', 'https://example.org/settings', 'javascript:alert(1)', 'https://example.org/?x=1']) expect(() => normalizeOrigin(value)).toThrow()
    expect(safeUrl('javascript:alert(1)')).toBeUndefined()
  })
  it('never sends tokens to another origin through a malicious pagination header', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    await expect(new GtsClient('https://social.example.org', 'secret').timeline('home', 'https://evil.example/api/v1/timelines/home')).rejects.toThrow('another instance')
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('follows server pagination and disables redirects and cookies', async () => {
    const next = 'https://social.example.org/api/v1/timelines/home?max_id=01ABC'
    const fetcher = vi.fn().mockResolvedValue(new Response('[]', { headers: { Link: `<${next}>; rel="next", <https://social.example.org/api/v1/timelines/home?min_id=01DEF>; rel="prev"` } }))
    vi.stubGlobal('fetch', fetcher)
    expect((await new GtsClient('https://social.example.org', 'secret').timeline('home')).next).toBe(next)
    const init = fetcher.mock.calls[0]![1] as RequestInit
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer secret')
    expect(init.redirect).toBe('error'); expect(init.credentials).toBe('omit')
  })
  it('falls back to v1 only for an unavailable v2 endpoint', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 404 })).mockResolvedValueOnce(Response.json({ title: 'Test', version: '0.21.0' }))
    vi.stubGlobal('fetch', fetcher)
    expect((await new GtsClient('https://social.example.org').instance()).version).toBe('0.21.0')
    expect(String(fetcher.mock.calls[1]![0])).toContain('/api/v1/instance')
    fetcher.mockReset().mockResolvedValue(new Response('{}', { status: 429, headers: { 'X-RateLimit-Reset': 'later' } }))
    await expect(new GtsClient('https://social.example.org').instance()).rejects.toMatchObject({ status: 429, reset: 'later' } satisfies Partial<ApiError>)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('preserves visibility and idempotency without overriding interaction policies', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ id: 'new' })); vi.stubGlobal('fetch', fetcher)
    await new GtsClient('https://social.example.org', 'secret').publish('Hello', 'CW', 'private', 'same-retry-key', 'zh')
    const init = fetcher.mock.calls[0]![1] as RequestInit
    expect(JSON.parse(init.body as string)).toEqual({ status: 'Hello', spoiler_text: 'CW', sensitive: true, visibility: 'private', content_type: 'text/plain', language: 'zh' })
    expect(new Headers(init.headers).get('Idempotency-Key')).toBe('same-retry-key')
  })
})
