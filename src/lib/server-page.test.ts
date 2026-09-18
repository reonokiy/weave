import { afterEach, describe, expect, it } from 'vitest'
import { localPageUrl, readServerPage } from './server-page'
afterEach(() => { document.body.innerHTML = '' })
describe('server-rendered page data', () => {
  it('distinguishes a standalone page from a server page', () => {
    expect(readServerPage()).toBeNull()
    const script = document.createElement('script'); script.id = 'weave-server-page'; script.type = 'application/json'
    script.textContent = JSON.stringify({ pageContent: 'profile.tmpl', account: { username: 'alice' } }); document.body.append(script)
    expect(readServerPage()?.account?.username).toBe('alice')
    script.textContent = '{}'
    expect(() => readServerPage()).toThrow('Invalid server page')
  })
  it('only accepts local pagination without embedded credentials', () => {
    expect(localPageUrl('/@alice?max_id=123')).toBe('/@alice?max_id=123')
    expect(localPageUrl('https://external.example/@alice')).toBeUndefined()
    expect(localPageUrl('javascript:alert(1)')).toBeUndefined()
    const credentialed = new URL('/@alice', location.origin); credentialed.username = 'alice'
    expect(localPageUrl(credentialed.href)).toBeUndefined()
    expect(localPageUrl(undefined)).toBeUndefined()
  })
})
