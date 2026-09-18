import { describe, expect, it } from 'vitest'
import { replyMention, replyPermission, replyVisibilities, replyVisibility } from './reply'
import type { Account, Status } from './types'

const account = { id: 'self', source: { privacy: 'public' } } as Account
const status = { id: 'parent', account: { id: 'other', acct: 'alice@remote.test' }, visibility: 'private' } as Status

describe('GoToSocial reply semantics', () => {
  it('uses server-computed me instead of inferring membership from public or followers', () => {
    const post = (automatic: string[], manual: string[]) => ({ ...status, interaction_policy: { can_reply: { automatic_approval: automatic, manual_approval: manual } } })
    expect(replyPermission(post(['followers', 'me'], []))).toBe('automatic')
    expect(replyPermission(post(['author'], ['me']))).toBe('approval')
    expect(replyPermission(post(['public'], []))).toBe('forbidden')
    expect(replyPermission(status)).toBe('unknown')
  })
  it('never defaults to a wider audience than the parent or the account preference', () => {
    expect(replyVisibilities(status).map(option => option.value)).toEqual(['private', 'direct'])
    expect(replyVisibility(status, account)).toBe('private')
    expect(replyVisibility({ ...status, visibility: 'public' }, { ...account, source: { privacy: 'direct' } })).toBe('direct')
    expect(replyVisibilities({ ...status, visibility: 'direct' }).map(option => option.value)).toEqual(['direct'])
  })
  it('mentions only the author, excluding self and implicit group recipients', () => {
    expect(replyMention({ ...status, mentions: [{ id: 'third', acct: 'third@elsewhere.test' }] }, account)).toBe('@alice@remote.test ')
    expect(replyMention({ ...status, account }, account)).toBe('')
  })
})
