import type { Page } from '@playwright/test'
import type { Account, Status } from '../../src/lib/types'

// Synthetic fixtures exist only in the browser test harness, never in the shipped app.
const origin = 'https://social.example.org'
const SCOPES = 'read write:statuses write:favourites write:follows write:media write:bookmarks write:mutes write:blocks write:accounts write:filters'
export const self: Account = { id: 'self', username: 'alex', acct: 'alex', display_name: 'Alex Morgan', avatar: `${origin}/avatar/self`, url: `${origin}/@alex`, source: { privacy: 'unlisted', language: 'en', note: 'Collecting small moments. Building things with care.' } }
const maya = { ...self, id: 'maya', username: 'maya', acct: 'maya@studio.social', display_name: 'Maya Chen', avatar: `${origin}/avatar/maya`, url: `${origin}/@maya`, source: undefined }
const jonas = { ...maya, id: 'jonas', username: 'jonas', acct: 'jonas@slow.social', display_name: 'Jonas Berg', avatar: `${origin}/avatar/jonas` }
const rules = { automatic_approval: ['public', 'me'], manual_approval: [] }
const base = { id: 'post-1', account: maya, content: '<p>A small reminder to make room for the things that don’t have a deadline.</p><p>Spent the morning walking by the water. No headphones, no destination. Just a little space to think.</p>', created_at: '2026-09-12T08:12:00Z', url: `${origin}/@maya/statuses/post-1`, visibility: 'public', sensitive: false, spoiler_text: '', media_attachments: [], reblog: null, favourites_count: 24, reblogs_count: 3, replies_count: 6, favourited: false, reblogged: false, bookmarked: false, interaction_policy: { can_reply: rules, can_favourite: rules, can_reblog: rules } } satisfies Status
export const posts = [
  base,
  { ...base, id: 'post-2', account: jonas, content: '<p>What’s one thing you learned this week that surprised you?</p><p>I’ll go first: the best part of a side project is often the people you meet along the way.</p>', created_at: '2026-09-12T07:45:00Z', favourites_count: 12, replies_count: 4, reblogs_count: 1 },
  { ...base, id: 'post-3', account: self, content: '<p>Working on a quieter corner of the internet. A little less noise, a little more connection. 🌿</p>', created_at: '2026-09-12T07:20:00Z', favourites_count: 8, replies_count: 2, reblogs_count: 0 },
]
export async function fixture(page: Page, signedIn = true) {
  await page.addInitScript(({ signedIn, origin, scopes }) => {
    localStorage.setItem('weave.locale', 'en')
    if (signedIn) sessionStorage.setItem('weave.session', JSON.stringify({ origin, token: 'fixture-token', client_id: 'fixture-app', client_secret: 'fixture-secret', scopes }))
  }, { signedIn, origin, scopes: SCOPES })
  await page.route(`${origin}/**`, async route => {
    const url = new URL(route.request().url())
    const path = url.pathname
    const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS' }
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    if (path.startsWith('/avatar/')) {
      const label = path.endsWith('maya') ? 'M' : path.endsWith('jonas') ? 'J' : 'A'
      const fill = label === 'M' ? '#ded3bf' : label === 'J' ? '#d6e2df' : '#d6dbee'
      return route.fulfill({ contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" rx="30" fill="${fill}"/><text x="48" y="63" text-anchor="middle" font-family="sans-serif" font-size="44" fill="#33483f">${label}</text></svg>` })
    }
    let data: unknown
    if (path.endsWith('/instance')) data = { title: 'The Garden', version: '0.21.0', configuration: { statuses: { max_characters: 5000, max_media_attachments: 4 }, polls: { max_options: 6, min_expiration: 300, max_expiration: 2629746 } } }
    else if (path.endsWith('/verify_credentials')) data = self
    else if (path.includes('/timelines/') || path === '/api/v1/bookmarks' || /accounts\/[^/]+\/statuses$/.test(path)) data = posts
    else if (path.endsWith('/context')) data = { ancestors: [], descendants: [{ ...posts[1], id: 'reply-1' }] }
    else if (path.endsWith('/relationships')) data = [{ id: 'maya', following: false, requested: false, followed_by: true, blocking: false, muting: false }]
    else if (path === '/api/v1/notifications') data = [{ id: 'notification-1', type: 'favourite', account: maya, status: posts[2], created_at: base.created_at }]
    else if (path === '/api/v2/search') data = { accounts: [maya, jonas], statuses: [base], hashtags: [] }
    else if (path === '/api/v1/interaction_requests') data = [{ id: 'request-1', type: 'reply', account: jonas, status: base, reply: posts[1] }]
    else if (path === '/api/v1/follow_requests') data = [maya]
    else if (path === '/api/v2/filters') data = []
    else if (path.endsWith('/interaction_policies/defaults')) data = { public: base.interaction_policy, unlisted: base.interaction_policy, private: base.interaction_policy, direct: base.interaction_policy }
    else if (/\/accounts\/[^/]+$/.test(path)) data = { ...maya, note: '<p>Designing useful things. Walking the long way home.</p>', followers_count: 128, following_count: 86 }
    else if (/\/statuses\/[^/]+\/(un)?favourite$/.test(path)) data = { ...base, favourited: !path.endsWith('/unfavourite'), favourites_count: 25 }
    else if (/\/statuses\/[^/]+$/.test(path)) data = posts.find(post => post.id === path.split('/').at(-1)) ?? base
    else if (path === '/api/v1/statuses' && route.request().method() === 'POST') data = { ...base, id: 'published', account: self }
    else return route.fulfill({ status: 404, headers, json: { error: `Unmocked fixture route: ${path}` } })
    return route.fulfill({ headers, json: data })
  })
}
