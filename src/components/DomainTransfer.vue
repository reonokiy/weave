<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { GtsClient } from '../lib/api'
import { errorText } from '../i18n'
import SettingsRecord from './SettingsRecord.vue'
const props = defineProps<{ client: GtsClient }>()
const { t } = useI18n()
const kind = ref('blocks')
const file = ref<File>()
const busy = ref(false)
const confirmed = ref(false)
const error = ref<Error | string>('')
const result = ref<unknown>(null)
function selectFile(event: Event) { file.value = (event.target as HTMLInputElement).files?.[0]; confirmed.value = false }
function endpoint() { return '/api/v1/admin/domain_' + kind.value }
async function exportFile() {
  busy.value = true; error.value = ''
  try {
    const response = await props.client.response(endpoint() + '?export=true')
    const url = URL.createObjectURL(await response.blob())
    const link = document.createElement('a'); link.href = url; link.download = `domain-${kind.value}.json`; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  } catch (reason) { error.value = reason as Error }
  finally { busy.value = false }
}
async function importFile() {
  if (!file.value || !confirmed.value || busy.value) return
  busy.value = true; error.value = ''
  try {
    const form = new FormData(); form.append('domains', file.value)
    result.value = (await props.client.request(endpoint() + '?import=true', { method: 'POST', body: form })).data
    confirmed.value = false
  } catch (reason) { error.value = reason as Error }
  finally { busy.value = false }
}
</script>
<template>
  <h1>{{ t('domainTransfer') }}</h1><section class="composer settings-form mt-6">
    <p>{{ t('domainTransferHint') }}</p><p v-if="error" role="alert" class="message error-message">{{ errorText(error) }}</p>
    <label>{{ t('permissionList') }}<select v-model="kind" class="field" :disabled="busy"><option value="blocks">{{ t('domainBlocks') }}</option><option value="allows">{{ t('domainAllows') }}</option></select></label>
    <button class="btn-quiet" :disabled="busy" @click="exportFile">{{ t('exportPermissions') }}</button>
    <form class="settings-form" @submit.prevent="importFile"><label>{{ t('permissionFile') }}<input class="field" type="file" accept=".json,application/json" required :disabled="busy" @change="selectFile" /></label><label><input v-model="confirmed" type="checkbox" required :disabled="busy" />{{ t('confirmPermissionImport') }}</label><button class="btn-primary" :disabled="busy || !file">{{ t('importPermissions') }}</button></form>
    <SettingsRecord v-if="result" :value="result" />
  </section>
</template>
