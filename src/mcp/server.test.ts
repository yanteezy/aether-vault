// @vitest-environment node
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { beforeAll, describe, expect, it } from 'vitest'

let vault: string
beforeAll(async () => {
  vault = await mkdtemp(join(tmpdir(), 'mcp-'))
  await mkdir(join(vault, 'Проєкти'))
  await mkdir(join(vault, '.aether'))
  await mkdir(join(vault, '.trash'))
  await writeFile(join(vault, 'Ідеї.md'), '# Ідеї\nЗапустити [[План]] у березні. #робота')
  await writeFile(join(vault, 'Проєкти', 'План.md'), '# План\nКроки запуску')
  await writeFile(join(vault, '.trash', 'Старе.md'), 'secret')
  await writeFile(join(vault, 'Дошка.canvas'), JSON.stringify({
    nodes: [
      { id: 'a', type: 'text', text: 'Швидка думка\nдругий рядок', x: 0, y: 0, width: 260, height: 140, color: '4', 'aether-tags': ['#план'] },
      { id: 'b', type: 'file', file: 'Ідеї.md', x: 400, y: 0, width: 300, height: 200 },
      { id: 'g', type: 'group', label: 'Рамка', x: -20, y: -20, width: 320, height: 200 },
    ],
    edges: [{ id: 'e', fromNode: 'a', fromSide: 'right', toNode: 'b', toSide: 'left', label: 'веде до' }],
  }))
  await writeFile(join(vault, '.aether', 'workspace.json'), JSON.stringify({ tabs: [{ file: 'Ідеї.md' }, { file: 'Дошка.canvas' }], active: 1, selection: { canvas: 'Дошка.canvas', cards: ['a'] } }))
  process.env.AETHER_VAULT = vault
})

// the server reads the vault folder when it loads, so import it after AETHER_VAULT is set
const server = () => import('./server.js')
const call = async (name: string, args: Record<string, unknown> = {}) => {
  const r = await (await server()).handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) as { result: { content: { text: string }[]; isError?: boolean } }
  return r.result
}

describe('Aether MCP server', () => {
  it('lists the vault without hidden folders', async () => {
    expect((await call('list_files')).content[0].text.split('\n')).toEqual(['Дошка.canvas', 'Ідеї.md', 'Проєкти/План.md'])
    expect((await call('list_files', { folder: 'Проєкти' })).content[0].text).toBe('Проєкти/План.md')
  })

  it('reads a note, and refuses paths outside the vault', async () => {
    expect((await call('read_note', { path: 'Проєкти/План.md' })).content[0].text).toBe('# План\nКроки запуску')
    for (const path of ['../outside.md', join(tmpdir(), 'x.md'), '..\\..\\Windows\\win.ini']) {
      const r = await call('read_note', { path })
      expect(r.isError).toBe(true)
    }
  })

  it('reads a canvas as an outline: cards, text, colour, tags, frames, note cards, connections', async () => {
    const text = (await call('read_canvas', { path: 'Дошка.canvas' })).content[0].text
    expect(text).toContain('[a] "Швидка думка" — text at (0, 0), 260×140, color green, tags #план')
    expect(text).toContain('    другий рядок')
    expect(text).toContain('[b] note "Ідеї.md"')
    expect(text).toContain('Запустити [[План]]') // the start of the note on the card
    expect(text).toContain('contains: a')
    expect(text).toContain('"Швидка думка" (right) → note "Ідеї.md" (left) — "веде до"')
  })

  it('searches notes and canvas cards, never hidden folders', async () => {
    const text = (await call('search', { query: 'ЗАПУС' })).content[0].text
    expect(text).toContain('Ідеї.md: ')
    expect(text).toContain('Проєкти/План.md: ')
    expect((await call('search', { query: 'швидка' })).content[0].text).toContain('Дошка.canvas card [a]')
    expect((await call('search', { query: 'secret' })).content[0].text).toBe('Nothing found for "secret".')
  })

  it('tells what is open and selected now', async () => {
    const text = (await call('current_view')).content[0].text
    expect(text).toContain('Active: Дошка.canvas')
    expect(text).toContain('Selected on Дошка.canvas: a')
    expect(text).toContain('SELECTED')
  })

  it('speaks MCP over stdio: initialize, tools/list, notifications get no answer, unknown methods an error', async () => {
    const { serve } = await server()
    const input = new PassThrough(), output = new PassThrough()
    const lines: Record<string, unknown>[] = []
    output.on('data', (b: Buffer) => { for (const l of b.toString().split('\n')) if (l.trim()) lines.push(JSON.parse(l)) })
    serve(input, output)
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } })}\n`)
    input.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`)
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })}\n`)
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'nope' })}\n`)
    input.write('not json\n')
    await new Promise((r) => setTimeout(r, 50))
    expect(lines).toHaveLength(4)
    expect(lines.find((l) => l.id === 1)).toMatchObject({ id: 1, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'aether' } } })
    const tools = (lines.find((l) => l.id === 2)!.result as { tools: { name: string; annotations: { readOnlyHint: boolean } }[] }).tools
    expect(tools.map((t) => t.name)).toEqual(['list_files', 'read_note', 'read_canvas', 'search', 'current_view'])
    expect(tools.every((t) => t.annotations.readOnlyHint)).toBe(true)
    expect(lines.find((l) => l.id === 3)).toMatchObject({ error: { code: -32601 } })
    expect(lines.find((l) => l.id === null)).toMatchObject({ error: { code: -32700 } })
  })
})
