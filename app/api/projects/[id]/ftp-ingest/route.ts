import { supabase } from '@/lib/supabase/server'
import { runProjectFtpIngest } from '@/lib/ftpIngest'
import { requireAdminApiAuth } from '@/lib/auth/session'

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(req: Request, context: RouteContext) {
  const auth = await requireAdminApiAuth()
  if (auth instanceof Response) return auth

  try {
    const { id } = await context.params
    const origin = new URL(req.url).origin

    const { data: projectRow, error } = await supabase
      .from('projects')
      .select('id, ftp_ingest')
      .eq('id', id)
      .maybeSingle()

    if (error) {
      return Response.json({ success: false, error: error.message }, { status: 500 })
    }

    if (!projectRow) {
      return Response.json({ success: false, error: 'Project not found' }, { status: 404 })
    }

    const ftpIngest = (projectRow.ftp_ingest ?? {}) as { enabled?: boolean; buffer_api_base_url?: string; project_code?: string; last_sync_at?: string | null }

    const summary = await runProjectFtpIngest({
      projectId: id,
      ftpIngest,
      uploadBaseUrl: origin,
      supabaseAdmin: supabase,
    })

    await supabase
      .from('projects')
      .update({ ftp_ingest: { ...ftpIngest, last_sync_at: new Date().toISOString() } })
      .eq('id', id)

    return Response.json({ success: true, data: summary })
  } catch (error) {
    return Response.json({ success: false, error: error instanceof Error ? error.message : 'Server error' }, { status: 500 })
  }
}
