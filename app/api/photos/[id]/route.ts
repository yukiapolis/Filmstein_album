import { DeleteObjectCommand } from '@aws-sdk/client-s3'
import { promises as fs } from 'node:fs'
import { supabase } from '@/lib/supabase/server'
import { r2 } from '@/lib/r2/client'
import { requireAdminApiAuth } from '@/lib/auth/session'
import { getLatestVersionNo, getVersionFiles, groupPhotoFilesByVersion, type PhotoFileRow } from '@/lib/photoVersions'

type RouteContext = { params: Promise<{ id: string }> }

type FileRow = {
  id: string
  photo_id: string
  branch_type: string | null
  storage_provider: string | null
  bucket_name: string | null
  object_key: string | null
  created_at?: string | null
}

async function deleteStoredAsset(file: FileRow) {
  if (file.storage_provider === 'r2' && file.bucket_name && file.object_key) {
    const base = (process.env.R2_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_PHOTO_PUBLIC_BASE_URL || '').replace(/\/+$/, '')
    const key = base && file.object_key.startsWith(base + '/')
      ? file.object_key.slice(base.length + 1)
      : file.object_key

    await r2.send(new DeleteObjectCommand({
      Bucket: file.bucket_name,
      Key: key,
    }))
    return
  }

  if (file.storage_provider === 'local' && file.object_key) {
    await fs.rm(file.object_key, { force: true })
  }
}

export async function PATCH(req: Request, context: RouteContext) {
  const auth = await requireAdminApiAuth()
  if (auth instanceof Response) return auth

  try {
    const { id } = await context.params
    const body = await req.json()
    const isPublished = body?.isPublished

    if (typeof isPublished !== 'boolean') {
      return Response.json({ success: false, error: 'isPublished boolean is required' }, { status: 400 })
    }

    const { error } = await supabase
      .from('photos')
      .update({ is_published: isPublished, updated_at: new Date().toISOString() })
      .eq('global_photo_id', id)

    if (error) {
      return Response.json({ success: false, error: error.message }, { status: 500 })
    }

    return Response.json({ success: true, photoId: id, isPublished })
  } catch {
    return Response.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}

export async function DELETE(req: Request, context: RouteContext) {
  const auth = await requireAdminApiAuth()
  if (auth instanceof Response) return auth

  try {
    const { id } = await context.params
    const url = new URL(req.url)
    const mode = url.searchParams.get('mode') === 'all-versions' ? 'all-versions' : 'current-version'
    const versionNoParam = url.searchParams.get('versionNo')

    if (mode === 'all-versions') {
      const { data: filesToDelete, error: filesToDeleteError } = await supabase
        .from('photo_files')
        .select('id, photo_id, branch_type, storage_provider, bucket_name, object_key')
        .eq('photo_id', id)

      if (filesToDeleteError) {
        return Response.json({ success: false, error: filesToDeleteError.message }, { status: 500 })
      }

      const { error: deleteFilesError } = await supabase
        .from('photo_files')
        .delete()
        .eq('photo_id', id)

      if (deleteFilesError) {
        return Response.json({ success: false, error: deleteFilesError.message }, { status: 500 })
      }

      const { error: deletePhotoError } = await supabase
        .from('photos')
        .delete()
        .eq('global_photo_id', id)

      if (deletePhotoError) {
        return Response.json({ success: false, error: deletePhotoError.message }, { status: 500 })
      }

      const cleanupErrors: string[] = []
      for (const file of (filesToDelete ?? []) as FileRow[]) {
        try {
          await deleteStoredAsset(file)
        } catch (err) {
          cleanupErrors.push(`${file.id}:${err instanceof Error ? err.message : String(err)}`)
        }
      }

      return Response.json({ success: true, mode, photoId: id, cleanupErrors })
    }

    const { data: fileRows, error: fileRowsError } = await supabase
      .from('photo_files')
      .select('id, photo_id, branch_type, storage_provider, bucket_name, object_key, version_no, created_at')
      .eq('photo_id', id)
      .order('version_no', { ascending: false })
      .order('created_at', { ascending: false })

    if (fileRowsError) {
      return Response.json({ success: false, error: fileRowsError.message }, { status: 500 })
    }

    const rows = (fileRows ?? []) as PhotoFileRow[]
    const latestVersionNo = getLatestVersionNo(rows)
    const targetVersionNo = versionNoParam ? Number(versionNoParam) || null : latestVersionNo

    if (!targetVersionNo) {
      return Response.json({ success: false, error: 'versionNo is required for current-version delete' }, { status: 400 })
    }

    const versionBundle = getVersionFiles(rows, targetVersionNo)
    if (!versionBundle || versionBundle.files.length === 0) {
      return Response.json({ success: false, error: 'Version not found' }, { status: 404 })
    }

    const allVersions = groupPhotoFilesByVersion(rows)

    const { error: deleteFileError } = await supabase
      .from('photo_files')
      .delete()
      .eq('photo_id', id)
      .eq('version_no', targetVersionNo)

    if (deleteFileError) {
      return Response.json({ success: false, error: deleteFileError.message }, { status: 500 })
    }

    const cleanupErrors: string[] = []
    for (const fileRow of versionBundle.files as FileRow[]) {
      try {
        await deleteStoredAsset(fileRow)
      } catch (err) {
        cleanupErrors.push(`${fileRow.id}:${err instanceof Error ? err.message : String(err)}`)
      }
    }

    if (allVersions.length <= 1) {
      const { error: deletePhotoError } = await supabase
        .from('photos')
        .delete()
        .eq('global_photo_id', id)

      if (deletePhotoError) {
        return Response.json({ success: false, error: deletePhotoError.message }, { status: 500 })
      }
    }

    return Response.json({ success: true, mode, photoId: id, versionNo: targetVersionNo, cleanupErrors })
  } catch {
    return Response.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}
