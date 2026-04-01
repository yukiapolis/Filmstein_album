import { supabase } from '../../../../src/lib/supabase/client'
import { mapRowToProject } from '@/lib/mapProject'
import { mapRowToPhoto } from '@/lib/mapPhoto'

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_req: Request, context: RouteContext) {
  try {
    const { id } = await context.params

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

    const { data: photoRows, error: photosError } = await supabase
      .from('photos')
      .select('*')
      .eq('project_id', id)

    if (photosError) {
      return Response.json(
        { success: false, error: photosError.message },
        { status: 500 },
      )
    }

    const project = mapRowToProject(projectRow as Record<string, unknown>)
    const photos = (photoRows ?? []).map((row) =>
      mapRowToPhoto(row as Record<string, unknown>),
    )
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
