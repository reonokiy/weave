import { describe, expect, it } from 'vitest'
import { initialFields, settingPages, settingRequest, type SettingOperation } from './settings'

const operation = (fields: SettingOperation['fields'], method = 'PATCH'): SettingOperation => ({ key: 'test', method, path: '/api/v1/items/{id}', produces: ['application/json'], fields: [{ name: 'id', in: 'path', type: 'string' }, ...fields] })
describe('settings requests', () => {
  it('clears explicitly empty text while leaving unspecified settings untouched', () => {
    const { init, path } = settingRequest(operation([{ name: 'note', in: 'formData', type: 'string' }, { name: 'display_name', in: 'formData', type: 'string' }]), { note: '' }, 'a/b')
    expect(path).toBe('/api/v1/items/a%2Fb')
    expect((init.body as FormData).get('note')).toBe('')
    expect((init.body as FormData).has('display_name')).toBe(false)
  })
  it('serializes account aliases as the array required by the Go model, including clearing', () => {
    const alias = settingPages.flatMap(page => page.operations).find(op => op.key === 'accountAlias')!
    expect(JSON.parse(settingRequest(alias, { also_known_as_uris: 'https://a.example/@a\nhttps://b.example/@b' }).init.body as string)).toEqual({ also_known_as_uris: ['https://a.example/@a', 'https://b.example/@b'] })
    expect(JSON.parse(settingRequest(alias, { also_known_as_uris: '' }).init.body as string)).toEqual({ also_known_as_uris: [] })
  })
  it('preserves documented multipart names and encodes query values', () => {
    const op = operation([{ name: 'ids[]', in: 'formData', type: 'array' }, { name: 'q', in: 'query', type: 'string' }])
    const { path, init } = settingRequest(op, { 'ids[]': ['a', 'b'], q: 'a&b' }, '1')
    expect((init.body as FormData).getAll('ids[]')).toEqual(['a', 'b'])
    expect(path).toBe('/api/v1/items/1?q=a%26b')
  })
  it('never prepopulates passwords or copies rendered biography HTML into editable source', () => {
    const op = operation([{ name: 'password', in: 'formData', type: 'string' }, { name: 'note', in: 'formData', type: 'string' }])
    expect(initialFields(op, { password: 'secret', note: '<p>rendered</p>', source: { note: '**source**' } })).toEqual({ note: '**source**' })
  })
})
