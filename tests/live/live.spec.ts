import { test, expect, type Page } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'

let runtimeErrors: string[] = []
let requests: { method: string; path: string; status: number }[] = []
test.beforeEach(() => { runtimeErrors = []; requests = [] })
test.afterEach(async ({}, info) => {
  await mkdir('artifacts/live', { recursive: true })
  const name = `${info.project.name}-${info.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`
  await writeFile(`artifacts/live/${name}-requests.json`, JSON.stringify(requests, null, 2))
  expect(runtimeErrors, 'Browser JavaScript errors').toEqual([])
})

async function api(page: Page, method: string, ...args: unknown[]) {
  return page.evaluate(async ({ method, args }) => {
    const modulePath = '/src/lib/api.ts'
    const { clientFor } = await import(modulePath)
    const client = clientFor(JSON.parse(sessionStorage.getItem('weave.session')!))
    const result = await client[method](...args)
    return method === 'request' ? result.data : result
  }, { method, args })
}

async function navigate(page: Page, name: string) {
  const nav = page.locator('.main-nav')
  if (!(await nav.getByRole('button', { name, exact: true }).isVisible())) await nav.getByRole('button', { name: 'More', exact: true }).click()
  await nav.getByRole('button', { name, exact: true }).click()
}

async function login(page: Page, username = 'alice') {
  page.on('pageerror', error => runtimeErrors.push(error.message))
  page.on('response', response => {
    const url = new URL(response.url())
    if (url.origin === 'http://127.0.0.1:8686' && (url.pathname.startsWith('/api/') || url.pathname.startsWith('/oauth/'))) requests.push({ method: response.request().method(), path: url.pathname, status: response.status() })
  })
  await page.goto('/')
  await page.getByLabel('Instance address').fill('http://127.0.0.1:8686')
  await page.getByRole('button', { name: 'Connect instance', exact: true }).click()
  await page.getByRole('button', { name: 'Authorize on your instance' }).click()
  await page.getByLabel('Email', { exact: true }).fill(`${username}@example.test`)
  await page.getByLabel('Password', { exact: true }).fill('Weave-local-e2e-only-2026!')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.getByRole('button', { name: 'Allow', exact: true }).click()
  await expect(page.locator('.draft-input').first()).toBeVisible()
}

test('real OAuth, publish, read-back and localization', async ({ page }, info) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await login(page)
  const text = `Live ${info.project.name} post ${Date.now()}`
  await page.locator('.draft-input').first().fill(text)
  const posted = page.waitForResponse(response => response.url().endsWith('/api/v1/statuses') && response.request().method() === 'POST')
  await page.getByRole('button', { name: 'Publish', exact: true }).click()
  const response = await posted
  expect(response.status()).toBe(200)
  const status = await response.json()
  expect(status.content).toContain(text)
  await expect(page.locator('.status-card').filter({ hasText: text })).toBeVisible()
  await page.reload()
  await expect(page.locator('.status-card').filter({ hasText: text })).toBeVisible()
  await page.getByLabel('Language', { exact: true }).selectOption('zh-CN')
  await expect(page.getByRole('button', { name: '发布', exact: true })).toBeVisible()
  await page.screenshot({ path: `artifacts/live/${info.project.name}-published.png`, fullPage: true })
  expect(errors).toEqual([])
})

test('real relationships, reactions, bookmarks, polls, conversations, and edit/delete', async ({ page, browser }, info) => {
  await login(page)
  const other = await browser.newContext({ baseURL: 'http://127.0.0.1:4188' })
  const bob = await other.newPage()
  try {
    await login(bob, 'bob')
    const aliceAccount = await api(page, 'account')
    const bobAccount = await api(bob, 'account')
    await api(page, 'accountAction', bobAccount.id, 'unfollow')
    // A locked account exercises real follow-request review.
    await api(bob, 'request', '/api/v1/accounts/update_credentials', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ locked: true }) })
    await api(page, 'accountAction', bobAccount.id, 'follow')
    const requests = await api(bob, 'followRequests')
    expect(requests.items.some((item: { id: string }) => item.id === aliceAccount.id)).toBe(true)
    await navigate(bob, 'Requests')
    await bob.getByRole('button', { name: 'Follow requests', exact: true }).click()
    await bob.getByRole('button', { name: 'Approve', exact: true }).click()
    expect((await api(page, 'relationship', bobAccount.id)).following).toBe(true)

    const text = `A real poll ${info.project.name} ${Date.now()}`
    const post = await api(bob, 'savePost', { status: text, visibility: 'public', poll: { options: ['Tea', 'Coffee'], expires_in: 3600, multiple: false } }, crypto.randomUUID())
    await navigate(page, 'Local')
    await page.getByRole('button', { name: 'Refresh timeline', exact: true }).click()
    const card = page.locator('.status-card:visible').filter({ hasText: text })
    await expect(card).toBeVisible()
    await card.getByRole('button', { name: 'Favourite', exact: true }).click()
    await expect(card.getByRole('button', { name: 'Undo favourite', exact: true })).toHaveAttribute('aria-pressed', 'true')
    expect((await api(page, 'status', post.id)).favourited).toBe(true)
    await card.getByRole('button', { name: 'Bookmark', exact: true }).click()
    expect((await api(page, 'bookmarks')).items.some((item: { id: string }) => item.id === post.id)).toBe(true)
    await navigate(page, 'Bookmarks')
    await expect(card).toBeVisible()
    await navigate(page, 'Local')
    await card.getByRole('checkbox', { name: /Tea/ }).check()
    await card.getByRole('button', { name: 'Vote', exact: true }).click()
    await expect.poll(async () => (await api(page, 'poll', post.poll.id)).voted).toBe(true)
    await api(page, 'statusAction', post.id, 'reblog')
    expect((await api(page, 'status', post.id)).reblogged).toBe(true)
    await api(page, 'statusAction', post.id, 'unreblog')
    const reply = await api(page, 'savePost', { status: '@bob A real reply', visibility: 'public', in_reply_to_id: post.id }, crypto.randomUUID())
    expect((await api(page, 'context', post.id)).descendants.some((item: { id: string }) => item.id === reply.id)).toBe(true)
    // GoToSocial text search only includes your posts and replies to you.
    expect((await api(page, 'search', text, false)).statuses.some((item: { id: string }) => item.id === post.id)).toBe(false)
    expect((await api(bob, 'search', text, false)).statuses.some((item: { id: string }) => item.id === post.id)).toBe(true)
    expect((await api(page, 'search', post.url, false)).statuses.some((item: { id: string }) => item.id === post.id)).toBe(true)
    await api(page, 'savePost', { status: 'Edited real reply', content_type: 'text/plain' }, crypto.randomUUID(), reply.id)
    expect((await api(page, 'source', reply.id)).text).toBe('Edited real reply')
    await api(page, 'deleteStatus', reply.id)
    await expect.poll(async () => (await api(page, 'context', post.id)).descendants.find((item: { id: string }) => item.id === reply.id)?.content).toContain('deleted status')
    await navigate(bob, 'Local')
    await bob.getByRole('button', { name: 'Refresh timeline', exact: true }).click()
    await bob.locator('.status-card').filter({ hasText: text }).getByRole('button', { name: /View post and replies/ }).click()
    await expect(bob.locator('.status-card').filter({ hasText: 'This post is unavailable' })).toBeVisible()
    await api(page, 'statusAction', post.id, 'unfavourite')
    await api(page, 'statusAction', post.id, 'unbookmark')
    for (const action of ['mute', 'unmute', 'block', 'unblock']) await api(page, 'accountAction', bobAccount.id, action)
    expect((await api(page, 'relationship', bobAccount.id))).toMatchObject({ muting: false, blocking: false, following: false })
    await page.screenshot({ path: `artifacts/live/${info.project.name}-poll.png`, fullPage: true })
  } finally { await other.close() }
})

test('real media upload, source editing, profile preferences and filters', async ({ page }, info) => {
  test.setTimeout(120000)
  await login(page, 'carol')
  expect(await api(page, 'emojis')).toEqual([])
  const text = `Media post ${info.project.name} ${Date.now()}`
  const png = await page.screenshot({ clip: { x: 0, y: 0, width: 128, height: 128 } })
  const composer = page.locator('.post-composer').first()
  await composer.locator('.draft-input').fill(text)
  await composer.locator('summary').click()
  await composer.locator('input[type="file"]').setInputFiles({ name: 'test-image.png', mimeType: 'image/png', buffer: png })
  await composer.getByLabel('Media description', { exact: true }).fill('A local test image')
  const result = page.waitForResponse(response => response.url().endsWith('/api/v1/statuses') && response.request().method() === 'POST')
  await composer.getByRole('button', { name: 'Publish', exact: true }).click()
  const publishedResponse = await result
  expect(publishedResponse.status()).toBe(200)
  const published = await publishedResponse.json()
  expect(published.media_attachments[0].description).toBe('A local test image')
  const card = page.locator('.status-card').filter({ hasText: text })
  const image = card.getByRole('img', { name: 'A local test image' })
  await expect(image).toBeVisible()
  await expect.poll(async () => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true)
  await card.getByRole('button', { name: 'Edit post', exact: true }).click()
  await card.locator('.draft-input').fill(`${text} edited`)
  await card.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(card.locator('.draft-input')).toHaveCount(0)
  expect((await api(page, 'source', published.id)).text).toBe(`${text} edited`)
  expect((await api(page, 'status', published.id)).media_attachments[0].description).toBe('A local test image')
  await page.screenshot({ path: `artifacts/live/${info.project.name}-media.png`, fullPage: true })
  await card.getByRole('button', { name: 'Delete post', exact: true }).click()
  await card.locator('.warning-box').getByRole('button', { name: 'Delete post', exact: true }).click()
  await expect(card).toHaveCount(0)

  await navigate(page, 'Preferences')
  const profile = page.locator('form').first()
  await profile.getByLabel('Display name', { exact: true }).fill(`Carol ${info.project.name}`)
  await profile.getByLabel('Bio', { exact: true }).fill('A real **Markdown** biography')
  await profile.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('Changes saved.', { exact: true })).toBeVisible()
  expect((await api(page, 'account')).display_name).toBe(`Carol ${info.project.name}`)
  const policy = page.locator('form').filter({ has: page.getByRole('heading', { name: 'Default interaction policies', exact: true }) })
  await policy.getByRole('combobox', { name: 'Interaction policy', exact: true }).selectOption('approval')
  await policy.getByRole('button', { name: 'Save', exact: true }).click()
  await expect.poll(async () => (await api(page, 'request', '/api/v1/interaction_policies/defaults')).unlisted.can_favourite.manual_approval).toContain('public')
  const filter = page.locator('form').filter({ has: page.getByRole('heading', { name: 'Content filters', exact: true }) })
  await filter.getByLabel('Filter name', { exact: true }).fill('Live keyword filter')
  await filter.getByLabel('Keywords (one per line)', { exact: true }).fill('unwanted phrase')
  await filter.getByRole('button', { name: 'Add filter', exact: true }).click()
  const savedFilter = page.locator('.composer').filter({ has: page.getByRole('heading', { name: 'Live keyword filter', exact: true }) })
  await expect(savedFilter).toBeVisible()
  await savedFilter.getByRole('combobox', { name: 'Filter action', exact: true }).selectOption('blur')
  await expect.poll(async () => (await api(page, 'request', '/api/v2/filters'))[0]?.filter_action).toBe('blur')
  await savedFilter.getByRole('button', { name: 'Remove', exact: true }).click()
  await expect(savedFilter).toHaveCount(0)
  expect(await api(page, 'request', '/api/v2/filters')).toEqual([])
})

test('real streaming, reply approval, notifications and server-side filters', async ({ page, browser }, info) => {
  await login(page)
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:4188' })
  const bob = await context.newPage()
  try {
    await login(bob, 'bob')
    const earlier = await api(bob, 'savePost', { status: 'Earlier public post for refresh regression', visibility: 'public' }, crypto.randomUUID())
    await navigate(page, 'Local')
    await page.getByLabel('Live updates', { exact: true }).check()
    await expect(page.getByText('Live connection active', { exact: true })).toBeVisible()
    const text = `Approval stream ${info.project.name} ${Date.now()}`
    const rules = { automatic_approval: ['author'], manual_approval: ['public'] }
    const post = await api(bob, 'savePost', { status: text, visibility: 'public', interaction_policy: { can_reply: rules, can_favourite: rules, can_reblog: rules } }, crypto.randomUUID())
    await expect(page.getByText('New activity is available. Refresh to load it.', { exact: true })).toBeVisible()
    await info.attach('timeline-diagnostic', { body: JSON.stringify({ created: post, fetched: await api(page, 'status', post.id), timeline: await api(page, 'timeline', 'local'), newer: await api(page, 'timeline', 'local', `/api/v1/timelines/public?local=true&since_id=${earlier.id}`), relationship: await api(page, 'relationship', (await api(bob, 'account')).id) }, null, 2), contentType: 'application/json' })
    await expect.poll(async () => (await api(page, 'timeline', 'local')).items.some((item: { id: string }) => item.id === post.id)).toBe(true)
    await page.getByRole('button', { name: 'Refresh timeline', exact: true }).click()
    const card = page.locator('.status-card').filter({ hasText: text })
    await card.getByRole('button', { name: /View post and replies/ }).click()
    await page.getByRole('button', { name: 'Request to reply', exact: true }).click()
    const replyText = `@bob Approval reply ${info.project.name} ${Date.now()}`
    const composer = page.locator('.post-composer:visible')
    await composer.locator('.draft-input').fill(replyText)
    await composer.getByRole('button', { name: 'Send reply', exact: true }).click()
    await expect(composer).toHaveCount(0)
    await expect.poll(async () => (await api(bob, 'interactions')).items.filter((item: { status: { id: string } }) => item.status.id === post.id).length).toBe(1)
    await navigate(bob, 'Requests')
    const request = bob.locator('section > div').filter({ has: bob.locator('.status-card').filter({ hasText: replyText }) }).filter({ has: bob.getByRole('button', { name: 'Approve', exact: true }) })
    await request.getByRole('button', { name: 'Approve', exact: true }).click()
    await expect(request).toHaveCount(0)
    await page.getByRole('button', { name: 'Refresh conversation', exact: true }).click()
    await expect(page.locator('.status-card').filter({ hasText: replyText })).toBeVisible()
    await page.getByRole('button', { name: 'Back to timeline', exact: true }).click()
    await navigate(bob, 'Notifications')
    await expect(bob.locator('main')).toContainText('Mentioned you')

    const filter = await api(page, 'post', '/api/v2/filters', { title: 'Live hidden post', context: ['public'], filter_action: 'hide', keywords_attributes: [{ keyword: text, whole_word: false }] })
    await page.getByRole('button', { name: 'Refresh timeline', exact: true }).click()
    await expect(card).toHaveCount(0)
    await api(page, 'request', `/api/v2/filters/${filter.id}`, { method: 'DELETE' })
    await page.getByRole('button', { name: 'Refresh timeline', exact: true }).click()
    await expect(card).toBeVisible()
    await api(bob, 'deleteStatus', post.id)
    await expect(card).toHaveCount(0)
    await page.getByLabel('Live updates', { exact: true }).uncheck()
    await page.screenshot({ path: `artifacts/live/${info.project.name}-stream.png`, fullPage: true })
  } finally { await context.close() }
})

test('real warm-cache pagination preserves more than a page of new posts', async ({ page }, info) => {
  await login(page, 'bob')
  await api(page, 'savePost', { status: 'Pagination cache seed', visibility: 'public' }, crypto.randomUUID())
  await api(page, 'timeline', 'local')
  const created = new Set<string>()
  for (let index = 0; index < 25; index++) {
    const post = await api(page, 'savePost', { status: `Pagination ${info.project.name} ${index}`, visibility: 'public' }, crypto.randomUUID())
    created.add(post.id)
  }
  const found: string[] = []
  let next: string | null = null
  for (let index = 0; index < 5; index++) {
    const result = await api(page, 'timeline', 'local', next)
    found.push(...result.items.map((item: { id: string }) => item.id).filter((id: string) => created.has(id)))
    if (new Set(found).size === created.size || !result.next) break
    next = result.next
  }
  expect(found).toHaveLength(25)
  expect(new Set(found)).toEqual(created)
  await navigate(page, 'Local')
  await expect(page.locator('.status-card').filter({ hasText: `Pagination ${info.project.name} 24` })).toBeVisible()
})
