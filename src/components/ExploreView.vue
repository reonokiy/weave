<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import StatusCard from './StatusCard.vue'
import { ApiError, safeUrl } from '../lib/api'
import { hasScope } from '../lib/auth'
import { sanitizeContent } from '../lib/content'
import { useWorkspace } from '../lib/workspace'
import { errorText, LocalizedError } from '../i18n'
import type { Account, InteractionRequest, Notification, Relationship, Status } from '../lib/types'

const props = defineProps<{ view: 'notifications' | 'search' | 'bookmarks' | 'requests' | 'profile'; accountId?: string }>()
const emit = defineEmits<{ open: [status: Status] }>()
const { t, te, n } = useI18n()
const workspace = useWorkspace()!
const statuses = ref<Status[]>([])
const accounts = ref<Account[]>([])
const notifications = ref<Notification[]>([])
const requests = ref<InteractionRequest[]>([])
const hashtags = ref<{ name: string; url: string }[]>([])
const profile = ref<Account | null>(null)
const relationship = ref<Relationship | null>(null)
const requestKind = ref<'interactions' | 'follows'>('interactions')
const query = ref('')
const resolve = ref(false)
const next = ref<string | null>(null)
const loading = ref(false)
const error = ref<string | Error>('')
const searched = ref(false)
let generation = 0
const api = computed(() => workspace.client.value!)
const empty = computed(() => !statuses.value.length && !accounts.value.length && !notifications.value.length && !requests.value.length && !hashtags.value.length)
const notificationLabel = (type: string) => { const key = `notification_${type.replaceAll('.', '_')}`; return te(key) ? t(key) : t('notification_unknown', { type }) }
const allowed = (scope: string) => workspace.session.value && hasScope(workspace.session.value, scope)
function report(reason: unknown) {
  error.value = reason instanceof ApiError && [404, 501].includes(reason.status) ? new LocalizedError('featureUnavailable') : reason instanceof Error ? reason : new LocalizedError('operationFailed')
  if (reason instanceof ApiError && reason.status === 401) workspace.report(reason)
}
const merge = <T extends { id: string }>(old: T[], items: T[], more: boolean) => [...new Map((more ? [...old, ...items] : items).map(item => [item.id, item])).values()]
function clear() { statuses.value = []; accounts.value = []; notifications.value = []; requests.value = []; hashtags.value = []; next.value = null; profile.value = null; relationship.value = null }
async function load(more = false) {
  if (!workspace.client.value) return
  const id = ++generation
  loading.value = true; error.value = ''
  try {
    if (props.view === 'search') {
      if (!query.value.trim()) return
      const result = await api.value.search(query.value.trim(), resolve.value)
      if (id !== generation) return
      statuses.value = result.statuses; accounts.value = result.accounts; hashtags.value = result.hashtags; searched.value = true
    } else if (props.view === 'profile' && props.accountId) {
      const results = await Promise.allSettled([api.value.profile(props.accountId), api.value.relationship(props.accountId), api.value.accountStatuses(props.accountId, more ? next.value : null)])
      if (id !== generation) return
      const [user, relation, posts] = results
      if (user.status === 'fulfilled') profile.value = user.value; else report(user.reason)
      if (relation.status === 'fulfilled') relationship.value = relation.value; else report(relation.reason)
      if (posts.status === 'fulfilled') { statuses.value = merge(statuses.value, posts.value.items, more); next.value = posts.value.next } else report(posts.reason)
    } else if (props.view === 'notifications') {
      const page = await api.value.notifications(more ? next.value : null); if (id !== generation) return
      notifications.value = merge(notifications.value, page.items, more); next.value = page.next
    } else if (props.view === 'bookmarks') {
      const page = await api.value.bookmarks(more ? next.value : null); if (id !== generation) return
      statuses.value = merge(statuses.value, page.items, more); next.value = page.next
    } else if (requestKind.value === 'follows') {
      const page = await api.value.followRequests(more ? next.value : null); if (id !== generation) return
      accounts.value = merge(accounts.value, page.items, more); next.value = page.next
    } else {
      const page = await api.value.interactions(more ? next.value : null); if (id !== generation) return
      requests.value = merge(requests.value, page.items, more); next.value = page.next
    }
  } catch (reason) { if (id === generation) report(reason) }
  finally { if (id === generation) loading.value = false }
}
async function relationshipAction(action: 'follow' | 'unfollow' | 'mute' | 'unmute' | 'block' | 'unblock') {
  if (!profile.value) return
  const id = profile.value.id
  if (workspace.pending.has(id)) return
  workspace.pending.add(id); error.value = ''
  try { relationship.value = await api.value.accountAction(id, action); if (action === 'block' || action === 'unblock') await load() }
  catch (reason) { report(reason) }
  finally { workspace.pending.delete(id) }
}
async function review(id: string, action: 'authorize' | 'reject') {
  if (workspace.pending.has(id)) return
  workspace.pending.add(id); error.value = ''
  try {
    if (requestKind.value === 'follows') { await api.value.reviewFollow(id, action); accounts.value = accounts.value.filter(item => item.id !== id) }
    else { await api.value.reviewInteraction(id, action); requests.value = requests.value.filter(item => item.id !== id) }
  } catch (reason) { report(reason) }
  finally { workspace.pending.delete(id) }
}
watch(() => [props.view, props.accountId, requestKind.value], () => { generation++; clear(); error.value = ''; if (props.view !== 'search') void load() }, { immediate: true })
onBeforeUnmount(() => generation++)
</script>

<template>
  <section :aria-label="t(view)" :aria-busy="loading">
    <div class="feed-label"><h2>{{ t(view) }}</h2><button v-if="view !== 'search'" class="btn-quiet" :disabled="loading" @click="load()">{{ t('refresh') }}</button></div>
    <form v-if="view === 'search'" class="composer" @submit.prevent="load()">
      <label for="search" class="sr-only">{{ t('search') }}</label><input id="search" v-model="query" class="field" :placeholder="t('searchPlaceholder')" required />
      <label class="flex gap-2 mt-3"><input v-model="resolve" type="checkbox" />{{ t('resolveRemote') }}</label>
      <button class="btn-primary mt-3" :disabled="loading">{{ t('search') }}</button><p class="mt-3 text-sm text-muted">{{ t('searchHint') }}</p>
    </form>
    <div v-if="view === 'requests'" class="feed-label"><button class="btn-quiet" :aria-pressed="requestKind === 'interactions'" @click="requestKind = 'interactions'">{{ t('interactionRequests') }}</button><button class="btn-quiet" :aria-pressed="requestKind === 'follows'" @click="requestKind = 'follows'">{{ t('followRequests') }}</button></div>
    <p v-if="error" class="message error-message" role="alert">{{ errorText(error) }}</p>
    <div v-if="profile" class="composer">
      <h2>{{ profile.display_name || profile.username }}</h2><p class="text-muted">@{{ profile.acct }}</p>
      <div class="post-content mt-3" v-html="sanitizeContent(profile.note ?? '')" />
      <p class="text-sm text-muted mt-3">{{ t('followersCount', { count: n(profile.followers_count ?? 0) }) }} · {{ t('followingCount', { count: n(profile.following_count ?? 0) }) }}</p>
      <p v-if="relationship?.followed_by" class="text-sm mt-3">{{ t('followsYou') }}</p>
      <div v-if="relationship && profile.id !== workspace.account.value?.id" class="flex flex-wrap gap-2 mt-3">
        <button class="btn-primary" :disabled="workspace.pending.has(profile.id) || !allowed('write:follows') || relationship.blocking" @click="relationshipAction(relationship.following || relationship.requested ? 'unfollow' : 'follow')">{{ t(relationship.following ? 'unfollow' : relationship.requested ? 'requested' : 'follow') }}</button>
        <button class="btn-quiet" :disabled="workspace.pending.has(profile.id) || !allowed('write:mutes')" @click="relationshipAction(relationship.muting ? 'unmute' : 'mute')">{{ t(relationship.muting ? 'unmute' : 'mute') }}</button>
        <button class="btn-quiet" :disabled="workspace.pending.has(profile.id) || !allowed('write:blocks')" @click="relationshipAction(relationship.blocking ? 'unblock' : 'block')">{{ t(relationship.blocking ? 'unblock' : 'block') }}</button>
      </div>
    </div>
    <div v-for="user in accounts" :key="user.id" class="status-card">
      <button class="btn-quiet" @click="workspace.openProfile(user.id)">{{ user.display_name || user.username }} · @{{ user.acct }}</button>
      <div v-if="view === 'requests'" class="flex gap-2 mt-3"><button class="btn-primary" :disabled="workspace.pending.has(user.id) || !allowed('write:follows')" @click="review(user.id, 'authorize')">{{ t('approve') }}</button><button class="btn-quiet" :disabled="workspace.pending.has(user.id) || !allowed('write:follows')" @click="review(user.id, 'reject')">{{ t('reject') }}</button></div>
    </div>
    <div v-for="notification in notifications" :key="notification.id">
      <div class="feed-label"><button class="btn-quiet" @click="workspace.openProfile(notification.account.id)">{{ notification.account.display_name || notification.account.username }}</button><span>{{ notificationLabel(notification.type) }}</span></div>
      <StatusCard v-if="notification.status" :status="notification.status" @open="emit('open', $event)" />
    </div>
    <div v-for="request in requests" :key="request.id">
      <div class="feed-label"><button class="btn-quiet" @click="workspace.openProfile(request.account.id)">{{ request.account.display_name || request.account.username }}</button><span>{{ t('requestType', { type: request.type }) }}</span></div>
      <StatusCard :status="request.reply ?? request.status" @open="emit('open', $event)" />
      <div class="p-4 flex gap-2"><button class="btn-primary" :disabled="workspace.pending.has(request.id)" @click="review(request.id, 'authorize')">{{ t('approve') }}</button><button class="btn-quiet" :disabled="workspace.pending.has(request.id)" @click="review(request.id, 'reject')">{{ t('reject') }}</button></div>
    </div>
    <StatusCard v-for="status in statuses" :key="status.id" :status="status" @open="emit('open', $event)" />
    <div v-if="hashtags.length" class="composer"><h2>{{ t('hashtags') }}</h2><a v-for="tag in hashtags" :key="tag.name" :href="safeUrl(tag.url)" target="_blank" rel="noopener noreferrer" class="btn-quiet">#{{ tag.name }}</a></div>
    <p v-if="loading" class="empty-state" role="status">{{ t('loading') }}</p>
    <p v-else-if="empty && !error && (view !== 'search' || searched)" class="empty-state">{{ t('emptyResults') }}</p>
    <div v-if="next" class="p-6 text-center"><button class="btn-quiet" :disabled="loading" @click="load(true)">{{ t('loadMore') }}</button></div>
  </section>
</template>
