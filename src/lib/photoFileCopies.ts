import { resolvePhotoPublicUrl } from '@/lib/resolvePhotoPublicUrl'

export type PhotoFileCopyRow = {
  id: string
  photo_file_id: string
  storage_provider: 'local' | 'r2' | string
  bucket_name?: string | null
  storage_key: string
  status: 'queued' | 'copying' | 'verifying' | 'available' | 'failed' | 'deleting-source' | string
  checksum_verified?: boolean | null
  size_bytes?: number | null
  size_verified?: boolean | null
  is_primary_read_source?: boolean | null
  last_verified_at?: string | null
  last_error?: string | null
  created_at?: string | null
  updated_at?: string | null
}

export type ReadableCopyResolution = {
  copy: PhotoFileCopyRow | null
  source: 'primary' | 'fallback' | 'legacy' | 'none'
}

function byFreshness(a?: string | null, b?: string | null) {
  return (b || '').localeCompare(a || '')
}

function fallbackPriority(copy: PhotoFileCopyRow): number {
  const providerPriority = (() => {
    switch (copy.storage_provider) {
      case 'local': return 2
      case 'r2': return 1
      default: return 0
    }
  })()

  const healthPenalty = [
    copy.last_error ? -4 : 0,
    copy.checksum_verified === false ? -2 : 0,
    copy.size_verified === false ? -2 : 0,
  ].reduce((sum, value) => sum + value, 0)

  return providerPriority + healthPenalty
}

export function selectReadableCopy(copies: PhotoFileCopyRow[] | null | undefined): ReadableCopyResolution {
  const available = (copies ?? []).filter((copy) => copy.status === 'available' && typeof copy.storage_key === 'string' && copy.storage_key.trim())

  const primary = [...available]
    .filter((copy) => copy.is_primary_read_source === true)
    .sort((a, b) => {
      const providerDiff = fallbackPriority(b) - fallbackPriority(a)
      if (providerDiff !== 0) return providerDiff
      return byFreshness(a.updated_at ?? a.created_at, b.updated_at ?? b.created_at)
    })[0] ?? null
  if (primary) {
    return { copy: primary, source: 'primary' }
  }

  const fallback = [...available].sort((a, b) => {
    const providerDiff = fallbackPriority(b) - fallbackPriority(a)
    if (providerDiff !== 0) return providerDiff
    return byFreshness(a.updated_at ?? a.created_at, b.updated_at ?? b.created_at)
  })[0] ?? null

  if (fallback) {
    return { copy: fallback, source: 'fallback' }
  }

  return { copy: null, source: 'none' }
}

export function buildLegacyCopyFromPhotoFile(row: Record<string, unknown>): PhotoFileCopyRow | null {
  const storageProvider = typeof row.storage_provider === 'string' ? row.storage_provider : null
  const storageKey = typeof row.object_key === 'string' ? row.object_key : null
  if (!storageProvider || !storageKey) return null

  return {
    id: `legacy:${String(row.id ?? '')}`,
    photo_file_id: String(row.id ?? ''),
    storage_provider: storageProvider,
    bucket_name: typeof row.bucket_name === 'string' ? row.bucket_name : null,
    storage_key: storageKey,
    status: 'available',
    checksum_verified: typeof row.checksum_sha256 === 'string' && row.checksum_sha256.length > 0,
    size_bytes: typeof row.file_size_bytes === 'number' ? row.file_size_bytes : null,
    size_verified: typeof row.file_size_bytes === 'number',
    is_primary_read_source: true,
    created_at: typeof row.created_at === 'string' ? row.created_at : null,
    updated_at: typeof row.created_at === 'string' ? row.created_at : null,
  }
}

export function isPhotoFileCopyRow(value: PhotoFileCopyRow | null | undefined): value is PhotoFileCopyRow {
  return Boolean(value && typeof value.storage_key === 'string' && value.storage_key.length > 0)
}

export function resolveCopyPublicUrl(copy: PhotoFileCopyRow | null): string {
  if (!copy) return ''
  return resolvePhotoPublicUrl({
    object_key: copy.storage_key,
    bucket_name: copy.bucket_name,
    storage_provider: copy.storage_provider,
  })
}
