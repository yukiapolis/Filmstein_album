import { requireAdminApiAuth } from '@/lib/auth/session'
import { getProjectPermissionContext } from '@/lib/auth/projectPermissions'
import { supabase } from '@/lib/supabase/server'

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApiAuth()
  if (auth instanceof Response) return auth

  try {
    const { id } = await context.params
    const sessionId = id?.trim()
    if (!sessionId) {
      return Response.json({ success: false, error: 'Missing sessionId' }, { status: 400 })
    }

    const { data: session, error: sessionError } = await supabase
      .from('upload_sessions')
      .select('id, project_id, file_name, status, processing_error, result_photo_id, result_original_file_id, result_thumb_file_id, result_display_file_id, result_client_preview_file_id, warnings, created_at, updated_at, completed_at')
      .eq('id', sessionId)
      .maybeSingle()

    if (sessionError) {
      return Response.json({ success: false, error: sessionError.message }, { status: 500 })
    }
    if (!session) {
      return Response.json({ success: false, error: 'Upload session not found' }, { status: 404 })
    }

    const permission = await getProjectPermissionContext(auth, String(session.project_id))
    if (!permission.exists) {
      return Response.json({ success: false, error: 'Project not found' }, { status: 404 })
    }
    if (!permission.canManageProject) {
      return Response.json({ success: false, error: 'Forbidden' }, { status: 403 })
    }

    return Response.json({ success: true, data: session })
  } catch (error) {
    console.error('[upload/direct/sessions] error:', error)
    return Response.json({ success: false, error: error instanceof Error ? error.message : 'Server error' }, { status: 500 })
  }
}
