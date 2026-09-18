<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { ServerPage } from '../lib/server-page'
import { safeUrl } from '../lib/api'
const props = defineProps<{ page: ServerPage }>()
const { t } = useI18n()
const submitted = ref(false)
const resetSubmission = () => { submitted.value = false }
onMounted(() => window.addEventListener('pageshow', resetSubmission))
onBeforeUnmount(() => window.removeEventListener('pageshow', resetSubmission))
const kind = props.page.pageContent.replace('.tmpl', '')
const confirmationAction = `/confirm_email?${new URLSearchParams({ token: props.page.token ?? '' })}`
</script>

<template>
  <section class="connect-panel server-auth">
    <template v-if="kind === 'sign-in'">
      <h1>{{ t('serverSignIn') }}</h1><p class="mt-3 text-muted">{{ t('serverSignInHint', { instance: page.instance?.title ?? '' }) }}</p>
      <form action="/auth/sign_in" method="post" class="settings-form mt-6" @submit="submitted = true">
        <label>{{ t('emailAddress') }}<input name="username" type="email" class="field" autocomplete="username" required /></label>
        <label>{{ t('password') }}<input name="password" type="password" class="field" autocomplete="current-password" required /></label>
        <button class="btn-primary" :disabled="submitted">{{ t('serverSignIn') }}</button>
      </form>
    </template>
    <template v-else-if="kind === '2fa'">
      <h1>{{ t('twoFactor') }}</h1><p class="mt-3 text-muted">{{ t('twoFactorSignInHint') }}</p>
      <form action="/auth/2fa" method="post" class="settings-form mt-6" @submit="submitted = true">
        <label>{{ t('authenticationCode') }}<input name="code" class="field" autocomplete="one-time-code" required /></label>
        <button class="btn-primary" :disabled="submitted">{{ t('continueAction') }}</button>
      </form>
    </template>
    <template v-else-if="kind === 'authorize'">
      <h1>{{ t('authorizeApplication') }}</h1><p class="mt-4">{{ t('authorizeApplicationHint', { app: page.appname ?? '', user: page.user ?? '' }) }}</p>
      <dl class="mt-5"><dt>{{ t('requestedPermissions') }}</dt><dd class="break-all mt-2">{{ page.scope }}</dd><dt class="mt-4">{{ t('returnAddress') }}</dt><dd class="break-all mt-2">{{ page.redirect }}</dd></dl>
      <form action="/oauth/authorize" method="post" class="mt-6" @submit="submitted = true"><button class="btn-primary" :disabled="submitted">{{ t('allowApplication') }}</button></form>
      <a v-if="safeUrl(page.appwebsite)" :href="safeUrl(page.appwebsite)" class="btn-quiet mt-3" rel="noopener noreferrer">{{ t('applicationWebsite') }}</a>
    </template>
    <template v-else-if="kind === 'sign-up'">
      <h1>{{ t('createAccount') }}</h1><p v-if="page.oidcEnabled" class="mt-4">{{ t('registrationOIDC') }}</p><p v-else-if="!page.registrationOpen" class="mt-4">{{ t('registrationClosed') }}</p>
      <form v-else action="/signup" method="post" class="settings-form mt-6" @submit="submitted = true">
        <label>{{ t('emailAddress') }}<input name="email" type="email" class="field" autocomplete="email" required /></label>
        <label>{{ t('usernameLabel') }}<input name="username" class="field" pattern="[a-z0-9_]{1,64}" autocomplete="username" autocapitalize="off" required /><span class="text-sm text-muted">{{ t('usernameHint') }}</span></label>
        <label>{{ t('password') }}<input name="password" type="password" class="field" autocomplete="new-password" required /></label>
        <label>{{ t('postLanguage') }}<input name="locale" class="field" value="en" /></label>
        <label>{{ t('registrationReason') }}<textarea name="reason" class="field" :required="page.reasonRequired" /></label>
        <a href="/about" target="_blank" rel="noopener" class="btn-quiet">{{ t('instanceRules') }}</a><label class="flex gap-2"><input type="checkbox" name="agreement" value="true" required />{{ t('agreeToRules') }}</label>
        <button class="btn-primary" :disabled="submitted">{{ t('createAccount') }}</button>
      </form>
    </template>
    <template v-else-if="kind === 'finalize'">
      <h1>{{ t('finishRegistration') }}</h1>
      <form action="/oauth/finalize" method="post" class="settings-form mt-6" @submit="submitted = true"><label>{{ t('usernameLabel') }}<input :value="page.suggestedUsername" name="username" class="field" pattern="[a-z0-9_]{1,64}" required /><span class="text-sm text-muted">{{ t('usernameHint') }}</span></label><input name="name" type="hidden" :value="page.name" /><button class="btn-primary" :disabled="submitted">{{ t('continueAction') }}</button></form>
    </template>
    <template v-else-if="kind === 'confirm-email'"><h1>{{ t('confirmEmail') }}</h1><p class="mt-4">{{ page.email }}</p><form :action="confirmationAction" method="post" class="mt-6" @submit="submitted = true"><button class="btn-primary" :disabled="submitted">{{ t('confirmEmail') }}</button></form></template>
    <template v-else-if="kind === 'confirmed-email'"><h1>{{ t('emailConfirmed') }}</h1><a href="/" class="btn-primary mt-6">{{ t('continueAction') }}</a></template>
    <template v-else-if="kind === 'signed-up'"><h1>{{ t('registrationSubmitted') }}</h1><p class="mt-4">{{ t('registrationSubmittedHint') }}</p></template>
    <template v-else-if="kind === 'oob'"><h1>{{ t('authorizationCode') }}</h1><p class="mt-4">{{ t('authorizationCodeHint') }}</p><code class="block break-all mt-4">{{ page.oobToken }}</code></template>
  </section>
</template>
