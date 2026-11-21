// Uploads the installer once more under a fixed name, so README links like
//   https://github.com/<owner>/<repo>/releases/latest/download/Aether-Windows-Setup.exe
// always download the newest version. Never fails the release (the workflow step has continue-on-error).
import { readFileSync } from 'node:fs'

const paths = JSON.parse(process.env.ARTIFACTS || '[]')
const exe = paths.find((p) => /-setup\.exe$/i.test(p))
const dmg = paths.find((p) => /\.dmg$/i.test(p))
const file = exe ?? dmg
if (!file) {
  console.log('No installer among artifacts:', paths)
  process.exit(0)
}
const name = exe ? 'Aether-Windows-Setup.exe' : 'Aether-macOS.dmg'
const url = `${process.env.UPLOAD_URL.replace(/\{.*\}$/, '')}?name=${encodeURIComponent(name)}`
const res = await fetch(url, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.GH_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/octet-stream',
  },
  body: readFileSync(file),
})
console.log(`${name} ← ${file}: HTTP ${res.status}`)
if (!res.ok) console.log((await res.text()).slice(0, 500))
