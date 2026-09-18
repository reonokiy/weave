import catalogue from './settings-catalog.json'
import { LocalizedError } from '../i18n'

export interface SettingField { name: string; in: string; type: string; required?: boolean; enum?: (string | number)[]; minimum?: number; maximum?: number; collectionFormat?: string; items?: { type?: string } }
export interface SettingOperation { key: string; method: string; path: string; fields: SettingField[]; produces: string[] }
export interface SettingPage { route: string; title: string; role: string; operations: SettingOperation[] }
export const settingPages = catalogue as SettingPage[]
export type FieldValue = string | string[] | File | boolean | number
export type FieldValues = Record<string, FieldValue>
export type SettingRecord = Record<string, unknown>
export const fieldKey = (name: string) => 'field_' + name.replace(/[^a-zA-Z0-9]+/g, '_').replace(/_$/, '')
export const recordTitle = (item: SettingRecord) => String(item.title || item.display_name || item.username || item.domain || item.shortcode || item.client_name || item.text || item.uri || item.id || '')

export function settingRequest(operation: SettingOperation, values: FieldValues, id?: string) {
  const query = new URLSearchParams()
  const form = new FormData()
  const body: Record<string, unknown> = {}
  let path = operation.path
  for (const field of operation.fields) {
    let value = field.in === 'path' && field.name === 'id' && id ? id : values[field.name]
    if (value === undefined || value === '' && (field.in === 'path' || field.in === 'query' || field.type === 'boolean' || field.enum?.length)) {
      if (field.required || field.in === 'path') throw new LocalizedError('requiredField', { field: field.name })
      continue
    }
    if (value === '' && field.required) throw new LocalizedError('requiredField', { field: field.name })
    if (field.in === 'path') { path = path.replace(`{${field.name}}`, encodeURIComponent(String(value))); continue }
    if (field.type === 'array' && typeof value === 'string') value = value.split('\n').map(line => line.trim()).filter(Boolean)
    if (field.in === 'body') {
      body[field.name] = field.type === 'boolean' ? value === true || value === 'true' : ['number', 'integer'].includes(field.type) ? Number(value) : value
      continue
    }
    const entries = Array.isArray(value) ? value : [value]
    for (const entry of entries) {
      if (field.in === 'query') query.append(field.name, String(entry))
      else form.append(field.name, entry instanceof File ? entry : String(entry))
    }
  }
  if (/\{[^}]+\}/.test(path)) throw new LocalizedError('selectRecordFirst')
  const isJSON = Object.keys(body).length > 0
  const accept = operation.produces.includes('application/json') ? 'application/json' : operation.produces[0] ?? '*/*'
  const init: RequestInit = { method: operation.method, headers: { Accept: accept, ...(isJSON ? { 'Content-Type': 'application/json' } : {}) } }
  if (operation.method !== 'GET') init.body = isJSON ? JSON.stringify(body) : form
  return { path: path + (query.size ? '?' + query : ''), init }
}

export function initialFields(operation: SettingOperation, item: SettingRecord): FieldValues {
  const result: FieldValues = {}
  for (const field of operation.fields) {
    if (field.in === 'path' || field.type === 'file' || /password|secret/.test(field.name)) continue
    const names = field.name.replaceAll(']', '').split('[')
    let value: unknown = item
    for (const name of names) value = value && typeof value === 'object' ? (value as SettingRecord)[name === 'fields_attributes' ? 'fields' : name] : undefined
    if (field.name === 'note' && item.source && typeof item.source === 'object') value = (item.source as SettingRecord).note
    if (['string', 'number', 'boolean'].includes(typeof value)) result[field.name] = String(value)
    else if (Array.isArray(value) && value.every(entry => typeof entry === 'string')) result[field.name] = value.join('\n')
  }
  return result
}
