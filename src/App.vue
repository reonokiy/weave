<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { errorText, LocalizedError } from './i18n'
import { computed, onMounted, onBeforeUnmount, provide, reactive, ref, watch } from 'vue'
import { ArrowRight, ArrowUpRight, Bell, Bookmark, Check, Globe2, Home, Inbox, Link2, LogOut, Menu, RefreshCw, Search, Settings2, Sprout, UserRound, X } from '@lucide/vue'
import StatusCard from './components/StatusCard.vue'
import ThreadView from './components/ThreadView.vue'
import PostComposer from './components/PostComposer.vue'
import ExploreView from './components/ExploreView.vue'
import PreferencesView from './components/PreferencesView.vue'
import { workspaceKey } from './lib/workspace'
import { connectStream } from './lib/stream'
import { ApiError, clientFor, GtsClient, normalizeOrigin, safeUrl } from './lib/api'
import { authorize, clearSession, finishAuthorization, loadSession, logout, hasScope, SCOPES } from './lib/auth'
import type { Account, Instance, Session, Status } from './lib/types'
import type { ServerPage } from './lib/server-page'

const baseUrl = import.meta.env.BASE_URL
const props = defineProps<{ serverPage?: ServerPage }>()

const { t, locale } = useI18n()
const session = ref<Session | null>(null)
const account = ref<Account | null>(null)
const instance = ref<Instance | null>(null)
const input = ref('')
const inspectedOrigin = ref('')
const connecting = ref(false)
const booting = ref(true)
const error = ref<string | Error>('')
const notice = ref('')
const timeline = ref<'home' | 'local'>('home')
const statuses = ref<Status[]>([])
const next = ref<string | null>(null)
const loading = ref(false)
const publishing = ref(false)
const selectedStatus = ref<string | null>(null)
const replyingBusy = ref(false)
const view = ref<'timeline' | 'notifications' | 'search' | 'bookmarks' | 'requests' | 'profile' | 'preferences'>('timeline')
const profileId = ref('')
const mobileMore = ref(false)
const updates = reactive(new Map<string, Status>())
const deleted = reactive(new Set<string>())
const pending = reactive(new Set<string>())
const drafts = reactive(new Set<string>())
const live = ref(false)
const liveConnected = ref(false)
const activity = ref(false)
let stopStream: (() => void) | undefined
const navigation = [
  { view: 'notifications', icon: Bell, mobile: true },
  { view: 'search', icon: Search, mobile: true },
  { view: 'bookmarks', icon: Bookmark, mobile: false },
  { view: 'requests', icon: Inbox, mobile: false },
  { view: 'profile', icon: UserRound, mobile: false },
  { view: 'preferences', icon: Settings2, mobile: false },
] as const
const pageTitle = computed(() => selectedStatus.value ? t('postDetails') : view.value !== 'timeline' ? t(view.value) : props.serverPage?.tagName ? '#' + props.serverPage.tagName : t(timeline.value === 'home' ? 'happening' : 'localFeed'))
let generation = 0
const client = computed(() => session.value ? clientFor(session.value) : null)
const originLabel = computed(() => session.value ? new URL(session.value.origin).host : '')
const name = computed(() => account.value?.display_name || account.value?.username || '')

function navigate(target: typeof view.value, id?: string) {
  if (pending.size || drafts.size || replyingBusy.value || publishing.value) { notice.value = 'busyNavigation'; return }
  if (selectedStatus.value) { notice.value = 'returnFirst'; return }
  if (props.serverPage) {
    if (target === 'preferences') { location.assign('/settings/user/posts'); return }
    if (target === 'requests') { location.assign('/settings/user/interaction_requests'); return }
    if (target === 'profile') {
      void client.value?.profile(id ?? account.value?.id ?? '').then(user => {
        const url = new URL(user.url)
        location.assign(url.origin === location.origin ? url.href : `/?view=profile&account=${encodeURIComponent(user.id)}`)
      }).catch(report)
      return
    }
    location.assign(`/?view=${target}`); return
  }
  mobileMore.value = false
  view.value = target
  if (target === 'profile') profileId.value = id ?? account.value?.id ?? ''
}
provide(workspaceKey, { client, session, account, instance, updates, deleted, pending, drafts, report, openProfile: id => navigate('profile', id) })
const expandedScopes = computed(() => session.value && SCOPES.split(' ').every(scope => hasScope(session.value!, scope)))
async function reauthorize() {
  if (!session.value) return
  connecting.value = true
  try { location.assign(await authorize(session.value.origin, new URL(import.meta.env.BASE_URL, location.origin).href)) }
  catch (reason) { report(reason) }
  finally { connecting.value = false }
}
function onPublished(status: Status) { notice.value = 'published'; updates.set(status.id, status); void loadTimeline() }
watch([session, live, timeline], () => {
  stopStream?.(); liveConnected.value = false
  if (!live.value || !session.value || !hasScope(session.value, 'read')) return
  const streams = timeline.value === 'local' ? [false, true] : [false]
  const states = streams.map(() => false)
  const stops = streams.map((local, index) => connectStream(session.value!, local, (type, payload) => {
    if (type === 'delete') deleted.add(payload)
    else activity.value = true
  }, value => { states[index] = value; liveConnected.value = states.every(Boolean) }))
  stopStream = () => stops.forEach(stop => stop())
})
onBeforeUnmount(() => stopStream?.())

function report(reason: unknown) {
  error.value = reason instanceof Error ? reason : new LocalizedError('operationFailed')
  if (reason instanceof ApiError && reason.status === 401) {
    generation++; selectedStatus.value = null; loading.value = false; updates.clear(); deleted.clear(); pending.clear(); drafts.clear(); live.value = false; view.value = 'timeline'
    clearSession(); session.value = null; account.value = null; statuses.value = []; instance.value = null; inspectedOrigin.value = ''; next.value = null
    error.value = new LocalizedError('sessionExpired')
  }
}

async function connect() {
  connecting.value = true; error.value = ''; notice.value = ''
  try {
    const origin = normalizeOrigin(input.value)
    if (inspectedOrigin.value !== origin) {
      const info = await new GtsClient(origin).instance()
      if (typeof info.version !== 'string' || typeof info.title !== 'string') throw new LocalizedError('invalidInstance')
      instance.value = info; inspectedOrigin.value = origin
      return
    }
    const redirect = new URL(import.meta.env.BASE_URL, location.origin).href
    location.assign(await authorize(origin, redirect))
  } catch (reason) { report(reason) }
  finally { connecting.value = false }
}

async function loadTimeline(more = false) {
  if (!client.value) return
  const id = ++generation
  activity.value = false
  if (!more) updates.clear()
  loading.value = true; error.value = ''
  try {
    const page = props.serverPage?.tagName
      ? await client.value.page<Status>(`/api/v1/timelines/tag/${encodeURIComponent(props.serverPage.tagName)}?limit=20`, more ? next.value : null)
      : await client.value.timeline(timeline.value, more ? next.value : null)
    if (id !== generation) return
    const merged = more ? [...statuses.value, ...page.items] : page.items
    statuses.value = [...new Map(merged.map(status => [status.id, status])).values()]
    next.value = page.next
  } catch (reason) { if (id === generation) report(reason) }
  finally { if (id === generation) loading.value = false }
}

function selectTimeline(value: 'home' | 'local') {
  if (selectedStatus.value) { notice.value = 'returnFirst'; return }
  if (pending.size || drafts.size || publishing.value || replyingBusy.value) { notice.value = 'busyNavigation'; return }
  if (props.serverPage) { location.assign(value === 'home' ? '/' : '/?timeline=local'); return }
  const returning = view.value !== 'timeline'
  mobileMore.value = false; view.value = 'timeline'
  if (timeline.value === value && !returning) return
  timeline.value = value; statuses.value = []; next.value = null
  void loadTimeline()
}

async function restoreAccount() {
  if (!client.value) return
  const api = client.value
  account.value = await api.account()
  // A metadata failure must not invalidate an otherwise usable session.
  try { instance.value = await api.instance() } catch { notice.value = 'metadataUnavailable' }
  await loadTimeline()
}

async function disconnect() {
  if (replyingBusy.value || pending.size || publishing.value) return
  updates.clear(); deleted.clear(); drafts.clear(); live.value = false; view.value = 'timeline'
  selectedStatus.value = null
  const current = session.value
  generation++; session.value = null; account.value = null; statuses.value = []; instance.value = null; inspectedOrigin.value = ''; next.value = null; error.value = ''; notice.value = ''; loading.value = false
  if (!current) return
  try { await logout(current) }
  catch { notice.value = 'revokeFailed' }
  finally { if (props.serverPage) location.assign('/') }
}

function openStatus(status: Status) {
  if (!props.serverPage) { selectedStatus.value = status.id; return }
  if (pending.size || drafts.size || publishing.value || replyingBusy.value) { notice.value = 'busyNavigation'; return }
  const url = status.url ? new URL(status.url) : null
  location.assign(url?.origin === location.origin ? url.href : `/?post=${encodeURIComponent(status.id)}`)
}
function closeThread() { if (props.serverPage) location.assign('/'); else selectedStatus.value = null }

onMounted(async () => {
  try {
    session.value = await finishAuthorization(new URL(location.href)) ?? loadSession()
    const query = new URLSearchParams(location.search)
    if (props.serverPage && query.get('timeline') === 'local') timeline.value = 'local'
    if (session.value) await restoreAccount()
    if (session.value && props.serverPage?.account) { profileId.value = props.serverPage.account.id; view.value = 'profile' }
    if (session.value && props.serverPage?.context?.Status) { selectedStatus.value = props.serverPage.context.Status.id; view.value = 'timeline' }
    if (session.value && props.serverPage) {
      const target = query.get('view')
      if (target && ['notifications', 'search', 'bookmarks', 'profile'].includes(target)) view.value = target as typeof view.value
      if (target === 'profile' && query.has('account')) profileId.value = query.get('account')!
      if (query.has('post')) selectedStatus.value = query.get('post')
    }
  } catch (reason) { report(reason) }
  finally { booting.value = false }
})
</script>

<template>
  <div class="app-shell" :class="{ 'is-welcome': !session }">
    <a class="skip-link" href="#main">{{ t('skipContent') }}</a>
    <aside class="sidebar" :class="{ 'menu-open': mobileMore }">
      <a :href="serverPage ? '/' : baseUrl" class="brand"><Link2 :size="32" :stroke-width="2.5" /><span>weave<span class="brand-dot">.</span></span></a>
      <div class="language-control">
        <label for="language" class="sr-only">{{ t('language') }}</label>
        <select id="language" v-model="locale" class="visibility-select"><option value="en" lang="en">English</option><option value="zh-CN" lang="zh-CN">简体中文</option></select>
      </div>
      <div v-if="session" class="sidebar-body">
        <p class="eyebrow mb-4">{{ t('yourSpace') }}</p>
        <nav :aria-label="t('timeline')" class="main-nav" :class="{ expanded: mobileMore }" @keydown.esc="mobileMore = false">
          <button class="nav-item mobile-primary" :class="{ active: view === 'timeline' && timeline === 'home' }" :aria-current="view === 'timeline' && timeline === 'home' ? 'page' : undefined" :disabled="!session" @click="selectTimeline('home')"><Home :size="21" />{{ t('home') }}</button>
          <button class="nav-item" :class="{ active: view === 'timeline' && timeline === 'local' }" :aria-current="view === 'timeline' && timeline === 'local' ? 'page' : undefined" :disabled="!session" @click="selectTimeline('local')"><Globe2 :size="21" />{{ t('local') }}</button>
          <button v-for="item in navigation" :key="item.view" class="nav-item" :class="{ active: view === item.view, 'mobile-primary': item.mobile }" :aria-current="view === item.view ? 'page' : undefined" :disabled="!expandedScopes" :title="!expandedScopes ? t('permissionNeeded') : undefined" @click="navigate(item.view)"><component :is="item.icon" :size="21" /><span>{{ t(item.view) }}</span></button>
          <a :href="`${session.origin}/settings`" target="_blank" rel="noopener noreferrer" class="nav-item nav-instance"><ArrowUpRight :size="21" /><span>{{ t('instanceSettings') }}</span></a>
          <button class="nav-item mobile-menu-toggle" :aria-expanded="mobileMore" @click="mobileMore = !mobileMore"><component :is="mobileMore ? X : Menu" :size="21" /><span>{{ t(mobileMore ? 'closeMenu' : 'more') }}</span></button>
        </nav>

      </div>
      <div class="sidebar-bottom">
        <template v-if="session">
          <div class="account-summary"><img v-if="safeUrl(account?.avatar)" :src="safeUrl(account?.avatar)" alt="" class="account-avatar" /><div><p class="truncate font-semibold">{{ name || t('connected') }}</p><p class="mt-1 break-all text-sm text-muted">{{ originLabel }}</p></div></div>
          <button class="btn-quiet mt-3" :disabled="publishing || replyingBusy || pending.size > 0 || booting" @click="disconnect"><LogOut :size="17" />{{ t('signOut') }}</button>
        </template>
        <template v-else><p class="text-sm text-muted">{{ t('tagline') }}</p><p class="mt-2 text-sm text-muted">{{ t('brandTitle') }}</p></template>
      </div>
    </aside>

    <main id="main" class="main-column">
      <header class="main-header">
        <div><p class="eyebrow">{{ session ? t('yourSpace') : t('welcomeEyebrow') }}</p><h1>{{ session ? pageTitle : t('welcomeHeading') }}</h1></div>
        <button v-if="session && view === 'timeline' && !selectedStatus" class="icon-button" :disabled="loading || booting" :aria-label="t('refreshFeed')" @click="account ? loadTimeline() : restoreAccount().catch(report)"><RefreshCw :size="19" :class="{ 'animate-spin': loading }" /></button>
        <span v-else-if="!session" class="connection-badge"><span class="live-dot" />{{ t('connectStep') }}</span>
      </header>

      <div v-if="session && !expandedScopes" class="message notice-message"><p>{{ t('scopeUpgrade') }}</p><button class="btn-primary mt-3" :disabled="connecting || publishing || replyingBusy || pending.size > 0" @click="reauthorize">{{ t('reauthorize') }}</button></div>
      <div v-if="session && expandedScopes" class="live-control"><label class="flex gap-2"><input v-model="live" type="checkbox" />{{ t('liveUpdates') }}</label><span v-if="live">{{ t(liveConnected ? 'liveConnected' : 'liveDisconnected') }}</span></div>
      <p v-if="activity" role="status" class="message notice-message">{{ t('newUpdates') }}</p>
      <div v-if="error" role="alert"  class="message error-message">{{ errorText(error) }}</div>
      <div v-if="notice" role="status" class="message notice-message">{{ t(notice) }}</div>
      <div v-if="booting" role="status" class="empty-state"><RefreshCw class="animate-spin" :size="24" /><p>{{ t('restoring') }}</p></div>

      <section v-else-if="!session" class="connect-panel">
        <span class="connection-symbol"><Link2 :size="30" /></span>
        <h2>{{ t('welcomeTitle') }}</h2>
        <p class="mt-4 leading-7 text-muted">{{ t('welcomeIntro') }}</p>
        <form class="mt-9" @submit.prevent="connect">
          <label for="instance" class="mb-2 block text-sm font-medium">{{ t('instanceAddress') }}</label>
          <input id="instance" v-model="input" class="field" placeholder="social.example.org" autocomplete="url" inputmode="url" required :disabled="connecting" @input="inspectedOrigin = ''; instance = null" />
          <div v-if="instance && inspectedOrigin" class="instance-preview mt-4"><Check :size="19" /><div><p class="font-semibold">{{ instance.title }}</p><p class="mt-1 break-all text-sm text-muted">{{ instance.version }}</p></div></div>
          <button class="btn-primary mt-4 w-full" :disabled="connecting"><RefreshCw v-if="connecting" :size="17" class="animate-spin" />{{ connecting ? t('connecting') : inspectedOrigin ? t('authorize') : t('connect') }}<ArrowRight v-if="!connecting" :size="18" /></button>
          <p class="mt-4 text-sm leading-6 text-muted">{{ t('loginHint') }}</p>
        </form>
      </section>

      <template v-else>
        <ThreadView v-if="selectedStatus && account" :status-id="selectedStatus" :session="session" :account="account" :instance="instance" @close="closeThread" @expired="report" @busy="replyingBusy = $event" />
        <PreferencesView v-if="view === 'preferences'" />
        <ExploreView v-if="view !== 'timeline' && view !== 'preferences'" v-show="!selectedStatus" :view="view" :account-id="profileId" @open="openStatus" />
        <div v-show="!selectedStatus && view === 'timeline'">
        <PostComposer v-if="account" :session="session" :account="account" :instance="instance" @published="onPublished" @busy="publishing = $event" @expired="report" />
        <div class="feed-label timeline-label"><span>{{ timeline === 'home' ? t('followingPeople') : t('communityFeed') }}</span><span>{{ t('chronological') }}</span></div>
        <div v-if="loading && !statuses.length" class="empty-state" role="status"><RefreshCw class="animate-spin" :size="24" /><p>{{ t('loadingFeed') }}</p></div>
        <div v-else-if="!statuses.length && !error" class="empty-state"><Sprout :size="32" /><h2>{{ t('quiet') }}</h2><p>{{ timeline === 'home' ? t('emptyHome') : t('emptyLocal') }}</p></div>
        <StatusCard v-for="status in statuses" :key="status.id" :status="status" @open="openStatus" />
        <div v-if="next" class="p-6 text-center"><button class="btn-quiet" :disabled="loading" @click="loadTimeline(true)">{{ loading ? t('loading') : t('loadMore') }}</button></div>
        </div>
      </template>
    </main>

    <aside class="context-column">
      <div class="context-heading"><span class="live-dot" />{{ session ? t('connected') : t('decentralized') }}</div>
      <section class="context-note"><p class="eyebrow">{{ session ? t('instanceEyebrow') : t('humanEyebrow') }}</p><h2>{{ instance?.title || t('smallWorld') }}</h2><p>{{ session ? t('instanceNote') : t('welcomeNote') }}</p><a v-if="session" :href="session.origin" target="_blank" rel="noopener noreferrer" class="mt-6 inline-flex items-center gap-2 text-sm font-medium">{{ t('visitInstance') }}<ArrowUpRight :size="16" /></a></section>
      <section v-if="session && expandedScopes" class="quick-links">
        <p class="eyebrow">{{ t('exploreCommunity') }}</p>
        <button @click="navigate('search')"><Search :size="18" /><span>{{ t('findPeople') }}</span><ArrowUpRight :size="16" /></button>
        <button @click="navigate('requests')"><Inbox :size="18" /><span>{{ t('requests') }}</span><ArrowUpRight :size="16" /></button>
        <button @click="navigate('profile')"><UserRound :size="18" /><span>{{ t('profile') }}</span><ArrowUpRight :size="16" /></button>
      </section>
      <div class="mt-7 flex items-center gap-2 text-sm text-muted"><Link2 :size="16" />{{ t('madeFor') }}</div>
    </aside>
  </div>
</template>
