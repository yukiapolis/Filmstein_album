import { supabase } from '@/lib/supabase/server'
import { runProjectFtpIngest } from '@/lib/ftpIngest'

const SCHEDULER_TICK_MS = 5_000
const projectLastRunAt = new Map<string, number>()
let schedulerStarted = false
let timer: NodeJS.Timeout | null = null
let syncRoundRunning = false

async function runFtpIngestSyncForEnabledProjectsOnce(origin: string) {
  console.log('[ftp-ingest:auto] tick start')
  const { data: projects, error } = await supabase
    .from('projects')
    .select('id, ftp_ingest')

  if (error) {
    console.error('[ftp-ingest:auto] failed to load projects:', error.message)
    return
  }

  const enabledProjects = (projects ?? []).filter((project) => (project.ftp_ingest as { enabled?: boolean } | null)?.enabled === true)
  console.log(`[ftp-ingest:auto] scanning ${enabledProjects.length} enabled project(s)`)

  for (const project of enabledProjects) {
    const ftpIngest = (project.ftp_ingest ?? {}) as { enabled?: boolean; buffer_api_base_url?: string; project_code?: string; last_sync_at?: string | null; auto_sync_interval_seconds?: number }
    const intervalSeconds = Math.max(1, Number(ftpIngest.auto_sync_interval_seconds) || 15)
    const lastRunAt = projectLastRunAt.get(project.id) ?? (ftpIngest.last_sync_at ? new Date(ftpIngest.last_sync_at).getTime() : 0)
    const now = Date.now()
    if (lastRunAt && now - lastRunAt < intervalSeconds * 1000) {
      continue
    }

    try {
      console.log(`[ftp-ingest:auto] running real ingest for project=${project.id}`)
      const summary = await runProjectFtpIngest({
        projectId: project.id,
        ftpIngest,
        uploadBaseUrl: origin,
        supabaseAdmin: supabase,
      })

      const syncedAt = new Date().toISOString()
      await supabase
        .from('projects')
        .update({ ftp_ingest: { ...ftpIngest, last_sync_at: syncedAt, auto_sync_interval_seconds: intervalSeconds } })
        .eq('id', project.id)
      projectLastRunAt.set(project.id, new Date(syncedAt).getTime())

      console.log(`[ftp-ingest:auto] project=${project.id} interval=${intervalSeconds}s found=${summary.foundJobs} imported=${summary.importedSuccess} failed=${summary.failedCount} confirmFailed=${summary.confirmFailedCount}`)
    } catch (error) {
      console.error(`[ftp-ingest:auto] project=${project.id} failed:`, error instanceof Error ? error.message : String(error))
    }
  }
}

export function ensureFtpIngestAutoSync(origin: string) {
  if (schedulerStarted) return
  schedulerStarted = true

  syncRoundRunning = true
  void runFtpIngestSyncForEnabledProjectsOnce(origin).finally(() => {
    syncRoundRunning = false
  })
  timer = setInterval(() => {
    if (syncRoundRunning) {
      console.log('[ftp-ingest:auto] skip tick: previous sync round still running')
      return
    }
    syncRoundRunning = true
    void runFtpIngestSyncForEnabledProjectsOnce(origin).finally(() => {
      syncRoundRunning = false
    })
  }, SCHEDULER_TICK_MS)
  timer.unref?.()

  console.log(`[ftp-ingest:auto] scheduler started, tick=${SCHEDULER_TICK_MS}ms`)
}

export function getFtpIngestAutoSyncIntervalMs() {
  return SCHEDULER_TICK_MS
}
