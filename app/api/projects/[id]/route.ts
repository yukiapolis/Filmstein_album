import { supabase } from '@/lib/supabase/server'
import { mapRowToProject } from '@/lib/mapProject'
import { mapRowToPhoto } from '@/lib/mapPhoto'

type RouteContext = { params: Promise<{ id: string }> }

type FileRow = {
  id: string
  photo_id: string
  file_name: string | null
  original_file_name: string | null
  object_key: string | null
  storage_provider: string | null
  bucket_name: string | null
  created_at: string | null
  branch_type: string | null
}

const BRANCH_TYPE_ORIGINAL = 'original'
const BRANCH_TYPE_THUMB = 'thumb'
const BRANCH_TYPE_DISPLAY = 'display'

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
        .select('id, photo_id, file_name, original_file_name, object_key, storage_provider, bucket_name, created_at, branch_type')
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
      const originalFile = fileRows.find((f) => f.branch_type === BRANCH_TYPE_ORIGINAL) ?? null
      const thumbFile = fileRows.find((f) => f.branch_type === BRANCH_TYPE_THUMB) ?? null
      const displayFile = fileRows.find((f) => f.branch_type === BRANCH_TYPE_DISPLAY) ?? null

      return mapRowToPhoto({
        ...(row as Record<string, unknown>),
        original_file: originalFile,
        thumb_file: thumbFile,
        display_file: displayFile,
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
