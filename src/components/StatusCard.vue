<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ArrowUpRight, Bookmark, Heart, MessageCircle, Repeat2, Shield } from '@lucide/vue'
import PostComposer from './PostComposer.vue'
import { ApiError } from '../lib/api'
import { hasScope } from '../lib/auth'
import { errorText, LocalizedError } from '../i18n'
import { useWorkspace } from '../lib/workspace'
import type { Status } from '../lib/types'
import { safeUrl } from '../lib/api'
import { renderContent } from '../lib/content'
import { statusUnavailable } from '../lib/status'

const { t, locale, n } = useI18n()
const props = defineProps<{ status: Status }>()
defineEmits<{ open: [status: Status] }>()
const workspace = useWorkspace()
const post = computed(() => {
  const original = props.status.reblog ?? props.status
  const update = workspace?.updates.get(original.id)
  // Filters belong to the view's context, not to an action response from another view.
  return update ? { ...update, filtered: original.filtered } : original
})
const actionBusy = computed(() => workspace?.pending.has(post.value.id) ?? false)
const actionError = ref<string | Error>('')
const actionNotice = ref(false)
const editing = ref(false)
watch(editing, value => { if (value) workspace?.drafts.add(post.value.id); else workspace?.drafts.delete(post.value.id) })
onBeforeUnmount(() => workspace?.drafts.delete(post.value.id))
const confirmDelete = ref(false)
const choices = ref<number[]>([])
const own = computed(() => Boolean(post.value.account) && workspace?.account.value?.id === post.value.account?.id)
const unavailable = computed(() => statusUnavailable(post.value))
const permission = (kind: 'can_favourite' | 'can_reblog') => {
  const rules = post.value.interaction_policy?.[kind]
  return !rules || rules.automatic_approval?.includes('me') || rules.manual_approval?.includes('me')
}
const allowed = (scope: string) => workspace?.session.value && hasScope(workspace.session.value, scope)
function report(reason: unknown) { actionError.value = reason instanceof Error ? reason : new LocalizedError('operationFailed'); if (reason instanceof ApiError && reason.status === 401) workspace?.report(reason) }
function openAccount(event: MouseEvent) { if (workspace && post.value.account) { event.preventDefault(); workspace.openProfile(post.value.account.id) } }
async function action(kind: 'favourite' | 'unfavourite' | 'reblog' | 'unreblog' | 'bookmark' | 'unbookmark') {
  if (!workspace?.client.value || actionBusy.value) return
  const owner = workspace.session.value
  const id = post.value.id; workspace.pending.add(id); actionError.value = ''; actionNotice.value = false
  try { const result = await workspace.client.value.statusAction(id, kind); if (workspace.session.value !== owner) return; workspace.updates.set(id, result); actionNotice.value = kind === 'favourite' || kind === 'reblog' }
  catch (reason) { if (workspace.session.value === owner) report(reason) }
  finally { if (workspace.session.value === owner) workspace.pending.delete(id) }
}
async function remove() {
  if (!workspace?.client.value || actionBusy.value) return
  const owner = workspace.session.value
  const id = post.value.id; workspace.pending.add(id)
  try { await workspace.client.value.deleteStatus(id); if (workspace.session.value === owner) workspace.deleted.add(id) }
  catch (reason) { if (workspace.session.value === owner) report(reason) }
  finally { if (workspace.session.value === owner) workspace.pending.delete(id); confirmDelete.value = false }
}
async function updatePoll(vote = false) {
  if (!workspace?.client.value || !post.value.poll || actionBusy.value) return
  const owner = workspace.session.value
  const id = post.value.id; workspace.pending.add(id); actionError.value = ''
  try {
    const poll = vote ? await workspace.client.value.vote(post.value.poll.id, choices.value) : await workspace.client.value.poll(post.value.poll.id)
    if (workspace.session.value !== owner) return
    workspace.updates.set(id, { ...post.value, poll }); choices.value = []
  } catch (reason) { if (workspace.session.value === owner) report(reason) }
  finally { if (workspace.session.value === owner) workspace.pending.delete(id) }
}
function toggleChoice(index: number) { choices.value = post.value.poll?.multiple ? choices.value.includes(index) ? choices.value.filter(value => value !== index) : [...choices.value, index] : [index] }
const revealed = ref(false)
const visible = computed(() => revealed.value || (!post.value.spoiler_text && !post.value.sensitive && !warnings.value.length))
const warnings = computed(() => post.value.filtered?.filter(item => item.filter.filter_action === 'warn').map(item => item.filter.title) ?? [])
const restricted = computed(() => Object.values(post.value.interaction_policy ?? {}).some(rules => !rules.automatic_approval?.includes('me')))
const blurred = computed(() => post.value.filtered?.some(item => item.filter.filter_action === 'blur'))
const hidden = computed(() => workspace?.deleted.has(post.value.id) || post.value.filtered?.some(item => item.filter.filter_action === 'hide'))
const time = computed(() => new Date(post.value.created_at).toLocaleString(locale.value, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }))
</script>

<template>
  <article v-if="!hidden" class="status-card">
    <p v-if="status.reblog && status.account" class="mb-3 flex items-center gap-2 text-sm text-muted"><Repeat2 :size="15" />{{ t('boosted', { name: status.account.display_name || status.account.username }) }}</p>
    <p v-if="unavailable || !post.account" class="text-sm text-muted">{{ t('postUnavailable') }}</p>
    <div v-else class="flex items-start gap-3">
      <a :href="safeUrl(post.account.url)" target="_blank" rel="noopener noreferrer" class="avatar" :aria-label="post.account.display_name || post.account.username" @click="openAccount">
        <img v-if="safeUrl(post.account.avatar)" :src="safeUrl(post.account.avatar)" alt="" loading="lazy" referrerpolicy="no-referrer" />
        <span v-else>{{ post.account.username.slice(0, 1).toUpperCase() }}</span>
      </a>
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-baseline justify-between gap-x-3">
          <a :href="safeUrl(post.account.url)" class="font-semibold text-ink" target="_blank" rel="noopener noreferrer" @click="openAccount">{{ post.account.display_name || post.account.username }}</a>
          <time :datetime="post.created_at" class="text-sm text-muted">{{ time }}</time>
        </div>
        <p class="mt-0.5 break-all text-sm text-muted">@{{ post.account.acct }}</p>
        <div v-if="post.spoiler_text || post.sensitive || warnings.length || blurred" class="warning-box mt-4">
          <p class="font-medium">{{ post.spoiler_text || (warnings.length ? t('filteredWarning', { filters: warnings.join(', ') }) : t('sensitiveContent')) }}</p>
          <button class="btn-quiet mt-2 text-sm" :aria-expanded="blurred ? revealed : visible" @click="revealed = !revealed">{{ revealed ? t('hideContent') : t('showContent') }}</button>
        </div>
        <template v-if="visible">
          <div class="post-content mt-4" v-html="renderContent(post.content, post.emojis)" />
          <div v-if="post.media_attachments.length && (!blurred || revealed)" class="mt-4 grid gap-2">
            <template v-for="media in post.media_attachments" :key="media.id">
              <a v-if="media.type === 'image' && safeUrl(media.url)" :href="safeUrl(media.url)" target="_blank" rel="noopener noreferrer">
                <img class="post-image" :src="safeUrl(media.preview_url) || safeUrl(media.url)" :alt="media.description || t('imageAlt')" loading="lazy" referrerpolicy="no-referrer" />
              </a>
              <video v-else-if="['video', 'gifv'].includes(media.type) && safeUrl(media.url)" class="post-image" controls preload="none" :src="safeUrl(media.url)" :poster="safeUrl(media.preview_url)" :aria-label="media.description || t('videoAlt')" />
              <audio v-else-if="media.type === 'audio' && safeUrl(media.url)" class="w-full" controls preload="none" :src="safeUrl(media.url)" :aria-label="media.description || t('audioAlt')" />
              <p v-else class="text-sm text-muted">{{ t('attachmentUnavailable') }}</p>
            </template>
          </div>
          <div v-if="post.poll" class="mt-4 grid gap-2">
            <label v-for="(option, index) in post.poll.options" :key="index" class="rounded-lg border border-line p-3">
              <input v-if="workspace && !post.poll.expired && !post.poll.voted && !own" type="checkbox" :checked="choices.includes(index)" :disabled="actionBusy" @change="toggleChoice(index)" />
              {{ option.title }} <span v-if="option.votes_count != null" class="float-right text-muted">{{ t('votes', { count: n(option.votes_count) }, option.votes_count) }}</span>
            </label>
            <p v-if="post.poll.expired || post.poll.voted" class="text-sm text-muted">{{ t(post.poll.expired ? 'pollEnded' : 'voted') }}</p>
            <div v-if="workspace" class="flex flex-wrap gap-2">
              <button v-if="!post.poll.expired && !post.poll.voted && !own" class="btn-primary" :disabled="actionBusy || !choices.length" @click="updatePoll(true)">{{ t('vote') }}</button>
              <button class="btn-quiet" :disabled="actionBusy" @click="updatePoll()">{{ t('refreshPoll') }}</button>
            </div>
          </div>
        </template>
        <p v-if="restricted" class="mt-4 flex items-center gap-1.5 text-sm text-muted"><Shield :size="14" />{{ t('interactionHint') }}</p>
        <footer class="status-actions">
          <button class="btn-quiet" :aria-label="t('viewReplies', { count: n(post.replies_count) })" @click="$emit('open', post)"><MessageCircle :size="17" />{{ n(post.replies_count) }}</button>
          <button class="btn-quiet" :aria-label="t(post.reblogged ? 'unboost' : 'boost')" :aria-pressed="Boolean(post.reblogged)" :disabled="!workspace || actionBusy || !allowed('write:statuses') || (!post.reblogged && !permission('can_reblog'))" @click="action(post.reblogged ? 'unreblog' : 'reblog')"><Repeat2 :size="17" />{{ n(post.reblogs_count) }}</button>
          <button class="btn-quiet" :aria-label="t(post.favourited ? 'unlike' : 'like')" :aria-pressed="Boolean(post.favourited)" :disabled="!workspace || actionBusy || !allowed('write:favourites') || (!post.favourited && !permission('can_favourite'))" @click="action(post.favourited ? 'unfavourite' : 'favourite')"><Heart :size="17" />{{ n(post.favourites_count) }}</button>
          <button v-if="workspace" class="btn-quiet" :aria-label="t(post.bookmarked ? 'unbookmark' : 'bookmark')" :aria-pressed="Boolean(post.bookmarked)" :disabled="actionBusy || !allowed('write:bookmarks')" @click="action(post.bookmarked ? 'unbookmark' : 'bookmark')"><Bookmark :size="17" /></button>
          <a v-if="safeUrl(post.url)" :href="safeUrl(post.url)" target="_blank" rel="noopener noreferrer" class="ml-auto inline-flex items-center gap-1" :aria-label="t('openOriginal')">{{ t('original') }}<ArrowUpRight :size="16" /></a>
        </footer>
        <p v-if="actionError" role="alert" class="message error-message">{{ errorText(actionError) }}</p>
        <p v-if="actionNotice" role="status" class="text-sm text-muted mt-3">{{ t('approvalAction') }}</p>
        <div v-if="own && workspace" class="flex flex-wrap gap-2 mt-3">
          <button class="btn-quiet" :disabled="actionBusy" @click="editing = !editing">{{ t(editing ? 'cancel' : 'edit') }}</button>
          <button class="btn-quiet" :disabled="actionBusy || editing" @click="confirmDelete = true">{{ t('deletePost') }}</button>
        </div>
        <div v-if="confirmDelete" class="warning-box mt-3"><p>{{ t('deleteConfirm') }}</p><button class="btn-primary" :disabled="actionBusy" @click="remove">{{ t('deletePost') }}</button><button class="btn-quiet" :disabled="actionBusy" @click="confirmDelete = false">{{ t('cancel') }}</button></div>
        <PostComposer v-if="editing && workspace?.session.value && workspace.account.value" :session="workspace.session.value" :account="workspace.account.value" :instance="workspace.instance.value" :edit="post" @published="workspace.updates.set($event.id, $event); editing = false" @cancel="editing = false" @expired="workspace.report" @busy="$event ? workspace.pending.add(post.id) : workspace.pending.delete(post.id)" />
      </div>
    </div>
  </article>
</template>
