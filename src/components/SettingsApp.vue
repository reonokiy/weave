<script setup lang="ts">
import { computed, onMounted, provide, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import SettingsResource from './SettingsResource.vue'
import SecuritySettings from './SecuritySettings.vue'
import PreferencesView from './PreferencesView.vue'
import ExploreView from './ExploreView.vue'
import SettingsRecord from './SettingsRecord.vue'
import ApplicationToken from './ApplicationToken.vue'
import DomainTransfer from './DomainTransfer.vue'
import { settingPages } from '../lib/settings'
import { clientFor, safeUrl } from '../lib/api'
import { loadSession, authorize, hasScope } from '../lib/auth'
import { workspaceKey } from '../lib/workspace'
import { errorText } from '../i18n'
import type { Account, Instance, Status } from '../lib/types'
const { t } = useI18n()
const session = ref(loadSession())
const account = ref<Account | null>(null)
const instance = ref<Instance | null>(null)
const client = computed(() => session.value ? clientFor(session.value) : null)
const user = ref<{ admin?: boolean; moderator?: boolean; email?: string; two_factor_enabled_at?: string }>({})
const error = ref<Error | string>('')
const ready = ref(false)
const path = location.pathname.replace(/\/$/, '')
const aliases: Record<string, string> = { '/settings': '/settings/user/profile', '/settings/user': '/settings/user/profile', '/settings/admin': '/settings/admin/instance/settings', '/settings/moderation': '/settings/moderation/reports', '/settings/admin/emoji/remote': '/settings/admin/emoji/local' }
const current = aliases[path] ?? path
const page = computed(() => [...settingPages].sort((a,b) => b.route.length - a.route.length).find(item => current === item.route || current.startsWith(item.route + '/')))
const allowed = (role: string) => role === 'user' || role === 'admin' && user.value.admin || role === 'moderator' && (user.value.admin || user.value.moderator)
const menus = computed(() => [
  { route: '/settings/user/account', title: 'accountSecurity', role: 'user' },
  { route: '/settings/user/posts', title: 'postingSettings', role: 'user' },
  { route: '/settings/user/interaction_requests', title: 'interactionRequests', role: 'user' },
  { route: '/settings/user/instance-info', title: 'aboutInstance', role: 'user' },
  { route: '/settings/moderation/domain-permissions/import-export', title: 'domainTransfer', role: 'moderator' },
  ...settingPages,
].filter(item => allowed(item.role)))
const scoped = computed(() => session.value && hasScope(session.value, 'read') && hasScope(session.value, 'write') && hasScope(session.value, 'admin'))
function report(reason: unknown) { error.value = reason as Error }
function changeSection(event: Event) { location.assign((event.target as HTMLSelectElement).value) }
provide(workspaceKey, { client, session, account, instance, updates: reactive(new Map()), deleted: reactive(new Set<string>()), pending: reactive(new Set<string>()), drafts: reactive(new Set<string>()), report, openProfile: id => { void client.value?.profile(id).then(value => { const url = safeUrl(value.url); if (url) location.assign(url) }).catch(report) } })
async function refreshUser() { user.value = (await client.value!.request<typeof user.value>('/api/v1/user')).data }
async function upgrade() { try { location.assign(await authorize(location.origin, location.origin + location.pathname, 'read write admin')) } catch (reason) { report(reason) } }
function open(status: Status) { const url = safeUrl(status.url); if (url) location.assign(url) }
onMounted(async () => {
  try { if (client.value) { const [self, info] = await Promise.all([client.value.account(), client.value.instance(), refreshUser()]); account.value = self; instance.value = info } }
  catch (reason) { report(reason) }
  finally { ready.value = true }
})
</script>
<template>
  <p v-if="error" class="message error-message" role="alert">{{ errorText(error) }}</p><p v-if="!ready" class="empty-state">{{ t('loading') }}</p>
  <div v-else-if="client" class="settings-layout">
    <label class="settings-mobile-nav">{{ t('settingsNavigation') }}<select class="field" :value="page?.route ?? current" @change="changeSection"><option v-for="item in menus" :key="item.route" :value="item.route">{{ t(item.title) }}</option></select></label>
    <nav class="settings-nav" :aria-label="t('settingsNavigation')"><a href="/" class="btn-quiet">{{ t('backToFeed') }}</a><a v-for="item in menus" :key="item.route" :href="item.route" :aria-current="current === item.route || current.startsWith(item.route + '/') ? 'page' : undefined">{{ t(item.title) }}</a></nav>
    <div class="settings-content">
      <section v-if="!scoped" class="composer"><h1>{{ t('settingsAuthorization') }}</h1><p class="mt-4">{{ t('settingsAuthorizationHint') }}</p><button class="btn-primary mt-5" @click="upgrade">{{ t('reauthorize') }}</button></section>
      <SecuritySettings v-else-if="current === '/settings/user/account'" :client="client" :user="user" :oidc="Boolean(instance?.configuration?.oidc_enabled)" @changed="refreshUser" />
      <ApplicationToken v-else-if="current === '/settings/user/applications/callback'" :client="client" callback />
      <DomainTransfer v-else-if="['/settings/moderation/domain-permissions/import-export', '/settings/moderation/domain-permissions/process'].includes(current) && allowed('moderator')" :client="client" />
      <PreferencesView v-else-if="current === '/settings/user/posts'" />
      <ExploreView v-else-if="current.startsWith('/settings/user/interaction_requests')" view="requests" @open="open" />
      <section v-else-if="current === '/settings/user/instance-info'" class="composer"><h1>{{ t('aboutInstance') }}</h1><SettingsRecord :value="instance" /></section>
      <SettingsResource v-else-if="page && allowed(page.role)" :key="page.route" :page="page" :client="client" />
      <section v-else class="composer"><h1>{{ t('settingsUnavailable') }}</h1><p class="mt-4">{{ t('settingsUnavailableHint') }}</p></section>
    </div>
  </div>
</template>
