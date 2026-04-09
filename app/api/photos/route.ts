import { DeleteObjectCommand } from '@aws-sdk/client-s3'
import { promises as fs } from 'node:fs'
import { supabase } from '@/lib/supabase/server'
import { r2 } from '@/lib/r2/client'
import { getLatestVersionNo, getVersionFiles, groupPhotoFilesByVersion, type PhotoFileRow } from '@/lib/photoVersions'
import { buildLegacyCopyFromPhotoFile, isPhotoFileCopyRow } from '@/lib/photoFileCopies'

type DeleteMode = 'current-version' | 'all-versions'

type FileRow = {
  id: string
  photo_id: string
  branch_type: string | null
  storage_provider: string | null
  bucket_name: string | null
  object_key: string | null
  created_at?: string | null
  file_copies?: Array<{
    id: string
    photo_file_id: string
    storage_provider: string
    bucket_name?: string | null
    storage_key: string
    status: string
    checksum_verified?: boolean | null
    size_bytes?: number | null
    size_verified?: boolean | null
    is_primary_read_source?: boolean | null
    last_verified_at?: string | null
    last_error?: string | null
    created_at?: string | null
    updated_at?: string | null
  }> | null
}

async function deleteStoredAsset(file: FileRow) {
  const copies = Array.isArray(file.file_copies) && file.file_copies.length > 0
    ? file.file_copies
    : [buildLegacyCopyFromPhotoFile(file)].filter(isPhotoFileCopyRow)

  for (const copy of copies) {
    if (copy.storage_provider === 'r2' && copy.bucket_name && copy.storage_key) {
      const base = (process.env.R2_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_PHOTO_PUBLIC_BASE_URL || '').replace(/\/+$/, '')
      const key = base && copy.storage_key.startsWith(base + '/')
        ? copy.storage_key.slice(base.length + 1)
        : copy.storage_key

      await r2.send(new DeleteObjectCommand({
        Bucket: copy.bucket_name,
        Key: key,
      }))
      continue
    }

    if (copy.storage_provider === 'local' && copy.storage_key) {
      await fs.rm(copy.storage_key, { force: true })
    }
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
    const { photoIds, versionNoByPhotoId, mode } = body as {
      photoIds?: string[]
      versionNoByPhotoId?: Record<string, number>
      mode?: DeleteMode
    }

    const deleteMode: DeleteMode = mode === 'all-versions' ? 'all-versions' : 'current-version'

    if (deleteMode === 'all-versions') {
      if (!Array.isArray(photoIds) || photoIds.length === 0) {
        return Response.json({ success: false, error: 'photoIds is required for all-versions delete' }, { status: 400 })
      }

      const { data: filesToDelete, error: filesToDeleteError } = await supabase
        .from('photo_files')
        .select('id, photo_id, branch_type, storage_provider, bucket_name, object_key, file_copies:photo_file_copies(id, photo_file_id, storage_provider, bucket_name, storage_key, status, checksum_verified, size_bytes, size_verified, is_primary_read_source, last_verified_at, last_error, created_at, updated_at)')
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

    if (!Array.isArray(photoIds) || photoIds.length === 0) {
      return Response.json({ success: false, error: 'photoIds is required for current-version delete' }, { status: 400 })
    }

    const { data: files, error: filesError } = await supabase
      .from('photo_files')
      .select('id, photo_id, branch_type, storage_provider, bucket_name, object_key, version_no, created_at, file_copies:photo_file_copies(id, photo_file_id, storage_provider, bucket_name, storage_key, status, checksum_verified, size_bytes, size_verified, is_primary_read_source, last_verified_at, last_error, created_at, updated_at)')
      .in('photo_id', photoIds)
      .order('version_no', { ascending: false })
      .order('created_at', { ascending: false })

    if (filesError) {
      return Response.json({ success: false, error: filesError.message }, { status: 500 })
    }

    const filesByPhotoId = new Map<string, PhotoFileRow[]>()
    for (const file of (files ?? []) as PhotoFileRow[]) {
      const list = filesByPhotoId.get(file.photo_id) ?? []
      list.push(file)
      filesByPhotoId.set(file.photo_id, list)
    }

    const deleteFileIds: string[] = []
    const deletedPhotoIds: string[] = []
    const deletedVersions: Array<{ photoId: string; versionNo: number }> = []
    const cleanupErrors: string[] = []

    for (const photoId of photoIds) {
      const rows = filesByPhotoId.get(photoId) ?? []
      if (rows.length === 0) continue

      const latestVersionNo = getLatestVersionNo(rows)
      const targetVersionNo = versionNoByPhotoId?.[photoId] ?? latestVersionNo
      if (!targetVersionNo) continue
      const versionBundle = getVersionFiles(rows, targetVersionNo)
      if (!versionBundle) continue

      const allVersions = groupPhotoFilesByVersion(rows)

      const { error: deleteVersionError } = await supabase
        .from('photo_files')
        .delete()
        .eq('photo_id', photoId)
        .eq('version_no', targetVersionNo)

      if (deleteVersionError) {
        return Response.json({ success: false, error: deleteVersionError.message }, { status: 500 })
      }

      for (const file of versionBundle.files as FileRow[]) {
        deleteFileIds.push(file.id)
        try {
          await deleteStoredAsset(file)
        } catch (err) {
          cleanupErrors.push(`${file.id}:${err instanceof Error ? err.message : String(err)}`)
        }
      }

      deletedVersions.push({ photoId, versionNo: targetVersionNo })

      if (allVersions.length <= 1) {
        const { error: deletePhotoError } = await supabase
          .from('photos')
          .delete()
          .eq('global_photo_id', photoId)

        if (deletePhotoError) {
          return Response.json({ success: false, error: deletePhotoError.message }, { status: 500 })
        }
        deletedPhotoIds.push(photoId)
      }
    }

    return Response.json({ success: true, deletedFileIds: deleteFileIds, deletedPhotoIds, deletedVersions, mode: deleteMode, cleanupErrors })
  } catch {
    return Response.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}
