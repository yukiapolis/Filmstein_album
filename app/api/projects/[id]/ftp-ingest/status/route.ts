import { supabase } from '@/lib/supabase/server'

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_req: Request, context: RouteContext) {
  try {
    const { id } = await context.params

    const { data: projectRow, error } = await supabase
      .from('projects')
      .select('id, ftp_ingest')
      .eq('id', id)
      .maybeSingle()

    if (error) return Response.json({ success: false, error: error.message }, { status: 500 })
    if (!projectRow) return Response.json({ success: false, error: 'Project not found' }, { status: 404 })

    const ftpIngest = (projectRow.ftp_ingest ?? {}) as { enabled?: boolean; buffer_api_base_url?: string; project_code?: string; last_sync_at?: string | null }
    if (!ftpIngest.enabled || !ftpIngest.buffer_api_base_url || !ftpIngest.project_code) {
      return Response.json({
        success: true,
        data: {
          pendingJobs: 0,
          inProgressJobs: 0,
          importedJobs: 0,
          failedJobs: 0,
          lastSyncTime: ftpIngest.last_sync_at ?? null,
          requestUrl: null,
          error: 'FTP ingest not fully configured',
        },
      })
    }

    const requestUrl = `${ftpIngest.buffer_api_base_url.replace(/\/+$/, '')}/api/ingest/jobs?status=stable&project=${encodeURIComponent(ftpIngest.project_code)}`
    let jobsRes: Response
    try {
      jobsRes = await fetch(requestUrl)
    } catch (error) {
      return Response.json({
        success: true,
        data: {
          pendingJobs: 0,
          inProgressJobs: 0,
          importedJobs: 0,
          failedJobs: 0,
          lastSyncTime: ftpIngest.last_sync_at ?? null,
          requestUrl,
          error: `Failed to reach buffer API: ${error instanceof Error ? error.message : String(error)}`,
        },
      })
    }
    const jobsBody = await jobsRes.json().catch(() => null)
    const jobs = Array.isArray(jobsBody?.items)
      ? jobsBody.items
      : Array.isArray(jobsBody?.data?.items)
        ? jobsBody.data.items
        : Array.isArray(jobsBody?.jobs)
          ? jobsBody.jobs
          : Array.isArray(jobsBody?.data?.jobs)
            ? jobsBody.data.jobs
            : Array.isArray(jobsBody?.data)
              ? jobsBody.data
              : []

    const { data: importRows, error: importError } = await supabase
      .from('ftp_ingest_import_jobs')
      .select('status, updated_at')
      .eq('project_id', id)

    if (importError) return Response.json({ success: false, error: importError.message }, { status: 500 })

    const importedJobs = (importRows ?? []).filter((row) => row.status === 'imported').length
    const failedJobs = (importRows ?? []).filter((row) => row.status === 'failed' || row.status === 'confirm_failed').length
    const inProgressJobs = (importRows ?? []).filter((row) => row.status === 'claimed').length
    const lastSyncTime = (importRows ?? []).map((row) => row.updated_at).filter(Boolean).sort().slice(-1)[0] ?? null

    return Response.json({
      success: true,
      data: {
        pendingJobs: jobs.length,
        inProgressJobs,
        importedJobs,
        failedJobs,
        lastSyncTime: ftpIngest.last_sync_at ?? lastSyncTime,
        requestUrl,
        error: jobsRes.ok
          ? (Array.isArray(jobs) ? null : 'Invalid buffer API response')
          : jobsBody?.error || `Status endpoint error: failed to load pending jobs (${jobsRes.status})`,
      },
    })
  } catch (error) {
    return Response.json({ success: false, error: error instanceof Error ? error.message : 'Server error' }, { status: 500 })
  }
}
