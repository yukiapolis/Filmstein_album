import os from 'node:os'
import path from 'node:path'
import { statfs } from 'node:fs/promises'

import { supabase } from '@/lib/supabase/server'

export type CurrentStorageNodeInfo = {
  id: string | null
  nodeKey: string | null
  name: string
  publicBaseUrl: string | null
  effectiveOrigin: string | null
  role: string | null
  isActive: boolean
  canHoldProjectLocally: boolean
  healthStatus: string
  isRegistered: boolean
  isLocalDevelopment: boolean
  diskTotalBytes: number | null
  diskAvailableBytes: number | null
  diskUsedBytes: number | null
  projectEstimatedBytes: number | null
  hasEnoughSpaceForProject: boolean | null
  notes: string[]
}

export type ProjectStorageStateInfo = {
  projectId: string
  locationMode: 'r2' | 'node_local'
  holderNodeId: string | null
  holderNodeKey: string | null
  holderNodeName: string | null
  holderNodePublicBaseUrl: string | null
  transitionState: string
  activeOperationId: string | null
  activeOperationKind: string | null
}

export type ProjectStoragePermissions = {
  isCurrentNodeHolder: boolean
  canPullToCurrentNode: boolean
  canReturnToR2: boolean
  blockingReason: string | null
}

function cleanUrl(value?: string | null) {
  const trimmed = value?.trim()
  return trimmed ? trimmed.replace(/\/+$/, '') : null
}

function boolFromEnv(value: string | undefined, fallback: boolean) {
  if (value == null || value === '') return fallback
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase())
}

function inferIsLocalDevelopment(origin: string | null) {
  if (!origin) return false
  try {
    const host = new URL(origin).hostname
    return ['localhost', '127.0.0.1', '::1'].includes(host)
  } catch {
    return false
  }
}

async function readDiskUsage(targetPath: string) {
  try {
    const stats = await statfs(targetPath)
    const total = Number(stats.blocks) * Number(stats.bsize)
    const available = Number(stats.bavail) * Number(stats.bsize)
    const used = Math.max(0, total - available)
    return { total, available, used }
  } catch {
    return { total: null, available: null, used: null }
  }
}

async function estimateProjectBytes(projectId: string) {
  const { data, error } = await supabase
    .from('photos')
    .select('global_photo_id')
    .eq('project_id', projectId)

  if (error) throw error

  const photoIds = (data ?? []).map((row) => String(row.global_photo_id || '')).filter(Boolean)
  if (photoIds.length === 0) return 0

  const { data: files, error: filesError } = await supabase
    .from('photo_files')
    .select('file_size_bytes')
    .in('photo_id', photoIds)
    .in('branch_type', ['thumb', 'display', 'original'])

  if (filesError) throw filesError

  return (files ?? []).reduce((sum, row) => sum + Math.max(0, Number(row.file_size_bytes || 0)), 0)
}

function buildDerivedNodeKey() {
  const configuredNodeKey = process.env.STORAGE_NODE_KEY?.trim()
  if (configuredNodeKey) return configuredNodeKey

  return `auto-${os.hostname().toLowerCase().replace(/[^a-z0-9._-]+/g, '-')}`
}

async function loadRegisteredNode(requestOrigin?: string | null) {
  const configuredNodeId = process.env.STORAGE_NODE_ID?.trim() || null
  const configuredNodeKey = process.env.STORAGE_NODE_KEY?.trim() || null
  const cleanOrigin = cleanUrl(requestOrigin || null)
  const hostName = os.hostname()

  if (configuredNodeId || configuredNodeKey) {
    let query = supabase.from('storage_nodes').select('*').limit(1)
    if (configuredNodeId) query = query.eq('id', configuredNodeId)
    else if (configuredNodeKey) query = query.eq('node_key', configuredNodeKey)

    const { data, error } = await query.maybeSingle()
    if (error) return null
    if (data) return data as Record<string, unknown>
  }

  if (cleanOrigin) {
    const byOrigin = await supabase
      .from('storage_nodes')
      .select('*')
      .eq('public_base_url', cleanOrigin)
      .limit(1)
      .maybeSingle()

    if (!byOrigin.error && byOrigin.data) return byOrigin.data as Record<string, unknown>
  }

  const byName = await supabase
    .from('storage_nodes')
    .select('*')
    .eq('name', hostName)
    .limit(1)
    .maybeSingle()

  if (!byName.error && byName.data) return byName.data as Record<string, unknown>
  return null
}

async function ensureRegisteredNode(params: {
  requestOrigin?: string | null
  canHoldProjectLocally: boolean
  publicBaseUrl: string | null
}) {
  const existing = await loadRegisteredNode(params.requestOrigin)
  if (existing) {
    const existingPublicBaseUrl = typeof existing.public_base_url === 'string' ? cleanUrl(String(existing.public_base_url)) : null
    if (params.publicBaseUrl && params.publicBaseUrl !== existingPublicBaseUrl && typeof existing.id === 'string') {
      const update = await supabase
        .from('storage_nodes')
        .update({ public_base_url: params.publicBaseUrl })
        .eq('id', String(existing.id))
        .select('*')
        .maybeSingle()
      if (!update.error && update.data) return update.data as Record<string, unknown>
    }
    return existing
  }
  if (!params.canHoldProjectLocally || !params.publicBaseUrl) return null

  const attemptedKey = buildDerivedNodeKey()
  const insert = await supabase
    .from('storage_nodes')
    .insert([{
      node_key: attemptedKey,
      name: os.hostname(),
      public_base_url: params.publicBaseUrl,
      role: 'general',
      is_active: true,
      can_hold_project_locally: true,
      health_status: 'online',
    }])
    .select('*')
    .maybeSingle()

  if (insert.error || !insert.data) {
    return null
  }

  return insert.data as Record<string, unknown>
}

async function loadNodeById(nodeId: string | null) {
  if (!nodeId) return null
  const { data, error } = await supabase
    .from('storage_nodes')
    .select('id, node_key, name, public_base_url')
    .eq('id', nodeId)
    .maybeSingle()
  if (error || !data) return null
  return data as Record<string, unknown>
}

export async function loadProjectStorageStateInfo(projectId: string): Promise<ProjectStorageStateInfo | null> {
  const { data, error } = await supabase
    .from('project_storage_state')
    .select('project_id, location_mode, holder_node_id, transition_state, active_operation_id, active_operation_kind')
    .eq('project_id', projectId)
    .maybeSingle()

  if (error || !data) return null

  const row = data as Record<string, unknown>
  const holderNodeId = typeof row.holder_node_id === 'string' ? String(row.holder_node_id) : null
  const holderNode = await loadNodeById(holderNodeId)

  return {
    projectId: String(row.project_id || projectId),
    locationMode: row.location_mode === 'node_local' ? 'node_local' : 'r2',
    holderNodeId,
    holderNodeKey: typeof holderNode?.node_key === 'string' ? String(holderNode.node_key) : null,
    holderNodeName: typeof holderNode?.name === 'string' ? String(holderNode.name) : null,
    holderNodePublicBaseUrl: typeof holderNode?.public_base_url === 'string' ? cleanUrl(String(holderNode.public_base_url)) : null,
    transitionState: typeof row.transition_state === 'string' ? String(row.transition_state) : 'idle',
    activeOperationId: typeof row.active_operation_id === 'string' ? String(row.active_operation_id) : null,
    activeOperationKind: typeof row.active_operation_kind === 'string' ? String(row.active_operation_kind) : null,
  }
}

export async function loadCurrentStorageNodeInfo(projectId: string, requestOrigin?: string | null): Promise<CurrentStorageNodeInfo> {
  const notes: string[] = []
  const configuredPublicBaseUrl = cleanUrl(process.env.STORAGE_NODE_PUBLIC_BASE_URL)
  const effectiveOrigin = cleanUrl(requestOrigin || null)
  const isLocalDevelopment = inferIsLocalDevelopment(effectiveOrigin)
  let registeredNode = await loadRegisteredNode(requestOrigin)
  const workspacePath = process.env.LOCAL_ORIGINALS_DIR || path.join(process.cwd(), 'storage')
  const disk = await readDiskUsage(workspacePath)

  let projectEstimatedBytes: number | null = null
  try {
    projectEstimatedBytes = await estimateProjectBytes(projectId)
  } catch {
    notes.push('Could not estimate project size from database')
  }

  const fallbackName = os.hostname()
  const preferredPublicBaseUrl = configuredPublicBaseUrl || effectiveOrigin

  const canHoldFromEnv = boolFromEnv(process.env.STORAGE_NODE_CAN_HOLD_LOCAL, isLocalDevelopment)
  const canHoldProjectLocally = typeof registeredNode?.can_hold_project_locally === 'boolean'
    ? Boolean(registeredNode.can_hold_project_locally)
    : canHoldFromEnv

  registeredNode = await ensureRegisteredNode({
    requestOrigin,
    canHoldProjectLocally,
    publicBaseUrl: preferredPublicBaseUrl,
  })

  const publicBaseUrl = configuredPublicBaseUrl
    || cleanUrl(typeof registeredNode?.public_base_url === 'string' ? String(registeredNode.public_base_url) : '')
    || effectiveOrigin
  if (!publicBaseUrl) {
    notes.push('No public base URL configured')
  }

  if (!registeredNode && canHoldProjectLocally && preferredPublicBaseUrl) {
    notes.push('Current node is not registered in storage_nodes')
  }

  const healthStatus = typeof registeredNode?.health_status === 'string'
    ? String(registeredNode.health_status)
    : 'unknown'

  const hasEnoughSpaceForProject = disk.available == null || projectEstimatedBytes == null
    ? null
    : disk.available >= Math.ceil(projectEstimatedBytes * 1.1)

  return {
    id: typeof registeredNode?.id === 'string' ? String(registeredNode.id) : (process.env.STORAGE_NODE_ID?.trim() || null),
    nodeKey: typeof registeredNode?.node_key === 'string' ? String(registeredNode.node_key) : buildDerivedNodeKey(),
    name: typeof registeredNode?.name === 'string' ? String(registeredNode.name) : fallbackName,
    publicBaseUrl,
    effectiveOrigin,
    role: typeof registeredNode?.role === 'string' ? String(registeredNode.role) : null,
    isActive: typeof registeredNode?.is_active === 'boolean' ? Boolean(registeredNode.is_active) : true,
    canHoldProjectLocally,
    healthStatus,
    isRegistered: Boolean(registeredNode),
    isLocalDevelopment,
    diskTotalBytes: typeof registeredNode?.disk_total_bytes === 'number' ? Number(registeredNode.disk_total_bytes) : disk.total,
    diskAvailableBytes: typeof registeredNode?.disk_available_bytes === 'number' ? Number(registeredNode.disk_available_bytes) : disk.available,
    diskUsedBytes: disk.used,
    projectEstimatedBytes,
    hasEnoughSpaceForProject,
    notes,
  }
}

export function getProjectStoragePermissions(currentNode: CurrentStorageNodeInfo, projectState: ProjectStorageStateInfo | null): ProjectStoragePermissions {
  const isCurrentNodeHolder = Boolean(currentNode.id && projectState?.holderNodeId && currentNode.id === projectState.holderNodeId)

  if (!currentNode.canHoldProjectLocally) {
    return { isCurrentNodeHolder, canPullToCurrentNode: false, canReturnToR2: false, blockingReason: 'Current node cannot hold project files locally' }
  }
  if (!currentNode.id || !currentNode.isRegistered) {
    return { isCurrentNodeHolder, canPullToCurrentNode: false, canReturnToR2: false, blockingReason: 'Current node is not registered in storage_nodes' }
  }
  if (!currentNode.isActive) {
    return { isCurrentNodeHolder, canPullToCurrentNode: false, canReturnToR2: false, blockingReason: 'Current node is not active' }
  }
  if (currentNode.hasEnoughSpaceForProject === false) {
    return { isCurrentNodeHolder, canPullToCurrentNode: false, canReturnToR2: false, blockingReason: 'Current node does not have enough available disk space' }
  }
  if (!currentNode.publicBaseUrl) {
    return { isCurrentNodeHolder, canPullToCurrentNode: false, canReturnToR2: false, blockingReason: 'Current node has no public base URL configured' }
  }
  if (projectState?.activeOperationId) {
    return { isCurrentNodeHolder, canPullToCurrentNode: false, canReturnToR2: false, blockingReason: 'Another storage operation is already in progress' }
  }
  if (!projectState || projectState.locationMode === 'r2') {
    return { isCurrentNodeHolder: false, canPullToCurrentNode: true, canReturnToR2: false, blockingReason: null }
  }
  if (isCurrentNodeHolder) {
    return { isCurrentNodeHolder: true, canPullToCurrentNode: false, canReturnToR2: true, blockingReason: 'This project is already held by the current node' }
  }
  return { isCurrentNodeHolder: false, canPullToCurrentNode: false, canReturnToR2: false, blockingReason: `This project is already held by ${projectState.holderNodeName || 'another node'}` }
}
