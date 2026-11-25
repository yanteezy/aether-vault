/** The desktop side of the switch to vault folders: real disk, real photos, the safety copy. Used by main.tsx. */
import { createBackup, BACKUP_SECTIONS } from './backup'
import { startFileStore, type FileIo, type StartResult } from './fileStore'
import { getImage, setPhotoUsers } from './images'
import * as fs from './vaultFs'

/**
 * Release builds move the data to files. A development run uses the same data folder as the installed app, so it
 * moves nothing unless asked with `VITE_FILE_VAULTS=1` (it still uses files once they are there).
 */
const MIGRATE = import.meta.env.PROD || import.meta.env.VITE_FILE_VAULTS === '1'

const EXT: Record<string, string> = { 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }

export async function startFiles(): Promise<StartResult> {
  const result = await startFileStore({
    io: fs satisfies FileIo,
    photo: async (id) => {
      const blob = await getImage(id)
      return blob ? { bytes: new Uint8Array(await blob.arrayBuffer()), ext: EXT[blob.type] ?? 'jpg' } : undefined
    },
    migrate: MIGRATE,
    backup: async () => fs.writeDataBackup('before-files.aether', JSON.stringify(await createBackup(BACKUP_SECTIONS))),
  })
  if (result.mode === 'files') setPhotoUsers(() => result.store.usedImages())
  return result
}
