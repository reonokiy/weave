import { t, LocalizedError } from '../i18n'
import type { Account, Instance, Page, Session, Status, ThreadContext, Visibility } from './types'
import type { Attachment, Emoji, InteractionRequest, Notification, Poll, PostBody, Relationship, SearchResults, StatusSource } from './types'

export class ApiError extends Error {
  constructor(public status: number, private serverMessage: string, public reset: string | null = null) {
    super()
  }
  override get message() { return this.status === 429 ? t('rateLimited') : this.serverMessage || t('requestFailed', { status: this.status }) }
}

export function normalizeOrigin(input: string): string {
  const url = new URL(input.includes('://') ? input.trim() : `https://${input.trim()}`)
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) throw new LocalizedError('httpsRequired')
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new LocalizedError('domainOnly')
  return url.origin
}

export function safeUrl(value: string | null | undefined): string | undefined {
  if (!value) return undefined
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : undefined } catch { return undefined }
}

export class GtsClient {
  readonly origin: string
  constructor(origin: string, private token?: string) { this.origin = normalizeOrigin(origin) }

  async response(path: string, init: RequestInit = {}): Promise<Response> {
    const url = new URL(path, this.origin)
    if (url.origin !== this.origin) throw new LocalizedError('crossOrigin')
    const headers = new Headers(init.headers)
    if (!headers.has('Accept')) headers.set('Accept', 'application/json')
    if (this.token) headers.set('Authorization', `Bearer ${this.token}`)
    const response = await fetch(url, { ...init, headers, credentials: 'omit', redirect: 'error', signal: init.signal ?? AbortSignal.timeout(20000) })
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      const message = typeof body.error === 'string' ? body.error : ''
      throw new ApiError(response.status, message, response.headers.get('X-RateLimit-Reset'))
    }
    return response
  }

  async request<T>(path: string, init: RequestInit = {}): Promise<{ data: T; response: Response }> {
    const response = await this.response(path, init)
    const data = response.status === 204 || response.headers.get('content-length') === '0' ? undefined : await response.text()
    return { data: (data ? JSON.parse(data) : undefined) as T, response }
  }

  async post<T>(path: string, body: unknown, headers?: HeadersInit): Promise<T> {
    return (await this.request<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })).data
  }

  async instance(): Promise<Instance> {
    try { return (await this.request<Instance>('/api/v2/instance')).data }
    catch (error) {
      if (!(error instanceof ApiError) || ![404, 501].includes(error.status)) throw error
      return (await this.request<Instance>('/api/v1/instance')).data
    }
  }

  async account(): Promise<Account> { return (await this.request<Account>('/api/v1/accounts/verify_credentials')).data }

  async page<T>(path: string, next?: string | null): Promise<Page<T>> {
    const expected = new URL(path, this.origin)
    const url = new URL(next ?? path, this.origin)
    if (url.pathname !== expected.pathname) throw new LocalizedError('invalidPagination')
    const { data, response } = await this.request<T[]>(url.href)
    const link = response.headers.get('Link')?.split(',').find(part => /rel="?next"?/.test(part))
    return { items: data, next: link?.match(/<([^>]+)>/)?.[1] ?? null }
  }

  notifications(next?: string | null) { return this.page<Notification>('/api/v1/notifications?limit=20', next) }
  bookmarks(next?: string | null) { return this.page<Status>('/api/v1/bookmarks?limit=20', next) }
  interactions(next?: string | null) { return this.page<InteractionRequest>('/api/v1/interaction_requests?limit=20', next) }
  followRequests(next?: string | null) { return this.page<Account>('/api/v1/follow_requests?limit=20', next) }
  accountStatuses(id: string, next?: string | null) { return this.page<Status>(`/api/v1/accounts/${encodeURIComponent(id)}/statuses?limit=20`, next) }
  async profile(id: string) { return (await this.request<Account>(`/api/v1/accounts/${encodeURIComponent(id)}`)).data }
  async relationship(id: string) { return (await this.request<Relationship[]>(`/api/v1/accounts/relationships?${new URLSearchParams({ 'id[]': id })}`)).data[0]! }
  accountAction(id: string, action: 'follow' | 'unfollow' | 'mute' | 'unmute' | 'block' | 'unblock') { return this.post<Relationship>(`/api/v1/accounts/${encodeURIComponent(id)}/${action}`, {}) }
  reviewFollow(id: string, action: 'authorize' | 'reject') { return this.post<Relationship>(`/api/v1/follow_requests/${encodeURIComponent(id)}/${action}`, {}) }
  reviewInteraction(id: string, action: 'authorize' | 'reject') { return this.post<InteractionRequest>(`/api/v1/interaction_requests/${encodeURIComponent(id)}/${action}`, {}) }
  async search(query: string, resolve: boolean) { return (await this.request<SearchResults>(`/api/v2/search?${new URLSearchParams({ q: query, resolve: String(resolve), limit: '40' })}`)).data }
  async statusAction(id: string, action: 'favourite' | 'unfavourite' | 'reblog' | 'unreblog' | 'bookmark' | 'unbookmark') {
    const result = await this.post<Status>(`/api/v1/statuses/${encodeURIComponent(id)}/${action}`, {})
    // Boost creation returns a wrapper; the other actions return the original status.
    return result.reblog ?? result
  }
  async source(id: string) { return (await this.request<StatusSource>(`/api/v1/statuses/${encodeURIComponent(id)}/source`)).data }
  async deleteStatus(id: string) { await this.request(`/api/v1/statuses/${encodeURIComponent(id)}`, { method: 'DELETE' }) }
  async savePost(body: PostBody, key: string, editId?: string) {
    if (editId) return (await this.request<Status>(`/api/v1/statuses/${encodeURIComponent(editId)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).data
    return this.post<Status>('/api/v1/statuses', body, { 'Idempotency-Key': key })
  }
  async upload(file: File, description: string) {
    const body = new FormData(); body.set('file', file); body.set('description', description)
    return (await this.request<Attachment>('/api/v1/media', { method: 'POST', body, signal: AbortSignal.timeout(120000) })).data
  }
  async updateMedia(id: string, description: string) { return (await this.request<Attachment>(`/api/v1/media/${encodeURIComponent(id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ description }) })).data }
  async poll(id: string) { return (await this.request<Poll>(`/api/v1/polls/${encodeURIComponent(id)}`)).data }
  vote(id: string, choices: number[]) { return this.post<Poll>(`/api/v1/polls/${encodeURIComponent(id)}/votes`, { choices }) }
  async emojis() { return (await this.request<Emoji[]>('/api/v1/custom_emojis')).data }

  async timeline(kind: 'home' | 'local', next?: string | null): Promise<Page<Status>> {
    const expected = kind === 'home' ? '/api/v1/timelines/home' : '/api/v1/timelines/public'
    const path = `${expected}?limit=20${kind === 'local' ? '&local=true' : ''}`
    const page = await this.page<Status>(path, next)
    if (!page.items.length) return page
    // The inspected GoToSocial cache can omit arrivals above a cached page.
    // A bounded since_id query reads that gap without losing its upper cursor.
    const gap = new URL(next ?? path, this.origin)
    gap.searchParams.delete('min_id')
    gap.searchParams.set('since_id', page.items[0]!.id)
    gap.searchParams.set('limit', '20')
    const recent = await this.page<Status>(gap.href)
    if (recent.items.length >= 20) return recent
    return { items: [...new Map([...recent.items, ...page.items].map(status => [status.id, status])).values()], next: page.next }
  }

  async status(id: string): Promise<Status> {
    return (await this.request<Status>(`/api/v1/statuses/${encodeURIComponent(id)}`)).data
  }

  async context(id: string): Promise<ThreadContext> {
    return (await this.request<ThreadContext>(`/api/v1/statuses/${encodeURIComponent(id)}/context`)).data
  }

  async publish(status: string, spoiler: string, visibility: Visibility, key: string, language?: string, reply?: { id: string; localOnly?: boolean }): Promise<Status> {
    // Omitting interaction_policy preserves the account's server-side defaults.
    return this.post<Status>('/api/v1/statuses', { status, spoiler_text: spoiler, visibility, sensitive: Boolean(spoiler), content_type: 'text/plain', language, in_reply_to_id: reply?.id, local_only: reply?.localOnly }, { 'Idempotency-Key': key })
  }
}

export const clientFor = (session: Session) => new GtsClient(session.origin, session.token)
