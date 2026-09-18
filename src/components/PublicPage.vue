<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import StatusCard from './StatusCard.vue'
import type { ServerPage } from '../lib/server-page'
import { localPageUrl } from '../lib/server-page'
import { safeUrl } from '../lib/api'
import { sanitizeContent } from '../lib/content'
import type { Status } from '../lib/types'
const props = defineProps<{ page: ServerPage; signedIn?: boolean }>()
defineEmits<{ signIn: []; interact: [] }>()
const { t } = useI18n()
const kind = props.page.pageContent.replace('.tmpl', '')
const retry = () => history.back()
const posts = computed(() => [...new Map([...(props.page.context?.Statuses ?? []), ...(props.page.pinned_statuses ?? []), ...(props.page.statuses ?? [])].map(post => [post.id, post])).values()])
const info = computed(() => props.page.instance as typeof props.page.instance & { description?: string; short_description?: string; rules?: { id: string; text: string }[]; email?: string })
function open(post: Status) { const url = safeUrl(post.url); if (url) location.assign(url) }
</script>
<template>
  <section v-if="page.account" class="public-profile composer"><img v-if="safeUrl(page.account.avatar)" :src="safeUrl(page.account.avatar)" alt="" class="public-avatar" /><h1>{{ page.account.display_name || page.account.username }}</h1><p class="text-muted mt-2">@{{ page.account.acct }}</p><div class="post-content mt-5" v-html="sanitizeContent(page.account.note ?? '')" /><button class="btn-primary mt-5" @click="$emit('signIn')">{{ t('signInToInteract') }}</button></section>
  <section v-if="kind === 'index' || kind === 'login-info'" class="public-hero"><p class="eyebrow">{{ t('yourSpace') }}</p><h1>{{ page.instance?.title }}</h1><div class="post-content mt-5" v-html="sanitizeContent(info?.short_description ?? '')" /><div class="flex flex-wrap gap-3 mt-6"><button class="btn-primary" @click="$emit('signIn')">{{ t('serverSignIn') }}</button><a href="/signup" class="btn-quiet">{{ t('createAccount') }}</a></div></section>
  <section v-else-if="kind === 'about'" class="composer"><h1>{{ t('aboutInstance') }}</h1><h2 class="mt-5">{{ page.instance?.title }}</h2><div class="post-content mt-4" v-html="sanitizeContent(info?.description ?? '')" /><h2 class="mt-6">{{ t('instanceRules') }}</h2><ol class="mt-4 space-y-3"><li v-for="rule in info?.rules" :key="rule.id">{{ rule.text }}</li></ol><p v-if="info?.email" class="mt-6">{{ info.email }}</p></section>
  <section v-else-if="kind === 'directory'" class="composer"><h1>{{ t('directory') }}</h1><a v-for="user in page.accounts" :key="user.id" :href="safeUrl(user.url)" class="directory-card"><img v-if="safeUrl(user.avatar)" :src="safeUrl(user.avatar)" alt="" class="account-avatar" /><div><h2>{{ user.display_name || user.username }}</h2><p class="text-muted">@{{ user.acct }}</p></div></a></section>
  <section v-else-if="kind === 'tag'" class="composer"><h1>#{{ page.tagName }}</h1><p class="mt-4">{{ t('signInForTag') }}</p><button class="btn-primary mt-4" @click="$emit('signIn')">{{ t('serverSignIn') }}</button></section>
  <section v-else-if="kind === 'authorize-interaction'" class="composer"><h1>{{ t('remoteInteraction') }}</h1><p class="mt-4 break-all">{{ page.interactionURI }}</p><button class="btn-primary mt-4" @click="$emit('interact')">{{ t(signedIn ? 'openInWeave' : 'serverSignIn') }}</button></section>
  <section v-else-if="['domain-blocklist', 'domain-allowlist'].includes(kind)" class="composer"><h1>{{ t(kind === 'domain-blocklist' ? 'domainBlocks' : 'domainAllows') }}</h1><article v-for="entry in page.blocklist || page.allowlist" :key="entry.domain" class="mt-5"><h2>{{ entry.domain }}</h2><p class="mt-2">{{ entry.public_comment }}</p></article></section>
  <section v-else-if="['error', 'item_deleted', 'item_not_visible', 'maintenance'].includes(kind)" class="composer"><h1>{{ t(kind === 'maintenance' ? 'maintenanceTitle' : kind === 'error' ? 'pageUnavailable' : 'postUnavailable') }}</h1><p class="mt-4 break-words">{{ page.error || t(kind === 'maintenance' ? 'maintenanceHint' : 'publicUnavailableHint') }}</p><p v-if="page.code" class="mt-3 text-muted">{{ page.code }}</p><div class="flex gap-3 mt-4"><button class="btn-quiet" @click="retry">{{ t('tryAgain') }}</button><a href="/" class="btn-quiet">{{ t('home') }}</a></div></section>
  <StatusCard v-for="post in posts" :key="post.id" :status="post" @open="open" /><p v-if="page.account && !posts.length" class="empty-state">{{ t('noPublicPosts') }}</p>
  <nav class="flex justify-between gap-4 mt-6" :aria-label="t('paginationLabel')"><a v-if="localPageUrl(page.statuses_prev || page.accounts_prev)" :href="localPageUrl(page.statuses_prev || page.accounts_prev)" class="btn-quiet">{{ t('previousPage') }}</a><a v-if="localPageUrl(page.statuses_next || page.accounts_next)" :href="localPageUrl(page.statuses_next || page.accounts_next)" class="btn-quiet">{{ t('loadMore') }}</a></nav>
</template>
