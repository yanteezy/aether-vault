/** Worker thread: builds the Galaxy of the vault it is given and posts the typed arrays back (transferred, not copied). */
import { parentPort, workerData } from 'node:worker_threads'
import { buildGalaxy } from './build.js'

void buildGalaxy(String(workerData.vault)).then(
  (data) => {
    const buffers = [...Object.values(data.positions), data.size, data.brightness, data.color, data.edges, data.degree, data.mtime, data.kind].map((a) => a.buffer as ArrayBuffer)
    parentPort!.postMessage({ ok: true, data }, buffers)
  },
  (e: unknown) => parentPort!.postMessage({ ok: false, error: e instanceof Error ? e.message : String(e) }),
)
