import { createHash } from 'node:crypto'
import path from 'node:path'

import { resolveCopyPublicUrl, selectReadableCopy, type PhotoFileCopyRow } from '@/lib/photoFileCopies'
import { supabase } from '@/lib/supabase/server'
import { buildLegacyCopyFromPhotoFile, isPhotoFileCopyRow } from '@/lib/photoFileCopies'

export const STORAGE_MIGRATION_SOURCE_PROVIDER = 'r2' as const
export const STORAGE_MIGRATION_TARGET_PROVIDER = 'backup_remote' as const
export const BACKUP_REMOTE_PUBLIC_BASE_URL = (process.env.BACKUP_REMOTE_PUBLIC_BASE_URL || 'https://snapflarebackup.filmstein.com').replace(/\/+$/, '')
const BACKUP_REMOTE_WRITE_BASE_URL = (process.env.BACKUP_REMOTE_WRITE_BASE_URL || BACKUP_REMOTE_PUBLIC_BASE_URL).replace(/\/+$/, '')
const BACKUP_REMOTE_AUTH_TOKEN = process.env.BACKUP_REMOTE_AUTH_TOKEN || ''

export type StorageMigrationBranchType = 'thumb' | 'display' | 'original'
export type StorageMigrationStatus = 'pending' | 'running' | 'completed' | 'completed_with_errors' | 'failed' | 'cancelled'
export type StorageMigrationPhase = 'planning' | 'copying' | 'verifying' | 'completed' | 'failed'
export type StorageMigrationItemStatus = 'queued' | 'copying' | 'verifying' | 'available' | 'failed' | 'skipped'

export type ProjectStorageMigrationRow = {
  id: string
  project_id: string
  requested_by_admin_user_id?: string | null
  source_provider: string
  target_provider: string
  branch_types: StorageMigrationBranchType[]
  status: StorageMigrationStatus
  current_phase: StorageMigrationPhase
  total_files: number
  done_files: number
  success_files: number
  failed_files: number
  total_bytes: number
  transferred_bytes: number
  bytes_per_second: number
  eta_seconds?: number | null
  last_error_summary?: string | null
  started_at?: string | null
  created_at?: string | null
  updated_at?: string | null
  completed_at?: string | null
}

export type ProjectStorageMigrationItemRow = {
  id: string
  migration_id: string
  photo_file_id: string
  branch_type: StorageMigrationBranchType
  source_copy_id?: string | null
  target_copy_id?: string | null
  status: StorageMigrationItemStatus
  bytes_total: number
  bytes_done: number
  attempt_count: number
  last_error?: string | null
  created_at?: string | null
  updated_at?: string | null
  completed_at?: string | null
}

export type ProjectStorageMigrationWithItems = ProjectStorageMigrationRow & {
  items: ProjectStorageMigrationItemRow[]
}

type PhotoFileRow = {
  id: string
  photo_id: string
  project_id: string
  branch_type: StorageMigrationBranchType | string | null
  version_no?: number | null
  file_name?: string | null
  original_file_name?: string | null
  storage_provider?: string | null
  bucket_name?: string | null
  object_key?: string | null
  mime_type?: string | null
  file_size_bytes?: number | null
  checksum_sha256?: string | null
  created_at?: string | null
  file_copies?: PhotoFileCopyRow[] | null
}

function normalizeCopies(file: PhotoFileRow): PhotoFileCopyRow[] {
  if (Array.isArray(file.file_copies) && file.file_copies.length > 0) {
    return file.file_copies.filter(isPhotoFileCopyRow)
  }
  return [buildLegacyCopyFromPhotoFile(file)].filter(isPhotoFileCopyRow)
}

function sanitizeFilenameSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^[-.]+|[-.]+$/g, '') || 'file'
}

function extractPathPart(value: string) {
  try {
    const url = new URL(value)
    return url.pathname.replace(/^\/+/, '')
  } catch {
    return value.replace(/^\/+/, '')
  }
}

function pickSourceCopy(file: PhotoFileRow): PhotoFileCopyRow | null {
  const copies = normalizeCopies(file)
  const r2Copies = copies.filter((copy) => copy.storage_provider === STORAGE_MIGRATION_SOURCE_PROVIDER && copy.status === 'available')
  const selected = selectReadableCopy(r2Copies)
  return selected.copy
}

function hasAvailableBackupCopy(file: PhotoFileRow): boolean {
  return normalizeCopies(file).some((copy) => copy.storage_provider === STORAGE_MIGRATION_TARGET_PROVIDER && copy.status === 'available')
}

function buildBackupStorageKey(file: PhotoFileRow) {
  const rawName = file.file_name || file.original_file_name || extractPathPart(file.object_key || '') || `${file.id}.bin`
  const baseName = sanitizeFilenameSegment(path.basename(rawName))
  const versionNo = Number(file.version_no) > 0 ? Number(file.version_no) : 1
  return ['projects', file.project_id, file.photo_id, String(file.branch_type || 'unknown'), `v${versionNo}`, baseName].join('/')
}

export function buildBackupRemotePublicUrl(storageKey: string) {
  return `${BACKUP_REMOTE_PUBLIC_BASE_URL}/${storageKey.replace(/^\/+/, '')}`
}

function buildBackupRemoteWriteUrl(storageKey: string) {
  return `${BACKUP_REMOTE_WRITE_BASE_URL}/${storageKey.replace(/^\/+/, '')}`
}

function parseMigrationRow(row: Record<string, unknown>): ProjectStorageMigrationRow {
  return {
    id: String(row.id || ''),
    project_id: String(row.project_id || ''),
    requested_by_admin_user_id: typeof row.requested_by_admin_user_id === 'string' ? row.requested_by_admin_user_id : null,
    source_provider: String(row.source_provider || ''),
    target_provider: String(row.target_provider || ''),
    branch_types: Array.isArray(row.branch_types) ? row.branch_types.filter((value): value is StorageMigrationBranchType => value === 'thumb' || value === 'display' || value === 'original') : [],
    status: (row.status as StorageMigrationStatus) || 'pending',
    current_phase: (row.current_phase as StorageMigrationPhase) || 'planning',
    total_files: Number(row.total_files || 0),
    done_files: Number(row.done_files || 0),
    success_files: Number(row.success_files || 0),
    failed_files: Number(row.failed_files || 0),
    total_bytes: Number(row.total_bytes || 0),
    transferred_bytes: Number(row.transferred_bytes || 0),
    bytes_per_second: Number(row.bytes_per_second || 0),
    eta_seconds: row.eta_seconds == null ? null : Number(row.eta_seconds || 0),
    last_error_summary: typeof row.last_error_summary === 'string' ? row.last_error_summary : null,
    started_at: typeof row.started_at === 'string' ? row.started_at : null,
    created_at: typeof row.created_at === 'string' ? row.created_at : null,
    updated_at: typeof row.updated_at === 'string' ? row.updated_at : null,
    completed_at: typeof row.completed_at === 'string' ? row.completed_at : null,
  }
}

function parseItemRow(row: Record<string, unknown>): ProjectStorageMigrationItemRow {
  return {
    id: String(row.id || ''),
    migration_id: String(row.migration_id || ''),
    photo_file_id: String(row.photo_file_id || ''),
    branch_type: (row.branch_type as StorageMigrationBranchType) || 'original',
    source_copy_id: typeof row.source_copy_id === 'string' ? row.source_copy_id : null,
    target_copy_id: typeof row.target_copy_id === 'string' ? row.target_copy_id : null,
    status: (row.status as StorageMigrationItemStatus) || 'queued',
    bytes_total: Number(row.bytes_total || 0),
    bytes_done: Number(row.bytes_done || 0),
    attempt_count: Number(row.attempt_count || 0),
    last_error: typeof row.last_error === 'string' ? row.last_error : null,
    created_at: typeof row.created_at === 'string' ? row.created_at : null,
    updated_at: typeof row.updated_at === 'string' ? row.updated_at : null,
    completed_at: typeof row.completed_at === 'string' ? row.completed_at : null,
  }
}

async function loadCandidateFiles(projectId: string, branchTypes: StorageMigrationBranchType[]) {
  const { data: photoRows, error: photoError } = await supabase
    .from('photos')
    .select('global_photo_id')
    .eq('project_id', projectId)

  if (photoError) throw photoError

  const photoIds = (photoRows ?? []).map((row) => String(row.global_photo_id || '')).filter(Boolean)
  if (photoIds.length === 0) return []

  const { data, error } = await supabase
    .from('photo_files')
    .select('id, photo_id, branch_type, version_no, file_name, original_file_name, storage_provider, bucket_name, object_key, mime_type, file_size_bytes, checksum_sha256, created_at, file_copies:photo_file_copies(id, photo_file_id, storage_provider, bucket_name, storage_key, status, checksum_verified, size_bytes, size_verified, is_primary_read_source, last_verified_at, last_error, created_at, updated_at)')
    .in('photo_id', photoIds)
    .in('branch_type', branchTypes)

  if (error) throw error

  return ((data ?? []) as Array<Record<string, unknown>>).map<PhotoFileRow>((row) => ({
    id: String(row.id || ''),
    photo_id: String(row.photo_id || ''),
    project_id: projectId,
    branch_type: typeof row.branch_type === 'string' ? row.branch_type : null,
    version_no: Number(row.version_no || 0),
    file_name: typeof row.file_name === 'string' ? row.file_name : null,
    original_file_name: typeof row.original_file_name === 'string' ? row.original_file_name : null,
    storage_provider: typeof row.storage_provider === 'string' ? row.storage_provider : null,
    bucket_name: typeof row.bucket_name === 'string' ? row.bucket_name : null,
    object_key: typeof row.object_key === 'string' ? row.object_key : null,
    mime_type: typeof row.mime_type === 'string' ? row.mime_type : null,
    file_size_bytes: Number(row.file_size_bytes || 0),
    checksum_sha256: typeof row.checksum_sha256 === 'string' ? row.checksum_sha256 : null,
    created_at: typeof row.created_at === 'string' ? row.created_at : null,
    file_copies: Array.isArray(row.file_copies) ? row.file_copies as PhotoFileCopyRow[] : null,
  }))
}

async function updateMigration(migrationId: string, patch: Partial<ProjectStorageMigrationRow>) {
  const { error } = await supabase.from('project_storage_migrations').update(patch).eq('id', migrationId)
  if (error) throw error
}

async function updateMigrationItem(itemId: string, patch: Partial<ProjectStorageMigrationItemRow>) {
  const { error } = await supabase.from('project_storage_migration_items').update(patch).eq('id', itemId)
  if (error) throw error
}

async function refreshMigrationProgress(migrationId: string) {
  const { data: migrationData, error: migrationError } = await supabase
    .from('project_storage_migrations')
    .select('*')
    .eq('id', migrationId)
    .maybeSingle()
  if (migrationError) throw migrationError
  if (!migrationData) throw new Error('Migration not found')

  const migration = parseMigrationRow(migrationData as Record<string, unknown>)

  const { data: itemsData, error: itemsError } = await supabase
    .from('project_storage_migration_items')
    .select('*')
    .eq('migration_id', migrationId)
  if (itemsError) throw itemsError

  const items = ((itemsData ?? []) as Array<Record<string, unknown>>).map(parseItemRow)
  const doneFiles = items.filter((item) => item.status === 'available' || item.status === 'failed' || item.status === 'skipped').length
  const successFiles = items.filter((item) => item.status === 'available' || item.status === 'skipped').length
  const failedFiles = items.filter((item) => item.status === 'failed').length
  const transferredBytes = items.reduce((sum, item) => sum + Math.max(0, item.bytes_done || 0), 0)
  const startedAtMs = migration.started_at ? new Date(migration.started_at).getTime() : Date.now()
  const elapsedSeconds = Math.max(1, Math.floor((Date.now() - startedAtMs) / 1000))
  const bytesPerSecond = transferredBytes > 0 ? transferredBytes / elapsedSeconds : 0
  const remainingBytes = Math.max(0, migration.total_bytes - transferredBytes)
  const etaSeconds = bytesPerSecond > 0 ? Math.ceil(remainingBytes / bytesPerSecond) : null
  const hasActive = items.some((item) => item.status === 'copying' || item.status === 'verifying' || item.status === 'queued')
  const status: StorageMigrationStatus = doneFiles >= migration.total_files
    ? failedFiles > 0
      ? 'completed_with_errors'
      : 'completed'
    : hasActive
      ? 'running'
      : 'failed'
  const currentPhase: StorageMigrationPhase = doneFiles >= migration.total_files
    ? 'completed'
    : items.some((item) => item.status === 'verifying')
      ? 'verifying'
      : 'copying'

  await updateMigration(migrationId, {
    done_files: doneFiles,
    success_files: successFiles,
    failed_files: failedFiles,
    transferred_bytes: transferredBytes,
    bytes_per_second: Number(bytesPerSecond.toFixed(2)),
    eta_seconds: etaSeconds,
    status,
    current_phase: currentPhase,
    completed_at: doneFiles >= migration.total_files ? new Date().toISOString() : null,
  })
}

async function ensureTargetCopy(photoFile: PhotoFileRow, storageKey: string, sizeBytes: number, mimeType?: string | null) {
  const existingQuery = await supabase
    .from('photo_file_copies')
    .select('id')
    .eq('photo_file_id', photoFile.id)
    .eq('storage_provider', STORAGE_MIGRATION_TARGET_PROVIDER)
    .eq('storage_key', storageKey)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existingQuery.error) throw existingQuery.error

  const patch = {
    bucket_name: BACKUP_REMOTE_PUBLIC_BASE_URL.replace(/^https?:\/\//, ''),
    storage_key: storageKey,
    status: 'copying',
    size_bytes: sizeBytes,
    size_verified: false,
    checksum_verified: false,
    is_primary_read_source: false,
    last_error: null,
  }

  if (existingQuery.data?.id) {
    const { data, error } = await supabase
      .from('photo_file_copies')
      .update(patch)
      .eq('id', existingQuery.data.id)
      .select('id')
      .maybeSingle()
    if (error) throw error
    if (!data?.id) throw new Error('Could not update backup copy row')
    return String(data.id)
  }

  const { data, error } = await supabase
    .from('photo_file_copies')
    .insert([{ photo_file_id: photoFile.id, storage_provider: STORAGE_MIGRATION_TARGET_PROVIDER, ...patch }])
    .select('id')
    .maybeSingle()
  if (error) throw error
  if (!data?.id) throw new Error('Could not create backup copy row')
  return String(data.id)
}

async function downloadSourceBuffer(copy: PhotoFileCopyRow) {
  const sourceUrl = resolveCopyPublicUrl(copy)
  if (!sourceUrl) throw new Error('Readable source URL missing')
  const res = await fetch(sourceUrl)
  if (!res.ok) throw new Error(`Source fetch failed (${res.status})`)
  const buffer = Buffer.from(await res.arrayBuffer())
  const contentType = res.headers.get('content-type') || undefined
  const checksum = createHash('sha256').update(buffer).digest('hex')
  return { buffer, contentType, checksum }
}

async function uploadToBackupRemote(storageKey: string, body: Buffer, contentType?: string) {
  const headers = new Headers()
  headers.set('content-type', contentType || 'application/octet-stream')
  headers.set('content-length', String(body.length))
  if (BACKUP_REMOTE_AUTH_TOKEN) {
    headers.set('authorization', `Bearer ${BACKUP_REMOTE_AUTH_TOKEN}`)
  }

  const res = await fetch(buildBackupRemoteWriteUrl(storageKey), {
    method: 'PUT',
    headers,
    body: new Uint8Array(body),
  })

  if (!res.ok) {
    throw new Error(`Backup upload failed (${res.status})`)
  }
}

async function verifyBackupRemote(storageKey: string, expectedSize: number, expectedChecksum: string) {
  const targetUrl = buildBackupRemotePublicUrl(storageKey)
  const authHeaders = BACKUP_REMOTE_AUTH_TOKEN ? { authorization: `Bearer ${BACKUP_REMOTE_AUTH_TOKEN}` } : undefined
  let sizeVerified = false

  const headRes = await fetch(targetUrl, { method: 'HEAD', headers: authHeaders })
  if (headRes.ok) {
    const contentLength = Number(headRes.headers.get('content-length') || 0)
    sizeVerified = contentLength === expectedSize
  }

  const getRes = await fetch(targetUrl, { headers: authHeaders })
  if (!getRes.ok) {
    throw new Error(`Backup verification fetch failed (${getRes.status})`)
  }
  const buffer = Buffer.from(await getRes.arrayBuffer())
  const checksum = createHash('sha256').update(buffer).digest('hex')
  if (!sizeVerified) {
    sizeVerified = buffer.length === expectedSize
  }

  return {
    sizeVerified,
    checksumVerified: checksum === expectedChecksum,
    sizeBytes: buffer.length,
  }
}

export async function listProjectStorageMigrations(projectId: string, limit = 10) {
  const { data, error } = await supabase
    .from('project_storage_migrations')
    .select('*, items:project_storage_migration_items(*)')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(Math.max(1, Math.min(limit, 20)))

  if (error) throw error

  return ((data ?? []) as Array<Record<string, unknown>>).map<ProjectStorageMigrationWithItems>((row) => ({
    ...parseMigrationRow(row),
    items: Array.isArray(row.items) ? (row.items as Array<Record<string, unknown>>).map(parseItemRow) : [],
  }))
}

export async function createProjectStorageMigration(params: {
  projectId: string
  requestedByAdminUserId: string
  branchTypes: StorageMigrationBranchType[]
}) {
  const branchTypes = Array.from(new Set(params.branchTypes)).filter((value): value is StorageMigrationBranchType => value === 'thumb' || value === 'display' || value === 'original')
  if (branchTypes.length === 0) {
    throw new Error('Select at least one branch type')
  }

  const { data: activeRow, error: activeError } = await supabase
    .from('project_storage_migrations')
    .select('id')
    .eq('project_id', params.projectId)
    .in('status', ['pending', 'running'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (activeError) throw activeError
  if (activeRow?.id) {
    throw new Error('A storage migration is already running for this project')
  }

  const files = await loadCandidateFiles(params.projectId, branchTypes)
  const candidates = files
    .filter((file) => (file.branch_type === 'thumb' || file.branch_type === 'display' || file.branch_type === 'original'))
    .filter((file) => !hasAvailableBackupCopy(file))
    .map((file) => ({ file, sourceCopy: pickSourceCopy(file) }))
    .filter((entry) => entry.sourceCopy)

  const totalBytes = candidates.reduce((sum, entry) => sum + Math.max(0, Number(entry.file.file_size_bytes || 0)), 0)

  const { data: migrationData, error: migrationError } = await supabase
    .from('project_storage_migrations')
    .insert([{
      project_id: params.projectId,
      requested_by_admin_user_id: params.requestedByAdminUserId,
      source_provider: STORAGE_MIGRATION_SOURCE_PROVIDER,
      target_provider: STORAGE_MIGRATION_TARGET_PROVIDER,
      branch_types: branchTypes,
      status: candidates.length > 0 ? 'pending' : 'completed',
      current_phase: candidates.length > 0 ? 'planning' : 'completed',
      total_files: candidates.length,
      done_files: candidates.length === 0 ? 0 : 0,
      success_files: 0,
      failed_files: 0,
      total_bytes: totalBytes,
      transferred_bytes: 0,
      bytes_per_second: 0,
      eta_seconds: null,
      completed_at: candidates.length === 0 ? new Date().toISOString() : null,
    }])
    .select('*')
    .maybeSingle()

  if (migrationError) throw migrationError
  if (!migrationData) throw new Error('Could not create migration')

  if (candidates.length > 0) {
    const { error: itemsError } = await supabase
      .from('project_storage_migration_items')
      .insert(candidates.map(({ file, sourceCopy }) => ({
        migration_id: migrationData.id,
        photo_file_id: file.id,
        branch_type: file.branch_type,
        source_copy_id: sourceCopy?.id.startsWith('legacy:') ? null : sourceCopy?.id ?? null,
        status: 'queued',
        bytes_total: Math.max(0, Number(file.file_size_bytes || sourceCopy?.size_bytes || 0)),
        bytes_done: 0,
        attempt_count: 0,
      })))
    if (itemsError) throw itemsError
  }

  return parseMigrationRow(migrationData as Record<string, unknown>)
}

export async function getProjectStorageMigrationStatus(projectId: string) {
  const migrations = await listProjectStorageMigrations(projectId, 8)
  const activeMigration = migrations.find((migration) => migration.status === 'pending' || migration.status === 'running') || null
  return {
    activeMigration,
    migrations,
  }
}

export async function processProjectStorageMigration(migrationId: string) {
  const { data: migrationData, error: migrationError } = await supabase
    .from('project_storage_migrations')
    .select('*')
    .eq('id', migrationId)
    .maybeSingle()
  if (migrationError) throw migrationError
  if (!migrationData) throw new Error('Migration not found')

  const migration = parseMigrationRow(migrationData as Record<string, unknown>)
  if (migration.status === 'completed' || migration.status === 'completed_with_errors' || migration.status === 'cancelled') {
    return migration
  }

  if (migration.status === 'pending') {
    await updateMigration(migrationId, {
      status: 'running',
      current_phase: 'copying',
      started_at: migration.started_at || new Date().toISOString(),
      completed_at: null,
      last_error_summary: null,
    })
  }

  const { data: itemRows, error: itemsError } = await supabase
    .from('project_storage_migration_items')
    .select('*, photo_file:photo_files(id, photo_id, branch_type, version_no, file_name, original_file_name, storage_provider, bucket_name, object_key, mime_type, file_size_bytes, checksum_sha256, created_at, file_copies:photo_file_copies(id, photo_file_id, storage_provider, bucket_name, storage_key, status, checksum_verified, size_bytes, size_verified, is_primary_read_source, last_verified_at, last_error, created_at, updated_at))')
    .eq('migration_id', migrationId)
    .order('created_at', { ascending: true })
  if (itemsError) throw itemsError

  let lastErrorSummary: string | null = null

  for (const row of (itemRows ?? []) as Array<Record<string, unknown>>) {
    const item = parseItemRow(row)
    if (item.status === 'available' || item.status === 'skipped') continue

    const photoFileRaw = (row.photo_file || {}) as Record<string, unknown>
    const photoFile: PhotoFileRow = {
      id: String(photoFileRaw.id || item.photo_file_id),
      photo_id: String(photoFileRaw.photo_id || ''),
      project_id: migration.project_id,
      branch_type: typeof photoFileRaw.branch_type === 'string' ? photoFileRaw.branch_type : item.branch_type,
      version_no: Number(photoFileRaw.version_no || 1),
      file_name: typeof photoFileRaw.file_name === 'string' ? photoFileRaw.file_name : null,
      original_file_name: typeof photoFileRaw.original_file_name === 'string' ? photoFileRaw.original_file_name : null,
      storage_provider: typeof photoFileRaw.storage_provider === 'string' ? photoFileRaw.storage_provider : null,
      bucket_name: typeof photoFileRaw.bucket_name === 'string' ? photoFileRaw.bucket_name : null,
      object_key: typeof photoFileRaw.object_key === 'string' ? photoFileRaw.object_key : null,
      mime_type: typeof photoFileRaw.mime_type === 'string' ? photoFileRaw.mime_type : null,
      file_size_bytes: Number(photoFileRaw.file_size_bytes || 0),
      checksum_sha256: typeof photoFileRaw.checksum_sha256 === 'string' ? photoFileRaw.checksum_sha256 : null,
      created_at: typeof photoFileRaw.created_at === 'string' ? photoFileRaw.created_at : null,
      file_copies: Array.isArray(photoFileRaw.file_copies) ? photoFileRaw.file_copies as PhotoFileCopyRow[] : null,
    }

    const sourceCopy = pickSourceCopy(photoFile)
    if (!sourceCopy) {
      lastErrorSummary = 'Readable R2 source copy not found'
      await updateMigrationItem(item.id, {
        status: 'failed',
        attempt_count: item.attempt_count + 1,
        last_error: lastErrorSummary,
        completed_at: new Date().toISOString(),
      })
      await refreshMigrationProgress(migrationId)
      continue
    }

    const storageKey = buildBackupStorageKey(photoFile)

    let targetCopyId: string | null = item.target_copy_id ?? null
    try {
      await updateMigrationItem(item.id, {
        status: 'copying',
        attempt_count: item.attempt_count + 1,
        last_error: null,
      })
      await updateMigration(migrationId, { current_phase: 'copying' })

      const { buffer, contentType, checksum } = await downloadSourceBuffer(sourceCopy)
      const expectedSize = buffer.length
      targetCopyId = await ensureTargetCopy(photoFile, storageKey, expectedSize, contentType || photoFile.mime_type)
      await updateMigrationItem(item.id, {
        target_copy_id: targetCopyId,
        bytes_total: expectedSize,
      })

      await uploadToBackupRemote(storageKey, buffer, contentType || photoFile.mime_type || undefined)
      await updateMigrationItem(item.id, {
        status: 'verifying',
        bytes_done: expectedSize,
      })
      await updateMigration(migrationId, { current_phase: 'verifying' })

      const verification = await verifyBackupRemote(storageKey, expectedSize, photoFile.checksum_sha256 || checksum)
      if (!verification.sizeVerified || !verification.checksumVerified) {
        throw new Error(`Verification failed (size=${verification.sizeVerified ? 'ok' : 'bad'}, checksum=${verification.checksumVerified ? 'ok' : 'bad'})`)
      }

      const { error: targetCopyError } = await supabase
        .from('photo_file_copies')
        .update({
          status: 'available',
          size_bytes: verification.sizeBytes,
          size_verified: verification.sizeVerified,
          checksum_verified: verification.checksumVerified,
          last_verified_at: new Date().toISOString(),
          last_error: null,
          is_primary_read_source: false,
        })
        .eq('id', targetCopyId)
      if (targetCopyError) throw targetCopyError

      await updateMigrationItem(item.id, {
        status: 'available',
        bytes_done: expectedSize,
        completed_at: new Date().toISOString(),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Migration failed'
      lastErrorSummary = message
      if (targetCopyId) {
        await supabase
          .from('photo_file_copies')
          .update({ status: 'failed', last_error: message, is_primary_read_source: false })
          .eq('id', targetCopyId)
      }
      await updateMigrationItem(item.id, {
        status: 'failed',
        last_error: message,
        completed_at: new Date().toISOString(),
      })
      await updateMigration(migrationId, { last_error_summary: message })
    }

    await refreshMigrationProgress(migrationId)
  }

  if (lastErrorSummary) {
    await updateMigration(migrationId, { last_error_summary: lastErrorSummary })
  }

  const { data: finalData, error: finalError } = await supabase
    .from('project_storage_migrations')
    .select('*')
    .eq('id', migrationId)
    .maybeSingle()
  if (finalError) throw finalError
  if (!finalData) throw new Error('Migration disappeared')
  return parseMigrationRow(finalData as Record<string, unknown>)
}

export async function kickProjectStorageMigration(origin: string, migrationId: string) {
  const headers = new Headers()
  if (process.env.WEBHOOK_SECRET) {
    headers.set('x-webhook-secret', process.env.WEBHOOK_SECRET)
  }

  return fetch(`${origin.replace(/\/+$/, '')}/api/internal/project-storage-migrations/process`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ migrationId }),
  }).catch(() => null)
}
