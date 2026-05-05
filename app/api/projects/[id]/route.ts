import { supabase } from '@/lib/supabase/server'
import { mapRowToProject } from '@/lib/mapProject'
import { mapRowToPhoto } from '@/lib/mapPhoto'
import { getFirstVersionFiles, getFirstVersionNo, getLatestVersionFiles, getLatestVersionNo, groupPhotoFilesByVersion, type PhotoFileRow } from '@/lib/photoVersions'
import { DeleteObjectCommand } from '@aws-sdk/client-s3'
import { r2 } from '@/lib/r2/client'
import fs from 'node:fs/promises'
import { buildLegacyCopyFromPhotoFile } from '@/lib/photoFileCopies'
import { getWatermarkVersionSignature } from '@/lib/clientWatermark'

type RouteContext = { params: Promise<{ id: string }> }

type FileRow = PhotoFileRow

export async function GET(req: Request, context: RouteContext) {
  try {
    const { id } = await context.params
    const url = new URL(req.url)
    const publishedOnly = url.searchParams.get('publishedOnly') === 'true'
    const viewerSessionId = url.searchParams.get('viewerSessionId')?.trim() || null

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

    const filesByPhotoId = new Map<string, FileRow[]>()
    if (photoIds.length > 0) {
      const { data: fileRows, error: filesError } = await supabase
        .from('photo_files')
        .select('id, photo_id, file_name, original_file_name, object_key, storage_provider, bucket_name, created_at, branch_type, version_no, file_size_bytes, checksum_sha256, processing_meta, file_copies:photo_file_copies(id, photo_file_id, storage_provider, bucket_name, storage_key, status, checksum_verified, size_bytes, size_verified, is_primary_read_source, last_verified_at, last_error, created_at, updated_at)')
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
    const watermarkVersionSignature = getWatermarkVersionSignature(project)

    const adminColorTagsByPhotoId = new Map<string, string[]>()
    const clientMarkCounts = new Map<string, number>()
    const clientMarkDetailsByPhotoId = new Map<string, Array<{ viewer_session_id: string; created_at: string; label: string }>>()
    const clientMarkedPhotoIds = new Set<string>()

    if (photoIds.length > 0) {
      const [adminTagsResult, clientMarksResult, viewerMarksResult] = await Promise.all([
        supabase
          .from('photo_admin_color_tags')
          .select('photo_id, color')
          .eq('project_id', id)
          .in('photo_id', photoIds),
        supabase
          .from('photo_client_marks')
          .select('photo_id, viewer_session_id, created_at')
          .eq('project_id', id)
          .in('photo_id', photoIds),
        viewerSessionId
          ? supabase
              .from('photo_client_marks')
              .select('photo_id')
              .eq('project_id', id)
              .eq('viewer_session_id', viewerSessionId)
              .in('photo_id', photoIds)
          : Promise.resolve({ data: [], error: null }),
      ])

      if (adminTagsResult.error) {
        return Response.json({ success: false, error: adminTagsResult.error.message }, { status: 500 })
      }
      if (clientMarksResult.error) {
        return Response.json({ success: false, error: clientMarksResult.error.message }, { status: 500 })
      }
      if (viewerMarksResult.error) {
        return Response.json({ success: false, error: viewerMarksResult.error.message }, { status: 500 })
      }

      for (const row of adminTagsResult.data ?? []) {
        const list = adminColorTagsByPhotoId.get(row.photo_id) ?? []
        if (typeof row.color === 'string') list.push(row.color)
        adminColorTagsByPhotoId.set(row.photo_id, list)
      }

      for (const row of clientMarksResult.data ?? []) {
        clientMarkCounts.set(row.photo_id, (clientMarkCounts.get(row.photo_id) ?? 0) + 1)
        const list = clientMarkDetailsByPhotoId.get(row.photo_id) ?? []
        const viewerSessionId = typeof row.viewer_session_id === 'string' ? row.viewer_session_id : ''
        const shortId = viewerSessionId ? viewerSessionId.slice(0, 8) : 'unknown'
        list.push({
          viewer_session_id: viewerSessionId,
          created_at: typeof row.created_at === 'string' ? row.created_at : '',
          label: `viewer:${shortId}`,
        })
        clientMarkDetailsByPhotoId.set(row.photo_id, list)
      }

      for (const row of viewerMarksResult.data ?? []) {
        clientMarkedPhotoIds.add(row.photo_id)
      }
    }

    const photos = (photoRows ?? []).map((row) => {
      const fileRows = filesByPhotoId.get(row.global_photo_id) ?? []
      const latestVersion = getLatestVersionFiles(fileRows)
      const firstVersion = getFirstVersionFiles(fileRows)
      const versionCount = groupPhotoFilesByVersion(fileRows).length

      return mapRowToPhoto({
        ...(row as Record<string, unknown>),
        admin_color_tags: adminColorTagsByPhotoId.get(row.global_photo_id) ?? [],
        client_mark_count: clientMarkCounts.get(row.global_photo_id) ?? 0,
        client_mark_details: clientMarkDetailsByPhotoId.get(row.global_photo_id) ?? [],
        client_marked: clientMarkedPhotoIds.has(row.global_photo_id),
        latest_original_file: latestVersion?.byBranch.original ?? null,
        latest_thumb_file: latestVersion?.byBranch.thumb ?? null,
        latest_display_file: latestVersion?.byBranch.display ?? null,
        latest_client_preview_file: latestVersion?.byBranch.client_preview ?? null,
        first_original_file: firstVersion?.byBranch.original ?? null,
        project_watermark_signature: watermarkVersionSignature,
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
      .select('id, object_key, storage_provider, bucket_name, file_copies:photo_file_copies(id, photo_file_id, storage_provider, bucket_name, storage_key, status, checksum_verified, size_bytes, size_verified, is_primary_read_source, last_verified_at, last_error, created_at, updated_at)')
      .in('photo_id', (
        await supabase.from('photos').select('global_photo_id').eq('project_id', id)
      ).data?.map((row) => row.global_photo_id) ?? [])

    if (fileError) {
      return Response.json({ success: false, error: fileError.message }, { status: 500 })
    }

    for (const file of fileRows ?? []) {
      const copies = Array.isArray(file.file_copies) && file.file_copies.length > 0
        ? file.file_copies
        : [buildLegacyCopyFromPhotoFile(file)].filter(Boolean)
      for (const copy of copies) {
        if (!copy?.storage_key) continue
        if (copy.storage_provider === 'r2' && copy.bucket_name) {
          const base = (process.env.R2_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_PHOTO_PUBLIC_BASE_URL || '').replace(/\/+$/, '')
          const key = base && copy.storage_key.startsWith(base + '/') ? copy.storage_key.slice(base.length + 1) : copy.storage_key
          try {
            await r2.send(new DeleteObjectCommand({ Bucket: copy.bucket_name, Key: key }))
          } catch {}
        } else if (copy.storage_provider === 'local') {
          try {
            await fs.rm(copy.storage_key, { force: true })
          } catch {}
        }
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
