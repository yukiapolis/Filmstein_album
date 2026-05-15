import path from 'node:path'

import { supabase } from '@/lib/supabase/server'
import { buildLegacyCopyFromPhotoFile, isPhotoFileCopyRow, type PhotoFileCopyRow } from '@/lib/photoFileCopies'

export type StorageLocationCategory = 'r2' | 'local_backup_server' | 'other_remote_storage' | 'app_local_storage' | 'unknown'
export type StorageManagedBranchType = 'thumb' | 'display' | 'original'

export type StorageLocationBreakdown = Record<Exclude<StorageLocationCategory, 'unknown'>, number>

export type StorageCopyDistribution = {
  totalCopies: number
  availableCopies: number
  failedCopies: number
  queuedCopies: number
  copyingCopies: number
  verifyingCopies: number
  byLocation: StorageLocationBreakdown
}

export type StorageBranchSummary = {
  branchType: StorageManagedBranchType
  totalFiles: number
  primaryReadSource: StorageLocationBreakdown
  copyDistribution: StorageCopyDistribution
  readableFiles: number
  verifiedFiles: number
  failedFiles: number
  abnormalFiles: number
  noPrimaryFiles: number
  noReadableFiles: number
}

export type ProjectStorageSummary = {
  projectId: string
  generatedAt: string
  branches: Record<StorageManagedBranchType, StorageBranchSummary>
}

type PhotoFileRow = {
  id: string
  photo_id: string
  branch_type: string | null
  storage_provider?: string | null
  bucket_name?: string | null
  object_key?: string | null
  checksum_sha256?: string | null
  file_size_bytes?: number | null
  created_at?: string | null
  file_copies?: PhotoFileCopyRow[] | null
}

const BACKUP_SERVER_HOST = 'snapflarebackup.filmstein.com'
const APP_LOCAL_ROOT = process.env.LOCAL_ORIGINALS_DIR || path.join(process.cwd(), 'storage', 'originals')

function emptyLocationBreakdown(): StorageLocationBreakdown {
  return {
    r2: 0,
    local_backup_server: 0,
    other_remote_storage: 0,
    app_local_storage: 0,
  }
}

function createEmptyBranchSummary(branchType: StorageManagedBranchType): StorageBranchSummary {
  return {
    branchType,
    totalFiles: 0,
    primaryReadSource: emptyLocationBreakdown(),
    copyDistribution: {
      totalCopies: 0,
      availableCopies: 0,
      failedCopies: 0,
      queuedCopies: 0,
      copyingCopies: 0,
      verifyingCopies: 0,
      byLocation: emptyLocationBreakdown(),
    },
    readableFiles: 0,
    verifiedFiles: 0,
    failedFiles: 0,
    abnormalFiles: 0,
    noPrimaryFiles: 0,
    noReadableFiles: 0,
  }
}

export function classifyStorageLocation(input: {
  storageProvider?: string | null
  bucketName?: string | null
  storageKey?: string | null
}): StorageLocationCategory {
  const provider = (input.storageProvider || '').trim().toLowerCase()
  const bucket = (input.bucketName || '').trim().toLowerCase()
  const key = (input.storageKey || '').trim()
  const keyLower = key.toLowerCase()

  if (provider === 'r2') return 'r2'
  if (provider === 'backup_remote') return 'local_backup_server'

  const mentionsBackup = [provider, bucket, keyLower].some((value) => value.includes('backup')) || keyLower.includes(BACKUP_SERVER_HOST)
  if (mentionsBackup) return 'local_backup_server'

  if (provider === 'local') {
    if (/^https?:\/\//i.test(key) && keyLower.includes(BACKUP_SERVER_HOST)) {
      return 'local_backup_server'
    }
    return 'app_local_storage'
  }

  if (/^https?:\/\//i.test(key)) {
    try {
      const hostname = new URL(key).hostname.toLowerCase()
      if (hostname === BACKUP_SERVER_HOST || hostname.endsWith(`.${BACKUP_SERVER_HOST}`)) {
        return 'local_backup_server'
      }
      return 'other_remote_storage'
    } catch {
      return 'other_remote_storage'
    }
  }

  if (key && path.isAbsolute(key) && key.startsWith(APP_LOCAL_ROOT)) {
    return 'app_local_storage'
  }

  if (provider) return 'other_remote_storage'
  return 'unknown'
}

function normalizeCopies(file: PhotoFileRow): PhotoFileCopyRow[] {
  if (Array.isArray(file.file_copies) && file.file_copies.length > 0) {
    return file.file_copies.filter(isPhotoFileCopyRow)
  }
  return [buildLegacyCopyFromPhotoFile(file)].filter(isPhotoFileCopyRow)
}

function isVerifiedCopy(copy: PhotoFileCopyRow) {
  return copy.status === 'available' && copy.checksum_verified !== false && copy.size_verified !== false
}

export async function loadProjectStorageSummary(projectId: string): Promise<ProjectStorageSummary> {
  const { data: photoRows, error: photoError } = await supabase
    .from('photos')
    .select('global_photo_id')
    .eq('project_id', projectId)

  if (photoError) throw photoError

  const photoIds = (photoRows ?? []).map((row) => String(row.global_photo_id || '')).filter(Boolean)
  const branchTypes: StorageManagedBranchType[] = ['thumb', 'display', 'original']
  const branches = {
    thumb: createEmptyBranchSummary('thumb'),
    display: createEmptyBranchSummary('display'),
    original: createEmptyBranchSummary('original'),
  }

  if (photoIds.length === 0) {
    return {
      projectId,
      generatedAt: new Date().toISOString(),
      branches,
    }
  }

  const { data: fileRows, error: fileError } = await supabase
    .from('photo_files')
    .select('id, photo_id, branch_type, storage_provider, bucket_name, object_key, checksum_sha256, file_size_bytes, created_at, file_copies:photo_file_copies(id, photo_file_id, storage_provider, bucket_name, storage_key, status, checksum_verified, size_bytes, size_verified, is_primary_read_source, last_verified_at, last_error, created_at, updated_at)')
    .in('photo_id', photoIds)
    .in('branch_type', branchTypes)

  if (fileError) throw fileError

  for (const file of (fileRows ?? []) as PhotoFileRow[]) {
    const branchType = file.branch_type as StorageManagedBranchType | null
    if (!branchType || !(branchType in branches)) continue

    const summary = branches[branchType]
    summary.totalFiles += 1

    const copies = normalizeCopies(file)
    const primaryCopies = copies.filter((copy) => copy.is_primary_read_source === true)
    const readableCopies = copies.filter((copy) => copy.status === 'available')
    const hasReadable = readableCopies.length > 0
    const hasVerified = copies.some(isVerifiedCopy)
    const hasFailed = copies.some((copy) => copy.status === 'failed' || Boolean(copy.last_error))
    const hasAbnormal = hasFailed || !hasReadable || primaryCopies.length === 0

    if (hasReadable) summary.readableFiles += 1
    if (hasVerified) summary.verifiedFiles += 1
    if (hasFailed) summary.failedFiles += 1
    if (hasAbnormal) summary.abnormalFiles += 1
    if (primaryCopies.length === 0) summary.noPrimaryFiles += 1
    if (!hasReadable) summary.noReadableFiles += 1

    const primaryForDistribution = primaryCopies[0]
    if (primaryForDistribution) {
      const category = classifyStorageLocation({
        storageProvider: primaryForDistribution.storage_provider,
        bucketName: primaryForDistribution.bucket_name,
        storageKey: primaryForDistribution.storage_key,
      })
      if (category !== 'unknown') {
        summary.primaryReadSource[category] += 1
      }
    }

    for (const copy of copies) {
      summary.copyDistribution.totalCopies += 1
      const category = classifyStorageLocation({
        storageProvider: copy.storage_provider,
        bucketName: copy.bucket_name,
        storageKey: copy.storage_key,
      })
      if (category !== 'unknown') {
        summary.copyDistribution.byLocation[category] += 1
      }
      if (copy.status === 'available') summary.copyDistribution.availableCopies += 1
      if (copy.status === 'failed') summary.copyDistribution.failedCopies += 1
      if (copy.status === 'queued') summary.copyDistribution.queuedCopies += 1
      if (copy.status === 'copying') summary.copyDistribution.copyingCopies += 1
      if (copy.status === 'verifying') summary.copyDistribution.verifyingCopies += 1
    }
  }

  return {
    projectId,
    generatedAt: new Date().toISOString(),
    branches,
  }
}
