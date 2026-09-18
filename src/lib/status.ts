import type { Status } from './types'

export function statusUnavailable(status: Status): boolean {
  if (!status.account) return true
  // GoToSocial thread tombstones retain the author but serialize zero-value rules.
  const rules = Object.values(status.interaction_policy ?? {})
  return rules.length > 0 && rules.every(rule => rule.automatic_approval === null && rule.manual_approval === null)
}
