<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ApiError } from '../lib/api'
import { useWorkspace } from '../lib/workspace'
import { errorText, LocalizedError } from '../i18n'
import { policyPreset } from '../lib/policy'
import { visibilityOptions } from '../lib/reply'
import type { Account, ContentFilter, InteractionPolicy, Visibility } from '../lib/types'

const workspace = useWorkspace()!
const { t, te, locale } = useI18n()
function audience(values: string[] | null) {
  return values?.length ? new Intl.ListFormat(locale.value).format(values.map(value => te(`audience_${value}`) ? t(`audience_${value}`) : value)) : t('audienceNone')
}
const displayName = ref(workspace.account.value?.display_name ?? '')
const note = ref(workspace.account.value?.source?.note ?? '')
const locked = ref(workspace.account.value?.locked ?? false)
const privacy = ref<Visibility>(workspace.account.value?.source?.privacy ?? 'unlisted')
const language = ref(workspace.account.value?.source?.language ?? '')
const format = ref(workspace.account.value?.source?.status_content_type ?? 'text/plain')
const sensitive = ref(workspace.account.value?.source?.sensitive ?? false)
const filters = ref<ContentFilter[]>([])
const filterTitle = ref('')
const keywords = ref('')
const filterAction = ref('warn')
const contexts = ref(['home', 'public', 'notifications', 'thread', 'account'])
const filterBusy = ref(false)
const saving = ref(false)
const error = ref<string | Error>('')
const notice = ref('')
const policyVisibility = ref<Visibility>('unlisted')
const policyMode = ref('default')
const currentPolicies = ref<Record<Visibility, InteractionPolicy> | null>(null)
let disposed = false
onBeforeUnmount(() => { disposed = true })

function report(reason: unknown) {
  error.value = reason instanceof ApiError && [404, 501].includes(reason.status) ? new LocalizedError('featureUnavailable') : reason instanceof Error ? reason : new LocalizedError('operationFailed')
  if (reason instanceof ApiError && reason.status === 401) workspace.report(reason)
}
async function load() {
  const api = workspace.client.value!
  const results = await Promise.allSettled([api.request<ContentFilter[]>('/api/v2/filters'), api.request<Record<Visibility, InteractionPolicy>>('/api/v1/interaction_policies/defaults')])
  if (disposed) return
  if (results[0].status === 'fulfilled') filters.value = results[0].value.data; else report(results[0].reason)
  if (results[1].status === 'fulfilled') currentPolicies.value = results[1].value.data; else report(results[1].reason)
}
async function saveProfile() {
  if (saving.value) return
  saving.value = true; workspace.pending.add('preferences'); error.value = ''; notice.value = ''
  try {
    const body = { display_name: displayName.value, note: note.value, locked: locked.value, source: { privacy: privacy.value, language: language.value, status_content_type: format.value, sensitive: sensitive.value } }
    const result = (await workspace.client.value!.request<Account>('/api/v1/accounts/update_credentials', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).data
    if (disposed) return
    workspace.account.value = result
    notice.value = 'saved'
  } catch (reason) { report(reason) }
  finally { saving.value = false; workspace.pending.delete('preferences') }
}
async function savePolicy() {
  if (saving.value) return
  saving.value = true; workspace.pending.add('preferences'); error.value = ''; notice.value = ''
  try {
    // Omitted visibilities RESET in GoToSocial. Read fresh and preserve their effective policies.
    const current = (await workspace.client.value!.request<Record<Visibility, InteractionPolicy>>('/api/v1/interaction_policies/defaults')).data
    const body = { ...current, [policyVisibility.value]: policyPreset(policyMode.value, policyVisibility.value) ?? null }
    currentPolicies.value = (await workspace.client.value!.request<Record<Visibility, InteractionPolicy>>('/api/v1/interaction_policies/defaults', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).data
    notice.value = 'saved'
  } catch (reason) { report(reason) }
  finally { saving.value = false; workspace.pending.delete('preferences') }
}
async function saveFilter(existing?: ContentFilter) {
  if (filterBusy.value) return
  filterBusy.value = true; workspace.pending.add('filters'); error.value = ''
  try {
    if (existing) {
      await workspace.client.value!.request(`/api/v2/filters/${encodeURIComponent(existing.id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filter_action: existing.filter_action }) })
    } else {
      await workspace.client.value!.post('/api/v2/filters', { title: filterTitle.value, context: contexts.value, filter_action: filterAction.value, keywords_attributes: keywords.value.split('\n').map(keyword => keyword.trim()).filter(Boolean).map(keyword => ({ keyword, whole_word: false })) })
      filterTitle.value = ''; keywords.value = ''
    }
    workspace.updates.clear(); notice.value = 'filtersSaved'; await load()
  } catch (reason) { report(reason) }
  finally { filterBusy.value = false; workspace.pending.delete('filters') }
}
async function deleteFilter(id: string) {
  if (filterBusy.value) return
  filterBusy.value = true; workspace.pending.add('filters'); error.value = ''
  try { await workspace.client.value!.request(`/api/v2/filters/${encodeURIComponent(id)}`, { method: 'DELETE' }); filters.value = filters.value.filter(item => item.id !== id); workspace.updates.clear(); notice.value = 'filtersSaved' }
  catch (reason) { report(reason) }
  finally { filterBusy.value = false; workspace.pending.delete('filters') }
}
onMounted(load)
</script>

<template>
  <section :aria-label="t('preferences')">
    <div class="feed-label"><h2>{{ t('preferences') }}</h2></div>
    <p v-if="error" role="alert" class="message error-message">{{ errorText(error) }}</p><p v-if="notice" role="status" class="message notice-message">{{ t(notice) }}</p>
    <form class="composer grid gap-3" @submit.prevent="saveProfile">
      <label>{{ t('displayName') }}<input v-model="displayName" class="field" :disabled="saving" /></label>
      <label>{{ t('bio') }}<textarea v-model="note" class="field" rows="4" :disabled="saving" /></label>
      <label class="flex gap-2"><input v-model="locked" type="checkbox" :disabled="saving" />{{ t('lockedAccount') }}</label>
      <label>{{ t('defaultVisibility') }}<select v-model="privacy" class="field" :disabled="saving"><option v-for="option in visibilityOptions" :key="option.value" :value="option.value">{{ t(option.label) }}</option></select></label>
      <label>{{ t('postLanguage') }}<input v-model="language" class="field" :disabled="saving" /></label>
      <label>{{ t('format') }}<select v-model="format" class="field" :disabled="saving"><option value="text/plain">{{ t('plainText') }}</option><option value="text/markdown">{{ t('markdown') }}</option></select></label>
      <label class="flex gap-2"><input v-model="sensitive" type="checkbox" :disabled="saving" />{{ t('sensitive') }}</label>
      <button class="btn-primary" :disabled="saving">{{ t(saving ? 'submitting' : 'save') }}</button>
    </form>
    <form class="composer grid gap-3" @submit.prevent="savePolicy">
      <h2>{{ t('defaultPolicies') }}</h2>
      <label>{{ t('visibility') }}<select v-model="policyVisibility" class="field" :disabled="saving"><option v-for="option in visibilityOptions" :key="option.value" :value="option.value">{{ t(option.label) }}</option></select></label>
      <div v-if="currentPolicies" class="text-sm text-muted grid gap-3"><div v-for="(rules, kind) in currentPolicies[policyVisibility]" :key="kind"><strong>{{ t(kind === 'can_reply' ? 'replyToPost' : kind === 'can_favourite' ? 'like' : 'boost') }}</strong><p>{{ t('policyAutomaticAudience', { audience: audience(rules.automatic_approval) }) }}</p><p>{{ t('policyManualAudience', { audience: audience(rules.manual_approval) }) }}</p></div></div>
      <label>{{ t('interactionPolicy') }}<select v-model="policyMode" class="field" :disabled="saving"><option value="default">{{ t('resetDefaults') }}</option><option value="automatic">{{ t('automaticPolicy') }}</option><option value="approval">{{ t('approvalPolicy') }}</option><option value="author">{{ t('authorPolicy') }}</option></select></label>
      <p class="text-sm text-muted">{{ t('policyHint') }}</p><button class="btn-primary" :disabled="saving || !currentPolicies">{{ t('save') }}</button>
    </form>
    <form class="composer grid gap-3" @submit.prevent="saveFilter()">
      <h2>{{ t('filters') }}</h2><label>{{ t('filterTitle') }}<input v-model="filterTitle" class="field" required :disabled="filterBusy" /></label>
      <label>{{ t('keywords') }}<textarea v-model="keywords" class="field" rows="3" required :disabled="filterBusy" /></label>
      <label>{{ t('filterAction') }}<select v-model="filterAction" class="field" :disabled="filterBusy"><option value="warn">{{ t('warn') }}</option><option value="hide">{{ t('hide') }}</option><option value="blur">{{ t('blur') }}</option></select></label>
      <div class="flex flex-wrap gap-3"><label v-for="context in ['home', 'public', 'notifications', 'thread', 'account']" :key="context" class="flex gap-2"><input v-model="contexts" type="checkbox" :value="context" :disabled="filterBusy" />{{ t(`context_${context}`) }}</label></div>
      <button class="btn-primary" :disabled="filterBusy || !contexts.length">{{ t('addFilter') }}</button>
    </form>
    <div v-for="filter in filters" :key="filter.id" class="composer grid gap-3">
      <h2>{{ filter.title }}</h2><p>{{ filter.keywords.map(item => item.keyword).join(', ') }}</p>
      <label>{{ t('filterAction') }}<select v-model="filter.filter_action" class="field" :disabled="filterBusy" @change="saveFilter(filter)"><option value="warn">{{ t('warn') }}</option><option value="hide">{{ t('hide') }}</option><option value="blur">{{ t('blur') }}</option></select></label>
      <button class="btn-quiet" :disabled="filterBusy" @click="deleteFilter(filter.id)">{{ t('remove') }}</button>
    </div>
  </section>
</template>
