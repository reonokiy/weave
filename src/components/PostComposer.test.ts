// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import PostComposer from './PostComposer.vue'
import { i18n } from '../i18n'
import { SCOPES } from '../lib/auth'
import type { Instance, Status } from '../lib/types'

let app: App | undefined
const session = { origin: 'https://social.example.org', token: 'token', client_id: 'app', client_secret: 'secret', scopes: SCOPES }
const account = { id: 'self', username: 'self', acct: 'self', display_name: 'Self', avatar: '', url: '', source: { language: 'de' } }
afterEach(() => { app?.unmount(); document.body.innerHTML = ''; i18n.global.locale.value = 'en'; vi.unstubAllGlobals() })
async function settle() { await new Promise(resolve => setTimeout(resolve, 10)); await nextTick() }
async function mount(edit?: Status, instance: Instance | null = null) {
  const root = document.createElement('div'); document.body.append(root)
  const published = vi.fn()
  app = createApp(PostComposer, { session, account, instance, edit, onPublished: published })
  app.use(i18n).mount(root); await settle()
  const submit = async () => { root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true })); await settle() }
  return { root, published, submit }
}

describe('post composition and retries', () => {
  it('enforces upload limits before sending files and retranslates parameterized errors', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    const { root } = await mount(undefined, { title: 'Test', version: 'test', configuration: { statuses: { max_media_attachments: 1 }, media_attachments: { image_size_limit: 2 } } })
    const input = root.querySelector<HTMLInputElement>('input[type="file"]')!
    Object.defineProperty(input, 'files', { configurable: true, value: [new File(['a'], 'a.png'), new File(['b'], 'b.png')] })
    input.dispatchEvent(new Event('change')); await nextTick()
    expect(root.textContent).toContain(i18n.global.t('tooManyMedia', { count: 1 }))
    i18n.global.locale.value = 'zh-CN'; await nextTick()
    expect(root.textContent).toContain(i18n.global.t('tooManyMedia', { count: 1 }))
    Object.defineProperty(input, 'files', { value: [new File(['large'], 'large.png', { type: 'image/png' })] })
    input.dispatchEvent(new Event('change')); await nextTick()
    expect(root.textContent).toContain(i18n.global.t('fileTooLarge'))
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('loads custom emoji safely and rejects an invalid poll before writing', async () => {
    const fetcher = vi.fn(async () => Response.json([{ shortcode: 'garden', static_url: 'https://social.example.org/emoji.png', visible_in_picker: true }, { shortcode: 'hidden', static_url: '', visible_in_picker: false }]))
    vi.stubGlobal('fetch', fetcher)
    const { root, submit } = await mount()
    const buttons = () => [...root.querySelectorAll('button')]
    buttons().find(button => button.textContent === 'Custom emoji')!.click(); await settle()
    expect(root.querySelectorAll('.emoji-picker button')).toHaveLength(1)
    root.querySelector<HTMLButtonElement>('.emoji-picker button')!.click(); await nextTick()
    expect(root.querySelector<HTMLTextAreaElement>('.draft-input')!.value).toContain(':garden:')
    const poll = [...root.querySelectorAll('label')].find(label => label.textContent === 'Add a poll')!.querySelector('input')!
    poll.click(); await nextTick(); await submit()
    expect(root.textContent).toContain(i18n.global.t('invalidPoll'))
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('keeps a successfully uploaded attachment when publishing fails, avoiding a second upload on retry', async () => {
    const writes: { url: string; body: unknown }[] = []
    let attempts = 0
    vi.stubGlobal('fetch', vi.fn(async (url: URL, init: RequestInit) => {
      writes.push({ url: url.pathname, body: init.body })
      if (url.pathname === '/api/v1/media') return Response.json({ id: 'media', url: 'https://social.example.org/image.png', description: '' })
      if (++attempts === 1) throw new TypeError('offline')
      return Response.json({ id: 'published' })
    }))
    const { root, submit, published } = await mount()
    const input = root.querySelector<HTMLInputElement>('input[type="file"]')!
    Object.defineProperty(input, 'files', { value: [new File(['image'], 'picture.png', { type: 'image/png' })] })
    input.dispatchEvent(new Event('change')); await nextTick()
    await submit()
    expect(root.textContent).toContain('submission result is uncertain')
    expect(root.textContent).toContain('picture.png')
    await submit()
    expect(writes.map(write => write.url)).toEqual(['/api/v1/media', '/api/v1/statuses', '/api/v1/statuses'])
    expect(JSON.parse(writes[2]!.body as string)).toMatchObject({ media_ids: ['media'], language: 'de' })
    expect(published).toHaveBeenCalledOnce()
  })
  it('loads edit source and explicitly preserves poll choices and expiry semantics', async () => {
    const writes: RequestInit[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: URL, init: RequestInit) => {
      if (url.pathname.endsWith('/source')) return Response.json({ id: 'post', text: '**Source**', spoiler_text: 'CW', content_type: 'text/markdown' })
      writes.push(init); return Response.json({ id: 'post' })
    }))
    const edit = { id: 'post', account, content: '<p>Rendered</p>', sensitive: true, language: 'fr', media_attachments: [], poll: { id: 'poll', options: [{ title: 'A' }, { title: 'B' }], multiple: false, expired: false } } as unknown as Status
    const { root, submit } = await mount(edit)
    expect(root.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('**Source**')
    await submit()
    expect(writes).toHaveLength(1)
    expect(writes[0]!.method).toBe('PUT')
    expect(JSON.parse(writes[0]!.body as string)).toMatchObject({ content_type: 'text/markdown', language: 'fr', spoiler_text: 'CW', sensitive: true, poll: { options: ['A', 'B'], expires_in: 0, multiple: false, hide_totals: true } })
    expect(JSON.parse(writes[0]!.body as string)).not.toHaveProperty('visibility')
  })
  it('does not emit a late publish result after the composer is unmounted', async () => {
    let finish!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { finish = resolve })))
    const { root, published } = await mount()
    const textarea = root.querySelector('textarea')!
    textarea.value = 'Hello'; textarea.dispatchEvent(new Event('input')); await nextTick()
    root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true })); await nextTick()
    app!.unmount(); app = undefined
    finish(Response.json({ id: 'late' })); await settle()
    expect(published).not.toHaveBeenCalled()
  })
})
