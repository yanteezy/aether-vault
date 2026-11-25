// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { migrateVaults, type MigrationIo, type MigrationSource } from './migrateVaults'
import { VaultFiles } from './vaultFiles'
import type { VaultData } from './vaultRepo'
import { fakeDisk } from '../test/fakeVaultDisk'
import { guideContent } from '../data/guide'
import type { Vault } from '../types/note'

/** Several vault folders, each an in-memory disk. */
function fakeLibrary() {
  const folders = new Map<string, { meta: string; disk: ReturnType<typeof fakeDisk>; attachments: Set<string> }>()
  const at = (dir: string) => folders.get(dir)!
  let corrupt = false
  const io: MigrationIo = {
    listVaults: async () => [...folders].map(([dir, f]) => ({ dir, meta: f.meta })),
    writeVaultMeta: async (dir, name, meta) => {
      let target = dir
      if (!target) {
        target = name
        for (let n = 2; folders.has(target); n++) target = `${name} ${n}`
        folders.set(target, { meta, disk: fakeDisk(), attachments: new Set() })
      }
      at(target).meta = meta
      return target
    },
    readVault: async (dir) => ({ ...at(dir).disk.snapshot(), meta: at(dir).meta, attachments: [...at(dir).attachments] }),
    writeAttachment: async (dir, name) => void at(dir).attachments.add(name),
    noteFileName: (v, ...a) => at(v).disk.io.noteFileName(v, ...a),
    writeNote: (v, file, text, create) => at(v).disk.io.writeNote(v, file, corrupt ? text.slice(0, -3) : text, create),
    renameNote: (v, ...a) => at(v).disk.io.renameNote(v, ...a),
    deleteNote: (v, ...a) => at(v).disk.io.deleteNote(v, ...a),
    writeCanvas: (v, ...a) => at(v).disk.io.writeCanvas(v, ...a),
  }
  return { io, folders, at, corrupt: (on: boolean) => (corrupt = on) }
}

const vault = (id: string, name: string): Vault => ({ id, name, createdAt: 1 })
const source = (vaults: Vault[], data: Record<string, Partial<VaultData>>): MigrationSource => ({
  vaults,
  load: (id) => structuredClone(data[id] ?? {}),
  image: async (id) => (id === 'img-lost' ? undefined : { bytes: new Uint8Array([1]), ext: 'png' }),
})
const guide = (lang: 'uk' | 'en'): Partial<VaultData> => {
  const g = guideContent(lang, 'Alt')
  return { notes: g.notes, connections: g.connections, chips: g.chips, ink: g.strokes, frames: g.frames }
}
const reopen = async (lib: ReturnType<typeof fakeLibrary>, dir: string) =>
  VaultFiles.open(dir, await lib.io.readVault(dir), lib.io).data

describe('migrateVaults', () => {
  it('moves the feature guide in both languages without a difference', async () => {
    const lib = fakeLibrary()
    const out = await migrateVaults(source([vault('default', 'Aether'), vault('b', 'Aether')], { default: guide('uk'), b: guide('en') }), lib.io)
    expect(out.results.map((r) => r.error)).toEqual([undefined, undefined])
    expect(out.results.map((r) => r.dir)).toEqual(['Aether', 'Aether 2'])
    expect((await reopen(lib, 'Aether')).notes).toHaveLength(guide('uk').notes!.length)
  })

  it('keeps photos, old font presets, fractions and every kind; reports a photo that was already lost', async () => {
    const lib = fakeLibrary()
    const old = {
      notes: [
        { id: 'a', title: '', tags: [], x: 439.1025, y: -0.4, width: 260, height: 160, image: { id: 'img-ok' }, fontSize: 'l' as never },
        { id: 'b', title: 'A/B?', tags: ['x y'], x: 1, y: 2, width: 3, height: 4, image: { id: 'img-lost' }, body: '- [ ] не чекліст' },
      ],
      connections: [{ id: 'c', from: 'a', to: 'gone' }],
      'canvas-transform': { x: 1.5, y: 2.5, scale: 0.33 },
    }
    const out = await migrateVaults(source([vault('default', 'Моє')], { default: old }), lib.io)
    expect(out.results[0].error).toBeUndefined()
    expect(out.results[0]).toMatchObject({ notes: 2, missingImages: ['img-lost'] })
    expect([...lib.at('Моє').attachments]).toEqual(['img-ok.png'])
    const back = await reopen(lib, 'Моє')
    expect(back.notes[0]).toMatchObject({ x: 439, fontSize: 17, title: '' })
    expect(back.notes[1].title).toBe('A/B?')
  })

  it('fails instead of losing something the new format would drop', async () => {
    const lib = fakeLibrary()
    const odd = { notes: [{ id: 'a', title: 'T', tags: [], x: 0, y: 0, width: 1, height: 1, mystery: 'secret text' }] }
    const out = await migrateVaults(source([vault('default', 'V')], { default: odd as never }), lib.io)
    expect(out.ok).toBe(false)
    expect(out.results[0].error).toBe('does not match: notes a: mystery')
  })

  it('notices a damaged write, and a second run repairs it in the same folder', async () => {
    const lib = fakeLibrary()
    const src = source([vault('default', 'V')], { default: guide('uk') })
    lib.corrupt(true)
    expect((await migrateVaults(src, lib.io)).ok).toBe(false)
    lib.corrupt(false)
    lib.at('V').disk.notes.clear()
    const again = await migrateVaults(src, lib.io)
    expect(again.results[0].error).toBeUndefined()
    expect([...lib.folders.keys()]).toEqual(['V'])
  })

  it('carries on after a disk error without doubling notes', async () => {
    const lib = fakeLibrary()
    const src = source([vault('default', 'V')], { default: guide('uk') })
    await lib.io.writeVaultMeta(null, 'V', JSON.stringify({ id: 'default' }))
    lib.at('V').disk.fail('canvas')
    expect((await migrateVaults(src, lib.io)).results[0].error).toBe('disk full')
    lib.at('V').disk.fail()
    expect((await migrateVaults(src, lib.io)).ok).toBe(true)
    expect(lib.at('V').disk.notes.size).toBe(guide('uk').notes!.length)
  })
})
