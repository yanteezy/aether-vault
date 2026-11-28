import { describe, expect, it } from 'vitest'
import { filesText, sizeText } from './backupSettings.js'

describe('backup tab texts', () => {
  it('counts files in Ukrainian', () => {
    expect([1, 2, 5, 11, 12, 21, 22, 25, 111].map(filesText)).toEqual(['1 файл', '2 файли', '5 файлів', '11 файлів', '12 файлів', '21 файл', '22 файли', '25 файлів', '111 файлів'])
  })
  it('shows sizes', () => {
    expect(sizeText(300)).toBe('1 КБ')
    expect(sizeText(5 * 1024 * 1024 + 300000)).toBe('5,3 МБ')
  })
})
