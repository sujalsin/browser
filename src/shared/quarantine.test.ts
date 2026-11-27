import { describe, expect, it } from 'vitest'
import { quarantineValue } from './quarantine'

describe('quarantineValue', () => {
  it('has the four parts macOS expects', () => {
    expect(quarantineValue(1_795_761_086_310, '3f2c1a90-7b1e-4c55-9d0a-12ab34cd56ef')).toBe('0081;6b0923be;Browser;3F2C1A90-7B1E-4C55-9D0A-12AB34CD56EF')
  })
  it('never lets odd input break the format', () => {
    expect(quarantineValue(-5, 'not-a-uuid', 'Evil;App\n')).toBe('0081;0;EvilApp;00000000-0000-0000-0000-000000000000')
    expect(quarantineValue(1000, 'x', ';;;').split(';')).toHaveLength(4)
  })
})
