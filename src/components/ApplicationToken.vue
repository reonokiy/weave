<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { GtsClient } from '../lib/api'
import type { SettingRecord } from '../lib/settings'
import { errorText, LocalizedError } from '../i18n'
const props = defineProps<{ client: GtsClient; app?: SettingRecord; callback?: boolean }>()
const { t } = useI18n()
const redirect = location.origin + '/settings/user/applications/callback'
const storageKey = 'weave.application.authorization'
const app = ref<SettingRecord | undefined>(props.app)
const scopes = ref(Array.isArray(props.app?.scopes) ? props.app.scopes.join(' ') : String(props.app?.scopes ?? 'read'))
const available = computed(() => Array.isArray(app.value?.redirect_uris) && app.value.redirect_uris.includes(redirect))
const busy = ref(false)
const error = ref<Error | string>('')
const token = ref('')
let code = ''
function begin() {
  try {
    const state = crypto.randomUUID()
    sessionStorage.setItem(storageKey, JSON.stringify({ id: app.value!.id, state, created: Date.now() }))
    const url = new URL('/oauth/authorize', location.origin)
    url.search = new URLSearchParams({ client_id: String(app.value!.client_id), redirect_uri: redirect, response_type: 'code', scope: scopes.value, state }).toString()
    location.assign(url.href)
  } catch (reason) { error.value = reason as Error }
}
async function receive() {
  if (!code || !app.value || busy.value || token.value) return
  busy.value = true; error.value = ''
  try {
    const result = await props.client.post<{ access_token: string }>('/oauth/token', { grant_type: 'authorization_code', code, redirect_uri: redirect, client_id: app.value.client_id, client_secret: app.value.client_secret })
    token.value = result.access_token; code = ''
  } catch (reason) { error.value = reason as Error }
  finally { busy.value = false }
}
onMounted(async () => {
  if (!props.callback) return
  busy.value = true
  try {
    const query = new URLSearchParams(location.search)
    history.replaceState({}, '', location.pathname)
    const pending = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null')
    sessionStorage.removeItem(storageKey)
    if (!pending || query.get('state') !== pending.state || !Number.isFinite(pending.created) || Date.now() - pending.created > 600000 || Date.now() < pending.created) throw new LocalizedError('authExpired')
    if (query.has('error')) throw new LocalizedError('authDenied')
    code = query.get('code') ?? ''
    if (!code) throw new LocalizedError('authCodeMissing')
    app.value = (await props.client.request<SettingRecord>('/api/v1/apps/' + encodeURIComponent(pending.id))).data
  } catch (reason) { error.value = reason as Error }
  finally { busy.value = false }
})
</script>
<template>
  <section class="composer settings-form"><h2>{{ t('applicationToken') }}</h2><p>{{ t('applicationTokenHint') }}</p>
    <p v-if="error" role="alert" class="message error-message">{{ errorText(error) }}</p>
    <template v-if="callback"><p>{{ app?.name || app?.client_name }}</p><code v-if="token" class="break-all" data-testid="application-token">{{ token }}</code><button v-else class="btn-primary" :disabled="busy || !app || !code" @click="receive">{{ t('receiveToken') }}</button></template>
    <template v-else><label>{{ t('field_scopes') }}<input v-model="scopes" class="field" :disabled="!available" /></label><p v-if="!available">{{ t('applicationCallbackHint', { url: redirect }) }}</p><button class="btn-primary" :disabled="!available || busy" @click="begin">{{ t('requestToken') }}</button></template>
  </section>
</template>
