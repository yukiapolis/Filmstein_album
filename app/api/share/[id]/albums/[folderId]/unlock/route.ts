import { NextRequest } from 'next/server'
import { supabase } from '@/lib/supabase/server'
import { buildFolderShareAccessCookie, extractFolderShareAccessConfig, extractProjectShareAccessConfig, isProjectShareAccessGranted, verifySharePassword } from '@/lib/shareAccess'

type RouteContext = { params: Promise<{ id: string; folderId: string }> }

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id: projectId, folderId } = await context.params
    const body = await request.json().catch(() => ({}))
    const password = typeof body?.password === 'string' ? body.password : ''

    const [{ data: projectRow, error: projectError }, { data: folderRow, error: folderError }] = await Promise.all([
      supabase
        .from('projects')
        .select('id, visual_settings')
        .eq('id', projectId)
        .maybeSingle(),
      supabase
        .from('project_folders')
        .select('id, project_id, access_mode, password_hash')
        .eq('id', folderId)
        .eq('project_id', projectId)
        .maybeSingle(),
    ])

    if (projectError) {
      return Response.json({ success: false, error: projectError.message }, { status: 500 })
    }
    if (folderError) {
      return Response.json({ success: false, error: folderError.message }, { status: 500 })
    }
    if (!projectRow || !folderRow) {
      return Response.json({ success: false, error: 'Not found' }, { status: 404 })
    }

    const projectShareAccess = extractProjectShareAccessConfig(projectRow.visual_settings)
    if (projectShareAccess.enabled === true && projectShareAccess.password_hash && !isProjectShareAccessGranted(request, projectId, projectShareAccess.password_hash)) {
      return Response.json({ success: false, error: 'Project password is required first' }, { status: 403 })
    }

    const folderAccess = extractFolderShareAccessConfig(folderRow)
    if (folderAccess.access_mode !== 'password_protected' || !folderAccess.password_hash) {
      return Response.json({ success: true, data: { unlocked: true } })
    }

    if (!password.trim()) {
      return Response.json({ success: false, error: 'Password is required' }, { status: 400 })
    }

    if (!verifySharePassword(password, folderAccess.password_hash)) {
      return Response.json({ success: false, error: 'Incorrect password' }, { status: 403 })
    }

    return new Response(JSON.stringify({ success: true, data: { unlocked: true } }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': buildFolderShareAccessCookie(projectId, folderId, folderAccess.password_hash),
      },
    })
  } catch {
    return Response.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}
