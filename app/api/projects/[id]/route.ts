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
