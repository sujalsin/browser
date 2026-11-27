import { describe, expect, it } from 'vitest'
import { newKeyRecord, parseKeyRecord, verifyKey, type KeyCrypto } from './key-check'

/** A stand-in keychain: "locks" by XOR with a key byte; can be told to refuse. */
function keychain(key: number, state: { refuse?: boolean } = {}): KeyCrypto {
  const x = (b: Buffer) => Buffer.from(b.map((v) => v ^ key))
  return {
    encrypt: async (text) => {
      if (state.refuse) throw new Error('denied')
      return Buffer.concat([Buffer.from([key]), x(Buffer.from(text))])
    },
    decrypt: async (data) => {
      if (state.refuse) throw new Error('denied')
      if (data[0] !== key) throw new Error('wrong key')
      return x(data.subarray(1)).toString()
    },
  }
}

describe('the key check', () => {
  it('a profile never locked before has nothing to check', async () => {
    expect(await verifyKey(null, keychain(7))).toBe('first')
  })
  it('passes with the same key', async () => {
    const record = await newKeyRecord(keychain(7))
    expect(await verifyKey(record, keychain(7))).toBe('ok')
    expect(await verifyKey(parseKeyRecord(JSON.stringify(record)), keychain(7))).toBe('ok')
  })
  it('notices when macOS refuses to hand the key over', async () => {
    const record = await newKeyRecord(keychain(7))
    expect(await verifyKey(record, keychain(7, { refuse: true }))).toBe('unavailable')
  })
  it('notices a different key (keychain reset, profile copied from another Mac)', async () => {
    const record = await newKeyRecord(keychain(7))
    expect(await verifyKey(record, keychain(9))).toBe('different')
  })
  it('notices a damaged record', async () => {
    const record = await newKeyRecord(keychain(7))
    expect(await verifyKey({ ...record, check: Buffer.from('garbage').toString('base64') }, keychain(7))).toBe('different')
  })
  it('refuses to create a record when the key cannot be had', async () => {
    await expect(newKeyRecord(keychain(7, { refuse: true }))).rejects.toThrow()
  })
  it('keeps the list of protected profiles when the record is renewed', async () => {
    const record = await newKeyRecord(keychain(9), { resaved: ['persist:space-a'], attempts: { 'persist:space-b': 1 } })
    expect(record.resaved).toEqual(['persist:space-a'])
    expect(record.attempts).toEqual({ 'persist:space-b': 1 })
  })
})

describe('parseKeyRecord', () => {
  it('reads a record and tolerates missing or odd fields', () => {
    expect(parseKeyRecord('{"v":1,"check":"YWJj","resaved":["a",3,null]}')).toEqual({ v: 1, check: 'YWJj', resaved: ['a'], attempts: {} })
    expect(parseKeyRecord('{"v":1,"check":"YWJj"}')?.resaved).toEqual([])
  })
  it('treats anything else as no record', () => {
    for (const text of [null, undefined, '', 'not json', '{}', '{"v":2,"check":"x"}', '{"v":1,"check":""}', '[]', '7']) expect(parseKeyRecord(text)).toBeNull()
  })
})
