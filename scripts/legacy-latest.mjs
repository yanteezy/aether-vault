// latest.json for the OLD Aether (0.2.x): its updater reads
// https://github.com/<repo>/releases/latest/download/latest.json. Built from the fragments that
// scripts/legacy-update.mjs left for each platform. Usage: node scripts/legacy-latest.mjs <dir with fragments> <repo>
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [dir = 'artifacts', repo = 'yanteezy/aether-vault'] = process.argv.slice(2)
const version = JSON.parse(readFileSync('package.json', 'utf8')).version
const notes = (() => { try { return readFileSync('RELEASE_NOTES.md', 'utf8').split('\n').find((l) => l.startsWith('•'))?.replace(/^•\s*/, '') ?? '' } catch { return '' } })()

const platforms = {}
const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) e.isDirectory() ? walk(join(d, e.name)) : /^legacy-.*\.json$/.test(e.name) && Object.assign(platforms, JSON.parse(readFileSync(join(d, e.name), 'utf8'))) }
walk(dir)
if (!Object.keys(platforms).length) { console.log('no signed files: no latest.json'); process.exit(0) }

const url = (file) => `https://github.com/${repo}/releases/download/v${version}/${file}`
const latest = {
  version,
  notes,
  pub_date: new Date().toISOString(),
  platforms: Object.fromEntries(Object.entries(platforms).map(([p, { signature, file }]) => [p, { signature, url: url(file) }])),
}
writeFileSync(join(dir, 'latest.json'), JSON.stringify(latest, null, 2))
console.log(`latest.json: ${Object.keys(latest.platforms).join(', ')}`)
