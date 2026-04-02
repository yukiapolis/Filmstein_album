import { DeleteObjectCommand } from '@aws-sdk/client-s3'
import { promises as fs } from 'node:fs'
import { supabase } from '@/lib/supabase/server'
import { r2 } from '@/lib/r2/client'

type RouteContext = { params: Promise<{ id: string }> }

const BRANCH_TYPE_DISPLAY = 'display'
const BRANCH_TYPE_ORIGINAL = 'original'

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
  try {
    const { id } = await context.params
    const url = new URL(req.url)
    const mode = url.searchParams.get('mode') === 'all-versions' ? 'all-versions' : 'current-version'
    const fileId = url.searchParams.get('fileId')

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

    if (!fileId) {
      return Response.json({ success: false, error: 'fileId is required for current-version delete' }, { status: 400 })
    }

    const { data: fileRow, error: fileError } = await supabase
      .from('photo_files')
      .select('id, photo_id, branch_type, storage_provider, bucket_name, object_key')
      .eq('id', fileId)
      .eq('photo_id', id)
      .maybeSingle()

    if (fileError) {
      return Response.json({ success: false, error: fileError.message }, { status: 500 })
    }

    if (!fileRow) {
      return Response.json({ success: false, error: 'File not found' }, { status: 404 })
    }

    const { error: deleteFileError } = await supabase
      .from('photo_files')
      .delete()
      .eq('id', fileId)

    if (deleteFileError) {
      return Response.json({ success: false, error: deleteFileError.message }, { status: 500 })
    }

    const cleanupErrors: string[] = []
    try {
      await deleteStoredAsset(fileRow as FileRow)
    } catch (err) {
      cleanupErrors.push(`${fileRow.id}:${err instanceof Error ? err.message : String(err)}`)
    }

    const { data: remainingFiles, error: remainingError } = await supabase
      .from('photo_files')
      .select('id, branch_type, created_at')
      .eq('photo_id', id)
      .order('created_at', { ascending: false })

    if (remainingError) {
      return Response.json({ success: false, error: remainingError.message }, { status: 500 })
    }

    const displayFile = remainingFiles?.find((f) => f.branch_type === BRANCH_TYPE_DISPLAY) ?? null
    const originalFile = remainingFiles?.find((f) => f.branch_type === BRANCH_TYPE_ORIGINAL) ?? null

    const { error: updatePhotoError } = await supabase
      .from('photos')
      .update({
        original_file_id: originalFile?.id ?? null,
        retouched_file_id: displayFile?.id ?? originalFile?.id ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('global_photo_id', id)

    if (updatePhotoError) {
      return Response.json({ success: false, error: updatePhotoError.message }, { status: 500 })
    }

    return Response.json({ success: true, mode, photoId: id, fileId, cleanupErrors })
  } catch {
    return Response.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}
