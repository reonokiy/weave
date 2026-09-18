import type { InteractionPolicy, Visibility } from './types'

export function policyPreset(mode: string, visibility: Visibility): InteractionPolicy | undefined {
  if (mode === 'default') return undefined
  const audience = visibility === 'direct' ? 'mentioned' : visibility === 'private' ? 'followers' : 'public'
  const rules = () => ({ automatic_approval: mode === 'automatic' ? ['author', audience] : ['author', 'mentioned'], manual_approval: mode === 'approval' ? [audience] : [] })
  return { can_reply: rules(), can_favourite: rules(), can_reblog: rules() }
}
