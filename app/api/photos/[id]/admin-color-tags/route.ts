import { supabase } from '@/lib/supabase/server'

const ALLOWED_COLORS = new Set(['red', 'green', 'blue', 'yellow', 'purple'])

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(req: Request, context: RouteContext) {
  try {
    const { id: photoId } = await context.params
    const body = await req.json()
    const projectId = typeof body?.projectId === 'string' ? body.projectId.trim() : ''
    const color = typeof body?.color === 'string' ? body.color.trim() : ''

    if (!projectId || !ALLOWED_COLORS.has(color)) {
      return Response.json({ success: false, error: 'projectId and valid color are required' }, { status: 400 })
    }

    const { data: photoRow, error: photoError } = await supabase
      .from('photos')
      .select('global_photo_id, project_id')
      .eq('global_photo_id', photoId)
      .eq('project_id', projectId)
      .maybeSingle()

    if (photoError) {
      return Response.json({ success: false, error: photoError.message }, { status: 500 })
    }

    if (!photoRow) {
      return Response.json({ success: false, error: 'Photo not found' }, { status: 404 })
    }

    const { data: existing, error: existingError } = await supabase
      .from('photo_admin_color_tags')
      .select('id')
      .eq('project_id', projectId)
      .eq('photo_id', photoId)
      .eq('color', color)
      .maybeSingle()

    if (existingError) {
      return Response.json({ success: false, error: existingError.message }, { status: 500 })
    }

    if (existing?.id) {
      const { error: deleteError } = await supabase
        .from('photo_admin_color_tags')
        .delete()
        .eq('id', existing.id)

      if (deleteError) {
        return Response.json({ success: false, error: deleteError.message }, { status: 500 })
      }
    } else {
      const { error: insertError } = await supabase
        .from('photo_admin_color_tags')
        .insert({
          project_id: projectId,
          photo_id: photoId,
          color,
        })

      if (insertError) {
        return Response.json({ success: false, error: insertError.message }, { status: 500 })
      }
    }

    const { data: tags, error: tagsError } = await supabase
      .from('photo_admin_color_tags')
      .select('color')
      .eq('project_id', projectId)
      .eq('photo_id', photoId)
      .order('created_at', { ascending: true })

    if (tagsError) {
      return Response.json({ success: false, error: tagsError.message }, { status: 500 })
    }

    return Response.json({
      success: true,
      data: {
        photoId,
        adminColorTags: (tags ?? []).map((tag) => tag.color).filter((value): value is string => typeof value === 'string'),
      },
    })
  } catch {
    return Response.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}
