import type { Account, Status, Visibility } from './types'
import { statusUnavailable } from './status'

export const visibilityOptions: { value: Visibility; label: string }[] = [
  { value: 'public', label: 'public' },
  { value: 'unlisted', label: 'unlisted' },
  { value: 'private', label: 'private' },
  { value: 'direct', label: 'direct' },
]

export function replyVisibilities(status: Status) {
  return visibilityOptions.slice(visibilityOptions.findIndex(option => option.value === status.visibility))
}

export function replyVisibility(status: Status, account: Account): Visibility {
  const allowed = replyVisibilities(status)
  return allowed.find(option => option.value === account.source?.privacy)?.value ?? allowed[0]!.value
}

export function replyPermission(status: Status): 'automatic' | 'approval' | 'forbidden' | 'unknown' {
  if (statusUnavailable(status)) return 'forbidden'
  const rules = status.interaction_policy?.can_reply
  if (!rules) return 'unknown'
  // GoToSocial computes "me" for the authenticated requester; do not infer relationships locally.
  if (rules.automatic_approval?.includes('me')) return 'automatic'
  if (rules.manual_approval?.includes('me')) return 'approval'
  return 'forbidden'
}

export function replyMention(status: Status, account: Account): string {
  // Mention only the author. Additional recipients must be an explicit choice.
  return !status.account || status.account.id === account.id ? '' : `@${status.account.acct} `
}
