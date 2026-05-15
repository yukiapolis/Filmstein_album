"use client";

import Link from "next/link";
import { Calendar, FolderOpen, HardDrive, Camera } from "lucide-react";
import type { Project } from "@/data/mockData";
import StatusBadge from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { useState } from "react";

function formatStorage(bytes?: number) {
  const value = typeof bytes === 'number' ? bytes : 0
  if (value >= 1024 * 1024 * 1024) return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(0)} MB`
  if (value >= 1024) return `${(value / 1024).toFixed(0)} KB`
  return value > 0 ? `${value} B` : '—'
}

function formatCreatedAt(project: Project) {
  const raw = project.created_at || project.date
  if (!raw) return '—'
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return project.date || '—'
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function getStorageBadge(project: Project) {
  const mode = project.storage_state?.location_mode === 'node_local' ? 'node_local' : 'r2'
  if (mode === 'node_local') {
    return {
      label: project.storage_state?.holder_node_name || project.storage_state?.holder_node_key || 'Node local',
      className: 'bg-amber-50 text-amber-700 border border-amber-200',
    }
  }
  return {
    label: 'R2',
    className: 'bg-sky-50 text-sky-700 border border-sky-200',
  }
}

export default function ProjectListRow({
  project,
  isSuperAdmin = false,
  onOpenMigration,
}: {
  project: Project
  isSuperAdmin?: boolean
  onOpenMigration?: (project: Project) => void
}) {
  const ftpEnabled = Boolean(project.ftp_ingest?.enabled)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [dangerConfirmOpen, setDangerConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const storageBadge = getStorageBadge(project)

  const handleDelete = async () => {
    setDeleting(true)
    try {
      const res = await fetch(`/api/projects/${project.id}`, { method: 'DELETE' })
      const body = await res.json().catch(() => null)
      if (!res.ok || body?.success !== true) {
        alert(body?.error || 'Delete failed')
        return
      }
      window.location.reload()
    } finally {
      setDeleting(false)
      setDangerConfirmOpen(false)
      setConfirmOpen(false)
    }
  }

  return (
    <>
      <div className="rounded-xl border border-border bg-card transition-colors hover:border-primary/20">
        <div className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:gap-6">
          <div className="flex min-w-0 flex-1 items-center gap-4">
            <div className="overflow-hidden rounded-lg border border-border bg-muted">
              <img src={project.cover_url} alt={project.name} className="h-20 w-20 object-cover" />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="truncate text-sm font-semibold text-foreground sm:text-base">{project.name}</h3>
                <StatusBadge status={project.status} />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <FolderOpen className="h-3.5 w-3.5" />
                  {project.type}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5" />
                  {formatCreatedAt(project)}
                </span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:min-w-[360px] lg:flex-none">
            <div className="rounded-lg bg-muted/40 px-3 py-2 text-sm font-medium text-foreground inline-flex items-center gap-1.5">
              <Camera className="h-3.5 w-3.5" />
              {project.photoCount}
            </div>

            <div className="rounded-lg bg-muted/40 px-3 py-2 text-sm font-medium text-foreground inline-flex items-center gap-1.5">
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${storageBadge.className}`}>
                {storageBadge.label}
              </span>
              <HardDrive className="h-3.5 w-3.5" />
              {formatStorage(project.storage_used_bytes)}
            </div>

            <div className={`rounded-lg px-3 py-2 text-sm font-medium ${ftpEnabled ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
              FTP {ftpEnabled ? 'On' : 'Off'}
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end lg:min-w-[320px] lg:flex-none">
            {isSuperAdmin ? (
              <Button type="button" variant="outline" size="sm" className="w-full sm:w-auto" onClick={() => onOpenMigration?.(project)}>
                Migration
              </Button>
            ) : null}
            <Button type="button" variant="outline" size="sm" className="w-full sm:w-auto" asChild>
              <Link href={`/projects/${project.id}/preview`}>View</Link>
            </Button>
            <Button type="button" variant="outline" size="sm" className="w-full sm:w-auto" asChild>
              <Link href={`/projects/${project.id}`}>Manage</Link>
            </Button>
            {project.permissions?.canDelete !== false ? (
              <Button type="button" variant="destructive" size="sm" className="w-full sm:w-auto" onClick={() => setConfirmOpen(true)}>
                Delete
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-xl">
            <h3 className="text-base font-semibold text-foreground">Delete project?</h3>
            <p className="mt-2 text-sm text-muted-foreground">This project and all associated data will be removed. Continue to second confirmation.</p>
            <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => setConfirmOpen(false)} disabled={deleting}>Cancel</Button>
              <Button type="button" variant="destructive" className="w-full sm:w-auto" onClick={() => { setConfirmOpen(false); setDangerConfirmOpen(true) }} disabled={deleting}>Continue</Button>
            </div>
          </div>
        </div>
      )}

      {dangerConfirmOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-2xl">
            <h3 className="text-base font-semibold text-foreground">Confirm permanent deletion</h3>
            <p className="mt-2 text-sm text-muted-foreground">This will delete the project, related photos, photo_files, project assets, storage objects, and associated database records.</p>
            <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => setDangerConfirmOpen(false)} disabled={deleting}>Cancel</Button>
              <Button type="button" variant="destructive" className="w-full sm:w-auto" onClick={() => void handleDelete()} disabled={deleting}>{deleting ? 'Deleting…' : 'Delete project'}</Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
