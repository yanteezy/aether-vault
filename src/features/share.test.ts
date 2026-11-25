// @vitest-environment node
// (jsdom's Blob has no .stream(); the link code needs only Web APIs that Node has natively)
import { describe, expect, it } from 'vitest'
import { SHARE_PAGE, generatePassword, makeShareLink, openShareToken, parseShareLink, type SharedBoard } from './share'

const board: SharedBoard = {
  v: 1,
  name: 'Дошка',
  notes: [{ id: 'n1', title: 'Привіт', tags: ['ідея'], x: 10, y: 20, width: 260, height: 160, body: 'текст' }],
  connections: [{ id: 'c1', from: 'n1', to: 'n1' }],
  frames: [],
  chips: [],
  strokes: [],
  theme: { theme: 'glass' },
}

describe('share links', () => {
  it('opens a link without a password', async () => {
    const link = await makeShareLink(board)
    expect(link.startsWith(SHARE_PAGE + '#a1.')).toBe(true)
    const tok = parseShareLink(link)!
    expect(tok.encrypted).toBe(false)
    expect(await openShareToken(tok.token)).toEqual(board)
  })

  it('opens a link with a password, and refuses without it or with a wrong one', async () => {
    const link = await makeShareLink(board, 'секрет-123')
    const tok = parseShareLink(link)!
    expect(tok.encrypted).toBe(true)
    expect(await openShareToken(tok.token, 'секрет-123')).toEqual(board)
    await expect(openShareToken(tok.token)).rejects.toThrow('password')
    await expect(openShareToken(tok.token, 'wrong')).rejects.toThrow('password')
  }, 20_000)

  it('finds the link inside a message, and as aether:// or a bare token', async () => {
    const link = await makeShareLink(board)
    const token = link.split('#')[1]
    expect(parseShareLink(`дивись: ${link} 👀`)?.token).toBe(token)
    expect(parseShareLink(`aether://open#${token}`)?.token).toBe(token)
    expect(parseShareLink(token)?.token).toBe(token)
  })

  it('ignores text that is not ours', () => {
    expect(parseShareLink('')).toBeNull()
    expect(parseShareLink('https://example.com/#a1.z.abcdefghijkl')).toBeNull()
    expect(parseShareLink('просто текст')).toBeNull()
  })

  it('reports a damaged token as broken', async () => {
    await expect(openShareToken('a1.z.AAAAAAAAAAAA')).rejects.toThrow('broken')
    await expect(openShareToken('b2.z.AAAAAAAAAAAA')).rejects.toThrow('broken')
    await expect(openShareToken('nonsense')).rejects.toThrow('broken')
  })

  it('fills in missing lists and trims a long name', async () => {
    const raw = { v: 1, name: 'x'.repeat(200), notes: [] }
    const bytes = new TextEncoder().encode(JSON.stringify(raw))
    const b64 = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    const opened = await openShareToken(`a1.j.${b64}`)
    expect(opened.name).toHaveLength(80)
    expect(opened).toMatchObject({ connections: [], frames: [], chips: [], strokes: [] })
  })
})

describe('generatePassword', () => {
  it('makes four groups of four readable characters', () => {
    const p = generatePassword()
    expect(p).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/)
    expect(p).not.toMatch(/[ilo01]/)
    expect(generatePassword()).not.toBe(p)
  })
})
