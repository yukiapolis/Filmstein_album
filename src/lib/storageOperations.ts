import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

import { DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'

import { supabase } from '@/lib/supabase/server'
import { getProjectStoragePermissions, loadCurrentStorageNodeInfo, loadProjectStorageStateInfo, type CurrentStorageNodeInfo, type ProjectStoragePermissions, type ProjectStorageStateInfo } from '@/lib/currentStorageNode'
import { buildLegacyCopyFromPhotoFile, isPhotoFileCopyRow, resolveCopyPublicUrl, type PhotoFileCopyRow } from '@/lib/photoFileCopies'
import { r2 } from '@/lib/r2/client'

export type StorageOperationType = 'pull_to_current_node' | 'return_to_r2'
export type StorageOperationStatus = 'queued' | 'preparing' | 'copying' | 'verifying' | 'switching_project_state' | 'completed' | 'failed'

export type ProjectStorageOperationRow = {
  id: string
  project_id: string
  operation_type: StorageOperationType
  status: StorageOperationStatus
  requested_by_admin_user_id: string | null
  node_id: string | null
  node_key: string | null
  node_name: string | null
  requested_branch_types: string[]
  total_files: number
  done_files: number
  failed_files: number
  total_bytes: number
  transferred_bytes: number
  current_phase: string | null
  error_message: string | null
  created_at: string | null
  updated_at: string | null
  completed_at: string | null
}

export type PullToCurrentNodeContext = {
  currentNode: CurrentStorageNodeInfo
  projectStorageState: ProjectStorageStateInfo | null
  permissions: ProjectStoragePermissions
}

const MANAGED_BRANCH_TYPES = ['thumb', 'display', 'original'] as const

function getStateActiveOperationKind(operationType: StorageOperationType) {
  return operationType === 'pull_to_current_node' ? 'pull_to_node' : 'return_to_r2'
}

type StorageOperationFileRow = {
  id: string
  photo_id: string
  branch_type: string | null
  version_no: number | null
  file_name: string | null
  original_file_name: string | null
  storage_provider: string | null
  bucket_name: string | null
  object_key: string | null
  mime_type: string | null
  file_size_bytes: number | null
  checksum_sha256: string | null
  created_at: string | null
  file_copies?: PhotoFileCopyRow[] | null
}

class CancelledStorageOperationError extends Error {
  constructor() {
    super('Storage operation was cancelled')
    this.name = 'CancelledStorageOperationError'
  }
}

const LOCAL_STORAGE_BUCKET = 'local-node-storage'
const R2_BASE_URL = (process.env.R2_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_PHOTO_PUBLIC_BASE_URL || '').replace(/\/+$/, '')

function mapOperation(row: Record<string, unknown>): ProjectStorageOperationRow {
  return {
    id: String(row.id || ''),
    project_id: String(row.project_id || ''),
    operation_type: (row.operation_type as StorageOperationType) || 'pull_to_current_node',
    status: (row.status as StorageOperationStatus) || 'queued',
    requested_by_admin_user_id: typeof row.requested_by_admin_user_id === 'string' ? row.requested_by_admin_user_id : null,
    node_id: typeof row.node_id === 'string' ? row.node_id : null,
    node_key: typeof row.node_key === 'string' ? row.node_key : null,
    node_name: typeof row.node_name === 'string' ? row.node_name : null,
    requested_branch_types: Array.isArray(row.requested_branch_types) ? row.requested_branch_types.map(String) : [],
    total_files: Number(row.total_files || 0),
    done_files: Number(row.done_files || 0),
    failed_files: Number(row.failed_files || 0),
    total_bytes: Number(row.total_bytes || 0),
    transferred_bytes: Number(row.transferred_bytes || 0),
    current_phase: typeof row.current_phase === 'string' ? row.current_phase : null,
    error_message: typeof row.error_message === 'string' ? row.error_message : null,
    created_at: typeof row.created_at === 'string' ? row.created_at : null,
    updated_at: typeof row.updated_at === 'string' ? row.updated_at : null,
    completed_at: typeof row.completed_at === 'string' ? row.completed_at : null,
  }
}

function mapFileRow(row: Record<string, unknown>): StorageOperationFileRow {
  return {
    id: String(row.id || ''),
    photo_id: String(row.photo_id || ''),
    branch_type: typeof row.branch_type === 'string' ? row.branch_type : null,
    version_no: typeof row.version_no === 'number' ? row.version_no : Number(row.version_no || 0) || null,
    file_name: typeof row.file_name === 'string' ? row.file_name : null,
    original_file_name: typeof row.original_file_name === 'string' ? row.original_file_name : null,
    storage_provider: typeof row.storage_provider === 'string' ? row.storage_provider : null,
    bucket_name: typeof row.bucket_name === 'string' ? row.bucket_name : null,
    object_key: typeof row.object_key === 'string' ? row.object_key : null,
    mime_type: typeof row.mime_type === 'string' ? row.mime_type : null,
    file_size_bytes: typeof row.file_size_bytes === 'number' ? row.file_size_bytes : Number(row.file_size_bytes || 0) || null,
    checksum_sha256: typeof row.checksum_sha256 === 'string' ? row.checksum_sha256 : null,
    created_at: typeof row.created_at === 'string' ? row.created_at : null,
    file_copies: Array.isArray(row.file_copies) ? row.file_copies as PhotoFileCopyRow[] : null,
  }
}

function sha256(buffer: Buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

function sanitizeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '_')
}

function getLocalStorageRoot() {
  return process.env.LOCAL_ORIGINALS_DIR || path.join(process.cwd(), 'storage')
}

function getBranchDirectory(branchType: string | null) {
  if (branchType === 'display') return 'display'
  if (branchType === 'thumb') return 'thumb'
  if (branchType === 'raw') return 'raw'
  return 'original'
}

function buildLocalCopyPath(file: StorageOperationFileRow) {
  const baseName = file.file_name
    || file.original_file_name
    || path.basename(file.object_key || '')
    || `${file.id}.bin`

  return path.join(
    getLocalStorageRoot(),
    file.photo_id,
    getBranchDirectory(file.branch_type),
    sanitizeFileName(baseName),
  )
}

function extractR2ObjectKey(objectKeyOrUrl: string) {
  if (R2_BASE_URL && objectKeyOrUrl.startsWith(`${R2_BASE_URL}/`)) {
    return objectKeyOrUrl.slice(R2_BASE_URL.length + 1)
  }
  return objectKeyOrUrl.replace(/^\/+/, '')
}

function buildR2PublicUrl(key: string) {
  return R2_BASE_URL ? `${R2_BASE_URL}/${key.replace(/^\/+/, '')}` : key.replace(/^\/+/, '')
}

function buildR2CopyKey(projectId: string, file: StorageOperationFileRow) {
  const existingR2 = getAllCopies(file).find((copy) => copy.storage_provider === 'r2' && typeof copy.storage_key === 'string' && copy.storage_key.trim())
  if (existingR2) {
    return extractR2ObjectKey(existingR2.storage_key)
  }

  if (file.storage_provider === 'r2' && file.object_key) {
    return extractR2ObjectKey(file.object_key)
  }

  const baseName = sanitizeFileName(file.file_name || file.original_file_name || `${file.id}.bin`)
  return `${projectId}/${file.photo_id}/${getBranchDirectory(file.branch_type)}/${baseName}`
}

function getAllCopies(file: StorageOperationFileRow) {
  const explicit = Array.isArray(file.file_copies) ? file.file_copies.filter(isPhotoFileCopyRow) : []
  const legacy = buildLegacyCopyFromPhotoFile(file as unknown as Record<string, unknown>)
  return legacy ? [...explicit, legacy] : explicit
}

function getExplicitCopies(file: StorageOperationFileRow) {
  return Array.isArray(file.file_copies) ? file.file_copies.filter(isPhotoFileCopyRow) : []
}

function pickSourceCopy(file: StorageOperationFileRow, preferred: 'local' | 'r2') {
  const explicitAvailable = getExplicitCopies(file).filter((copy) => copy.status === 'available')
  const legacyAvailable = getAllCopies(file).filter((copy) => copy.status === 'available' && String(copy.id).startsWith('legacy:'))
  const available = [...explicitAvailable, ...legacyAvailable]

  return available.find((copy) => copy.storage_provider === preferred)
    || available.find((copy) => copy.storage_provider === (preferred === 'local' ? 'r2' : 'local'))
    || available[0]
    || null
}

async function readSourceCopy(copy: PhotoFileCopyRow) {
  if (copy.storage_provider === 'local') {
    return {
      buffer: await fs.readFile(copy.storage_key),
      contentType: null as string | null,
    }
  }

  const url = resolveCopyPublicUrl(copy)
  if (!url) {
    throw new Error('Source copy URL could not be resolved')
  }

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to download source copy (${response.status})`)
  }

  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get('content-type'),
  }
}

async function uploadToR2(params: { key: string; body: Buffer; contentType?: string | null }) {
  await r2.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME!,
    Key: params.key,
    Body: params.body,
    ContentType: params.contentType || undefined,
  }))

  return buildR2PublicUrl(params.key)
}

async function deleteR2Copy(copy: PhotoFileCopyRow) {
  if (copy.storage_provider !== 'r2' || !copy.bucket_name || !copy.storage_key) return
  await r2.send(new DeleteObjectCommand({
    Bucket: copy.bucket_name,
    Key: extractR2ObjectKey(copy.storage_key),
  }))
}

async function loadOperationById(operationId: string) {
  const { data, error } = await supabase
    .from('project_storage_operations')
    .select('*')
    .eq('id', operationId)
    .maybeSingle()

  if (error) throw error
  return data ? mapOperation(data as Record<string, unknown>) : null
}

async function updateOperation(operationId: string, patch: Record<string, unknown>) {
  const { error } = await supabase
    .from('project_storage_operations')
    .update(patch)
    .eq('id', operationId)

  if (error) throw error
}

async function assertOperationStillActive(operationId: string, projectId: string) {
  const [operation, state] = await Promise.all([
    loadOperationById(operationId),
    loadProjectStorageStateInfo(projectId),
  ])

  if (!operation) throw new CancelledStorageOperationError()
  if (operation.status === 'failed' || operation.current_phase === 'cancelled') throw new CancelledStorageOperationError()
  if (!state || state.activeOperationId !== operationId) throw new CancelledStorageOperationError()
}

async function estimateOperationScope(projectId: string, branchTypes: string[]) {
  const { data: photos, error: photoError } = await supabase.from('photos').select('global_photo_id').eq('project_id', projectId)
  if (photoError) throw photoError

  const photoIds = (photos ?? []).map((row) => String(row.global_photo_id || '')).filter(Boolean)
  if (photoIds.length === 0) {
    return { totalFiles: 0, totalBytes: 0 }
  }

  const { data: files, error: fileError } = await supabase
    .from('photo_files')
    .select('file_size_bytes')
    .in('photo_id', photoIds)
    .in('branch_type', branchTypes)

  if (fileError) throw fileError

  return {
    totalFiles: (files ?? []).length,
    totalBytes: (files ?? []).reduce((sum, row) => sum + Math.max(0, Number(row.file_size_bytes || 0)), 0),
  }
}

async function loadOperationFiles(projectId: string, branchTypes: string[]) {
  const { data: photos, error: photosError } = await supabase
    .from('photos')
    .select('global_photo_id')
    .eq('project_id', projectId)

  if (photosError) throw photosError

  const photoIds = (photos ?? []).map((row) => String(row.global_photo_id || '')).filter(Boolean)
  if (photoIds.length === 0) return [] as StorageOperationFileRow[]

  const { data: files, error: filesError } = await supabase
    .from('photo_files')
    .select('id, photo_id, branch_type, version_no, file_name, original_file_name, storage_provider, bucket_name, object_key, mime_type, file_size_bytes, checksum_sha256, created_at, file_copies:photo_file_copies(id, photo_file_id, storage_provider, bucket_name, storage_key, status, checksum_verified, size_bytes, size_verified, is_primary_read_source, last_verified_at, last_error, created_at, updated_at)')
    .in('photo_id', photoIds)
    .in('branch_type', branchTypes)
    .order('created_at', { ascending: true })

  if (filesError) throw filesError
  return ((files ?? []) as Array<Record<string, unknown>>).map(mapFileRow)
}

async function ensureLocalTargetCopy(file: StorageOperationFileRow, targetPath: string) {
  const existing = getExplicitCopies(file).find((copy) => copy.storage_provider === 'local' && copy.storage_key === targetPath)
  if (existing) return existing.id

  const { data, error } = await supabase
    .from('photo_file_copies')
    .insert([{
      photo_file_id: file.id,
      storage_provider: 'local',
      bucket_name: LOCAL_STORAGE_BUCKET,
      storage_key: targetPath,
      status: 'queued',
      checksum_verified: false,
      size_bytes: 0,
      size_verified: false,
      is_primary_read_source: false,
      last_error: null,
    }])
    .select('id')
    .single()

  if (error) throw error
  return String(data.id)
}

async function ensureR2TargetCopy(file: StorageOperationFileRow, targetKey: string) {
  const existing = getExplicitCopies(file).find((copy) => copy.storage_provider === 'r2' && extractR2ObjectKey(copy.storage_key) === targetKey)
  if (existing) return existing.id

  const { data, error } = await supabase
    .from('photo_file_copies')
    .insert([{
      photo_file_id: file.id,
      storage_provider: 'r2',
      bucket_name: process.env.R2_BUCKET_NAME!,
      storage_key: buildR2PublicUrl(targetKey),
      status: 'queued',
      checksum_verified: false,
      size_bytes: 0,
      size_verified: false,
      is_primary_read_source: false,
      last_error: null,
    }])
    .select('id')
    .single()

  if (error) throw error
  return String(data.id)
}

async function setProjectStateIdle(projectId: string) {
  const { error } = await supabase
    .from('project_storage_state')
    .upsert([{ project_id: projectId, location_mode: 'r2', holder_node_id: null, transition_state: 'idle', active_operation_id: null, active_operation_kind: null, updated_at: new Date().toISOString() }], { onConflict: 'project_id' })
  if (error) throw error
}

async function switchProjectStateToNode(projectId: string, nodeId: string) {
  const { error } = await supabase
    .from('project_storage_state')
    .upsert([{ project_id: projectId, location_mode: 'node_local', holder_node_id: nodeId, transition_state: 'idle', active_operation_id: null, active_operation_kind: null, updated_at: new Date().toISOString() }], { onConflict: 'project_id' })
  if (error) throw error
}

async function switchProjectStateToR2(projectId: string) {
  const { error } = await supabase
    .from('project_storage_state')
    .upsert([{ project_id: projectId, location_mode: 'r2', holder_node_id: null, transition_state: 'idle', active_operation_id: null, active_operation_kind: null, updated_at: new Date().toISOString() }], { onConflict: 'project_id' })
  if (error) throw error
}

async function promotePrimaryCopies(copyIds: string[], fileIds: string[]) {
  if (fileIds.length === 0 || copyIds.length === 0) return
  const { error: clearError } = await supabase.from('photo_file_copies').update({ is_primary_read_source: false }).in('photo_file_id', fileIds)
  if (clearError) throw clearError
  const { error: promoteError } = await supabase.from('photo_file_copies').update({ is_primary_read_source: true }).in('id', copyIds)
  if (promoteError) throw promoteError
}

async function verifyLocalCopiesReady(copyIds: string[]) {
  if (copyIds.length === 0) throw new Error('No verified local copies were created')

  const { data, error } = await supabase
    .from('photo_file_copies')
    .select('id, storage_provider, storage_key, status, checksum_verified, size_verified')
    .in('id', copyIds)

  if (error) throw error
  if ((data ?? []).length !== copyIds.length) throw new Error('Some expected local copy rows are missing before R2 release')

  for (const row of data ?? []) {
    if (row.storage_provider !== 'local') throw new Error(`Expected local copy before R2 release, got ${row.storage_provider}`)
    if (row.status !== 'available') throw new Error(`Local copy ${row.id} is not available before R2 release`)
    if (!row.checksum_verified || !row.size_verified) throw new Error(`Local copy ${row.id} is not fully verified before R2 release`)
    await fs.access(String(row.storage_key || ''))
  }
}

async function releaseR2Copies(files: StorageOperationFileRow[]) {
  for (const file of files) {
    const r2Copies = getAllCopies(file).filter((copy) => copy.storage_provider === 'r2' && copy.status === 'available' && !String(copy.id).startsWith('legacy:'))
    for (const copy of r2Copies) {
      await deleteR2Copy(copy)
      const { error } = await supabase.from('photo_file_copies').delete().eq('id', copy.id)
      if (error) throw error
    }
  }
}

async function releaseLocalCopies(files: StorageOperationFileRow[]) {
  for (const file of files) {
    const localCopies = getAllCopies(file).filter((copy) => copy.storage_provider === 'local' && copy.status === 'available' && !String(copy.id).startsWith('legacy:'))
    for (const copy of localCopies) {
      try {
        await fs.rm(copy.storage_key, { force: true })
      } catch {}
      const { error } = await supabase.from('photo_file_copies').delete().eq('id', copy.id)
      if (error) throw error
    }
  }
}

async function failOperation(operation: ProjectStorageOperationRow, message: string) {
  await updateOperation(operation.id, { status: 'failed', current_phase: 'failed', error_message: message, completed_at: new Date().toISOString() })
  const state = await loadProjectStorageStateInfo(operation.project_id)
  if (state?.activeOperationId === operation.id) {
    await setProjectStateIdle(operation.project_id)
  }
}

export async function getStorageOperationPanel(projectId: string, requestOrigin: string | null) {
  const currentNode = await loadCurrentStorageNodeInfo(projectId, requestOrigin)
  const projectStorageState = await loadProjectStorageStateInfo(projectId)
  const permissions = getProjectStoragePermissions(currentNode, projectStorageState)

  const { data, error } = await supabase.from('project_storage_operations').select('*').eq('project_id', projectId).order('created_at', { ascending: false }).limit(10)
  const operations = error ? [] : ((data ?? []) as Array<Record<string, unknown>>).map(mapOperation)
  const activeOperation = projectStorageState?.activeOperationId ? operations.find((row) => row.id === projectStorageState.activeOperationId) || null : null

  return { currentNode, projectStorageState, permissions, operations, activeOperation }
}

async function createStorageOperation(input: {
  projectId: string
  requestedByAdminUserId: string
  branchTypes: string[]
  requestOrigin: string | null
  operationType: StorageOperationType
}) {
  const normalizedBranchTypes = Array.from(new Set(input.branchTypes)).sort()
  const requiredBranchTypes = [...MANAGED_BRANCH_TYPES].sort()
  if (normalizedBranchTypes.length !== requiredBranchTypes.length || normalizedBranchTypes.some((value, index) => value !== requiredBranchTypes[index])) {
    throw new Error('For now, storage migration must include thumb, display, and original together so project-level storage state stays consistent')
  }
  const currentNode = await loadCurrentStorageNodeInfo(input.projectId, input.requestOrigin)
  const projectStorageState = await loadProjectStorageStateInfo(input.projectId)
  const permissions = getProjectStoragePermissions(currentNode, projectStorageState)

  if (projectStorageState?.activeOperationId) throw new Error('Another storage operation is already in progress')

  if (input.operationType === 'pull_to_current_node') {
    if (!permissions.canPullToCurrentNode) throw new Error(permissions.blockingReason || 'Pull to current node is not allowed')
  } else {
    if (!permissions.canReturnToR2) throw new Error(permissions.blockingReason || 'Return to R2 is not allowed')
  }

  const scope = await estimateOperationScope(input.projectId, normalizedBranchTypes)
  const operationId = randomUUID()
  const { data: operationData, error: opError } = await supabase
    .from('project_storage_operations')
    .insert([{ id: operationId, project_id: input.projectId, operation_type: input.operationType, status: 'queued', requested_by_admin_user_id: input.requestedByAdminUserId, node_id: currentNode.id, node_key: currentNode.nodeKey, node_name: currentNode.name, requested_branch_types: normalizedBranchTypes, total_files: scope.totalFiles, done_files: 0, failed_files: 0, total_bytes: scope.totalBytes, transferred_bytes: 0, current_phase: 'queued', error_message: null }])
    .select('*')
    .maybeSingle()
  if (opError) throw opError

  const { error: stateError } = await supabase
    .from('project_storage_state')
    .upsert([{ project_id: input.projectId, location_mode: projectStorageState?.locationMode === 'node_local' ? 'node_local' : 'r2', holder_node_id: projectStorageState?.holderNodeId || null, transition_state: input.operationType === 'pull_to_current_node' ? 'pulling_to_node' : 'returning_to_r2', active_operation_id: operationId, active_operation_kind: getStateActiveOperationKind(input.operationType), updated_at: new Date().toISOString() }], { onConflict: 'project_id' })
  if (stateError) {
    await supabase.from('project_storage_operations').delete().eq('id', operationId)
    throw stateError
  }

  return { operation: operationData ? mapOperation(operationData as Record<string, unknown>) : null, context: { currentNode, projectStorageState, permissions } as PullToCurrentNodeContext }
}

export async function createPullToCurrentNodeOperation(input: { projectId: string; requestedByAdminUserId: string; branchTypes: string[]; requestOrigin: string | null }) {
  return createStorageOperation({ ...input, operationType: 'pull_to_current_node' })
}

export async function createReturnToR2Operation(input: { projectId: string; requestedByAdminUserId: string; branchTypes: string[]; requestOrigin: string | null }) {
  return createStorageOperation({ ...input, operationType: 'return_to_r2' })
}

export async function cancelActiveStorageOperation(input: { projectId: string; requestOrigin: string | null }) {
  const panel = await getStorageOperationPanel(input.projectId, input.requestOrigin)
  const activeOperation = panel.activeOperation
  if (!activeOperation) throw new Error('No active storage operation to cancel')

  const { error: opError } = await supabase.from('project_storage_operations').update({ status: 'failed', current_phase: 'cancelled', error_message: 'Cancelled by super admin', completed_at: new Date().toISOString() }).eq('id', activeOperation.id)
  if (opError) throw opError

  const statePatch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (panel.projectStorageState?.activeOperationId === activeOperation.id) {
    statePatch.transition_state = 'idle'
    statePatch.active_operation_id = null
    statePatch.active_operation_kind = null
  }

  const { error: stateError } = await supabase.from('project_storage_state').update(statePatch).eq('project_id', input.projectId)
  if (stateError) throw stateError

  return { cancelledOperationId: activeOperation.id }
}

async function processPullToCurrentNodeOperation(operation: ProjectStorageOperationRow) {
  if (!operation.node_id) {
    await failOperation(operation, 'Current node is not registered in storage_nodes; cannot assign project holder node')
    return
  }

  await assertOperationStillActive(operation.id, operation.project_id)
  const files = await loadOperationFiles(operation.project_id, operation.requested_branch_types)
  await updateOperation(operation.id, { total_files: files.length, total_bytes: files.reduce((sum, file) => sum + Math.max(0, Number(file.file_size_bytes || 0)), 0), status: 'copying', current_phase: 'copying' })

  let doneFiles = 0
  let failedFiles = 0
  let transferredBytes = 0
  let firstError: string | null = null
  const successfulLocalCopyIds: string[] = []
  const processedFileIds: string[] = []
  const successfullyCopiedFiles: StorageOperationFileRow[] = []

  for (const file of files) {
    await assertOperationStillActive(operation.id, operation.project_id)
    const sourceCopy = pickSourceCopy(file, 'r2')
    if (!sourceCopy) {
      failedFiles += 1
      firstError = firstError || `No readable source copy found for file ${file.id}`
      await updateOperation(operation.id, { failed_files: failedFiles, error_message: firstError })
      continue
    }

    const targetPath = buildLocalCopyPath(file)
    const targetCopyId = await ensureLocalTargetCopy(file, targetPath)

    try {
      const { error: copyStartError } = await supabase.from('photo_file_copies').update({ status: 'copying', last_error: null, bucket_name: LOCAL_STORAGE_BUCKET }).eq('id', targetCopyId)
      if (copyStartError) throw copyStartError

      const { buffer } = await readSourceCopy(sourceCopy)
      await fs.mkdir(path.dirname(targetPath), { recursive: true })
      await fs.writeFile(targetPath, buffer)
      await updateOperation(operation.id, { status: 'verifying', current_phase: 'verifying' })

      const stats = await fs.stat(targetPath)
      const actualChecksum = sha256(buffer)
      const expectedChecksum = file.checksum_sha256 || actualChecksum
      if (actualChecksum !== expectedChecksum || stats.size !== buffer.length) throw new Error(`Verification failed for file ${file.id}`)

      doneFiles += 1
      transferredBytes += buffer.length
      successfulLocalCopyIds.push(targetCopyId)
      processedFileIds.push(file.id)
      successfullyCopiedFiles.push(file)

      const { error: copyAvailableError } = await supabase.from('photo_file_copies').update({ status: 'available', bucket_name: LOCAL_STORAGE_BUCKET, size_bytes: stats.size, size_verified: true, checksum_verified: true, last_verified_at: new Date().toISOString(), last_error: null, is_primary_read_source: false }).eq('id', targetCopyId)
      if (copyAvailableError) throw copyAvailableError

      await updateOperation(operation.id, { status: 'copying', current_phase: 'copying', done_files: doneFiles, failed_files: failedFiles, transferred_bytes: transferredBytes, error_message: firstError })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Copy failed'
      failedFiles += 1
      firstError = firstError || message
      await supabase.from('photo_file_copies').update({ status: 'failed', bucket_name: LOCAL_STORAGE_BUCKET, last_error: message, is_primary_read_source: false }).eq('id', targetCopyId)
      await updateOperation(operation.id, { status: 'copying', current_phase: 'copying', done_files: doneFiles, failed_files: failedFiles, transferred_bytes: transferredBytes, error_message: message })
    }
  }

  await assertOperationStillActive(operation.id, operation.project_id)
  if (failedFiles > 0) throw new Error(firstError || `${failedFiles} file copy operations failed`)

  await updateOperation(operation.id, { status: 'switching_project_state', current_phase: 'releasing_r2', done_files: doneFiles, failed_files: failedFiles, transferred_bytes: transferredBytes })
  await promotePrimaryCopies(successfulLocalCopyIds, processedFileIds)
  await verifyLocalCopiesReady(successfulLocalCopyIds)
  await releaseR2Copies(successfullyCopiedFiles)
  await switchProjectStateToNode(operation.project_id, operation.node_id)
  await updateOperation(operation.id, { status: 'completed', current_phase: 'completed', done_files: doneFiles, failed_files: failedFiles, transferred_bytes: transferredBytes, error_message: null, completed_at: new Date().toISOString() })
}

async function processReturnToR2Operation(operation: ProjectStorageOperationRow) {
  await assertOperationStillActive(operation.id, operation.project_id)
  const files = await loadOperationFiles(operation.project_id, operation.requested_branch_types)
  await updateOperation(operation.id, { total_files: files.length, total_bytes: files.reduce((sum, file) => sum + Math.max(0, Number(file.file_size_bytes || 0)), 0), status: 'copying', current_phase: 'copying' })

  let doneFiles = 0
  let failedFiles = 0
  let transferredBytes = 0
  let firstError: string | null = null
  const successfulR2CopyIds: string[] = []
  const processedFileIds: string[] = []
  const successfullyReturnedFiles: StorageOperationFileRow[] = []

  for (const file of files) {
    await assertOperationStillActive(operation.id, operation.project_id)
    const sourceCopy = pickSourceCopy(file, 'local')
    if (!sourceCopy) {
      failedFiles += 1
      firstError = firstError || `No readable local source copy found for file ${file.id}`
      await updateOperation(operation.id, { failed_files: failedFiles, error_message: firstError })
      continue
    }

    const targetKey = buildR2CopyKey(operation.project_id, file)
    const targetCopyId = await ensureR2TargetCopy(file, targetKey)

    try {
      const { error: copyStartError } = await supabase.from('photo_file_copies').update({ status: 'copying', last_error: null, bucket_name: process.env.R2_BUCKET_NAME!, storage_key: buildR2PublicUrl(targetKey) }).eq('id', targetCopyId)
      if (copyStartError) throw copyStartError

      const { buffer, contentType } = await readSourceCopy(sourceCopy)
      await uploadToR2({ key: targetKey, body: buffer, contentType: contentType || file.mime_type })
      await updateOperation(operation.id, { status: 'verifying', current_phase: 'verifying' })

      const actualChecksum = sha256(buffer)
      const expectedChecksum = file.checksum_sha256 || actualChecksum
      if (actualChecksum !== expectedChecksum) throw new Error(`Verification failed for file ${file.id}`)

      doneFiles += 1
      transferredBytes += buffer.length
      successfulR2CopyIds.push(targetCopyId)
      processedFileIds.push(file.id)
      successfullyReturnedFiles.push(file)

      const { error: copyAvailableError } = await supabase.from('photo_file_copies').update({ status: 'available', bucket_name: process.env.R2_BUCKET_NAME!, storage_key: buildR2PublicUrl(targetKey), size_bytes: buffer.length, size_verified: true, checksum_verified: true, last_verified_at: new Date().toISOString(), last_error: null, is_primary_read_source: false }).eq('id', targetCopyId)
      if (copyAvailableError) throw copyAvailableError

      await updateOperation(operation.id, { status: 'copying', current_phase: 'copying', done_files: doneFiles, failed_files: failedFiles, transferred_bytes: transferredBytes, error_message: firstError })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Copy failed'
      failedFiles += 1
      firstError = firstError || message
      await supabase.from('photo_file_copies').update({ status: 'failed', bucket_name: process.env.R2_BUCKET_NAME!, last_error: message, is_primary_read_source: false }).eq('id', targetCopyId)
      await updateOperation(operation.id, { status: 'copying', current_phase: 'copying', done_files: doneFiles, failed_files: failedFiles, transferred_bytes: transferredBytes, error_message: message })
    }
  }

  await assertOperationStillActive(operation.id, operation.project_id)
  if (failedFiles > 0) throw new Error(firstError || `${failedFiles} file copy operations failed`)

  await updateOperation(operation.id, { status: 'switching_project_state', current_phase: 'releasing_local', done_files: doneFiles, failed_files: failedFiles, transferred_bytes: transferredBytes })
  await promotePrimaryCopies(successfulR2CopyIds, processedFileIds)
  await releaseLocalCopies(successfullyReturnedFiles)
  await switchProjectStateToR2(operation.project_id)
  await updateOperation(operation.id, { status: 'completed', current_phase: 'completed', done_files: doneFiles, failed_files: failedFiles, transferred_bytes: transferredBytes, error_message: null, completed_at: new Date().toISOString() })
}

export async function processProjectStorageOperation(operationId: string) {
  const claimed = await supabase.from('project_storage_operations').update({ status: 'preparing', current_phase: 'preparing', error_message: null }).eq('id', operationId).eq('status', 'queued').select('*').maybeSingle()
  if (claimed.error) throw claimed.error

  const operation = claimed.data ? mapOperation(claimed.data as Record<string, unknown>) : await loadOperationById(operationId)
  if (!operation) throw new Error('Storage operation not found')
  if (operation.status === 'completed' || operation.status === 'failed') return operation

  try {
    if (operation.operation_type === 'pull_to_current_node') {
      await processPullToCurrentNodeOperation(operation)
    } else if (operation.operation_type === 'return_to_r2') {
      await processReturnToR2Operation(operation)
    } else {
      throw new Error(`Unsupported storage operation type: ${operation.operation_type}`)
    }
  } catch (error) {
    if (error instanceof CancelledStorageOperationError) {
      return (await loadOperationById(operation.id)) || operation
    }
    const message = error instanceof Error ? error.message : 'Storage operation failed'
    await failOperation(operation, message)
  }

  return (await loadOperationById(operation.id)) || operation
}

export async function kickProjectStorageOperation(origin: string, operationId: string) {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (process.env.WEBHOOK_SECRET) headers.set('x-webhook-secret', process.env.WEBHOOK_SECRET)

  return fetch(`${origin.replace(/\/+$/, '')}/api/internal/project-storage-operations/process`, { method: 'POST', headers, body: JSON.stringify({ operationId }) }).catch(() => null)
}
