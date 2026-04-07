"use client";

import { useState, useRef, useEffect } from "react";
import { X, Upload, Loader2, Download, Trash2 } from "lucide-react";
import type { Project, ProjectType, ProjectStatus } from "@/data/mockData";
import { Button } from "@/components/ui/button";

interface ProjectEditDialogProps {
  open: boolean;
  onClose: () => void;
  project: Project;
  onSaved: (updated: Project) => void;
}

const PROJECT_TYPES: ProjectType[] = ["Wedding", "Event", "Campaign"];
const PROJECT_STATUSES: ProjectStatus[] = ["Draft", "Reviewing", "Delivered"];

export default function ProjectEditDialog({
  open,
  onClose,
  project,
  onSaved,
}: ProjectEditDialogProps) {
  const [name, setName] = useState(project.name);
  const [clientName, setClientName] = useState(project.clientName);
  const [type, setType] = useState<ProjectType>(project.type);
  const [status, setStatus] = useState<ProjectStatus>(project.status);
  const [coverUrl, setCoverUrl] = useState(project.cover_url);
  const [ftpEnabled, setFtpEnabled] = useState(Boolean((project as Project & { ftp_ingest?: { enabled?: boolean } }).ftp_ingest?.enabled));
  const [ftpBufferApiBaseUrl, setFtpBufferApiBaseUrl] = useState((project as Project & { ftp_ingest?: { buffer_api_base_url?: string } }).ftp_ingest?.buffer_api_base_url || "");
  const [ftpProjectCode, setFtpProjectCode] = useState((project as Project & { ftp_ingest?: { project_code?: string } }).ftp_ingest?.project_code || "");
  const [ftpAutoSyncIntervalSeconds, setFtpAutoSyncIntervalSeconds] = useState(String((project as Project & { ftp_ingest?: { auto_sync_interval_seconds?: number } }).ftp_ingest?.auto_sync_interval_seconds ?? 15));
  const [ingesting, setIngesting] = useState(false);
  const [ingestResult, setIngestResult] = useState<string | null>(null);
  const [ftpStatusSummary, setFtpStatusSummary] = useState<string | null>(null);
  const [ftpStatusError, setFtpStatusError] = useState<string | null>(null);
  const [orphanScanSummary, setOrphanScanSummary] = useState<string | null>(null);
  const [orphanScanResult, setOrphanScanResult] = useState<null | {
    r2_orphans: { count: number; totalBytes: number; items: Array<{ path: string; size: number; sourceType: string; reason: string }> };
    local_orphans: { count: number; totalBytes: number; items: Array<{ path: string; size: number; sourceType: string; reason: string }> };
    db_orphans: { count: number; totalBytes: number; items: Array<{ path: string; size: number; sourceType: string; reason: string }> };
  }>(null);
  const [scanningOrphans, setScanningOrphans] = useState(false);
  const [cleaningOrphans, setCleaningOrphans] = useState(false);
  const [orphanCleanupSummary, setOrphanCleanupSummary] = useState<string | null>(null);
  const [cleanupConfirmOpen, setCleanupConfirmOpen] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleCoverUpload = async (file: File) => {
    setUploadingCover(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("projectId", project.id);
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const body = await res.json();
      if (!res.ok || !body.success) {
        setError(body.error ?? "Upload failed");
        return;
      }
      // Support both { url } and { fileUrl } response shapes
      const uploadedUrl = (body as Record<string, unknown>).url ?? (body as Record<string, unknown>).fileUrl;
      if (uploadedUrl) setCoverUrl(String(uploadedUrl));
    } catch {
      setError("Upload failed. Please try again.");
    } finally {
      setUploadingCover(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleCoverUpload(file);
    e.target.value = "";
  };

  const formatBytesToMb = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(2)} MB`;

  const handleScanOrphans = async () => {
    setScanningOrphans(true);
    setError(null);
    setOrphanScanSummary(null);
    try {
      const res = await fetch(`/api/projects/${project.id}/storage/orphans/scan`, { method: 'POST' });
      const body = await res.json().catch(() => null);
      if (!res.ok || body?.success !== true) {
        setError(body?.error ?? 'Orphan scan failed');
        return;
      }
      const data = body.data;
      setOrphanScanResult(data);
      setOrphanScanSummary(`R2 ${data.r2_orphans.count} · ${formatBytesToMb(data.r2_orphans.totalBytes)} · Local ${data.local_orphans.count} · ${formatBytesToMb(data.local_orphans.totalBytes)} · DB ${data.db_orphans.count}`);
    } catch {
      setError('Orphan scan failed. Please try again.');
    } finally {
      setScanningOrphans(false);
    }
  };

  const handleCleanupOrphans = async (cleanTypes: Array<'r2' | 'local' | 'db'>) => {
    if (!orphanScanResult) return;
    setCleaningOrphans(true);
    setError(null);
    setOrphanCleanupSummary(null);
    try {
      const res = await fetch(`/api/projects/${project.id}/storage/orphans/cleanup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scanResult: orphanScanResult, cleanTypes }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || body?.success !== true) {
        setError(body?.error ?? 'Orphan cleanup failed');
        return;
      }
      const data = body.data as { deletedCount?: number; freedBytes?: number; skippedCount?: number; failedItems?: Array<{ path: string }> };
      setOrphanCleanupSummary(`Deleted ${data.deletedCount ?? 0} · Freed ${formatBytesToMb(data.freedBytes ?? 0)} · Skipped ${data.skippedCount ?? 0} · Failed ${data.failedItems?.length ?? 0}`);
      await handleScanOrphans();
    } catch {
      setError('Orphan cleanup failed. Please try again.');
    } finally {
      setCleaningOrphans(false);
    }
  };

  const handleLoadFtpStatus = async () => {
    try {
      const statusUrl = `/api/projects/${project.id}/ftp-ingest/status`
      const res = await fetch(statusUrl)
      const body = await res.json().catch(() => null)
      if (!res.ok || body?.success !== true) {
        setFtpStatusError(body?.error ?? `Status endpoint error (${res.status})`)
        return
      }
      const data = body.data as { pendingJobs?: number; inProgressJobs?: number; importedJobs?: number; failedJobs?: number; lastSyncTime?: string | null; requestUrl?: string | null; error?: string | null }
      setFtpStatusSummary(`Pending ${data.pendingJobs ?? 0} · In progress ${data.inProgressJobs ?? 0} · Imported ${data.importedJobs ?? 0} · Failed ${data.failedJobs ?? 0}${data.lastSyncTime ? ` · Last sync ${data.lastSyncTime}` : ''}${data.requestUrl ? ` · URL ${data.requestUrl}` : ''}`)
      setFtpStatusError(data.error ?? null)
    } catch (error) {
      setFtpStatusError(`Status fetch failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  };

  useEffect(() => {
    if (open && ftpEnabled) {
      void fetch('/api/internal/ftp-ingest-auto-start').catch(() => null);
      void handleLoadFtpStatus();
    }
  }, [open, ftpEnabled]);

  const handleRunFtpIngest = async () => {
    setIngesting(true);
    setError(null);
    setIngestResult(null);
    try {
      const res = await fetch(`/api/projects/${project.id}/ftp-ingest`, { method: 'POST' });
      const body = await res.json().catch(() => null);
      if (!res.ok || body?.success !== true) {
        setError(body?.error ?? 'FTP ingest failed');
        return;
      }
      const data = body.data as { foundJobs?: number; importedSuccess?: number; failedCount?: number; confirmFailedCount?: number };
      setIngestResult(`Found ${data.foundJobs ?? 0} jobs · Imported ${data.importedSuccess ?? 0} · Failed ${data.failedCount ?? 0}${(data.confirmFailedCount ?? 0) > 0 ? ` · Confirm failed ${data.confirmFailedCount}` : ''}`);
    } catch {
      setError('FTP ingest failed. Please try again.');
    } finally {
      setIngesting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          client_name: clientName,
          type,
          status,
          cover_url: coverUrl,
          ftp_ingest: {
            enabled: ftpEnabled,
            buffer_api_base_url: ftpBufferApiBaseUrl.trim(),
            project_code: ftpProjectCode.trim(),
            auto_sync_interval_seconds: Math.max(1, Number(ftpAutoSyncIntervalSeconds) || 15),
          },
        }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) {
        setError(body.error ?? "Save failed");
        return;
      }
      onSaved({
        ...project,
        name,
        clientName,
        type,
        status,
        cover_url: coverUrl,
        ftp_ingest: {
          enabled: ftpEnabled,
          buffer_api_base_url: ftpBufferApiBaseUrl.trim(),
          project_code: ftpProjectCode.trim(),
          auto_sync_interval_seconds: Math.max(1, Number(ftpAutoSyncIntervalSeconds) || 15),
        },
      });
      onClose();
    } catch {
      setError("Save failed. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[calc(100vh-2rem)] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-base font-semibold text-foreground">Edit Project</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-4 overflow-y-auto p-6">
          {/* Banner image */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Banner Image</label>
            <div className="relative overflow-hidden rounded-lg bg-muted aspect-[3/2]">
              <img
                src={coverUrl}
                alt="Cover"
                className="h-full w-full object-cover"
              />
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingCover}
              >
                {uploadingCover ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Upload className="mr-1.5 h-3.5 w-3.5" />
                )}
                {coverUrl !== project.cover_url ? "Change" : "Upload"} Banner
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileChange}
              />
            </div>
          </div>

          {/* Name */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground" htmlFor="edit-name">
              Project Name
            </label>
            <input
              id="edit-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="flex h-9 w-full rounded-md border border-border bg-background px-3 py-1 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          {/* Client name */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground" htmlFor="edit-client">
              Client Name
            </label>
            <input
              id="edit-client"
              type="text"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              className="flex h-9 w-full rounded-md border border-border bg-background px-3 py-1 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          {/* Type + Status row */}
          <div className="flex gap-4">
            <div className="flex-1 space-y-1.5">
              <label className="text-sm font-medium text-foreground" htmlFor="edit-type">
                Type
              </label>
              <select
                id="edit-type"
                value={type}
                onChange={(e) => setType(e.target.value as ProjectType)}
                className="flex h-9 w-full rounded-md border border-border bg-background px-3 py-1 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                {PROJECT_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div className="flex-1 space-y-1.5">
              <label className="text-sm font-medium text-foreground" htmlFor="edit-status">
                Status
              </label>
              <select
                id="edit-status"
                value={status}
                onChange={(e) => setStatus(e.target.value as ProjectStatus)}
                className="flex h-9 w-full rounded-md border border-border bg-background px-3 py-1 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                {PROJECT_STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-4">
            <div>
              <h3 className="text-sm font-semibold text-foreground">FTP Ingest</h3>
              <p className="text-xs text-muted-foreground">Enable manual ingest from an FTP buffer API for this project.</p>
            </div>
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input type="checkbox" checked={ftpEnabled} onChange={(e) => setFtpEnabled(e.target.checked)} />
              Enable FTP Ingest
            </label>
            {ftpEnabled && (
              <>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">Buffer API Base URL</label>
                  <input
                    type="text"
                    value={ftpBufferApiBaseUrl}
                    onChange={(e) => setFtpBufferApiBaseUrl(e.target.value)}
                    placeholder="http://1.2.3.4:9090"
                    className="flex h-9 w-full rounded-md border border-border bg-background px-3 py-1 text-sm text-foreground"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">Project Code</label>
                  <input
                    type="text"
                    value={ftpProjectCode}
                    onChange={(e) => setFtpProjectCode(e.target.value)}
                    placeholder="project-test"
                    className="flex h-9 w-full rounded-md border border-border bg-background px-3 py-1 text-sm text-foreground"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">Auto Sync Interval (seconds)</label>
                  <input
                    type="number"
                    min="1"
                    value={ftpAutoSyncIntervalSeconds}
                    onChange={(e) => setFtpAutoSyncIntervalSeconds(e.target.value)}
                    placeholder="15"
                    className="flex h-9 w-full rounded-md border border-border bg-background px-3 py-1 text-sm text-foreground"
                  />
                </div>
                {ftpProjectCode.trim() && (
                  <div className="rounded-md border border-dashed border-border bg-background p-3 text-xs text-muted-foreground">
                    <p className="font-medium text-foreground">FTP Setup Guide</p>
                    <p className="mt-1">This project expects incoming files under:</p>
                    <code className="mt-1 block rounded bg-muted px-2 py-1 text-foreground">/{ftpProjectCode.trim()}/</code>
                    <p className="mt-2">Create any FTP account manually on the buffer server.</p>
                    <p>As long as files are uploaded into this project directory, the main gallery can ingest them.</p>
                    <p>The main site does not manage FTP usernames or passwords.</p>
                  </div>
                )}
                <div className="space-y-2 rounded-md border border-border bg-background p-3 text-xs text-muted-foreground">
                  <p className="font-medium text-foreground">FTP Ingest Status</p>
                  {ftpStatusSummary && <p>{ftpStatusSummary}</p>}
                  {ftpStatusError && <p className="text-destructive">{ftpStatusError}</p>}
                  {ingestResult && <p>{ingestResult}</p>}
                  <div className="flex items-center gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={handleLoadFtpStatus}>
                      Refresh status
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={handleRunFtpIngest} disabled={ingesting}>
                      {ingesting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1.5 h-3.5 w-3.5" />}
                      Run sync now
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-4">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Storage Maintenance</h3>
              <p className="text-xs text-muted-foreground">Scan this project for orphaned storage objects before cleanup.</p>
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={handleScanOrphans} disabled={scanningOrphans}>
                {scanningOrphans ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Trash2 className="mr-1.5 h-3.5 w-3.5" />}
                Scan orphan files
              </Button>
              {orphanScanSummary && <p className="text-xs text-muted-foreground">{orphanScanSummary}</p>}
            </div>
            {orphanScanResult && (
              <div className="space-y-3 text-xs text-muted-foreground">
                <div className="flex items-center gap-2">
                  <Button type="button" variant="destructive" size="sm" onClick={() => setCleanupConfirmOpen(true)} disabled={cleaningOrphans}>
                    {cleaningOrphans ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Trash2 className="mr-1.5 h-3.5 w-3.5" />}
                    Clean scanned orphans
                  </Button>
                  {orphanCleanupSummary && <p>{orphanCleanupSummary}</p>}
                </div>
                <div className="rounded-md border border-border bg-background p-3">
                  <p className="font-medium text-foreground">Scan Summary</p>
                  <ul className="mt-2 space-y-1">
                    <li>R2 orphan count: {orphanScanResult.r2_orphans.count} / {formatBytesToMb(orphanScanResult.r2_orphans.totalBytes)}</li>
                    <li>Local orphan count: {orphanScanResult.local_orphans.count} / {formatBytesToMb(orphanScanResult.local_orphans.totalBytes)}</li>
                    <li>DB orphan count: {orphanScanResult.db_orphans.count}</li>
                  </ul>
                </div>
                {([
                  ['R2 Orphans', orphanScanResult.r2_orphans.items],
                  ['Local Orphans', orphanScanResult.local_orphans.items],
                  ['DB Orphans', orphanScanResult.db_orphans.items],
                ] as const).map(([title, items]) => (
                  <details key={title} className="rounded-md border border-border bg-background p-3">
                    <summary className="cursor-pointer font-medium text-foreground">{title} ({items.length})</summary>
                    <div className="mt-2 space-y-2">
                      {items.length === 0 ? (
                        <p>No items</p>
                      ) : items.map((item) => (
                        <div key={`${title}-${item.path}`} className="rounded border border-border/60 p-2">
                          <p className="break-all text-foreground">{item.path}</p>
                          <p>{item.reason}</p>
                          <p>{formatBytesToMb(item.size)}</p>
                        </div>
                      ))}
                    </div>
                  </details>
                ))}
              </div>
            )}
          </div>

          {error && (
            <p className="text-sm text-destructive" role="alert">{error}</p>
          )}
        </div>

        {cleanupConfirmOpen && orphanScanResult && (
          <div className="border-t border-border bg-muted/30 px-6 py-4">
            <p className="text-sm font-semibold text-foreground">Confirm orphan cleanup</p>
            <p className="mt-1 text-sm text-muted-foreground">
              This will delete {orphanScanResult.r2_orphans.count + orphanScanResult.local_orphans.count} storage files and clean {orphanScanResult.db_orphans.count} orphan database records.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Estimated space to free: {formatBytesToMb(orphanScanResult.r2_orphans.totalBytes + orphanScanResult.local_orphans.totalBytes)}.
            </p>
            <div className="mt-3 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setCleanupConfirmOpen(false)} disabled={cleaningOrphans}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={async () => {
                  await handleCleanupOrphans(['r2', 'local', 'db']);
                  setCleanupConfirmOpen(false);
                }}
                disabled={cleaningOrphans}
              >
                {cleaningOrphans ? 'Cleaning…' : 'Confirm cleanup'}
              </Button>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-border px-6 py-4">
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSave} disabled={saving || !name.trim()}>
            {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Save Changes
          </Button>
        </div>
      </div>
    </div>
  );
}
