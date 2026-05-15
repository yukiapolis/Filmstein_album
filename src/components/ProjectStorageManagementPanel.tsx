"use client";

import { useEffect, useState } from 'react'
import { Loader2, Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ProjectStorageSummary, StorageBranchSummary } from '@/lib/storageManagement'
import type { StorageMigrationBranchType } from '@/lib/storageMigrations'
import type { CurrentStorageNodeInfo, ProjectStoragePermissions, ProjectStorageStateInfo } from '@/lib/currentStorageNode'
import type { ProjectStorageOperationRow } from '@/lib/storageOperations'

type StorageMigrationStatusPayload = {
  activeMigration: ProjectStorageOperationRow | null
  migrations: ProjectStorageOperationRow[]
  currentNode: CurrentStorageNodeInfo
  projectStorageState: ProjectStorageStateInfo | null
  permissions: ProjectStoragePermissions
  createdOperation?: ProjectStorageOperationRow | null
}

const STORAGE_LOCATION_LABELS = {
  r2: 'R2',
  local_backup_server: 'Node local',
  other_remote_storage: 'Other remote storage',
  app_local_storage: 'App local storage',
} as const

const STORAGE_BRANCH_LABELS: Record<'thumb' | 'display' | 'original', string> = {
  thumb: 'thumb',
  display: 'display',
  original: 'original',
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = value
  let unitIndex = 0
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }
  return `${size.toFixed(size >= 100 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}

function formatNodeModeLabel(locationMode?: 'r2' | 'node_local' | null) {
  if (locationMode === 'node_local') return 'Held by node'
  return 'R2'
}

export default function ProjectStorageManagementPanel({
  projectId,
  projectName,
}: {
  projectId: string
  projectName?: string
}) {
  const [storageSummary, setStorageSummary] = useState<ProjectStorageSummary | null>(null)
  const [storageSummaryLoading, setStorageSummaryLoading] = useState(false)
  const [storageSummaryError, setStorageSummaryError] = useState<string | null>(null)
  const [storageMigrationStatus, setStorageMigrationStatus] = useState<StorageMigrationStatusPayload | null>(null)
  const [storageMigrationLoading, setStorageMigrationLoading] = useState(false)
  const [storageMigrationError, setStorageMigrationError] = useState<string | null>(null)
  const [storageMigrationSubmitting, setStorageMigrationSubmitting] = useState(false)
  const [storageMigrationCancelling, setStorageMigrationCancelling] = useState(false)
  const [storageMigrationSelection, setStorageMigrationSelection] = useState<Record<StorageMigrationBranchType, boolean>>({ thumb: false, display: false, original: false })

  useEffect(() => {
    let cancelled = false

    const loadStoragePanel = async (isInitial: boolean) => {
      if (isInitial) {
        setStorageSummaryLoading(true)
        setStorageMigrationLoading(true)
      }
      setStorageSummaryError(null)
      setStorageMigrationError(null)
      try {
        const [summaryRes, migrationRes] = await Promise.all([
          fetch(`/api/projects/${projectId}/storage/summary`),
          fetch(`/api/projects/${projectId}/storage/migrations`),
        ])
        const summaryBody = await summaryRes.json().catch(() => null) as { success?: boolean; error?: string; data?: ProjectStorageSummary } | null
        const migrationBody = await migrationRes.json().catch(() => null) as { success?: boolean; error?: string; data?: StorageMigrationStatusPayload } | null
        if (cancelled) return

        if (!summaryRes.ok || summaryBody?.success !== true || !summaryBody.data) {
          setStorageSummaryError(summaryBody?.error ?? 'Could not load storage summary')
          setStorageSummary(null)
        } else {
          setStorageSummary(summaryBody.data)
        }

        if (!migrationRes.ok || migrationBody?.success !== true || !migrationBody.data) {
          setStorageMigrationError(migrationBody?.error ?? 'Could not load storage migrations')
          setStorageMigrationStatus(null)
        } else {
          setStorageMigrationStatus(migrationBody.data)
        }
      } catch {
        if (!cancelled) {
          setStorageSummaryError('Could not load storage summary')
          setStorageMigrationError('Could not load storage migrations')
          setStorageSummary(null)
          setStorageMigrationStatus(null)
        }
      } finally {
        if (!cancelled && isInitial) {
          setStorageSummaryLoading(false)
          setStorageMigrationLoading(false)
        }
      }
    }

    void loadStoragePanel(true)
    const poll = window.setInterval(() => {
      void loadStoragePanel(false)
    }, 3000)

    return () => {
      cancelled = true
      window.clearInterval(poll)
    }
  }, [projectId])

  const handleToggleStorageMigrationBranch = (branchType: StorageMigrationBranchType) => {
    setStorageMigrationSelection((current) => ({ ...current, [branchType]: !current[branchType] }))
  }

  const handleStartStorageMigration = async (operationType: 'pull_to_current_node' | 'return_to_r2') => {
    const branchTypes = (Object.entries(storageMigrationSelection) as Array<[StorageMigrationBranchType, boolean]>)
      .filter(([, checked]) => checked)
      .map(([branchType]) => branchType)

    if (branchTypes.length === 0) return

    setStorageMigrationSubmitting(true)
    setStorageMigrationError(null)
    try {
      const res = await fetch(`/api/projects/${projectId}/storage/migrations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branchTypes, operationType }),
      })
      const body = await res.json().catch(() => null) as { success?: boolean; error?: string; data?: StorageMigrationStatusPayload } | null
      if (!res.ok || body?.success !== true || !body.data) {
        setStorageMigrationError(body?.error ?? (operationType === 'return_to_r2' ? 'Could not start return-to-R2' : 'Could not start pull-to-current-node'))
        return
      }
      setStorageMigrationStatus(body.data)
      setStorageMigrationSelection({ thumb: false, display: false, original: false })
    } catch {
      setStorageMigrationError(operationType === 'return_to_r2' ? 'Could not start return-to-R2' : 'Could not start pull-to-current-node')
    } finally {
      setStorageMigrationSubmitting(false)
    }
  }

  const handleCancelActiveMigration = async () => {
    setStorageMigrationCancelling(true)
    setStorageMigrationError(null)
    try {
      const res = await fetch(`/api/projects/${projectId}/storage/migrations`, {
        method: 'DELETE',
      })
      const body = await res.json().catch(() => null) as { success?: boolean; error?: string; data?: StorageMigrationStatusPayload } | null
      if (!res.ok || body?.success !== true || !body.data) {
        setStorageMigrationError(body?.error ?? 'Could not cancel active storage operation')
        return
      }
      setStorageMigrationStatus(body.data)
    } catch {
      setStorageMigrationError('Could not cancel active storage operation')
    } finally {
      setStorageMigrationCancelling(false)
    }
  }

  const renderLocationBreakdown = (counts: Record<'r2' | 'local_backup_server' | 'other_remote_storage' | 'app_local_storage', number>) => {
    const visibleEntries = Object.entries(counts).filter(([, value]) => value > 0) as Array<[keyof typeof counts, number]>
    if (visibleEntries.length === 0) {
      return <p className="text-xs text-muted-foreground">None detected</p>
    }

    return (
      <div className="flex flex-wrap gap-2">
        {visibleEntries.map(([key, value]) => (
          <span key={key} className="rounded-full border border-border bg-background px-2 py-1 text-[11px] text-foreground">
            {STORAGE_LOCATION_LABELS[key]} · {value}
          </span>
        ))}
      </div>
    )
  }

  const renderStorageBranchCard = (branch: StorageBranchSummary) => (
    <div key={branch.branchType} className="rounded-md border border-border bg-background p-4 space-y-3">
      <div>
        <p className="text-sm font-semibold text-foreground capitalize">{STORAGE_BRANCH_LABELS[branch.branchType]}</p>
        <p className="text-xs text-muted-foreground">{branch.totalFiles} files in this project</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <p className="text-xs font-medium text-foreground">Primary read source</p>
          {renderLocationBreakdown(branch.primaryReadSource)}
        </div>
        <div className="space-y-2">
          <p className="text-xs font-medium text-foreground">Copy distribution</p>
          {renderLocationBreakdown(branch.copyDistribution.byLocation)}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <div className="rounded border border-border/70 px-2 py-2">
          <p className="text-muted-foreground">Readable</p>
          <p className="mt-1 font-medium text-foreground">{branch.readableFiles}</p>
        </div>
        <div className="rounded border border-border/70 px-2 py-2">
          <p className="text-muted-foreground">Verified</p>
          <p className="mt-1 font-medium text-foreground">{branch.verifiedFiles}</p>
        </div>
        <div className="rounded border border-border/70 px-2 py-2">
          <p className="text-muted-foreground">Failed / abnormal</p>
          <p className="mt-1 font-medium text-foreground">{branch.failedFiles} / {branch.abnormalFiles}</p>
        </div>
        <div className="rounded border border-border/70 px-2 py-2">
          <p className="text-muted-foreground">No primary / no readable</p>
          <p className="mt-1 font-medium text-foreground">{branch.noPrimaryFiles} / {branch.noReadableFiles}</p>
        </div>
      </div>

      <div className="rounded border border-border/70 px-3 py-3 text-xs text-muted-foreground">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <span>Total copies: {branch.copyDistribution.totalCopies}</span>
          <span>Available: {branch.copyDistribution.availableCopies}</span>
          <span>Queued: {branch.copyDistribution.queuedCopies}</span>
          <span>Copying: {branch.copyDistribution.copyingCopies}</span>
          <span>Verifying: {branch.copyDistribution.verifyingCopies}</span>
        </div>
      </div>
    </div>
  )

  const selectedStorageMigrationBranchCount = Object.values(storageMigrationSelection).filter(Boolean).length
  const activeStorageMigration = storageMigrationStatus?.activeMigration ?? null
  const currentStorageNode = storageMigrationStatus?.currentNode ?? null
  const projectStorageState = storageMigrationStatus?.projectStorageState ?? null
  const storagePermissions = storageMigrationStatus?.permissions ?? null

  const renderStorageMigrationCard = (operation: ProjectStorageOperationRow, compact = false) => {
    const progress = operation.total_files > 0 ? Math.min(100, Math.round((operation.done_files / operation.total_files) * 100)) : 0

    return (
      <div key={operation.id} className={`rounded-md border border-border bg-background p-4 ${compact ? 'space-y-2' : 'space-y-3'}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-foreground">{operation.operation_type === 'return_to_r2' ? 'Return to R2' : 'Pull to current node'}</p>
            <p className="text-[11px] text-muted-foreground">{operation.requested_branch_types.join(', ')} · {operation.status}{operation.current_phase ? ` · phase ${operation.current_phase}` : ''}</p>
          </div>
          <p className="text-[11px] text-muted-foreground">{operation.created_at ? new Date(operation.created_at).toLocaleString() : ''}</p>
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Progress</span>
            <span>{operation.done_files} / {operation.total_files} files</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-foreground/80 transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          <div className="rounded border border-border/70 px-2 py-2">
            <p className="text-muted-foreground">Failed files</p>
            <p className="mt-1 font-medium text-foreground">{operation.failed_files}</p>
          </div>
          <div className="rounded border border-border/70 px-2 py-2">
            <p className="text-muted-foreground">Transferred</p>
            <p className="mt-1 font-medium text-foreground">{formatBytes(operation.transferred_bytes)} / {formatBytes(operation.total_bytes)}</p>
          </div>
          <div className="rounded border border-border/70 px-2 py-2">
            <p className="text-muted-foreground">Node</p>
            <p className="mt-1 font-medium text-foreground">{operation.node_name || operation.node_key || '—'}</p>
          </div>
          <div className="rounded border border-border/70 px-2 py-2">
            <p className="text-muted-foreground">State switch</p>
            <p className="mt-1 font-medium text-foreground">{projectStorageState?.transitionState || 'idle'}</p>
          </div>
        </div>

        {operation.error_message ? (
          <p className="text-xs text-destructive">Last error: {operation.error_message}</p>
        ) : null}
      </div>
    )
  }

  return (
    <div className="space-y-4 rounded-lg border border-border bg-muted/30 p-4">
      <div>
        <h3 className="text-sm font-semibold text-foreground">Storage Management</h3>
        <p className="text-xs text-muted-foreground">{projectName ? `${projectName} · ` : ''}Show current holder state, current node readiness, and prepare pull-to-current-node without the old fixed backup target model.</p>
      </div>

      <div className="rounded-md border border-border bg-background p-4 space-y-4">
        <div>
          <p className="text-sm font-medium text-foreground">Current storage state</p>
          <p className="text-xs text-muted-foreground">
            {projectStorageState?.locationMode === 'node_local'
              ? `This project is currently held by ${projectStorageState.holderNodeName || 'another node'}.`
              : 'This project currently reads from R2.'}
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded border border-border px-3 py-3 text-xs">
            <p className="text-muted-foreground">Current node</p>
            <p className="mt-1 font-medium text-foreground">{currentStorageNode?.name || 'Unknown node'}</p>
            <p className="mt-1 text-muted-foreground">{currentStorageNode?.nodeKey || 'No node key configured'}</p>
          </div>
          <div className="rounded border border-border px-3 py-3 text-xs">
            <p className="text-muted-foreground">Read source</p>
            <p className="mt-1 font-medium text-foreground">{formatNodeModeLabel(projectStorageState?.locationMode)}</p>
            <p className="mt-1 text-muted-foreground">{projectStorageState?.locationMode === 'node_local' ? (projectStorageState?.holderNodeName || 'Unknown holder') : 'No holder node'}</p>
          </div>
          <div className="rounded border border-border px-3 py-3 text-xs">
            <p className="text-muted-foreground">Current node free space</p>
            <p className="mt-1 font-medium text-foreground">{currentStorageNode ? formatBytes(currentStorageNode.diskAvailableBytes || 0) : '—'}</p>
            <p className="mt-1 text-muted-foreground">Total {currentStorageNode ? formatBytes(currentStorageNode.diskTotalBytes || 0) : '—'} · Used {currentStorageNode ? formatBytes(currentStorageNode.diskUsedBytes || 0) : '—'}</p>
          </div>
          <div className="rounded border border-border px-3 py-3 text-xs">
            <p className="text-muted-foreground">Estimated project size</p>
            <p className="mt-1 font-medium text-foreground">{currentStorageNode?.projectEstimatedBytes != null ? formatBytes(currentStorageNode.projectEstimatedBytes) : '—'}</p>
            <p className="mt-1 text-muted-foreground">{currentStorageNode?.hasEnoughSpaceForProject == null ? 'Space check unavailable' : currentStorageNode.hasEnoughSpaceForProject ? 'Enough space to pull to this node' : 'Not enough space on this node'}</p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded border border-border px-3 py-3 text-xs">
            <p className="text-muted-foreground">Transition state</p>
            <p className="mt-1 font-medium text-foreground">{projectStorageState?.transitionState || 'idle'}</p>
            <p className="mt-1 text-muted-foreground">{projectStorageState?.activeOperationKind || 'No active operation'}</p>
          </div>
          <div className="rounded border border-border px-3 py-3 text-xs">
            <p className="text-muted-foreground">Holder node</p>
            <p className="mt-1 font-medium text-foreground">{projectStorageState?.holderNodeName || 'None'}</p>
            <p className="mt-1 text-muted-foreground">{projectStorageState?.holderNodeKey || 'No holder key'}</p>
          </div>
          <div className="rounded border border-border px-3 py-3 text-xs">
            <p className="text-muted-foreground">Holder public URL</p>
            <p className="mt-1 break-all font-medium text-foreground">{projectStorageState?.holderNodePublicBaseUrl || 'No holder URL'}</p>
          </div>
          <div className="rounded border border-border px-3 py-3 text-xs">
            <p className="text-muted-foreground">Current node relation</p>
            <p className="mt-1 font-medium text-foreground">{storagePermissions?.isCurrentNodeHolder ? 'Current node is holder' : 'Current node is not holder'}</p>
            <p className="mt-1 text-muted-foreground">{storagePermissions?.blockingReason || (storagePermissions?.canPullToCurrentNode ? 'Current node can pull this project' : storagePermissions?.canReturnToR2 ? 'Current node can return this project to R2' : 'No action available')}</p>
          </div>
        </div>

        <div className="rounded border border-border px-3 py-3 text-xs space-y-2">
          <p className="font-medium text-foreground">Current node public base URL</p>
          <p className="break-all text-foreground">{currentStorageNode?.publicBaseUrl || 'No public base URL configured'}</p>
          <p className="text-muted-foreground">{currentStorageNode?.publicBaseUrl ? 'Other nodes can later use this URL to resolve assets when this node becomes the holder.' : 'Configure STORAGE_NODE_PUBLIC_BASE_URL, or make sure the current request origin is the node URL you want to use for validation.'}</p>
        </div>

        <div>
          <p className="text-sm font-medium text-foreground">Storage migration actions</p>
          <p className="text-xs text-muted-foreground">Current project-level storage state only stays consistent when thumb, display, and original move together. Select all three managed branches before starting a migration.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <p className="text-xs font-medium text-foreground">Branch types</p>
            <div className="flex flex-wrap gap-2">
              {(['thumb', 'display', 'original'] as const).map((branchType) => (
                <label key={branchType} className="flex items-center gap-2 rounded border border-border px-3 py-2 text-xs text-foreground">
                  <input type="checkbox" checked={storageMigrationSelection[branchType]} onChange={() => handleToggleStorageMigrationBranch(branchType)} />
                  {STORAGE_BRANCH_LABELS[branchType]}
                </label>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-medium text-foreground">This node</p>
            <div className="rounded border border-border px-3 py-2 text-xs text-foreground">{currentStorageNode?.name || 'Current node'}</div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => handleStartStorageMigration('pull_to_current_node')} disabled={storageMigrationSubmitting || selectedStorageMigrationBranchCount === 0 || Boolean(activeStorageMigration) || storagePermissions?.canPullToCurrentNode === false}>
            {storageMigrationSubmitting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1.5 h-3.5 w-3.5" />}
            Pull to current node
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => handleStartStorageMigration('return_to_r2')} disabled={storageMigrationSubmitting || selectedStorageMigrationBranchCount === 0 || Boolean(activeStorageMigration) || storagePermissions?.canReturnToR2 === false}>
            {storageMigrationSubmitting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1.5 h-3.5 w-3.5" />}
            Return selected branches to R2
          </Button>
          <p className="text-xs text-muted-foreground">{activeStorageMigration ? 'Wait for the active operation to finish before starting another one.' : selectedStorageMigrationBranchCount === 0 ? 'Select thumb, display, and original.' : selectedStorageMigrationBranchCount < 3 ? 'Select all three managed branches together.' : storagePermissions?.canReturnToR2 ? 'All three managed branches selected · return to R2 is available' : storagePermissions?.canPullToCurrentNode ? 'All three managed branches selected · pull to current node is available' : (storagePermissions?.blockingReason || 'No migration action is available on this node')}</p>
        </div>
        {currentStorageNode?.notes?.length ? (
          <div className="space-y-1">
            {currentStorageNode.notes.map((note) => <p key={note} className="text-xs text-muted-foreground">{note}</p>)}
          </div>
        ) : null}
        {storageMigrationError ? <p className="text-sm text-destructive">{storageMigrationError}</p> : null}
      </div>

      {storageMigrationLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading migration status…
        </div>
      ) : activeStorageMigration ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-medium text-foreground">Active operation</p>
            <Button type="button" variant="outline" size="sm" onClick={handleCancelActiveMigration} disabled={storageMigrationCancelling}>
              {storageMigrationCancelling ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <X className="mr-1.5 h-3.5 w-3.5" />}
              Cancel stuck task
            </Button>
          </div>
          {renderStorageMigrationCard(activeStorageMigration)}
        </div>
      ) : null}

      {storageSummaryLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading storage summary…
        </div>
      ) : storageSummaryError ? (
        <p className="text-sm text-destructive">{storageSummaryError}</p>
      ) : storageSummary ? (
        <div className="space-y-3">
          <p className="text-[11px] text-muted-foreground">Updated {new Date(storageSummary.generatedAt).toLocaleString()}</p>
          {(['thumb', 'display', 'original'] as const).map((branchType) => renderStorageBranchCard(storageSummary.branches[branchType]))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No storage summary available yet.</p>
      )}

      {storageMigrationStatus?.migrations?.length ? (
        <div className="space-y-2">
          <p className="text-xs font-medium text-foreground">Recent operations</p>
          <div className="space-y-2">
            {storageMigrationStatus.migrations.slice(0, 5).map((migration) => renderStorageMigrationCard(migration, true))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
