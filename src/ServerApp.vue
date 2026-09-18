<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Link2, ArrowRight } from '@lucide/vue'
import App from './App.vue'
import ServerAuth from './components/ServerAuth.vue'
import PublicPage from './components/PublicPage.vue'
import SettingsApp from './components/SettingsApp.vue'
import { authorize, finishAuthorization, loadSession, logout } from './lib/auth'
import type { ServerPage } from './lib/server-page'
import { errorText } from './i18n'
import { clientFor } from './lib/api'
const props = defineProps<{ page: ServerPage }>()
const { t, locale } = useI18n()
const ready = ref(false)
const signedIn = ref(false)
const busy = ref(false)
const error = ref('')
const authPage = /^(sign-in|2fa|authorize|sign-up|signed-up|finalize|confirm-email|confirmed-email|oob)\.tmpl$/.test(props.page.pageContent)
const clientPage = computed(() => signedIn.value && /^(index|login-info|profile|profile-gallery|thread|tag)\.tmpl$/.test(props.page.pageContent))
async function signIn() {
  busy.value = true; error.value = ''
  try { location.assign(await authorize(location.origin, location.origin + location.pathname + location.search, props.page.pageContent === 'settings.tmpl' ? 'read write admin' : undefined)) }
  catch (reason) { error.value = errorText(reason instanceof Error ? reason : new Error(t('operationFailed'))); busy.value = false }
}
async function signOut() {
  busy.value = true; error.value = ''
  try { const current = loadSession(); if (current) await logout(current); location.assign('/') }
  catch (reason) { signedIn.value = false; error.value = errorText(reason as Error); busy.value = false }
}
async function interact() {
  const current = loadSession()
  if (!current || current.origin !== location.origin) return signIn()
  busy.value = true; error.value = ''
  try {
    const result = await clientFor(current).search(props.page.interactionURI ?? '', true)
    if (result.statuses[0]) location.assign('/?post=' + encodeURIComponent(result.statuses[0].id))
    else if (result.accounts[0]) location.assign('/?view=profile&account=' + encodeURIComponent(result.accounts[0].id))
    else { error.value = t('emptyResults'); busy.value = false }
  } catch (reason) { error.value = errorText(reason as Error); busy.value = false }
}
onMounted(async () => {
  try { if (!authPage) { const current = (location.pathname === '/settings/user/applications/callback' ? null : await finishAuthorization(new URL(location.href))) ?? loadSession(); signedIn.value = current?.origin === location.origin } }
  catch (reason) { error.value = errorText(reason as Error) }
  finally { ready.value = true }
})
</script>
<template>
  <App v-if="ready && clientPage" :server-page="page" />
  <div v-else class="server-shell" :class="{ 'server-settings': page.pageContent === 'settings.tmpl' }">
    <a class="skip-link" href="#main">{{ t('skipContent') }}</a>
    <header class="server-header"><a href="/" class="brand"><Link2 :size="30" /><span>weave<span class="brand-dot">.</span></span></a>
      <nav class="flex flex-wrap gap-3 items-center" :aria-label="t('navigationLabel')"><a href="/about" class="btn-quiet">{{ t('aboutInstance') }}</a><a v-if="page.showAcctDir" href="/directory" class="btn-quiet">{{ t('directory') }}</a><label class="sr-only" for="server-language">{{ t('language') }}</label><select id="server-language" v-model="locale" class="visibility-select"><option value="en">English</option><option value="zh-CN">简体中文</option></select><button v-if="signedIn && !authPage" class="btn-quiet" :disabled="busy" @click="signOut">{{ t("signOut") }}</button><button v-else-if="!authPage" class="btn-primary" :disabled="busy" @click="signIn">{{ t('serverSignIn') }}<ArrowRight :size="17" /></button></nav>
    </header>
    <main id="main" class="server-main"><p v-if="error" role="alert" class="message error-message">{{ error }}</p><p v-if="!ready" class="empty-state">{{ t('loading') }}</p><ServerAuth v-else-if="authPage" :page="page" /><SettingsApp v-else-if="page.pageContent === 'settings.tmpl' && signedIn" /><section v-else-if="page.pageContent === 'settings.tmpl'" class="connect-panel"><h1>{{ t('settingsAuthorization') }}</h1><button class="btn-primary mt-5" :disabled="busy" @click="signIn">{{ t('serverSignIn') }}</button></section><PublicPage v-else :page="page" :signed-in="signedIn" @sign-in="signIn" @interact="interact" /></main>
    <footer class="server-footer"><span>{{ t('madeFor') }}</span><a href="/about">{{ page.instance?.title }}</a></footer>
  </div>
</template>
