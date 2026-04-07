import fs from 'node:fs/promises'
import { DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import { supabase } from '@/lib/supabase/server'
import { r2 } from '@/lib/r2/client'

type RouteContext = { params: Promise<{ id: string }> }

type CleanupItem = { path: string; size: number; sourceType: 'r2' | 'local' | 'db'; reason: string }

export async function POST(req: Request, context: RouteContext) {
  try {
    const { id } = await context.params
    const body = await req.json()
    const scanResult = body?.scanResult as {
      r2_orphans?: { items?: CleanupItem[] }
      local_orphans?: { items?: CleanupItem[] }
      db_orphans?: { items?: CleanupItem[] }
    }
    const cleanTypes = Array.isArray(body?.cleanTypes) ? body.cleanTypes as string[] : []

    const deleted: CleanupItem[] = []
    const failedItems: Array<{ path: string; error: string }> = []
    let freedBytes = 0
    let skippedCount = 0

    const publicBase = (process.env.R2_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_PHOTO_PUBLIC_BASE_URL || '').replace(/\/+$/, '')
    const bucket = process.env.R2_BUCKET_NAME || ''

    if (cleanTypes.includes('r2')) {
      for (const item of scanResult?.r2_orphans?.items ?? []) {
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
      for (const item of scanResult?.local_orphans?.items ?? []) {
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
      for (const item of scanResult?.db_orphans?.items ?? []) {
        const { error, count } = await supabase
          .from('photo_files')
          .delete({ count: 'exact' })
          .eq('object_key', item.path)
        if (error) {
          failedItems.push({ path: item.path, error: error.message })
        } else if ((count ?? 0) > 0) {
          deleted.push(item)
        } else {
          skippedCount++
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
