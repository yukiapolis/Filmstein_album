import fs from 'node:fs/promises'
import { DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import { supabase } from '@/lib/supabase/server'
import { r2 } from '@/lib/r2/client'
import { requireAdminApiAuth } from '@/lib/auth/session'
import { getProjectPermissionContext } from '@/lib/auth/projectPermissions'
import { loadProjectStorageScanScope, scanProjectStorageOrphans, type OrphanScanResult } from '@/lib/projectStorageOrphans'

type RouteContext = { params: Promise<{ id: string }> }

type CleanupItem = { path: string; size: number; sourceType: 'r2' | 'local' | 'db' | 'zombie-photo'; reason: string }

function buildAllowedPathSet(scanResult: OrphanScanResult, cleanType: 'r2' | 'local' | 'db') {
  if (cleanType === 'r2') return new Set((scanResult.r2_orphans.items ?? []).map((item) => item.path))
  if (cleanType === 'local') return new Set((scanResult.local_orphans.items ?? []).map((item) => item.path))
  return new Set((scanResult.db_orphans.items ?? []).map((item) => item.path))
}

function selectRequestedItems(items: CleanupItem[], allowedPaths: Set<string>) {
  return items.filter((item) => allowedPaths.has(item.path))
}

export async function POST(req: Request, context: RouteContext) {
  const auth = await requireAdminApiAuth()
  if (auth instanceof Response) return auth

  try {
    const { id } = await context.params
    const permission = await getProjectPermissionContext(auth, id)
    if (!permission.exists) {
      return Response.json({ success: false, error: 'Project not found' }, { status: 404 })
    }
    if (!permission.canManageProject) {
      return Response.json({ success: false, error: 'Forbidden' }, { status: 403 })
    }

    const body = await req.json()
    const submittedScanResult = body?.scanResult as {
      r2_orphans?: { items?: CleanupItem[] }
      local_orphans?: { items?: CleanupItem[] }
      db_orphans?: { items?: CleanupItem[] }
    }
    const cleanTypes = Array.isArray(body?.cleanTypes) ? body.cleanTypes as string[] : []

    const scope = await loadProjectStorageScanScope(id)
    if (!scope) {
      return Response.json({ success: false, error: 'Project not found' }, { status: 404 })
    }

    const freshScan = await scanProjectStorageOrphans({
      projectId: id,
      project: scope.project,
      photoFiles: scope.photoFiles,
      photos: scope.photos,
    })

    const requestedR2Items = selectRequestedItems(submittedScanResult?.r2_orphans?.items ?? [], buildAllowedPathSet(freshScan, 'r2'))
    const requestedLocalItems = selectRequestedItems(submittedScanResult?.local_orphans?.items ?? [], buildAllowedPathSet(freshScan, 'local'))
    const requestedDbItems = selectRequestedItems(submittedScanResult?.db_orphans?.items ?? [], buildAllowedPathSet(freshScan, 'db'))

    const deleted: CleanupItem[] = []
    const failedItems: Array<{ path: string; error: string }> = []
    let freedBytes = 0
    let skippedCount = 0

    const publicBase = (process.env.R2_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_PHOTO_PUBLIC_BASE_URL || '').replace(/\/+$/, '')
    const bucket = process.env.R2_BUCKET_NAME || ''

    if (cleanTypes.includes('r2')) {
      for (const item of requestedR2Items) {
        const key = publicBase && item.path.startsWith(`${publicBase}/`) ? item.path.slice(publicBase.length + 1) : item.path
        try {
          await r2.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
          await r2.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
          deleted.push(item)
          freedBytes += item.size || 0
        } catch (error) {
          failedItems.push({ path: item.path, error: error instanceof Error ? error.message : String(error) })
        }
      }
    }

    if (cleanTypes.includes('local')) {
      for (const item of requestedLocalItems) {
        try {
          await fs.access(item.path)
          await fs.rm(item.path, { force: true })
          deleted.push(item)
          freedBytes += item.size || 0
        } catch (error) {
          failedItems.push({ path: item.path, error: error instanceof Error ? error.message : String(error) })
        }
      }
    }

    if (cleanTypes.includes('db')) {
      for (const item of requestedDbItems) {
        if (item.reason.includes('logical photo exists without')) {
          const { data: linkedFiles, error: linkedFilesError } = await supabase
            .from('photo_files')
            .select('id')
            .eq('photo_id', item.path)

          if (linkedFilesError) {
            failedItems.push({ path: item.path, error: linkedFilesError.message })
            continue
          }

          if ((linkedFiles ?? []).length > 0) {
            const { error: deleteFilesError } = await supabase
              .from('photo_files')
              .delete()
              .eq('photo_id', item.path)
            if (deleteFilesError) {
              failedItems.push({ path: item.path, error: deleteFilesError.message })
              continue
            }
          }

          const { error, count } = await supabase
            .from('photos')
            .delete({ count: 'exact' })
            .eq('project_id', id)
            .eq('global_photo_id', item.path)
          if (error) {
            failedItems.push({ path: item.path, error: error.message })
          } else if ((count ?? 0) > 0) {
            deleted.push(item)
          } else {
            skippedCount += 1
          }
          continue
        }

        const validPhotoIds = new Set(scope.photos.map((photo) => photo.global_photo_id))
        const { data: linkedFileRows, error: linkedFileRowsError } = await supabase
          .from('photo_files')
          .select('photo_id')
          .eq('object_key', item.path)

        if (linkedFileRowsError) {
          failedItems.push({ path: item.path, error: linkedFileRowsError.message })
          continue
        }

        const isProjectScoped = (linkedFileRows ?? []).every((row) => typeof row.photo_id === 'string' && validPhotoIds.has(row.photo_id))
        if (!isProjectScoped) {
          skippedCount += 1
          continue
        }

        const { error, count } = await supabase
          .from('photo_files')
          .delete({ count: 'exact' })
          .eq('object_key', item.path)
          .in('photo_id', Array.from(validPhotoIds))
        if (error) {
          failedItems.push({ path: item.path, error: error.message })
        } else if ((count ?? 0) > 0) {
          deleted.push(item)
        } else {
          skippedCount += 1
        }
      }
    }

    return Response.json({
      success: true,
      data: {
        deletedCount: deleted.length,
        freedBytes,
        skippedCount,
        failedItems,
      },
    })
  } catch (error) {
    return Response.json({ success: false, error: error instanceof Error ? error.message : 'Server error' }, { status: 500 })
  }
}
