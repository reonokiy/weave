<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import SettingsFields from './SettingsFields.vue'
import SettingsRecord from './SettingsRecord.vue'
import ApplicationToken from './ApplicationToken.vue'
import { GtsClient } from '../lib/api'
import { errorText, LocalizedError } from '../i18n'
import { initialFields, recordTitle, settingRequest, type SettingPage, type SettingOperation, type SettingRecord, type FieldValues } from '../lib/settings'

const props = defineProps<{ page: SettingPage; client: GtsClient }>()
const { t } = useI18n()
const busy = ref(false)
const error = ref<string | Error>('')
const notice = ref('')
const result = ref<unknown>(null)
const selected = ref<SettingOperation | null>(null)
const values = ref<FieldValues>({})
const confirmed = ref(false)
const next = ref<string | null>(null)
const dirty = ref(false)
const suffix = decodeURIComponent(location.pathname.slice(props.page.route.length)).split('/').filter(Boolean)
const id = ref(suffix[0] && !['new', 'overview', 'search', 'pending', 'preview'].includes(suffix[0]) ? suffix[0] : '')
const list = props.page.operations.find(op => op.method === 'GET' && !op.path.includes('{') && !op.path.endsWith('.csv') && !op.path.endsWith('/categories') && !op.path.endsWith('/preview'))
const detail = props.page.operations.find(op => op.method === 'GET' && op.path.endsWith('/{id}'))
const records = computed(() => Array.isArray(result.value) ? result.value as SettingRecord[] : null)
const item = computed(() => !Array.isArray(result.value) && result.value && typeof result.value === 'object' ? result.value as SettingRecord : {})
const actions = computed(() => props.page.operations.filter(op => op !== list && op !== detail && (!op.path.includes('{id}') || id.value)))
const fields = computed(() => selected.value?.fields.filter(field => !(field.in === 'path' && field.name === 'id' && id.value)) ?? [])

function choose(operation: SettingOperation) {
  selected.value = operation; values.value = initialFields(operation, item.value); confirmed.value = false; error.value = ''; notice.value = ''; dirty.value = false
  if (props.page.title === 'applications' && operation.method === 'POST') values.value.redirect_uris = location.origin + '/settings/user/applications/callback'
}
async function load(url?: string) {
  busy.value = true; error.value = ''
  try {
    const operation = id.value && detail ? detail : list
    if (id.value && /domain-permissions|domain-limits/.test(props.page.route) && list && !/^[0-9A-HJKMNP-TV-Z]{26}$/i.test(id.value)) {
      // Resolve original domain-based URLs before calling any ID-based endpoint.
      const data = (await props.client.request<SettingRecord[]>(list.path)).data
      const found = data.find(entry => entry.domain === id.value)
      if (!found) throw new LocalizedError('settingsUnavailable')
      id.value = String(found.id); result.value = found; next.value = null
    } else if (operation) {
      const inputs: FieldValues = { ...(suffix[0] === 'pending' ? { status: 'pending' } : {}) }
      const request = settingRequest(operation, inputs, id.value)
      const expected = new URL(request.path, props.client.origin)
      if (url && new URL(url, props.client.origin).pathname !== expected.pathname) throw new LocalizedError('invalidPagination')
      const { data, response } = await props.client.request<unknown>(url ?? request.path, request.init)
      result.value = data
      const link = response.headers.get('Link')?.split(',').find(value => /rel="?next"?/.test(value))
      next.value = link?.match(/<([^>]+)>/)?.[1] ?? null
      // Original domain-permission detail URLs contain domains, not database IDs.
      if (id.value && !detail && Array.isArray(data)) result.value = data.find(entry => entry.id === id.value || entry.domain === id.value) ?? null
    } else if (props.page.title === 'profile' || props.page.title === 'instanceSettings') {
      result.value = (await props.client.request(props.page.title === 'profile' ? '/api/v1/accounts/verify_credentials' : '/api/v1/instance')).data
    }
    if (suffix[0] === 'new' || !list && !id.value) {
      const operation = actions.value.find(op => ['POST', 'PATCH'].includes(op.method))
      if (operation) choose(operation)
    }
  } catch (reason) { error.value = reason as Error }
  finally { busy.value = false }
}
async function submit() {
  if (!selected.value || busy.value) return
  if (selected.value.method !== 'GET' && !confirmed.value) return
  busy.value = true; error.value = ''; notice.value = ''
  try {
    const operation = selected.value
    const request = settingRequest(operation, values.value, id.value)
    const response = await props.client.response(request.path, request.init)
    if (response.headers.get('content-type')?.includes('text/csv')) {
      const url = URL.createObjectURL(await response.blob()); const a = document.createElement('a'); a.href = url; a.download = operation.path.split('/').at(-1) ?? 'export.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
    } else {
      const text = await response.text()
      result.value = text && response.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text || null
    }
    dirty.value = false; notice.value = 'saved'; selected.value = null; values.value = {}
  } catch (reason) { error.value = reason as Error }
  finally { busy.value = false }
}
const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty.value || busy.value) event.preventDefault() }
onMounted(() => { window.addEventListener('beforeunload', beforeUnload); void load() })
onBeforeUnmount(() => window.removeEventListener('beforeunload', beforeUnload))
</script>
<template>
  <section>
    <div class="feed-label"><h1>{{ t(page.title) }}</h1><button class="btn-quiet" :disabled="busy || dirty" @click="load()">{{ t('refresh') }}</button></div>
    <p v-if="error" class="message error-message" role="alert">{{ errorText(error) }}</p><p v-if="notice" role="status" class="message notice-message">{{ t(notice) }}</p>
    <div class="settings-actions"><button v-if="list?.fields.some(field => field.in === 'query')" class="btn-quiet" :disabled="busy || dirty" @click="choose(list)">{{ t('search') }}</button><button v-for="operation in actions" :key="operation.key" class="btn-quiet" :disabled="busy || dirty" @click="choose(operation)">{{ t('action_' + operation.key) }}</button></div>
    <form v-if="selected" class="composer settings-form" @submit.prevent="submit" @input="dirty = true" @change="dirty = true">
      <h2>{{ t('action_' + selected.key) }}</h2><SettingsFields :fields="fields" :values="values" :disabled="busy" />
      <label v-if="selected.method !== 'GET'" class="flex gap-2"><input v-model="confirmed" type="checkbox" required :disabled="busy" />{{ t('confirmSettingsAction', { action: t('action_' + selected.key) }) }}</label>
      <div class="flex gap-3"><button class="btn-primary" :disabled="busy">{{ t(selected.method === 'GET' ? 'continueAction' : 'save') }}</button><button type="button" class="btn-quiet" :disabled="busy" @click="selected = null; dirty = false; values = {}">{{ t('cancel') }}</button></div>
    </form>
    <p v-if="busy" class="empty-state" role="status">{{ t('loading') }}</p>
    <template v-if="records"><article v-for="(record, index) in records" :key="String(record.id ?? index)" class="composer"><h2>{{ recordTitle(record) }}</h2><SettingsRecord :value="record" /><a v-if="record.id && !id" :href="page.route + '/' + encodeURIComponent(String(record.id))" class="btn-primary mt-4">{{ t('manageRecord') }}</a></article><p v-if="!records.length && !busy" class="empty-state">{{ t('emptyResults') }}</p></template>
    <section v-else-if="result !== null" class="composer"><SettingsRecord :value="result" /></section>
    <ApplicationToken v-if="page.title === 'applications' && item.client_id" :key="String(item.id)" :client="client" :app="item" />
    <button v-if="next" class="btn-quiet mt-5" :disabled="busy || dirty" @click="load(next)">{{ t('loadMore') }}</button>
  </section>
</template>
