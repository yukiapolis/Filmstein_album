import { supabase } from '@/lib/supabase/server'

type RouteContext = { params: Promise<{ id: string }> }

async function loadMarkDetails(projectId: string, photoId: string) {
  const { data, error } = await supabase
    .from('photo_client_marks')
    .select('viewer_session_id, created_at')
    .eq('project_id', projectId)
    .eq('photo_id', photoId)
    .order('created_at', { ascending: true })

  if (error) throw error

  return (data ?? [])
    .map((row) => {
      const viewerSessionId = typeof row.viewer_session_id === 'string' ? row.viewer_session_id : ''
      const shortId = viewerSessionId ? viewerSessionId.slice(0, 8) : 'unknown'
      return {
        viewerSessionId,
        createdAt: typeof row.created_at === 'string' ? row.created_at : undefined,
        label: `viewer:${shortId}`,
      }
    })
    .filter((row) => row.viewerSessionId)
}

export async function POST(req: Request, context: RouteContext) {
  try {
    const { id: photoId } = await context.params
    const body = await req.json()
    const projectId = typeof body?.projectId === 'string' ? body.projectId.trim() : ''
    const viewerSessionId = typeof body?.viewerSessionId === 'string' ? body.viewerSessionId.trim() : ''

    if (!projectId || !viewerSessionId) {
      return Response.json({ success: false, error: 'projectId and viewerSessionId are required' }, { status: 400 })
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
      .from('photo_client_marks')
      .select('id')
      .eq('project_id', projectId)
      .eq('photo_id', photoId)
      .eq('viewer_session_id', viewerSessionId)
      .maybeSingle()

    if (existingError) {
      return Response.json({ success: false, error: existingError.message }, { status: 500 })
    }

    let marked = false
    if (existing?.id) {
      const { error: deleteError } = await supabase
        .from('photo_client_marks')
        .delete()
        .eq('id', existing.id)

      if (deleteError) {
        return Response.json({ success: false, error: deleteError.message }, { status: 500 })
      }
    } else {
      const { error: insertError } = await supabase
        .from('photo_client_marks')
        .insert({
          project_id: projectId,
          photo_id: photoId,
          viewer_session_id: viewerSessionId,
        })

      if (insertError) {
        return Response.json({ success: false, error: insertError.message }, { status: 500 })
      }
      marked = true
    }

    const { count, error: countError } = await supabase
      .from('photo_client_marks')
      .select('*', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .eq('photo_id', photoId)

    if (countError) {
      return Response.json({ success: false, error: countError.message }, { status: 500 })
    }

    const clientMarkDetails = await loadMarkDetails(projectId, photoId)

    return Response.json({
      success: true,
      data: {
        photoId,
        marked,
        clientMarkCount: count ?? 0,
        hasClientMarks: (count ?? 0) > 0,
        clientMarkDetails,
      },
    })
  } catch {
    return Response.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}

export async function DELETE(req: Request, context: RouteContext) {
  try {
    const { id: photoId } = await context.params
    const body = await req.json()
    const projectId = typeof body?.projectId === 'string' ? body.projectId.trim() : ''
    const viewerSessionId = typeof body?.viewerSessionId === 'string' ? body.viewerSessionId.trim() : ''

    if (!projectId || !viewerSessionId) {
      return Response.json({ success: false, error: 'projectId and viewerSessionId are required' }, { status: 400 })
    }

    const { error: deleteError } = await supabase
      .from('photo_client_marks')
      .delete()
      .eq('project_id', projectId)
      .eq('photo_id', photoId)
      .eq('viewer_session_id', viewerSessionId)

    if (deleteError) {
      return Response.json({ success: false, error: deleteError.message }, { status: 500 })
    }

    const { count, error: countError } = await supabase
      .from('photo_client_marks')
      .select('*', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .eq('photo_id', photoId)

    if (countError) {
      return Response.json({ success: false, error: countError.message }, { status: 500 })
    }

    const clientMarkDetails = await loadMarkDetails(projectId, photoId)

    return Response.json({
      success: true,
      data: {
        photoId,
        viewerSessionId,
        clientMarkCount: count ?? 0,
        hasClientMarks: (count ?? 0) > 0,
        clientMarkDetails,
      },
    })
  } catch {
    return Response.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}
