<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { errorText, LocalizedError } from '../i18n'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ArrowLeft, RefreshCw, Send } from '@lucide/vue'
import StatusCard from './StatusCard.vue'
import PostComposer from './PostComposer.vue'
import { ApiError, clientFor } from '../lib/api'
import { replyPermission } from '../lib/reply'
import type { Account, Instance, Session, Status, ThreadContext } from '../lib/types'

const { t } = useI18n()
const props = defineProps<{ statusId: string; session: Session; account: Account; instance: Instance | null }>()
const emit = defineEmits<{ close: []; expired: [reason: unknown]; busy: [value: boolean] }>()
const selected = ref(props.statusId)
const post = ref<Status | null>(null)
const context = ref<ThreadContext>({ ancestors: [], descendants: [] })
const loading = ref(false)
const error = ref<string | Error>('')
const notice = ref('')
const replying = ref(false)
const publishing = ref(false)
let generation = 0
const permission = computed(() => post.value ? replyPermission(post.value) : 'unknown')
const hidden = computed(() => post.value?.filtered?.some(item => item.filter.filter_action === 'hide'))

function report(reason: unknown) {
  if (reason instanceof ApiError && reason.status === 401) { emit('expired', reason); return }
  error.value = reason instanceof ApiError && reason.status === 404
    ? new LocalizedError('postUnavailable')
    : reason instanceof Error ? reason : new LocalizedError('loadFailed')
}

async function load() {
  const id = ++generation
  const api = clientFor(props.session)
  loading.value = true; error.value = ''; post.value = null
  context.value = { ancestors: [], descendants: [] }
  // Both endpoints require read:statuses. Keep a readable post if only context fails.
  const results = await Promise.allSettled([api.status(selected.value), api.context(selected.value)])
  if (id !== generation) return
  const [statusResult, contextResult] = results
  if (statusResult.status === 'fulfilled') post.value = statusResult.value
  else report(statusResult.reason)
  if (contextResult.status === 'fulfilled') context.value = contextResult.value
  else report(contextResult.reason)
  loading.value = false
}

function open(status: Status) {
  if (replying.value) { notice.value = 'finishReplyFirst'; return }
  if (document.getElementById('weave-server-page')) {
    const url = status.url ? new URL(status.url) : null
    location.assign(url?.origin === location.origin ? url.href : `/?post=${encodeURIComponent(status.id)}`)
    return
  }
  selected.value = status.id; notice.value = ''; void load()
}

function startReply() {
  if (replying.value || !post.value || permission.value === 'forbidden' || hidden.value) return
  replying.value = true; notice.value = ''
}
async function posted() {
  replying.value = false; notice.value = 'replySubmitted'; await load()
}

function close() {
  if (replying.value) { notice.value = 'finishReplyBeforeBack'; return }
  emit('close')
}

watch(() => props.statusId, id => { selected.value = id; void load() }, { immediate: true })
onBeforeUnmount(() => { generation++ })
</script>

<template>
  <section :aria-label="t('postDetails')" :aria-busy="loading">
    <div class="feed-label">
      <button class="btn-quiet" :disabled="publishing" @click="close"><ArrowLeft :size="17" />{{ t('backToFeed') }}</button>
      <button class="btn-quiet" :disabled="loading || replying" :aria-label="t('refreshThread')" @click="load"><RefreshCw :size="17" /></button>
    </div>
    <p v-if="error" role="alert" class="message error-message">{{ errorText(error) }}</p>
    <p v-if="notice" role="status" class="message notice-message">{{ t(notice) }}</p>
    <div v-if="loading" role="status" class="empty-state">{{ t('loadingThread') }}</div>
    <template v-else-if="post">
      <template v-if="context.ancestors.length">
        <div class="feed-label">{{ t('ancestors') }}</div>
        <StatusCard v-for="item in context.ancestors" :key="item.id" :status="item" @open="open" />
      </template>
      <div class="feed-label">{{ t('currentPost') }}</div>
      <p v-if="hidden" class="message notice-message">{{ t('filteredPost') }}</p>
      <StatusCard v-else :key="post.id" :status="post" @open="startReply" />
      <div v-if="!hidden" class="composer">
        <p v-if="permission === 'forbidden'" class="text-sm text-muted">{{ t('replyForbidden') }}</p>
        <template v-else>
          <button v-if="!replying" class="btn-primary" @click="startReply">{{ permission === 'approval' ? t('requestReply') : t('replyToPost') }}</button>
          <template v-else>
            <p v-if="permission === 'approval'" class="mt-3 text-sm text-muted">{{ t('approvalHint') }}</p>
            <PostComposer :session="session" :account="account" :instance="instance" :reply="post" @published="posted" @cancel="replying = false; notice = ''" @busy="publishing = $event; emit('busy', $event)" @expired="emit('expired', $event)" />
          </template>
        </template>
      </div>
      <div class="feed-label">{{ t('descendants') }}</div>
      <StatusCard v-for="item in context.descendants" :key="item.id" :status="item" @open="open" />
      <p v-if="!context.descendants.length && !error" class="empty-state">{{ t('emptyReplies') }}</p>
    </template>
  </section>
</template>
