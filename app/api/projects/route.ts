import { supabase } from '../../../src/lib/supabase/client'
import { mapRowToProject } from '@/lib/mapProject'

function sumProjectStorageUsedBytes(fileRows: Array<{ file_size_bytes?: unknown }>) {
  return fileRows.reduce((total, row) => total + (typeof row.file_size_bytes === 'number' ? row.file_size_bytes : 0), 0)
}

const PROJECT_TYPES = new Set(['Wedding', 'Event', 'Campaign'])

export async function GET() {
  try {
    const { data, error } = await supabase
      .from('projects')
      .select('id, name, client_name, description, type, status, cover_url, ftp_ingest, project_assets, visual_settings, created_at')
      .order('created_at', { ascending: false })

    if (error) {
      return Response.json(
        { success: false, error: error.message },
        { status: 500 }
      )
    }

    const projectsWithStats = await Promise.all((data ?? []).map(async (row) => {
      const projectId = String(row.id ?? '')

      const { count: photoCount, error: photoError } = await supabase
        .from('photos')
        .select('global_photo_id', { count: 'exact', head: true })
        .eq('project_id', projectId)

      if (photoError) throw new Error(photoError.message)

      const { data: photoRowsForFiles, error: photoRowsError } = await supabase
        .from('photos')
        .select('global_photo_id')
        .eq('project_id', projectId)

      if (photoRowsError) throw new Error(photoRowsError.message)

      const photoIds = (photoRowsForFiles ?? [])
        .map((photo) => String(photo.global_photo_id ?? ''))
        .filter(Boolean)

      let fileRows: Array<{ file_size_bytes?: unknown }> = []
      if (photoIds.length > 0) {
        const fileRes = await supabase
          .from('photo_files')
          .select('file_size_bytes')
          .in('photo_id', photoIds)

        if (fileRes.error) {
          fileRows = []
        } else {
          fileRows = (fileRes.data ?? []) as Array<{ file_size_bytes?: unknown }>
        }
      }

      return mapRowToProject({
        ...(row as Record<string, unknown>),
        photo_count: photoCount ?? 0,
        storage_used_bytes: sumProjectStorageUsedBytes(fileRows),
      })
    }))

    return Response.json({
      success: true,
      data: projectsWithStats,
    })
  } catch (error) {
    return Response.json({ success: false, error: error instanceof Error ? error.message : 'Server error' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json()

    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const clientName = typeof body.clientName === 'string' ? body.clientName.trim() : ''
    const type = typeof body.type === 'string' && PROJECT_TYPES.has(body.type)
      ? body.type
      : 'Campaign'

    if (!name) {
      return Response.json({ success: false, error: 'Project name is required' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('projects')
      .insert([
        {
          name,
          client_name: clientName,
          type,
        },
      ])
      .select()

    if (error) {
      return Response.json(
        { success: false, error: error.message },
        { status: 500 }
      )
    }

    const project = data && data[0]
      ? mapRowToProject(data[0] as Record<string, unknown>)
      : null
    return Response.json({ success: true, data: project })
  } catch {
    return Response.json(
      { success: false, error: 'Server error' },
      { status: 500 }
    )
  }
}
