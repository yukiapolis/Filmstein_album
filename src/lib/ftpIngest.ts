import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'

export type FtpIngestConfig = {
  enabled?: boolean
  buffer_api_base_url?: string
  project_code?: string
}

export type FtpIngestSummary = {
  foundJobs: number
  importedSuccess: number
  failedCount: number
  confirmFailedCount: number
  errors: string[]
  requestUrl: string
  rawJobsResponse: unknown
}

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  let json: any = null
  try { json = text ? JSON.parse(text) : null } catch {}
  return { res, json, text }
}

export async function runProjectFtpIngest(params: {
  projectId: string
  ftpIngest: FtpIngestConfig
  uploadBaseUrl: string
  supabaseAdmin: { from: (table: string) => any }
}) : Promise<FtpIngestSummary> {
  const config = params.ftpIngest
  if (!config.enabled) throw new Error('FTP ingest is not enabled')
  if (!config.buffer_api_base_url?.trim()) throw new Error('Missing buffer API base URL')
  if (!config.project_code?.trim()) throw new Error('Missing project code')

  const baseUrl = config.buffer_api_base_url.replace(/\/+$/, '')
  const projectCode = config.project_code.trim()
  const requestUrl = `${baseUrl}/api/ingest/jobs?status=stable&project=${encodeURIComponent(projectCode)}`
  const jobsRes = await fetch(requestUrl)
  const jobsBody = await jobsRes.json().catch(() => null)
  if (!jobsRes.ok) throw new Error(jobsBody?.error || `Failed to list buffer jobs (${jobsRes.status})`)

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
  const summary: FtpIngestSummary = {
    foundJobs: jobs.length,
    importedSuccess: 0,
    failedCount: 0,
    confirmFailedCount: 0,
    errors: [],
    requestUrl,
    rawJobsResponse: jobsBody,
  }

  for (const job of jobs) {
    const jobId = String(job.id ?? job.job_id ?? '')
    if (!jobId) {
      summary.failedCount++
      summary.errors.push('Encountered buffer job without id')
      continue
    }

    try {
      const existingImport = await params.supabaseAdmin
        .from('ftp_ingest_import_jobs')
        .select('id, status')
        .eq('project_id', params.projectId)
        .eq('buffer_job_id', jobId)
        .maybeSingle()

      if (existingImport.data?.id && existingImport.data?.status === 'imported') {
        summary.errors.push(`${jobId}: already imported`)
        continue
      }

      if (existingImport.data?.id) {
        await params.supabaseAdmin
          .from('ftp_ingest_import_jobs')
          .update({ status: 'claimed', updated_at: new Date().toISOString() })
          .eq('id', existingImport.data.id)
      } else {
        await params.supabaseAdmin
          .from('ftp_ingest_import_jobs')
          .insert([{ project_id: params.projectId, buffer_job_id: jobId, status: 'claimed' }])
      }

      const claim = await postJson(`${baseUrl}/api/ingest/jobs/${encodeURIComponent(jobId)}/claim`, {})
      if (!claim.res.ok) throw new Error(claim.json?.error || `claim failed (${claim.res.status})`)

      const fileRes = await fetch(`${baseUrl}/api/ingest/jobs/${encodeURIComponent(jobId)}/file`)
      if (!fileRes.ok) {
        await postJson(`${baseUrl}/api/ingest/jobs/${encodeURIComponent(jobId)}/fail`, { error: `download failed (${fileRes.status})` })
        await params.supabaseAdmin.from('ftp_ingest_import_jobs').update({ status: 'failed', updated_at: new Date().toISOString() }).eq('project_id', params.projectId).eq('buffer_job_id', jobId)
        summary.failedCount++
        summary.errors.push(`${jobId}: download failed`)
        continue
      }

      const arrayBuffer = await fileRes.arrayBuffer()
      const fileName = String(job.file_name ?? job.filename ?? `${jobId}.bin`)
      const tempPath = path.join(os.tmpdir(), `filmstein-ftp-${jobId}-${fileName.replace(/[^a-zA-Z0-9._-]+/g, '_')}`)
      await fs.writeFile(tempPath, Buffer.from(arrayBuffer))

      try {
        const form = new FormData()
        form.append('projectId', params.projectId)
        form.append('file', new File([Buffer.from(arrayBuffer)], fileName, { type: String(job.content_type ?? 'application/octet-stream') }))

        const uploadRes = await fetch(`${params.uploadBaseUrl}/api/upload`, {
          method: 'POST',
          body: form,
        })
        const uploadBody = await uploadRes.json().catch(() => null)

        if (!uploadRes.ok || uploadBody?.success !== true) {
          await postJson(`${baseUrl}/api/ingest/jobs/${encodeURIComponent(jobId)}/fail`, { error: uploadBody?.error || `upload failed (${uploadRes.status})` })
          await params.supabaseAdmin.from('ftp_ingest_import_jobs').update({ status: 'failed', updated_at: new Date().toISOString() }).eq('project_id', params.projectId).eq('buffer_job_id', jobId)
          summary.failedCount++
          summary.errors.push(`${jobId}: upload failed`)
          continue
        }

        const confirm = await postJson(`${baseUrl}/api/ingest/jobs/${encodeURIComponent(jobId)}/confirm`, {})
        if (!confirm.res.ok) {
          await params.supabaseAdmin.from('ftp_ingest_import_jobs').update({ status: 'confirm_failed', updated_at: new Date().toISOString() }).eq('project_id', params.projectId).eq('buffer_job_id', jobId)
          summary.confirmFailedCount++
          summary.errors.push(`${jobId}: imported but confirm failed`)
        } else {
          await params.supabaseAdmin.from('ftp_ingest_import_jobs').update({ status: 'imported', updated_at: new Date().toISOString() }).eq('project_id', params.projectId).eq('buffer_job_id', jobId)
          summary.importedSuccess++
        }
      } finally {
        await fs.rm(tempPath, { force: true })
      }
    } catch (error) {
      try {
        await postJson(`${baseUrl}/api/ingest/jobs/${encodeURIComponent(jobId)}/fail`, { error: error instanceof Error ? error.message : String(error) })
      } catch {}
      await params.supabaseAdmin.from('ftp_ingest_import_jobs').update({ status: 'failed', updated_at: new Date().toISOString() }).eq('project_id', params.projectId).eq('buffer_job_id', jobId)
      summary.failedCount++
      summary.errors.push(`${jobId}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return summary
}
