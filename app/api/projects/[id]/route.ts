import { supabase } from '@/lib/supabase/server'
import { mapRowToProject } from '@/lib/mapProject'
import { mapRowToPhoto } from '@/lib/mapPhoto'
import { getFirstVersionFiles, getFirstVersionNo, getLatestVersionFiles, getLatestVersionNo, groupPhotoFilesByVersion, type PhotoFileRow } from '@/lib/photoVersions'
import { DeleteObjectCommand } from '@aws-sdk/client-s3'
import { r2 } from '@/lib/r2/client'
import fs from 'node:fs/promises'

type RouteContext = { params: Promise<{ id: string }> }

type FileRow = PhotoFileRow

export async function GET(req: Request, context: RouteContext) {
  try {
    const { id } = await context.params
    const url = new URL(req.url)
    const publishedOnly = url.searchParams.get('publishedOnly') === 'true'

    const { data: projectRow, error: projectError } = await supabase
      .from('projects')
      .select('*')
      .eq('id', id)
      .maybeSingle()

    if (projectError) {
      return Response.json(
        { success: false, error: projectError.message },
        { status: 500 },
      )
    }

    if (!projectRow) {
      return Response.json({ success: false, error: 'Not found' }, { status: 404 })
    }

    let photosQuery = supabase
      .from('photos')
      .select('global_photo_id, project_id, folder_id, original_file_id, retouched_file_id, color_label, status, updated_at, is_published')
      .eq('project_id', id)

    if (publishedOnly) {
      photosQuery = photosQuery.eq('is_published', true)
    }

    const { data: photoRows, error: photosError } = await photosQuery

    if (photosError) {
      return Response.json(
        { success: false, error: photosError.message },
        { status: 500 },
      )
    }

    const photoIds = (photoRows ?? []).map((row) => row.global_photo_id)

    let filesByPhotoId = new Map<string, FileRow[]>()
    if (photoIds.length > 0) {
      const { data: fileRows, error: filesError } = await supabase
        .from('photo_files')
        .select('id, photo_id, file_name, original_file_name, object_key, storage_provider, bucket_name, created_at, branch_type, version_no')
        .in('photo_id', photoIds)

      if (filesError) {
        return Response.json(
          { success: false, error: filesError.message },
          { status: 500 },
        )
      }

      for (const row of (fileRows ?? []) as FileRow[]) {
        const list = filesByPhotoId.get(row.photo_id) ?? []
        list.push(row)
        filesByPhotoId.set(row.photo_id, list)
      }
    }

    const project = mapRowToProject(projectRow as Record<string, unknown>)
    const photos = (photoRows ?? []).map((row) => {
      const fileRows = filesByPhotoId.get(row.global_photo_id) ?? []
      const latestVersion = getLatestVersionFiles(fileRows)
      const firstVersion = getFirstVersionFiles(fileRows)
      const versionCount = groupPhotoFilesByVersion(fileRows).length

      return mapRowToPhoto({
        ...(row as Record<string, unknown>),
        latest_original_file: latestVersion?.byBranch.original ?? null,
        latest_thumb_file: latestVersion?.byBranch.thumb ?? null,
        latest_display_file: latestVersion?.byBranch.display ?? null,
        first_original_file: firstVersion?.byBranch.original ?? null,
        version_count: versionCount,
        latest_version_no: getLatestVersionNo(fileRows),
        first_version_no: getFirstVersionNo(fileRows),
      })
    })
    project.photoCount = photos.length

    return Response.json({
      success: true,
      data: { project, photos },
    })
  } catch {
    return Response.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}

export async function PATCH(req: Request, context: RouteContext) {
  try {
    const { id } = await context.params
    const body = await req.json()

    const updates: Record<string, unknown> = {}
    if (typeof body.name === 'string' && body.name.trim()) updates.name = body.name.trim()
    if (typeof body.client_name === 'string') updates.client_name = body.client_name.trim()
    if (typeof body.type === 'string') updates.type = body.type
    if (typeof body.status === 'string') updates.status = body.status
    if (typeof body.description === 'string') updates.description = body.description.trim()
    if (typeof body.cover_url === 'string') updates.cover_url = body.cover_url.trim()
    if (body.ftp_ingest && typeof body.ftp_ingest === 'object') updates.ftp_ingest = body.ftp_ingest
    if (body.project_assets && typeof body.project_assets === 'object') updates.project_assets = body.project_assets
    if (body.visual_settings && typeof body.visual_settings === 'object') updates.visual_settings = body.visual_settings

    if (Object.keys(updates).length === 0) {
      return Response.json({ success: false, error: 'No fields to update' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('projects')
      .update(updates)
      .eq('id', id)
      .select()
      .maybeSingle()

    if (error) {
      return Response.json({ success: false, error: error.message }, { status: 500 })
    }

    if (!data) {
      return Response.json({ success: false, error: 'Not found' }, { status: 404 })
    }

    return Response.json({ success: true, data })
  } catch {
    return Response.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}

export async function DELETE(_req: Request, context: RouteContext) {
  try {
    const { id } = await context.params

    const { data: fileRows, error: fileError } = await supabase
      .from('photo_files')
      .select('id, object_key, storage_provider')
      .in('photo_id', (
        await supabase.from('photos').select('global_photo_id').eq('project_id', id)
      ).data?.map((row) => row.global_photo_id) ?? [])

    if (fileError) {
      return Response.json({ success: false, error: fileError.message }, { status: 500 })
    }

    for (const file of fileRows ?? []) {
      if (!file.object_key) continue
      if (file.storage_provider === 'r2' && process.env.R2_BUCKET_NAME) {
        try {
          await r2.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: file.object_key }))
        } catch {}
      } else if (file.storage_provider === 'local') {
        try {
          await fs.rm(file.object_key, { force: true })
        } catch {}
      }
    }

    const { data: projectRow } = await supabase
      .from('projects')
      .select('project_assets, cover_url')
      .eq('id', id)
      .maybeSingle()

    const projectAssets = (projectRow?.project_assets ?? {}) as Record<string, { url?: string }>
    const assetUrls = [projectRow?.cover_url, projectAssets.cover?.url, projectAssets.banner?.url, projectAssets.splash_poster?.url, projectAssets.loading_gif?.url, projectAssets.watermark_logo?.url].filter(Boolean) as string[]
    const publicBase = (process.env.R2_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_PHOTO_PUBLIC_BASE_URL || '').replace(/\/+$/, '')
    for (const url of assetUrls) {
      if (process.env.R2_BUCKET_NAME && publicBase && url.startsWith(`${publicBase}/`)) {
        const key = url.slice(publicBase.length + 1)
        try {
          await r2.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key }))
        } catch {}
      }
    }

    await supabase.from('photo_files').delete().in('photo_id', (
      await supabase.from('photos').select('global_photo_id').eq('project_id', id)
    ).data?.map((row) => row.global_photo_id) ?? [])
    await supabase.from('photos').delete().eq('project_id', id)
    await supabase.from('folders').delete().eq('project_id', id)
    await supabase.from('ftp_ingest_import_jobs').delete().eq('project_id', id)
    const { error: deleteProjectError } = await supabase.from('projects').delete().eq('id', id)

    if (deleteProjectError) {
      return Response.json({ success: false, error: deleteProjectError.message }, { status: 500 })
    }

    return Response.json({ success: true })
  } catch (error) {
    return Response.json({ success: false, error: error instanceof Error ? error.message : 'Server error' }, { status: 500 })
  }
}
