// The bridge for the OLD Aether (0.2.x, Tauri): it updates only from `latest.json` with files signed by the
// Tauri key. After electron-builder, this signs this platform's new installer with that key and leaves a
// fragment for `latest.json` (scripts/legacy-latest.mjs puts the fragments together).
//   Windows: the NSIS setup .exe (the old app runs it, then quits).
//   macOS:   Aether.app packed as .app.tar.gz (the old app swaps its bundle for this one and relaunches).
// The key comes from the GitHub secrets TAURI_SIGNING_PRIVATE_KEY / _PASSWORD; without them nothing is signed
// and the old app simply sees no update.
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const version = JSON.parse(readFileSync('package.json', 'utf8')).version
const out = 'release'
if (!process.env.TAURI_SIGNING_PRIVATE_KEY) {
  console.log('::warning::TAURI_SIGNING_PRIVATE_KEY is not set: the old Aether 0.2.x will not see this release.')
  process.exit(0)
}

let file, platforms
if (process.platform === 'win32') {
  file = readdirSync(out).find((f) => f === `Aether-Setup-${version}.exe`)
  platforms = ['windows-x86_64', 'windows-x86_64-nsis']
} else if (process.platform === 'darwin') {
  const app = ['mac-universal', 'mac-arm64', 'mac'].map((d) => join(out, d, 'Aether.app')).find(existsSync)
  if (!app) throw new Error('Aether.app not found in release/')
  file = 'Aether_universal.app.tar.gz'
  execFileSync('tar', ['-czf', join(out, file), '-C', join(app, '..'), 'Aether.app'], { stdio: 'inherit' })
  platforms = ['darwin-aarch64', 'darwin-x86_64', 'darwin-aarch64-app', 'darwin-x86_64-app']
} else process.exit(0)
if (!file) throw new Error(`installer for ${version} not found in release/`)

// the same signer the old release workflow used (tauri-action): writes <file>.sig
execFileSync('npx', ['--yes', '@tauri-apps/cli@2', 'signer', 'sign', join(out, file)], { stdio: 'inherit', shell: process.platform === 'win32' })
const signature = readFileSync(join(out, `${file}.sig`), 'utf8').trim()
writeFileSync(join(out, `legacy-${process.platform}.json`), JSON.stringify(Object.fromEntries(platforms.map((p) => [p, { signature, file }])), null, 2))
console.log(`signed ${file} for the old Aether`)
