import fs from 'node:fs/promises'
import path from 'node:path'
import { ListObjectsV2Command, HeadObjectCommand } from '@aws-sdk/client-s3'
import { r2 } from '@/lib/r2/client'

const THIRTY_MINUTES_MS = 30 * 60 * 1000

export type OrphanItem = {
  path: string
  size: number
  sourceType: 'r2' | 'local' | 'db'
  reason: string
}

export type OrphanScanResult = {
  r2_orphans: { count: number; totalBytes: number; items: OrphanItem[] }
  local_orphans: { count: number; totalBytes: number; items: OrphanItem[] }
  db_orphans: { count: number; totalBytes: number; items: OrphanItem[] }
}

function summarize(items: OrphanItem[]) {
  return {
    count: items.length,
    totalBytes: items.reduce((sum, item) => sum + item.size, 0),
    items,
  }
}

export async function scanProjectStorageOrphans(params: {
  projectId: string
  project: { cover_url?: string | null }
  photoFiles: Array<{ object_key: string | null; storage_provider: string | null; bucket_name: string | null; file_size_bytes?: number | null; created_at?: string | null }>
}) : Promise<OrphanScanResult> {
  const now = Date.now()
  const validR2 = new Set<string>()
  const validLocal = new Set<string>()

  for (const file of params.photoFiles) {
    if (!file.object_key) continue
    if (file.storage_provider === 'r2') validR2.add(file.object_key)
    if (file.storage_provider === 'local') validLocal.add(file.object_key)
  }

  if (params.project.cover_url) {
    if (/^https?:\/\//.test(params.project.cover_url)) validR2.add(params.project.cover_url)
    else validLocal.add(params.project.cover_url)
  }

  const r2Orphans: OrphanItem[] = []
  const localOrphans: OrphanItem[] = []
  const dbOrphans: OrphanItem[] = []

  const bucket = process.env.R2_BUCKET_NAME
  const publicBase = (process.env.R2_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_PHOTO_PUBLIC_BASE_URL || '').replace(/\/+$/, '')
  if (bucket) {
    const prefixes = [`${params.projectId}/`]
    for (const prefix of prefixes) {
      const listed = await r2.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix }))
      for (const item of listed.Contents ?? []) {
        if (!item.Key) continue
        const fullUrl = publicBase ? `${publicBase}/${item.Key}` : item.Key
        const lastModified = item.LastModified ? new Date(item.LastModified).getTime() : 0
        if (lastModified && now - lastModified < THIRTY_MINUTES_MS) continue
        if (!validR2.has(fullUrl) && !validR2.has(item.Key)) {
          r2Orphans.push({ path: item.Key, size: Number(item.Size || 0), sourceType: 'r2', reason: 'not referenced by project photo_files or project assets' })
        }
      }
    }
  }

  const localRoot = process.env.LOCAL_ORIGINALS_DIR || path.join(process.cwd(), 'storage', 'originals')
  const localProjectRoot = path.join(localRoot, params.projectId)
  try {
    const walk = async (dir: string) => {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          await walk(full)
        } else {
          const stat = await fs.stat(full)
          if (now - stat.mtimeMs < THIRTY_MINUTES_MS) continue
          if (!validLocal.has(full)) {
            localOrphans.push({ path: full, size: stat.size, sourceType: 'local', reason: 'not referenced by project photo_files or project assets' })
          }
        }
      }
    }
    await walk(localProjectRoot)
  } catch {}

  for (const file of params.photoFiles) {
    if (!file.object_key) continue
    if (file.storage_provider === 'r2' && bucket) {
      const key = publicBase && file.object_key.startsWith(`${publicBase}/`) ? file.object_key.slice(publicBase.length + 1) : file.object_key
      try {
        await r2.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
      } catch {
        dbOrphans.push({ path: file.object_key, size: Number(file.file_size_bytes || 0), sourceType: 'db', reason: 'database row points to missing R2 object' })
      }
    }
    if (file.storage_provider === 'local') {
      try {
        await fs.access(file.object_key)
      } catch {
        dbOrphans.push({ path: file.object_key, size: Number(file.file_size_bytes || 0), sourceType: 'db', reason: 'database row points to missing local file' })
      }
    }
  }

  return {
    r2_orphans: summarize(r2Orphans),
    local_orphans: summarize(localOrphans),
    db_orphans: summarize(dbOrphans),
  }
}
