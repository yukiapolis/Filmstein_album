"use client";

import Link from "next/link";
import { Calendar, FolderOpen, HardDrive, Image as ImageIcon, ServerCog } from "lucide-react";
import type { Project } from "@/data/mockData";
import StatusBadge from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";

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

function FtpBadge({ enabled }: { enabled: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-muted text-muted-foreground'}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${enabled ? 'bg-emerald-500' : 'bg-muted-foreground/60'}`} />
      {enabled ? 'On' : 'Off'}
    </span>
  )
}

export default function ProjectListRow({ project }: { project: Project }) {
  const ftpEnabled = Boolean(project.ftp_ingest?.enabled)

  return (
    <div className="rounded-xl border border-border bg-card transition-colors hover:border-primary/20">
      <div className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:gap-6">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <div className="overflow-hidden rounded-lg border border-border bg-muted">
            <img src={project.cover_url} alt={project.name} className="h-20 w-28 object-cover" />
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

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:min-w-[420px] lg:flex-none">
          <div className="rounded-lg bg-muted/40 px-3 py-2">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Photos</p>
            <p className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-foreground">
              <ImageIcon className="h-3.5 w-3.5" />
              {project.photoCount}
            </p>
          </div>

          <div className="rounded-lg bg-muted/40 px-3 py-2">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Storage</p>
            <p className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-foreground">
              <HardDrive className="h-3.5 w-3.5" />
              {formatStorage(project.storage_used_bytes)}
            </p>
          </div>

          <div className="rounded-lg bg-muted/40 px-3 py-2">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">FTP</p>
            <div className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-foreground">
              <ServerCog className="h-3.5 w-3.5" />
              <FtpBadge enabled={ftpEnabled} />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 lg:min-w-[160px] lg:flex-none">
          <Button type="button" variant="outline" size="sm" asChild>
            <Link href={`/projects/${project.id}`}>Manage</Link>
          </Button>
          <Button type="button" variant="outline" size="sm" asChild>
            <Link href={`/projects/${project.id}/preview`}>View</Link>
          </Button>
        </div>
      </div>
    </div>
  )
}
