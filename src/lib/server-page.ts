import type { Account, Instance, Status } from './types'

export interface ServerPage {
  pageContent: string
  instance?: Instance
  account?: Account
  context?: { Status: Status; Statuses: Status[] }
  statuses?: Status[]
  pinned_statuses?: Status[]
  statuses_next?: string
  statuses_prev?: string
  accounts?: Account[]
  accounts_next?: string
  accounts_prev?: string
  tagName?: string
  registrationOpen?: boolean
  reasonRequired?: boolean
  oidcEnabled?: boolean
  showAcctDir?: boolean
  user?: string
  username?: string
  email?: string
  token?: string
  oobToken?: string
  blocklist?: { domain: string; public_comment?: string }[]
  allowlist?: { domain: string; public_comment?: string }[]
  appname?: string
  appwebsite?: string
  scope?: string
  redirect?: string
  name?: string
  suggestedUsername?: string
  interactionURI?: string
  code?: number | string
  error?: string
}

export function readServerPage(): ServerPage | null {
  const element = document.getElementById('weave-server-page')
  if (!element) return null
  const page: ServerPage = JSON.parse(element.textContent ?? '{}')
  if (typeof page.pageContent !== 'string') throw new Error('Invalid server page')
  return page
}

export function localPageUrl(value: string | undefined): string | undefined {
  if (!value) return
  try { const url = new URL(value, location.origin); if (url.origin === location.origin && !url.username && !url.password) return url.pathname + url.search + url.hash } catch {}
}
