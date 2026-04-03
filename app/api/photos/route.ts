import { DeleteObjectCommand } from '@aws-sdk/client-s3'
import { promises as fs } from 'node:fs'
import { supabase } from '@/lib/supabase/server'
import { r2 } from '@/lib/r2/client'

const BRANCH_TYPE_DISPLAY = 'display'
const BRANCH_TYPE_ORIGINAL = 'original'

type DeleteMode = 'current-version' | 'all-versions'

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

export async function PATCH(req: Request) {
  try {
    const body = await req.json()
    const { photoIds, folderId, isPublished } = body

    if (!Array.isArray(photoIds) || photoIds.length === 0) {
      return Response.json({ success: false, error: 'No photo IDs provided' }, { status: 400 })
    }

    const updates: Record<string, unknown> = {}
    if (typeof isPublished === 'boolean') {
      updates.is_published = isPublished
      updates.updated_at = new Date().toISOString()
    }
    if (folderId === null || folderId === 'null') {
      updates.folder_id = null
    } else if (folderId) {
      updates.folder_id = folderId
    }

    const { error } = await supabase
      .from('photos')
      .update(updates)
      .in('global_photo_id', photoIds)

    if (error) {
      return Response.json({ success: false, error: error.message }, { status: 500 })
    }

    return Response.json({ success: true })
  } catch {
    return Response.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  try {
    const body = await req.json()
    const { photoIds, fileIds, mode } = body as {
      photoIds?: string[]
      fileIds?: string[]
      mode?: DeleteMode
    }

    const deleteMode: DeleteMode = mode === 'all-versions' ? 'all-versions' : 'current-version'

    if (deleteMode === 'all-versions') {
      if (!Array.isArray(photoIds) || photoIds.length === 0) {
        return Response.json({ success: false, error: 'photoIds is required for all-versions delete' }, { status: 400 })
      }

      const { data: filesToDelete, error: filesToDeleteError } = await supabase
        .from('photo_files')
        .select('id, photo_id, branch_type, storage_provider, bucket_name, object_key')
        .in('photo_id', photoIds)

      if (filesToDeleteError) {
        return Response.json({ success: false, error: filesToDeleteError.message }, { status: 500 })
      }

      const { error: deleteFilesError } = await supabase
        .from('photo_files')
        .delete()
        .in('photo_id', photoIds)

      if (deleteFilesError) {
        return Response.json({ success: false, error: deleteFilesError.message }, { status: 500 })
      }

      const { error: deletePhotosError } = await supabase
        .from('photos')
        .delete()
        .in('global_photo_id', photoIds)

      if (deletePhotosError) {
        return Response.json({ success: false, error: deletePhotosError.message }, { status: 500 })
      }

      const cleanupErrors: string[] = []
      for (const file of (filesToDelete ?? []) as FileRow[]) {
        try {
          await deleteStoredAsset(file)
        } catch (err) {
          cleanupErrors.push(`${file.id}:${err instanceof Error ? err.message : String(err)}`)
        }
      }

      return Response.json({ success: true, deletedPhotoIds: photoIds, mode: deleteMode, cleanupErrors })
    }

    if (!Array.isArray(fileIds) || fileIds.length === 0) {
      return Response.json({ success: false, error: 'fileIds is required for current-version delete' }, { status: 400 })
    }

    const { data: files, error: filesError } = await supabase
      .from('photo_files')
      .select('id, photo_id, branch_type, storage_provider, bucket_name, object_key')
      .in('id', fileIds)

    if (filesError) {
      return Response.json({ success: false, error: filesError.message }, { status: 500 })
    }

    if (!files || files.length === 0) {
      return Response.json({ success: false, error: 'No matching files found' }, { status: 404 })
    }

    const photoIdsToRefresh = Array.from(new Set(files.map((f) => f.photo_id)))

    const { error: deleteFileError } = await supabase
      .from('photo_files')
      .delete()
      .in('id', fileIds)

    if (deleteFileError) {
      return Response.json({ success: false, error: deleteFileError.message }, { status: 500 })
    }

    const cleanupErrors: string[] = []
    for (const file of files as FileRow[]) {
      try {
        await deleteStoredAsset(file)
      } catch (err) {
        cleanupErrors.push(`${file.id}:${err instanceof Error ? err.message : String(err)}`)
      }
    }

    for (const photoId of photoIdsToRefresh) {
      const { data: remainingFiles, error: remainingError } = await supabase
        .from('photo_files')
        .select('id, branch_type, created_at')
        .eq('photo_id', photoId)
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
        .eq('global_photo_id', photoId)

      if (updatePhotoError) {
        return Response.json({ success: false, error: updatePhotoError.message }, { status: 500 })
      }
    }

    return Response.json({ success: true, deletedFileIds: fileIds, mode: deleteMode, cleanupErrors })
  } catch {
    return Response.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}
