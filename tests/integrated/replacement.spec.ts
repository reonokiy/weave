import { test, expect, type Page } from '@playwright/test'
import { createHmac } from 'node:crypto'

async function login(page: Page, path = '/', user = 'alice', recovery?: string) {
  await page.goto(path)
  await page.locator('main').getByRole('button', { name: 'Sign in', exact: true }).first().click()
  await page.getByLabel('Email', { exact: true }).fill(`${user}@example.test`)
  await page.getByLabel('Password', { exact: true }).fill('Weave-local-e2e-only-2026!')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  if (recovery) {
    await page.getByLabel('Authentication or recovery code', { exact: true }).fill(recovery)
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
  }
  await page.getByRole('button', { name: 'Allow', exact: true }).click()
}
async function request(page: Page, path: string, method = 'GET', body?: unknown) {
  return page.evaluate(async ({ path, method, body }) => {
    const session = JSON.parse(sessionStorage.getItem('weave.session')!)
    const response = await fetch(path, { method, headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    if (!response.ok) throw new Error(`${method} ${path}: ${response.status}`)
    const text = await response.text(); return text ? JSON.parse(text) : null
  }, { path, method, body })
}

test('same-origin OAuth and original public profile/post URLs', async ({ page, browser }, info) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await login(page)
  await expect(page.locator('.draft-input')).toBeVisible()
  const post = await request(page, '/api/v1/statuses', 'POST', { status: `Same URL ${info.project.name}`, visibility: 'public' })
  await page.goto(new URL(post.url).pathname)
  await expect(page.locator('.status-card:visible').filter({ hasText: `Same URL ${info.project.name}` })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Reply to this post', exact: true })).toBeVisible()
  await page.reload()
  await expect(page.locator('.status-card:visible').filter({ hasText: `Same URL ${info.project.name}` })).toBeVisible()
  const context = await browser.newContext()
  const visitor = await context.newPage()
  try {
    const response = await visitor.goto(post.url)
    expect(response!.status()).toBe(200)
    await expect(visitor.locator('.status-card').filter({ hasText: `Same URL ${info.project.name}` })).toBeVisible()
    await visitor.goto('http://127.0.0.1:8686/@alice')
    await expect(visitor.getByRole('heading', { name: 'alice', exact: true })).toBeVisible()
    await expect(visitor.locator('.status-card').filter({ hasText: `Same URL ${info.project.name}` })).toBeVisible()
    await visitor.screenshot({ path: `artifacts/integrated/${info.project.name}-public-profile.png`, fullPage: true })
    const unavailable = await visitor.goto('http://127.0.0.1:8686/@nonexistent')
    expect(unavailable!.status()).toBe(404)
    expect(unavailable!.headers()['content-type']).toContain('text/html')
    await expect(visitor.getByRole('heading', { name: 'Page unavailable', exact: true })).toBeVisible()
  } finally { await context.close() }
  expect(errors).toEqual([])
})

test('two-factor setup, recovery-code sign-in and disable use the real backend', async ({ page, browser }) => {
  await login(page, '/settings/user/account', 'bob')
  await page.getByRole('button', { name: 'Set up two-factor authentication', exact: true }).click()
  await expect(page.locator('img[width="256"]')).toBeVisible()
  const uri = await page.evaluate(async () => {
    const session = JSON.parse(sessionStorage.getItem('weave.session')!)
    const response = await fetch('/api/v1/user/2fa/qruri', { headers: { Authorization: `Bearer ${session.token}`, Accept: 'text/plain' } })
    if (!response.ok) throw new Error('Could not read authenticator URI')
    return response.text()
  })
  const secret = new URL(uri).searchParams.get('secret')!
  const bits = [...secret].map(char => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(char).toString(2).padStart(5, '0')).join('')
  const key = Buffer.from(bits.match(/.{8}/g)!.map(byte => parseInt(byte, 2)))
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)))
  const digest = createHmac('sha1', key).update(counter).digest()
  const offset = digest[digest.length - 1]! & 15
  const code = String((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0')
  await page.getByLabel('Authentication or recovery code', { exact: true }).fill(code)
  await page.getByRole('button', { name: 'Enable two-factor authentication', exact: true }).click()
  await expect(page.locator('.recovery-codes li')).toHaveCount(8)
  const recovery = await page.locator('.recovery-codes li').first().innerText()
  const context = await browser.newContext()
  try {
    const other = await context.newPage()
    await login(other, 'http://127.0.0.1:8686/', 'bob', recovery)
    await expect(other.locator('.draft-input')).toBeVisible()
  } finally {
    await context.close()
    await request(page, '/api/v1/user/2fa/disable', 'POST', { password: 'Weave-local-e2e-only-2026!' })
  }
  await page.reload()
  await expect(page.getByRole('button', { name: 'Set up two-factor authentication', exact: true })).toBeVisible()
})

test('application token callback preserves the existing settings session', async ({ page }, info) => {
  await login(page, '/settings/user/applications', 'carol')
  await expect(page.getByRole('heading', { name: 'Applications', exact: true })).toBeVisible()
  const before = await page.evaluate(() => sessionStorage.getItem('weave.session'))
  const app = await request(page, '/api/v1/apps', 'POST', { client_name: `Token test ${info.project.name}`, scopes: 'read', redirect_uris: 'http://127.0.0.1:8686/settings/user/applications/callback' })
  await page.goto(`/settings/user/applications/${app.id}`)
  await page.getByRole('button', { name: 'Request access token', exact: true }).click()
  await page.getByLabel('Email', { exact: true }).fill('carol@example.test')
  await page.getByLabel('Password', { exact: true }).fill('Weave-local-e2e-only-2026!')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.getByRole('button', { name: 'Allow', exact: true }).click()
  await page.getByRole('button', { name: 'Receive access token', exact: true }).click()
  const token = await page.getByTestId('application-token').innerText()
  expect(token.length).toBeGreaterThan(10)
  expect(await page.evaluate(() => sessionStorage.getItem('weave.session'))).toBe(before)
  expect(new URL(page.url()).search).toBe('')
  const valid = await page.request.get('/api/v1/accounts/verify_credentials', { headers: { Authorization: `Bearer ${token}` } })
  expect(valid.ok()).toBe(true)
  expect((await valid.json()).username).toBe('carol')
  await request(page, `/api/v1/apps/${app.id}`, 'DELETE')
})

test('protocol endpoints retain native GoToSocial responses', async ({ request }) => {
  const instance = await request.get('/api/v1/instance')
  expect((await instance.json()).version).toContain('0.22.1')
  const finger = await request.get('/.well-known/webfinger?resource=acct:alice@127.0.0.1:8686')
  expect(finger.ok()).toBe(true)
  expect((await finger.json()).subject).toBe('acct:alice@127.0.0.1:8686')
  const activity = await request.get('/@alice', { headers: { Accept: 'application/activity+json' } })
  expect(activity.headers()['content-type']).not.toContain('text/html')
  expect(await activity.text()).not.toContain('weave-server-page')
  const asset = await request.get('/assets/logo.webp')
  expect(asset.ok()).toBe(true)
  expect(asset.headers()['content-type']).toContain('image/webp')
})

test('settings authorize and persist profile and password changes', async ({ page }, info) => {
  await login(page, '/settings/user/profile', 'carol')
  const name = `Carol ${info.project.name}`
  await page.getByLabel('Display name', { exact: true }).fill(name)
  await page.getByLabel('Confirm:', { exact: false }).check()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('Changes saved.')
  expect((await request(page, '/api/v1/accounts/verify_credentials')).display_name).toBe(name)
  await page.goto('/settings/user/account')
  const form = page.locator('form').filter({ has: page.getByRole('heading', { name: 'Change password', exact: true }) })
  const replacement = `Changed-weave-${info.project.name}-2026!`
  await form.getByLabel('Current password', { exact: true }).fill('Weave-local-e2e-only-2026!')
  await form.getByLabel('New password', { exact: true }).fill(replacement)
  await form.getByLabel('Confirm new password', { exact: true }).fill(replacement)
  await form.getByRole('button', { name: 'Change password', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('Changes saved.')
  await request(page, '/api/v1/user/password_change', 'POST', { old_password: replacement, new_password: 'Weave-local-e2e-only-2026!' })
  await page.screenshot({ path: `artifacts/integrated/${info.project.name}-security.png`, fullPage: true })
  await page.goto('/settings/admin/instance/rules')
  await expect(page.getByRole('heading', { name: 'Page unavailable', exact: true })).toBeVisible()
})

test('closed registration and untranslated input survives locale changes', async ({ page }) => {
  test.skip(process.env.GTS_TEST_REGISTRATION === 'true')
  await page.goto('/signup')
  await expect(page.getByText('This instance is not accepting new registrations.')).toBeVisible()
  await page.getByLabel('Language', { exact: true }).selectOption('zh-CN')
  await expect(page.getByText('本站暂不接受新注册。')).toBeVisible()
  expect(await page.locator('input[name=password]').count()).toBe(0)
})

test('open registration submits through the unchanged signup handler', async ({ page }, info) => {
  test.skip(process.env.GTS_TEST_REGISTRATION !== 'true')
  await page.goto('/signup')
  await page.getByLabel('Email', { exact: true }).fill(`visitor-${info.project.name}@example.test`)
  await page.locator('input[name=username]').fill(`visitor_${info.project.name}`)
  await page.getByLabel('Password', { exact: true }).fill('Visitor-local-e2e-only-2026!')
  await page.locator('textarea[name=reason]').fill('Joining this isolated instance to verify the registration interface.')
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Create account', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Registration submitted', exact: true })).toBeVisible()
})

test('remote interaction keeps its URI through OAuth and opens the requested post', async ({ page }, info) => {
  await login(page)
  await expect(page.locator('.draft-input')).toBeVisible()
  const post = await request(page, '/api/v1/statuses', 'POST', { status: `Remote interaction ${info.project.name}`, visibility: 'public' })
  await page.evaluate(() => sessionStorage.clear())
  await login(page, '/authorize_interaction?' + new URLSearchParams({ uri: post.url }))
  await expect(page.locator('main')).toContainText(post.url)
  await page.getByRole('button', { name: 'Open in Weave', exact: true }).click()
  await expect(page.locator('.status-card:visible').filter({ hasText: `Remote interaction ${info.project.name}` })).toBeVisible()
})

test('domain permission import and export preserve their original routes', async ({ page }, info) => {
  const failed: string[] = []
  page.on('response', response => { if (response.status() >= 500) failed.push(response.url()) })
  await login(page, '/settings/moderation/domain-permissions/import-export')
  const domain = `blocked-${info.project.name}.example`
  await page.getByLabel('GoToSocial JSON file', { exact: true }).setInputFiles({ name: 'blocks.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify([{ domain, public_comment: 'Local integration test' }])) })
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Import permissions', exact: true }).click()
  await expect.poll(async () => (await request(page, '/api/v1/admin/domain_blocks')).some((item: { domain: string }) => item.domain === domain)).toBe(true)
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export permissions', exact: true }).click()
  expect((await download).suggestedFilename()).toBe('domain-blocks.json')
  await page.goto(`/settings/moderation/domain-permissions/blocks/${domain}`)
  await expect(page.locator('.settings-content')).toContainText(domain)
  expect(failed).toEqual([])
})

test('administrator manages instance rules using original settings URLs', async ({ page }, info) => {
  await login(page, '/settings/admin/instance/rules')
  await page.getByRole('button', { name: 'Create Instance rules', exact: true }).click()
  const form = page.locator('form')
  const text = `Be considerate ${info.project.name}`
  await form.getByLabel('Text', { exact: false }).fill(text)
  await form.getByRole('checkbox').check()
  await form.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('Changes saved.')
  const rules = await request(page, '/api/v1/admin/instance/rules')
  const rule = rules.find((entry: { text: string }) => entry.text === text)
  expect(rule).toBeTruthy()
  await page.goto(`/settings/admin/instance/rules/${rule.id}`)
  await expect(page.locator('.settings-content')).toContainText(text)
  await page.getByRole('button', { name: 'Edit Instance rules', exact: true }).click()
  await page.getByLabel('Text', { exact: false }).fill(`${text} updated`)
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('Changes saved.')
  expect((await request(page, `/api/v1/admin/instance/rules/${rule.id}`)).text).toBe(`${text} updated`)
  await page.screenshot({ path: `artifacts/integrated/${info.project.name}-admin-rules.png`, fullPage: true })
  await page.getByRole('button', { name: 'Delete Instance rules', exact: true }).click()
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('Changes saved.')
  expect((await request(page, '/api/v1/admin/instance/rules')).some((entry: { id: string }) => entry.id === rule.id)).toBe(false)
})
