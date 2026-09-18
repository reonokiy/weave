<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { fieldKey } from '../lib/settings'
const props = defineProps<{ value: unknown; depth?: number }>()
const { t, te } = useI18n()
const reveal = ref(false)
const entries = computed(() => props.value && typeof props.value === 'object' ? Object.entries(props.value).filter(([,value]) => value !== null && value !== undefined && value !== '') : [])
const label = (key: string) => te(fieldKey(key)) ? t(fieldKey(key)) : /^\d+$/.test(key) ? String(Number(key) + 1) : t('serverField', { name: key })
</script>
<template>
  <p v-if="typeof value !== 'object' || value === null" class="break-words">{{ typeof value === 'boolean' ? t(value ? 'yes' : 'no') : value }}</p>
  <dl v-else class="settings-record">
    <template v-for="[key, item] in entries" :key="key">
      <dt>{{ label(key) }}</dt><dd>
        <template v-if="/secret|access_token|recovery/i.test(key)"><button class="btn-quiet" @click="reveal = !reveal">{{ t(reveal ? 'hideSecret' : 'revealSecret') }}</button><code v-if="reveal" class="break-all">{{ item }}</code></template>
        <details v-else-if="typeof item === 'object' && item !== null && (depth ?? 0) < 3"><summary>{{ t('viewDetails') }}</summary><SettingsRecord :value="item" :depth="(depth ?? 0) + 1" /></details>
        <span v-else-if="typeof item !== 'object'" class="break-all">{{ typeof item === 'boolean' ? t(item ? 'yes' : 'no') : item }}</span>
      </dd>
    </template>
  </dl>
</template>
