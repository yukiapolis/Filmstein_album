import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import sharp from 'sharp'

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

async function validateDownloadedImage(params: { tempPath: string; fileName: string; buffer: Buffer }) {
  const stat = await fs.stat(params.tempPath)
  if (!stat.isFile() || stat.size <= 0) {
    throw new Error('invalid image file: downloaded file missing or empty')
  }

  const ext = path.extname(params.fileName).toLowerCase()
  const allowedExt = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.tif', '.tiff'])
  if (ext && !allowedExt.has(ext)) {
    throw new Error(`invalid image file: unsupported extension ${ext}`)
  }

  let metadata: sharp.Metadata
  try {
    metadata = await sharp(params.buffer, { failOn: 'error' }).metadata()
  } catch {
    throw new Error('metadata read failed')
  }

  if (!metadata.format || !['jpeg', 'png', 'webp', 'gif', 'tiff'].includes(metadata.format)) {
    throw new Error('invalid image file: unsupported or unreadable image format')
  }

  if (!metadata.width || !metadata.height || metadata.width <= 0 || metadata.height <= 0) {
    throw new Error('invalid image file: missing image dimensions')
  }

  try {
    await sharp(params.buffer, { failOn: 'error' }).resize({ width: 64 }).toBuffer()
  } catch {
    throw new Error('thumb generation failed')
  }

  try {
    await sharp(params.buffer, { failOn: 'error' }).resize({ width: 1600, withoutEnlargement: true }).toBuffer()
  } catch {
    throw new Error('display generation failed')
  }
}

async function cleanupPartialUpload(params: {
  uploadBaseUrl: string
  projectId: string
  supabaseAdmin: { from: (table: string) => any }
  recentBeforeIso: string
  fileName: string
}) {
  const cleanupCandidates = await params.supabaseAdmin
    .from('photo_files')
    .select('id, photo_id, file_name, original_file_name, created_at')
    .gte('created_at', params.recentBeforeIso)
    .or(`file_name.eq.${params.fileName},original_file_name.eq.${params.fileName}`)

  const rows = Array.isArray(cleanupCandidates.data) ? cleanupCandidates.data : []
  const photoIds = Array.from(new Set(rows.map((row: any) => String(row.photo_id ?? '')).filter(Boolean)))

  for (const photoId of photoIds) {
    try {
      await fetch(`${params.uploadBaseUrl}/api/photos/${photoId}?mode=all-versions`, { method: 'DELETE' })
    } catch {
      // best-effort cleanup only
    }
  }
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
        .select('id, status, updated_at')
        .eq('project_id', params.projectId)
        .eq('buffer_job_id', jobId)
        .maybeSingle()

      if (existingImport.data?.id && existingImport.data?.status === 'imported') {
        summary.errors.push(`${jobId}: already imported`)
        continue
      }

      if (existingImport.data?.id && existingImport.data?.status === 'failed') {
        const failedAt = existingImport.data.updated_at ? new Date(existingImport.data.updated_at).getTime() : 0
        if (failedAt && Date.now() - failedAt < 60_000) {
          summary.errors.push(`${jobId}: failed recently, waiting before retry`)
          continue
        }
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
      const fileBuffer = Buffer.from(arrayBuffer)
      const fileName = String(job.file_name ?? job.filename ?? '')
      if (!fileName.trim()) {
        throw new Error('invalid image file: missing file name')
      }

      const tempPath = path.join(os.tmpdir(), `filmstein-ftp-${jobId}-${fileName.replace(/[^a-zA-Z0-9._-]+/g, '_')}`)
      await fs.writeFile(tempPath, fileBuffer)

      try {
        await validateDownloadedImage({ tempPath, fileName, buffer: fileBuffer })

        const beforeUploadIso = new Date().toISOString()
        const form = new FormData()
        form.append('projectId', params.projectId)
        form.append('file', new File([fileBuffer], fileName, { type: String(job.content_type ?? 'application/octet-stream') }))

        const uploadRes = await fetch(`${params.uploadBaseUrl}/api/upload`, {
          method: 'POST',
          body: form,
        })
        const uploadBody = await uploadRes.json().catch(() => null)

        if (!uploadRes.ok || uploadBody?.success !== true) {
          await cleanupPartialUpload({
            uploadBaseUrl: params.uploadBaseUrl,
            projectId: params.projectId,
            supabaseAdmin: params.supabaseAdmin,
            recentBeforeIso: beforeUploadIso,
            fileName,
          })
          await postJson(`${baseUrl}/api/ingest/jobs/${encodeURIComponent(jobId)}/fail`, { error: uploadBody?.error || `upload failed (${uploadRes.status})` })
          await params.supabaseAdmin.from('ftp_ingest_import_jobs').update({ status: 'failed', updated_at: new Date().toISOString() }).eq('project_id', params.projectId).eq('buffer_job_id', jobId)
          summary.failedCount++
          summary.errors.push(`${jobId}: ${uploadBody?.error || 'upload failed'}`)
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
