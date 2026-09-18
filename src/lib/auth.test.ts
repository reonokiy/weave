import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { authorize, finishAuthorization, loadSession, logout, SCOPES } from './auth'

const origin = 'https://social.example.org'
const redirect = `${location.origin}/weave/`
beforeEach(() => { sessionStorage.clear(); history.replaceState({}, '', '/weave/') })
afterEach(() => vi.unstubAllGlobals())
async function start() {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ client_id: 'client', client_secret: 'app-secret' }))
  vi.stubGlobal('fetch', fetcher)
  return { fetcher, url: new URL(await authorize(origin, redirect)) }
}
describe('OAuth authorization code flow', () => {
  it('registers the exact subpath callback and declared scopes, then consumes a valid callback once', async () => {
    const { fetcher, url } = await start()
    expect(url.searchParams.get('scope')).toBe(SCOPES)
    expect(url.searchParams.get('redirect_uri')).toBe(redirect)
    expect(url.searchParams.get('state')!.length).toBeGreaterThan(32)
    expect(url.searchParams.has('code_challenge')).toBe(false)
    const registration = JSON.parse(fetcher.mock.calls[0]![1].body)
    expect(registration.redirect_uris).toBe(redirect)
    fetcher.mockResolvedValueOnce(Response.json({ access_token: 'access' }))
    const callback = new URL(`${redirect}?code=authorization-code&state=${url.searchParams.get('state')}`)
    expect(await finishAuthorization(callback)).toMatchObject({ token: 'access', origin })
    const tokenRequest = JSON.parse(fetcher.mock.calls[1]![1].body)
    expect(tokenRequest).toEqual({ grant_type: 'authorization_code', client_id: 'client', client_secret: 'app-secret', redirect_uri: redirect, code: 'authorization-code' })
    expect(loadSession()?.token).toBe('access')
    expect(location.search).toBe('')
    await expect(finishAuthorization(callback)).rejects.toThrow('did not match')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it.each(['missing', 'wrong', 'expired', 'denied', 'path'])('rejects %s callbacks before exchanging a code', async (mode) => {
    const { fetcher, url } = await start()
    let state = url.searchParams.get('state')!
    if (mode === 'wrong') state = 'other'
    if (mode === 'missing') sessionStorage.clear()
    if (mode === 'expired') {
      const pending = JSON.parse(sessionStorage.getItem('weave.oauth.pending')!)
      pending.created = Date.now() - 700000
      sessionStorage.setItem('weave.oauth.pending', JSON.stringify(pending))
    }
    const callback = new URL(`${mode === 'path' ? `${location.origin}/wrong/` : redirect}?${mode === 'denied' ? 'error=access_denied' : 'code=code'}&state=${state}`)
    await expect(finishAuthorization(callback)).rejects.toThrow()
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(sessionStorage.getItem('weave.oauth.pending')).toBeNull()
  })
  it('clears local credentials even if remote revocation fails', async () => {
    sessionStorage.setItem('weave.session', JSON.stringify({ token: 'secret' }))
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))
    await expect(logout({ origin, token: 'secret', client_id: 'client', client_secret: 'secret' })).rejects.toThrow('offline')
    expect(loadSession()).toBeNull()
  })
  it('returns to the original query without retaining OAuth credentials', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ client_id: 'client', client_secret: 'secret' })).mockResolvedValueOnce(Response.json({ access_token: 'access' }))
    vi.stubGlobal('fetch', fetcher)
    const target = location.origin + '/authorize_interaction?uri=https%3A%2F%2Fremote.example%2Fpost%2F1'
    const authorization = new URL(await authorize(origin, target))
    const callback = new URL(target)
    callback.searchParams.set('code', 'code'); callback.searchParams.set('state', authorization.searchParams.get('state')!)
    await finishAuthorization(callback)
    expect(location.pathname + location.search).toBe(new URL(target).pathname + new URL(target).search)
    expect(loadSession()?.token).toBe('access')
  })
})
