import { supabase } from '@/lib/supabase/server'
import { runProjectFtpIngest } from '@/lib/ftpIngest'

export async function runFtpIngestSyncForEnabledProjects(origin: string) {
  const { data: projects, error } = await supabase
    .from('projects')
    .select('id, ftp_ingest')

  if (error) {
    throw new Error(error.message)
  }

  const results = [] as Array<{ projectId: string; success: boolean; error?: string; foundJobs?: number; importedSuccess?: number; failedCount?: number }>
  for (const project of projects ?? []) {
    const ftpIngest = (project.ftp_ingest ?? {}) as { enabled?: boolean; buffer_api_base_url?: string; project_code?: string; last_sync_at?: string | null }
    if (!ftpIngest.enabled) continue

    try {
      const summary = await runProjectFtpIngest({
        projectId: project.id,
        ftpIngest,
        uploadBaseUrl: origin,
        supabaseAdmin: supabase,
      })

      await supabase
        .from('projects')
        .update({ ftp_ingest: { ...ftpIngest, last_sync_at: new Date().toISOString() } })
        .eq('id', project.id)

      results.push({ projectId: project.id, success: true, foundJobs: summary.foundJobs, importedSuccess: summary.importedSuccess, failedCount: summary.failedCount })
    } catch (error) {
      results.push({ projectId: project.id, success: false, error: error instanceof Error ? error.message : String(error) })
    }
  }

  return results
}

export async function POST(req: Request) {
  try {
    const auth = req.headers.get('x-openclaw-internal-token') || ''
    const expected = process.env.FTP_INGEST_INTERNAL_TOKEN || ''
    if (!expected || auth !== expected) {
      return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const origin = new URL(req.url).origin
    const results = await runFtpIngestSyncForEnabledProjects(origin)
    return Response.json({ success: true, data: results })
  } catch (error) {
    return Response.json({ success: false, error: error instanceof Error ? error.message : 'Server error' }, { status: 500 })
  }
}
