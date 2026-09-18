<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { GtsClient } from '../lib/api'
import { errorText } from '../i18n'
const props = defineProps<{ client: GtsClient; user: { email?: string; unconfirmed_email?: string; two_factor_enabled_at?: string }; oidc?: boolean }>()
const emit = defineEmits<{ changed: [] }>()
const { t } = useI18n()
const busy = ref(false)
const error = ref<Error | string>('')
const notice = ref('')
const oldPassword = ref('')
const newPassword = ref('')
const confirmation = ref('')
const emailPassword = ref('')
const newEmail = ref('')
const disablePassword = ref('')
const code = ref('')
const qr = ref('')
const recovery = ref<string[]>([])
async function change(kind: 'password_change' | 'email_change' | '2fa/enable' | '2fa/disable') {
  if (busy.value) return
  if (kind === 'password_change' && newPassword.value !== confirmation.value) { error.value = t('passwordMismatch'); return }
  busy.value = true; error.value = ''; notice.value = ''
  try {
    const body = kind === 'password_change' ? { old_password: oldPassword.value, new_password: newPassword.value } : kind === 'email_change' ? { password: emailPassword.value, new_email: newEmail.value } : kind === '2fa/enable' ? { code: code.value } : { password: disablePassword.value }
    const result = await props.client.post<string[] | undefined>('/api/v1/user/' + kind, body)
    if (kind === '2fa/enable') recovery.value = result ?? []
    oldPassword.value = ''; newPassword.value = ''; confirmation.value = ''; emailPassword.value = ''; newEmail.value = ''; disablePassword.value = ''; code.value = ''
    if (qr.value) URL.revokeObjectURL(qr.value)
    qr.value = ''; notice.value = 'saved'; emit('changed')
  } catch (reason) { error.value = reason as Error }
  finally { busy.value = false }
}
async function prepareTwoFactor() {
  busy.value = true; error.value = ''
  try { qr.value = URL.createObjectURL(await (await props.client.response('/api/v1/user/2fa/qr.png', { headers: { Accept: 'image/png' } })).blob()) }
  catch (reason) { error.value = reason as Error }
  finally { busy.value = false }
}
onBeforeUnmount(() => { if (qr.value) URL.revokeObjectURL(qr.value) })
</script>
<template>
  <h1>{{ t('accountSecurity') }}</h1><p v-if="error" role="alert" class="message error-message mt-5">{{ errorText(error) }}</p><p v-if="notice" role="status" class="message notice-message mt-5">{{ t(notice) }}</p>
  <p v-if="oidc" class="composer">{{ t('securityOIDC') }}</p>
  <template v-else>
    <form class="composer settings-form mt-6" @submit.prevent="change('password_change')"><h2>{{ t('changePassword') }}</h2><label>{{ t('currentPassword') }}<input v-model="oldPassword" class="field" type="password" autocomplete="current-password" required /></label><label>{{ t('newPassword') }}<input v-model="newPassword" class="field" type="password" autocomplete="new-password" required /></label><label>{{ t('confirmNewPassword') }}<input v-model="confirmation" class="field" type="password" autocomplete="new-password" required /></label><button class="btn-primary" :disabled="busy">{{ t('changePassword') }}</button></form>
    <form class="composer settings-form" @submit.prevent="change('email_change')"><h2>{{ t('changeEmail') }}</h2><p>{{ user.email }}</p><p v-if="user.unconfirmed_email && user.unconfirmed_email !== user.email">{{ t('pendingEmail', { email: user.unconfirmed_email }) }}</p><label>{{ t('emailAddress') }}<input v-model="newEmail" type="email" class="field" autocomplete="email" required /></label><label>{{ t('currentPassword') }}<input v-model="emailPassword" class="field" type="password" autocomplete="current-password" required /></label><button class="btn-primary" :disabled="busy">{{ t('changeEmail') }}</button></form>
    <section class="composer"><h2>{{ t('twoFactor') }}</h2><div v-if="recovery.length" class="mt-5"><p>{{ t('saveRecoveryCodes') }}</p><ul class="recovery-codes mt-4"><li v-for="entry in recovery" :key="entry"><code>{{ entry }}</code></li></ul><button class="btn-quiet mt-4" @click="recovery = []">{{ t('recoveryCodesSaved') }}</button></div>
      <form v-else-if="user.two_factor_enabled_at" class="settings-form mt-5" @submit.prevent="change('2fa/disable')"><p>{{ t('twoFactorEnabled') }}</p><label>{{ t('currentPassword') }}<input v-model="disablePassword" class="field" type="password" autocomplete="current-password" required /></label><button class="btn-primary" :disabled="busy">{{ t('disableTwoFactor') }}</button></form>
      <template v-else><p class="mt-4">{{ t('twoFactorSetupHint') }}</p><button v-if="!qr" class="btn-primary mt-4" :disabled="busy" @click="prepareTwoFactor">{{ t('setUpTwoFactor') }}</button><form v-else class="settings-form mt-4" @submit.prevent="change('2fa/enable')"><img :src="qr" :alt="t('authenticatorQrCode')" width="256" height="256" /><label>{{ t('authenticationCode') }}<input v-model="code" class="field" autocomplete="one-time-code" inputmode="numeric" required /></label><button class="btn-primary" :disabled="busy">{{ t('enableTwoFactor') }}</button></form></template>
    </section>
  </template>
</template>
