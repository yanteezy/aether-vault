/**
 * Read-only MCP server (Model Context Protocol, stdio transport) that lets Claude Desktop / Claude Code
 * see one Aether vault: list notes, read a note or a canvas, search, and what the app has open now.
 * Run: node server.cjs <vault folder>   (or AETHER_VAULT=<vault folder> node server.cjs)
 * stdout carries only JSON-RPC messages, one per line; anything for people goes to stderr.
 */
import { createInterface } from 'node:readline'
import { currentView, listFiles, readCanvas, readNote, search } from './vaultTools.js'

const VERSION = '1.0.0'
const vault = process.argv[2] || process.env.AETHER_VAULT || ''

type Args = Record<string, unknown>
const str = (a: Args, key: string) => (typeof a[key] === 'string' ? (a[key] as string) : '')

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
export const TOOLS = [
  {
    name: 'list_files',
    description: 'List the notes (.md), canvases (.canvas) and attachments in the Aether vault, as vault-relative paths. Optional `folder` limits the list to one folder.',
    inputSchema: { type: 'object', properties: { folder: { type: 'string', description: 'Vault-relative folder, e.g. "Projects". Empty for the whole vault.' } }, additionalProperties: false },
    annotations: readOnly,
    run: async (a: Args) => (await listFiles(vault, str(a, 'folder'))).join('\n') || 'The vault is empty.',
  },
  {
    name: 'read_note',
    description: 'Read one Markdown note of the vault (frontmatter included).',
    inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'Vault-relative path, e.g. "Ideas.md".' } }, required: ['path'], additionalProperties: false },
    annotations: readOnly,
    run: (a: Args) => readNote(vault, str(a, 'path')),
  },
  {
    name: 'read_canvas',
    description: 'Read a canvas (.canvas, JSON Canvas) as an outline: every card with its text, position, size, colour and tags, frames with what they contain, note cards with the start of their note, and all connections with their sides and labels.',
    inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'Vault-relative path, e.g. "Board.canvas".' } }, required: ['path'], additionalProperties: false },
    annotations: readOnly,
    run: (a: Args) => readCanvas(vault, str(a, 'path')),
  },
  {
    name: 'search',
    description: 'Full-text search (case-insensitive) in note text and file names, and in the text of canvas cards and frames. Returns paths with a short snippet per hit.',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Text to look for.' } }, required: ['query'], additionalProperties: false },
    annotations: readOnly,
    run: (a: Args) => search(vault, str(a, 'query')),
  },
  {
    name: 'current_view',
    description: 'What the user has open in the Aether app right now: open tabs, the active file, and the cards selected on the open canvas (with that canvas as an outline). Use it when the user says "this card", "this note" or "what I have open".',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: readOnly,
    run: () => currentView(vault),
  },
]

type Msg = { jsonrpc: '2.0'; id?: number | string | null; method?: string; params?: Args }

/** One JSON-RPC message in, the reply out (null for notifications). */
export async function handle(msg: Msg): Promise<object | null> {
  const reply = (result: object) => ({ jsonrpc: '2.0', id: msg.id, result })
  const fail = (code: number, message: string) => ({ jsonrpc: '2.0', id: msg.id ?? null, error: { code, message } })
  if (msg.id === undefined || msg.id === null) return null // a notification (e.g. notifications/initialized): no answer
  switch (msg.method) {
    case 'initialize':
      return reply({
        protocolVersion: typeof msg.params?.protocolVersion === 'string' ? msg.params.protocolVersion : '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'aether', version: VERSION },
        instructions: 'Read-only access to the user\'s Aether notes vault (Obsidian-compatible Markdown notes and JSON Canvas boards). Call current_view when the user refers to what they have open or selected.',
      })
    case 'ping':
      return reply({})
    case 'tools/list':
      return reply({ tools: TOOLS.map(({ run: _run, ...t }) => t) })
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === msg.params?.name)
      if (!tool) return fail(-32602, `Unknown tool: ${String(msg.params?.name)}`)
      if (!vault) return reply({ content: [{ type: 'text', text: 'No vault folder is set: start the server with the vault folder as its argument or AETHER_VAULT.' }], isError: true })
      try {
        const text = await tool.run((msg.params?.arguments as Args) ?? {})
        return reply({ content: [{ type: 'text', text }] })
      } catch (e) {
        return reply({ content: [{ type: 'text', text: (e as Error).message }], isError: true })
      }
    }
    default:
      return fail(-32601, `Method not found: ${msg.method}`)
  }
}

/** The stdio loop: newline-delimited JSON-RPC. */
export function serve(input: NodeJS.ReadableStream = process.stdin, output: NodeJS.WritableStream = process.stdout) {
  const rl = createInterface({ input })
  rl.on('line', (line) => {
    if (!line.trim()) return
    let msg: Msg
    try { msg = JSON.parse(line.replace(/^﻿/, '')) } catch { // a byte-order mark some shells put first
      output.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })}\n`)
      return
    }
    void handle(msg).then((r) => { if (r) output.write(`${JSON.stringify(r)}\n`) })
  })
}

export const hasVault = () => !!vault
