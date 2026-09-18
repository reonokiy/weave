import { inject, type InjectionKey, type Ref, type ComputedRef } from 'vue'
import type { GtsClient } from './api'
import type { Account, Instance, Session, Status } from './types'

export interface Workspace {
  client: ComputedRef<GtsClient | null>; session: Ref<Session | null>; account: Ref<Account | null>; instance: Ref<Instance | null>
  updates: Map<string, Status>; deleted: Set<string>; pending: Set<string>; drafts: Set<string>
  report: (reason: unknown) => void; openProfile: (id: string) => void
}
export const workspaceKey: InjectionKey<Workspace> = Symbol('workspace')
export const useWorkspace = () => inject(workspaceKey, null)
