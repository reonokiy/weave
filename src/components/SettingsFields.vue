<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { fieldKey, type SettingField, type FieldValues } from '../lib/settings'
defineProps<{ fields: SettingField[]; values: FieldValues; disabled?: boolean }>()
const { t } = useI18n()
const long = (field: SettingField) => field.type === 'array' || /^(note|text|description|short_description|terms|custom_css|reason|message|action_taken_comment|public_comment|private_comment)$/.test(field.name)
const inputType = (field: SettingField) => /password|secret/.test(field.name) ? 'password' : field.type === 'file' ? 'file' : ['number', 'integer'].includes(field.type) ? 'number' : /email/.test(field.name) ? 'email' : 'text'
const change = (event: Event, field: SettingField, values: FieldValues) => { const input = event.target as HTMLInputElement; if (input.files?.[0]) values[field.name] = input.files[0] }
</script>
<template>
  <label v-for="field in fields" :key="field.name" class="setting-field">
    <span>{{ t(fieldKey(field.name)) }}<span v-if="field.required" aria-hidden="true"> *</span></span>
    <select v-if="field.type === 'boolean'" v-model="values[field.name]" class="field" :required="field.required" :disabled="disabled"><option value="">{{ t('unchanged') }}</option><option value="true">{{ t('yes') }}</option><option value="false">{{ t('no') }}</option></select>
    <select v-else-if="field.enum?.length" v-model="values[field.name]" class="field" :required="field.required" :disabled="disabled"><option value="">{{ t('chooseOption') }}</option><option v-for="option in field.enum" :key="option" :value="option">{{ t('option_' + option, String(option)) }}</option></select>
    <textarea v-else-if="long(field)" :value="String(values[field.name] ?? '')" class="field" rows="4" :required="field.required" :disabled="disabled" @input="values[field.name] = ($event.target as HTMLTextAreaElement).value" />
    <input v-else-if="field.type === 'file'" class="field" type="file" :required="field.required" :disabled="disabled" @change="change($event, field, values)" />
    <input v-else v-model="values[field.name]" class="field" :type="inputType(field)" :min="field.minimum" :max="field.maximum" :step="field.type === 'number' ? 'any' : undefined" :required="field.required" :disabled="disabled" :autocomplete="inputType(field) === 'password' ? 'off' : undefined" />
    <span v-if="field.type === 'array'" class="text-sm text-muted">{{ t('onePerLine') }}</span>
  </label>
</template>
