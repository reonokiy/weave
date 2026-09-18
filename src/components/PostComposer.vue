<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Send, SlidersHorizontal } from '@lucide/vue'
import { ApiError, clientFor, safeUrl } from '../lib/api'
import { hasScope } from '../lib/auth'
import { approximateLength } from '../lib/content'
import { replyMention, replyVisibilities, replyVisibility, visibilityOptions } from '../lib/reply'
import { policyPreset } from '../lib/policy'
import { errorText, LocalizedError } from '../i18n'
import type { Account, Attachment, Emoji, Instance, PostBody, Session, Status } from '../lib/types'

const props = defineProps<{ session: Session; account: Account; instance: Instance | null; reply?: Status; edit?: Status }>()
const emit = defineEmits<{ published: [status: Status]; cancel: []; busy: [value: boolean]; expired: [error: unknown]; dirty: [value: boolean] }>()
const { t, n } = useI18n()
const prefix = useId()
const draft = ref(props.reply ? replyMention(props.reply, props.account) : '')
const spoiler = ref(props.reply?.spoiler_text ?? '')
const visibility = ref(props.reply ? replyVisibility(props.reply, props.account) : props.account.source?.privacy ?? 'unlisted')
const contentType = ref(props.account.source?.status_content_type ?? 'text/plain')
const language = ref(props.account.source?.language ?? '')
const sensitive = ref(props.reply?.sensitive ?? props.account.source?.sensitive ?? false)
const localOnly = ref(props.reply?.local_only ?? false)
const policy = ref('default')
const busy = ref(false)
const ready = ref(!props.edit)
const error = ref<string | Error>('')
const notice = ref('')
const pollEnabled = ref(false)
const pollOptions = ref('')
const pollDuration = ref(86400)
const multiple = ref(false)
const hideTotals = ref(false)
const media = ref<{ key: string; file?: File; attachment?: Attachment; description: string }[]>([])
const emojis = ref<Emoji[]>([])
const emojiLoading = ref(false)
const dirty = ref(false)
const editor = ref<HTMLTextAreaElement>()
function markDirty() { dirty.value = true; emit('dirty', true) }
watch(() => props.account.source, source => {
  if (dirty.value || props.reply || props.edit) return
  visibility.value = source?.privacy ?? 'unlisted'; language.value = source?.language ?? ''
  sensitive.value = source?.sensitive ?? false; contentType.value = source?.status_content_type ?? 'text/plain'
})
let attempt: { body: string; key: string } | null = null
let disposed = false
onBeforeUnmount(() => { disposed = true })
const api = computed(() => clientFor(props.session))
const config = computed(() => props.instance?.configuration)
const options = computed(() => props.reply ? replyVisibilities(props.reply) : visibilityOptions)
const length = computed(() => approximateLength(draft.value, spoiler.value, config.value?.statuses?.characters_reserved_per_url))
const limit = computed(() => config.value?.statuses?.max_characters)
const canSubmit = computed(() => ready.value && !busy.value && Boolean(draft.value.trim() || media.value.length) && !(limit.value && length.value > limit.value))

function report(reason: unknown) {
  error.value = reason instanceof Error ? reason : new LocalizedError('operationFailed')
  if (reason instanceof ApiError && reason.status === 401) emit('expired', reason)
}

async function initialize() {
  if (!props.edit) return
  error.value = ''
  try {
    const source = await api.value.source(props.edit.id)
    if (disposed) return
    draft.value = source.text; spoiler.value = source.spoiler_text
    contentType.value = source.content_type ?? 'text/plain'
    language.value = props.edit.language ?? language.value
    sensitive.value = props.edit.sensitive
    media.value = props.edit.media_attachments.map(attachment => ({ key: attachment.id, attachment, description: attachment.description ?? '' }))
    // Editing a poll requires an explicit configuration; omitted poll deletes it in GoToSocial.
    if (props.edit.poll) {
      pollEnabled.value = true; pollOptions.value = props.edit.poll.options.map(item => item.title).join('\n')
      multiple.value = props.edit.poll.multiple; hideTotals.value = props.edit.poll.options.some(item => item.votes_count == null)
      pollDuration.value = 0 // Zero keeps the existing expiry on unchanged poll options.
    }
    ready.value = true
  } catch (reason) { if (!disposed) report(reason) }
}

function selectFiles(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  const max = config.value?.statuses?.max_media_attachments
  if (max && media.value.length + files.length > max) { error.value = new LocalizedError('tooManyMedia', { count: max }); input.value = ''; return }
  for (const file of files) {
    const maxSize = file.type.startsWith('image/') ? config.value?.media_attachments?.image_size_limit : config.value?.media_attachments?.video_size_limit
    if (maxSize && file.size > maxSize) { error.value = new LocalizedError('fileTooLarge'); continue }
    media.value.push({ key: crypto.randomUUID(), file, description: '' })
  }
  input.value = ''; emit('dirty', true)
}

async function loadEmojis() {
  emojiLoading.value = true
  try { emojis.value = (await api.value.emojis()).filter(emoji => emoji.visible_in_picker !== false) }
  catch (reason) { report(reason) }
  finally { emojiLoading.value = false }
}

async function publish() {
  if (!canSubmit.value) return
  error.value = ''; notice.value = ''
  const poll = pollEnabled.value ? { options: pollOptions.value.split('\n').map(option => option.trim()).filter(Boolean), expires_in: pollDuration.value, multiple: multiple.value, hide_totals: hideTotals.value } : null
  const limits = config.value?.polls
  if (poll && (media.value.length || poll.options.length < 2 || (limits?.max_options && poll.options.length > limits.max_options) || poll.options.some(option => limits?.max_characters_per_option && Array.from(option).length > limits.max_characters_per_option) || !Number.isFinite(poll.expires_in) || (poll.expires_in !== 0 || !props.edit?.poll) && (poll.expires_in < (limits?.min_expiration ?? 1) || poll.expires_in > (limits?.max_expiration ?? Number.MAX_SAFE_INTEGER)))) {
    error.value = new LocalizedError('invalidPoll'); return
  }
  busy.value = true; emit('busy', true)
  let submitted = false
  try {
    for (const item of media.value) {
      if (!item.attachment && item.file) item.attachment = await api.value.upload(item.file, item.description)
      if (disposed) return
      if (!item.attachment?.url) throw new LocalizedError('mediaNotReady')
      if (!props.edit && item.attachment.description !== item.description) item.attachment = await api.value.updateMedia(item.attachment.id, item.description)
    }
    const body: PostBody = {
      status: draft.value, spoiler_text: spoiler.value, sensitive: sensitive.value || Boolean(spoiler.value), content_type: contentType.value,
      language: language.value || undefined, media_ids: media.value.map(item => item.attachment!.id), poll,
      ...(props.edit ? { media_attributes: media.value.map(item => ({ id: item.attachment!.id, description: item.description })) } : {}),
      ...(!props.edit ? { visibility: visibility.value, local_only: localOnly.value, in_reply_to_id: props.reply?.id, interaction_policy: policyPreset(policy.value, visibility.value) } : {}),
    }
    const fingerprint = JSON.stringify(body)
    if (attempt?.body !== fingerprint) attempt = { body: fingerprint, key: crypto.randomUUID() }
    submitted = true
    const status = await api.value.savePost(body, attempt.key, props.edit?.id)
    if (disposed) return
    draft.value = ''; spoiler.value = ''; media.value = []; pollEnabled.value = false; attempt = null
    dirty.value = false; emit('dirty', false); emit('published', status)
  } catch (reason) {
    if (disposed) return
    report(reason)
    if (submitted && (!(reason instanceof ApiError) || reason.status >= 500)) notice.value = 'uncertainSubmission'
  } finally { busy.value = false; emit('busy', false) }
}
onMounted(async () => { await initialize(); if (props.reply) { await nextTick(); editor.value?.focus() } })
</script>

<template>
  <form class="composer post-composer" :class="{ 'is-new': !reply && !edit }" @submit.prevent="publish" @input="markDirty">
    <p v-if="error" role="alert" class="message error-message">{{ errorText(error) }}</p>
    <p v-if="notice" role="status" class="message notice-message">{{ t(notice) }}</p>
    <button v-if="!ready" type="button" class="btn-quiet" @click="initialize">{{ t('retry') }}</button>
    <fieldset :disabled="busy || !ready" class="compose-fields">
      <div class="composer-heading"><img v-if="safeUrl(account.avatar)" :src="safeUrl(account.avatar)" alt="" class="account-avatar" /><label :for="`${prefix}-draft`" class="block font-semibold">{{ edit ? t('edit') : reply ? t('replyLabel', { account: '@' + reply.account?.acct }) : t('composerLabel', { name: account.display_name || account.username }) }}</label></div>
      <textarea :id="`${prefix}-draft`" ref="editor" v-model="draft" class="draft-input" rows="2" :placeholder="t('draftPlaceholder')" />
      <div class="composer-toolbar">
      <div v-if="!edit" class="composer-visibility">
        <label><span class="sr-only">{{ t('visibility') }}</span><select v-model="visibility" class="visibility-select"><option v-for="option in options" :key="option.value" :value="option.value">{{ t(option.label) }}</option></select></label>
      </div>
      <details class="composer-options"><summary><SlidersHorizontal :size="17" />{{ t('postOptions') }}</summary>
        <div class="grid gap-3 mt-3">
          <label :for="`${prefix}-spoiler`">{{ t('contentWarning') }}</label>
          <input :id="`${prefix}-spoiler`" v-model="spoiler" class="field" :placeholder="t('contentWarning')" />
          <label>{{ t('format') }}<select v-model="contentType" class="field"><option value="text/plain">{{ t('plainText') }}</option><option value="text/markdown">{{ t('markdown') }}</option></select></label>
          <label>{{ t('postLanguage') }}<input v-model="language" class="field" placeholder="en" /></label>
          <label class="flex gap-2"><input v-model="sensitive" type="checkbox" />{{ t('sensitive') }}</label>
          <label v-if="!edit" class="flex gap-2"><input v-model="localOnly" type="checkbox" :disabled="reply?.local_only" />{{ t('localOnly') }}</label>
          <label v-if="!pollEnabled">{{ t('addMedia') }}<input type="file" multiple :disabled="!hasScope(session, 'write:media')" :accept="config?.media_attachments?.supported_mime_types?.join(',')" class="field" @change="selectFiles" /></label>
          <div v-for="(item, index) in media" :key="item.key" class="attachment-draft">
            <img v-if="safeUrl(item.attachment?.preview_url)" :src="safeUrl(item.attachment?.preview_url)" alt="" class="post-image" />
            <p>{{ item.file?.name || item.attachment?.type }}</p>
            <label>{{ t('mediaDescription') }}<textarea v-model="item.description" class="field" :maxlength="config?.media_attachments?.description_limit" /></label>
            <button type="button" class="btn-quiet" @click="media.splice(index, 1); emit('dirty', true)">{{ t('remove') }}</button>
          </div>
          <label v-if="!media.length" class="flex gap-2"><input v-model="pollEnabled" type="checkbox" />{{ t('addPoll') }}</label>
          <template v-if="pollEnabled">
            <p v-if="edit?.poll" class="text-sm text-muted">{{ t('editPollHint') }}</p>
            <label>{{ t('pollOptions') }}<textarea v-model="pollOptions" class="field" rows="4" /></label>
            <label>{{ t('pollDuration') }}<input v-model.number="pollDuration" type="number" class="field" :min="edit?.poll ? 0 : config?.polls?.min_expiration ?? 1" :max="config?.polls?.max_expiration" /></label>
            <label class="flex gap-2"><input v-model="multiple" type="checkbox" />{{ t('multipleChoice') }}</label>
            <label class="flex gap-2"><input v-model="hideTotals" type="checkbox" />{{ t('hideTotals') }}</label>
          </template>
          <template v-if="!edit">
            <label>{{ t('interactionPolicy') }}<select v-model="policy" class="field"><option value="default">{{ t('accountDefaults') }}</option><option value="automatic">{{ t('automaticPolicy') }}</option><option value="approval">{{ t('approvalPolicy') }}</option><option value="author">{{ t('authorPolicy') }}</option></select></label>
            <p class="text-sm text-muted">{{ t('policyHint') }}</p>
          </template>
          <button type="button" class="btn-quiet" :disabled="emojiLoading" @click="loadEmojis">{{ t('emoji') }}</button>
          <div class="emoji-picker"><button v-for="emoji in emojis" :key="emoji.shortcode" type="button" class="btn-quiet" :title="emoji.shortcode" @click="draft += ` :${emoji.shortcode}: `; emit('dirty', true)"><img v-if="safeUrl(emoji.static_url)" :src="safeUrl(emoji.static_url)" :alt="`:${emoji.shortcode}:`" width="24" height="24" loading="lazy" /></button></div>
        </div>
      </details>
      <p v-if="reply?.local_only" class="text-sm text-muted mb-3">{{ t('localOnlyHint') }}</p>
      <p v-if="!edit && visibility === 'direct'" class="text-sm text-muted mb-3">{{ t(reply ? 'directReplyHint' : 'directHint') }}</p>
      <div class="composer-footer">
        <span class="text-sm text-muted">{{ t('characterCount', { count: n(length) }) }}{{ limit ? ` / ${n(limit)}` : '' }}</span>
        <button v-if="reply || edit" type="button" class="btn-quiet" @click="emit('cancel')">{{ t('cancel') }}</button>
        <button class="btn-primary" :disabled="!canSubmit"><Send :size="16" />{{ busy ? t('submitting') : edit ? t('save') : reply ? t('sendReply') : t('publish') }}</button>
      </div>
      </div>
    </fieldset>
  </form>
</template>
