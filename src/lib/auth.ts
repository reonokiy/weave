import { LocalizedError } from '../i18n'
import { GtsClient, normalizeOrigin } from './api'
import type { AppRegistration, Session } from './types'

const PENDING = 'weave.oauth.pending'
const SESSION = 'weave.session'
// The streaming processor checks broad read, despite the route's read:streaming annotation.
export const SCOPES = 'read write:statuses write:favourites write:follows write:media write:bookmarks write:mutes write:blocks write:accounts write:filters'
export function hasScope(session: Session, scope: string) { return (session.scopes ?? 'read:accounts read:statuses write:statuses').split(' ').some(value => value === scope || value === scope.split(':')[0]) }
interface Pending extends AppRegistration { origin: string; state: string; redirect: string; created: number; scopes?: string }

const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
function read<T>(key: string): T | null {
  try { return JSON.parse(sessionStorage.getItem(key) ?? 'null') } catch { sessionStorage.removeItem(key); return null }
}
export function loadSession(): Session | null {
  const value = read<Session>(SESSION)
  if (!value || typeof value.origin !== 'string' || typeof value.token !== 'string' || !value.token || typeof value.client_id !== 'string' || typeof value.client_secret !== 'string') return null
  try { normalizeOrigin(value.origin); return value } catch { clearSession(); return null }
}
export function clearSession() { sessionStorage.removeItem(SESSION); sessionStorage.removeItem(PENDING) }

export async function authorize(input: string, redirect: string, scopes = SCOPES): Promise<string> {
  const origin = normalizeOrigin(input)
  const state = base64url(crypto.getRandomValues(new Uint8Array(32)))
  // Verify storage before registering an application on the server.
  sessionStorage.setItem(PENDING, 'null')
  const app = await new GtsClient(origin).post<AppRegistration>('/api/v1/apps', { client_name: 'Weave', redirect_uris: redirect, scopes, website: redirect })
  sessionStorage.setItem(PENDING, JSON.stringify({ ...app, origin, state, redirect, scopes, created: Date.now() } satisfies Pending))
  const url = new URL('/oauth/authorize', origin)
  // GoToSocial's HTTP handlers currently discard PKCE fields. Match its official flow.
  url.search = new URLSearchParams({ client_id: app.client_id, redirect_uri: redirect, response_type: 'code', scope: scopes, state }).toString()
  return url.href
}

export async function finishAuthorization(url: URL): Promise<Session | null> {
  if (!url.searchParams.has('code') && !url.searchParams.has('error')) return null
  const pending = read<Pending>(PENDING)
  // Consume once, including on errors. Retry requires a fresh authorization.
  sessionStorage.removeItem(PENDING)
  const clean = new URL(url)
  for (const key of ['code', 'state', 'error', 'error_description']) clean.searchParams.delete(key)
  history.replaceState({}, '', clean.pathname + clean.search)
  const expected = pending ? new URL(pending.redirect) : null
  if (expected) expected.search = expected.searchParams.toString()
  if (!pending || !pending.state || url.searchParams.get('state') !== pending.state || !Number.isFinite(pending.created) || Date.now() < pending.created || Date.now() - pending.created > 600000 || clean.href !== expected?.href) throw new LocalizedError('authExpired')
  if (url.searchParams.has('error')) throw new LocalizedError('authDenied')
  const code = url.searchParams.get('code')
  if (!code) throw new LocalizedError('authCodeMissing')
  const token = await new GtsClient(pending.origin).post<{ access_token: string; scope?: string }>('/oauth/token', {
    grant_type: 'authorization_code', client_id: pending.client_id, client_secret: pending.client_secret,
    redirect_uri: pending.redirect, code,
  })
  if (!token.access_token) throw new LocalizedError('authTokenMissing')
  const session: Session = { origin: pending.origin, client_id: pending.client_id, client_secret: pending.client_secret, token: token.access_token, scopes: token.scope ?? pending.scopes ?? SCOPES }
  sessionStorage.setItem(SESSION, JSON.stringify(session))
  return session
}

export async function logout(session: Session): Promise<void> {
  // Clear before the network call so a later login cannot be erased by a slow revoke.
  clearSession()
  await new GtsClient(session.origin).request('/oauth/revoke', {
    method: 'POST', body: new URLSearchParams({ token: session.token, client_id: session.client_id, client_secret: session.client_secret }),
  })
}
