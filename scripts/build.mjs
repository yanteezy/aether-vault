// Bundles the page (src/app) into dist/app. Node built-ins and electron stay real `require` calls,
// because the page runs with Node integration, like Obsidian.
// `--prod` (release build): minified, no sourcemaps, NODE_ENV=production.
import { rm } from 'node:fs/promises'
import { build } from 'esbuild'

const prod = process.argv.includes('--prod')
if (prod) await rm('dist/app', { recursive: true, force: true }) // no stale .map files in the installer

await build({
  // note-menu.css loads after app.css on purpose: its card rules override app.css's
  entryPoints: { index: 'src/app/index.ts', app: 'src/styles/app.css', 'note-menu': 'src/styles/note-menu.css', shell: 'src/styles/shell.css', galaxy: 'src/styles/galaxy.css' },
  outdir: 'dist/app',
  bundle: true,
  platform: 'node',
  format: 'iife', // own scope: a classic <script> would leak `var top` etc. into window
  target: 'chrome140',
  external: ['electron'],
  // a classic <script> page cannot import() a Node module: compile import('electron') to a require() promise
  supported: { 'dynamic-import': false },
  loader: { '.woff2': 'file', '.woff': 'file' },
  sourcemap: !prod,
  minify: prod,
  define: prod ? { 'process.env.NODE_ENV': '"production"' } : undefined,
  logLevel: 'warning',
})

// The read-only MCP server Claude Desktop / Claude Code runs: one CommonJS file (the package is "type": "module",
// and inside the .mcpb there is no package.json), plain Node, no Electron.
await build({
  entryPoints: ['src/mcp/main.ts'],
  outfile: 'dist/mcp/server.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  minify: prod,
  logLevel: 'warning',
})
await packMcpb()

// «Галактика» builder: a worker thread of the main process; bundled (it uses the app's Markdown parser and `yaml`)
await build({
  entryPoints: ['src/main/galaxy/worker.ts'],
  outfile: 'dist/main/galaxyWorker.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  minify: prod,
  logLevel: 'warning',
})
// updates (electron-updater): bundled too, the installed app has no node_modules
await build({
  entryPoints: ['src/main/updater.ts'],
  outfile: 'dist/main/updater.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
  minify: prod,
  logLevel: 'warning',
})

/** dist/claude/aether.mcpb: a ZIP (stored, no compression) with manifest.json and the server, per the MCPB manifest spec 0.3. */
async function packMcpb() {
  const { readFile, writeFile, mkdir } = await import('node:fs/promises')
  const { crc32 } = await import('node:zlib')
  const pkg = JSON.parse(await readFile('package.json', 'utf8'))
  const manifest = {
    manifest_version: '0.3',
    name: 'aether',
    display_name: 'Aether — нотатки й полотна',
    version: pkg.version,
    description: 'Read-only access to an Aether notes vault: notes, canvases, search and what is open in the app.',
    author: { name: 'Aether' },
    server: {
      type: 'node',
      entry_point: 'server/index.cjs',
      mcp_config: { command: 'node', args: ['${__dirname}/server/index.cjs'], env: { AETHER_VAULT: '${user_config.vault}' } },
    },
    user_config: {
      vault: { type: 'directory', title: 'Папка сховища Aether', description: 'Папка з вашими нотатками й полотнами. Claude зможе лише читати її.', required: true },
    },
    tools: [
      { name: 'list_files', description: 'List notes, canvases and attachments' },
      { name: 'read_note', description: 'Read a Markdown note' },
      { name: 'read_canvas', description: 'Read a canvas as an outline of cards and connections' },
      { name: 'search', description: 'Search notes and canvas cards' },
      { name: 'current_view', description: 'What is open and selected in the app now' },
    ],
    compatibility: { runtimes: { node: '>=18.0.0' } },
  }
  const files = [
    ['manifest.json', Buffer.from(JSON.stringify(manifest, null, 2))],
    ['server/index.cjs', await readFile('dist/mcp/server.cjs')],
  ]
  // minimal ZIP writer: local headers + central directory, method 0 (stored)
  const locals = [], centrals = []
  let offset = 0
  for (const [name, data] of files) {
    const n = Buffer.from(name, 'utf8'), crc = crc32(data) >>> 0
    const head = Buffer.alloc(30); head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6)
    head.writeUInt32LE(crc, 14); head.writeUInt32LE(data.length, 18); head.writeUInt32LE(data.length, 22); head.writeUInt16LE(n.length, 26)
    const cen = Buffer.alloc(46); cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8)
    cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(data.length, 20); cen.writeUInt32LE(data.length, 24); cen.writeUInt16LE(n.length, 28); cen.writeUInt32LE(offset, 42)
    locals.push(head, n, data); centrals.push(cen, n)
    offset += 30 + n.length + data.length
  }
  const dir = Buffer.concat(centrals)
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16)
  await mkdir('dist/claude', { recursive: true })
  await writeFile('dist/claude/aether.mcpb', Buffer.concat([...locals, dir, end]))
}
