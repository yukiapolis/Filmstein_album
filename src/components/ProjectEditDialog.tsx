"use client";

import { useState, useEffect } from "react";
import { X, Upload, Loader2, Download, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import type { Project, ProjectType, ProjectStatus } from "@/data/mockData";
import { Button } from "@/components/ui/button";

interface ProjectEditDialogProps {
  open: boolean;
  onClose: () => void;
  project: Project;
  onSaved: (updated: Project) => void;
}

type AssetKey = 'cover' | 'banner' | 'splash_poster' | 'loading_gif' | 'watermark_logo'
type AssetValue = { url?: string; file_name?: string; mime_type?: string; file_size_bytes?: number; duration_seconds?: number }
type ProjectAssetsState = NonNullable<Project['project_assets']>

const PROJECT_TYPES: ProjectType[] = ["Wedding", "Event", "Campaign"];
const PROJECT_STATUSES: ProjectStatus[] = ["Draft", "Reviewing", "Delivered"];

const EMPTY_ASSETS: ProjectAssetsState = {}

const ASSET_ACCEPT: Record<AssetKey, string> = {
  cover: 'image/jpeg,image/png,image/webp',
  banner: 'image/jpeg,image/png,image/webp',
  splash_poster: 'image/jpeg,image/png,image/webp',
  loading_gif: 'image/gif',
  watermark_logo: 'image/png,image/svg+xml',
}

const ASSET_SPECS: Record<AssetKey, { label: string; recommendedSize?: string; maxMb: number }> = {
  cover: { label: 'Cover', recommendedSize: '500 × 500 px', maxMb: 2 },
  banner: { label: 'Banner', recommendedSize: '1500 × 844 px', maxMb: 3 },
  splash_poster: { label: 'Splash Poster', recommendedSize: '1500 × 2668 px', maxMb: 5 },
  loading_gif: { label: 'Loading GIF', maxMb: 10 },
  watermark_logo: { label: 'Watermark Logo', maxMb: 5 },
}

function formatBytesToMb(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function clampOpacity(value: number) {
  if (Number.isNaN(value)) return 1
  return Math.min(1, Math.max(0, value))
}

function getWatermarkPreviewStyle(position: string, offsetX: number, offsetY: number, scale: number, opacity: number) {
  const safeScale = Math.max(0.2, scale || 1)
  const base = {
    width: `${96 * safeScale}px`,
    opacity: clampOpacity(opacity),
  } as const

  if (position === 'custom') {
    return {
      ...base,
      left: `calc(50% + ${offsetX}px)`,
      top: `calc(50% + ${offsetY}px)`,
      transform: 'translate(-50%, -50%)',
    }
  }

  const vertical = position.startsWith('top') ? 'top' : 'bottom'
  const horizontal = position.endsWith('left') ? 'left' : 'right'

  return {
    ...base,
    [vertical]: `${16 + offsetY}px`,
    [horizontal]: `${16 + offsetX}px`,
  }
}

function AssetPreview({ asset, label }: { asset?: AssetValue; label: string }) {
  if (!asset?.url) {
    return (
      <div className="flex aspect-[4/3] w-28 items-center justify-center rounded-md border border-dashed border-border bg-muted text-[11px] text-muted-foreground">
        No preview
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-md border border-border bg-muted">
      <img src={asset.url} alt={label} className="aspect-[4/3] w-28 object-cover" />
    </div>
  )
}

function AssetSection({
  title,
  assetKey,
  asset,
  enabled,
  setEnabled,
  expanded,
  setExpanded,
  onUpload,
  onDelete,
  uploading,
  children,
  alwaysVisible = false,
}: {
  title: string
  assetKey: AssetKey
  asset?: AssetValue
  enabled: boolean
  setEnabled?: (next: boolean) => void
  expanded: boolean
  setExpanded: (next: boolean) => void
  onUpload: (assetKey: AssetKey, file: File | null) => void
  onDelete: (assetKey: AssetKey) => void
  uploading: boolean
  children?: React.ReactNode
  alwaysVisible?: boolean
}) {
  const showContent = alwaysVisible || enabled

  return (
    <div className="rounded-lg border border-border bg-background">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          {!alwaysVisible && setEnabled ? (
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          ) : null}
          <button
            type="button"
            className="flex items-center gap-2 text-left"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
            <div>
              <p className="text-sm font-medium text-foreground">{title}</p>
              <p className="text-xs text-muted-foreground">
                {asset?.file_name ? `${asset.file_name} · ${formatBytesToMb(asset.file_size_bytes || 0)}` : 'No file uploaded'}
              </p>
              <p className="text-[11px] text-muted-foreground">
                Recommended: {ASSET_SPECS[assetKey].recommendedSize ? `${ASSET_SPECS[assetKey].recommendedSize} · ` : ''}max {ASSET_SPECS[assetKey].maxMb} MB
              </p>
            </div>
          </button>
        </div>
        {alwaysVisible || enabled ? (
          <div className="flex items-center gap-2">
            <label className="inline-flex cursor-pointer items-center rounded-md border border-border px-3 py-2 text-xs font-medium text-foreground hover:bg-muted">
              {uploading ? 'Uploading…' : 'Upload'}
              <input
                type="file"
                className="hidden"
                accept={ASSET_ACCEPT[assetKey]}
                onChange={(e) => {
                  void onUpload(assetKey, e.target.files?.[0] || null)
                  e.currentTarget.value = ''
                }}
              />
            </label>
            <Button type="button" variant="outline" size="sm" onClick={() => onDelete(assetKey)} disabled={!asset?.url || uploading}>
              Delete
            </Button>
          </div>
        ) : null}
      </div>

      {showContent && expanded ? (
        <div className="border-t border-border px-4 py-4">
          <div className="flex flex-wrap items-start gap-4">
            <AssetPreview asset={asset} label={title} />
            <div className="min-w-[180px] flex-1 space-y-2 text-xs text-muted-foreground">
              <p>{asset?.url ? 'Uploaded and linked to project assets.' : 'No file uploaded yet.'}</p>
              {asset?.url ? <p className="break-all">{asset.url}</p> : null}
              {children}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default function ProjectEditDialog({
  open,
  onClose,
  project,
  onSaved,
}: ProjectEditDialogProps) {
  const [name, setName] = useState(project.name);
  const [clientName, setClientName] = useState(project.clientName);
  const [description, setDescription] = useState(project.description || '');
  const [type, setType] = useState<ProjectType>(project.type);
  const [status, setStatus] = useState<ProjectStatus>(project.status);
  const [ftpEnabled, setFtpEnabled] = useState(Boolean((project as Project & { ftp_ingest?: { enabled?: boolean } }).ftp_ingest?.enabled));
  const [projectAssets, setProjectAssets] = useState<ProjectAssetsState>((project.project_assets || EMPTY_ASSETS) as ProjectAssetsState);
  const [watermarkEnabled, setWatermarkEnabled] = useState(Boolean(project.visual_settings?.watermark?.enabled));
  const [watermarkPosition, setWatermarkPosition] = useState(project.visual_settings?.watermark?.position || 'bottom-right');
  const [watermarkOffsetX, setWatermarkOffsetX] = useState(String(project.visual_settings?.watermark?.offset_x ?? 0));
  const [watermarkOffsetY, setWatermarkOffsetY] = useState(String(project.visual_settings?.watermark?.offset_y ?? 0));
  const [watermarkScale, setWatermarkScale] = useState(String(project.visual_settings?.watermark?.scale ?? 1));
  const [watermarkOpacity, setWatermarkOpacity] = useState(String(project.visual_settings?.watermark?.opacity ?? 1));
  const [assetUploading, setAssetUploading] = useState<string | null>(null);
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bannerEnabled, setBannerEnabled] = useState(Boolean(project.project_assets?.banner?.url));
  const [bannerExpanded, setBannerExpanded] = useState(false);
  const [posterEnabled, setPosterEnabled] = useState(Boolean(project.project_assets?.splash_poster?.url));
  const [posterExpanded, setPosterExpanded] = useState(false);
  const [posterDurationSeconds, setPosterDurationSeconds] = useState(String(project.project_assets?.splash_poster?.duration_seconds ?? 3));
  const [gifEnabled, setGifEnabled] = useState(Boolean(project.project_assets?.loading_gif?.url));
  const [gifExpanded, setGifExpanded] = useState(false);
  const [watermarkSectionEnabled, setWatermarkSectionEnabled] = useState(Boolean(project.project_assets?.watermark_logo?.url || project.visual_settings?.watermark?.enabled));
  const [watermarkExpanded, setWatermarkExpanded] = useState(false);

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

  const handleAssetUpload = async (assetType: AssetKey, file: File | null) => {
    if (!file) return;
    setAssetUploading(assetType);
    setError(null);
    try {
      const maxBytes = ASSET_SPECS[assetType].maxMb * 1024 * 1024
      if (file.size > maxBytes) {
        setError(`${ASSET_SPECS[assetType].label} must be smaller than ${ASSET_SPECS[assetType].maxMb} MB`)
        return
      }

      if (['cover', 'banner', 'splash_poster'].includes(assetType)) {
        const size = await new Promise<{ width: number; height: number } | null>((resolve) => {
          const img = new Image()
          img.onload = () => resolve({ width: img.width, height: img.height })
          img.onerror = () => resolve(null)
          img.src = URL.createObjectURL(file)
        })
        if (!size) {
          setError(`Could not read ${ASSET_SPECS[assetType].label} image dimensions`)
          return
        }
      }

      const form = new FormData();
      form.append('assetType', assetType);
      form.append('file', file);
      const res = await fetch(`/api/projects/${project.id}/assets`, { method: 'POST', body: form });
      const body = await res.json().catch(() => null);
      if (!res.ok || body?.success !== true) {
        setError(body?.error ?? 'Asset upload failed');
        return;
      }
      setProjectAssets((prev) => {
        const next = {
          ...prev,
          [assetType]: {
            ...(prev?.[assetType] || {}),
            url: body.data.url,
            file_name: body.data.fileName,
            mime_type: file.type || undefined,
            file_size_bytes: body.data.size,
          },
        }
        return next
      });
      if (assetType === 'banner') setBannerEnabled(true)
      if (assetType === 'splash_poster') setPosterEnabled(true)
      if (assetType === 'loading_gif') setGifEnabled(true)
      if (assetType === 'watermark_logo') setWatermarkSectionEnabled(true)
    } catch {
      setError('Asset upload failed. Please try again.');
    } finally {
      setAssetUploading(null);
    }
  };

  const handleDeleteAsset = (assetType: AssetKey) => {
    setProjectAssets((prev) => {
      const next = { ...prev }
      delete next[assetType]
      return next
    })

    if (assetType === 'banner') setBannerEnabled(false)
    if (assetType === 'splash_poster') setPosterEnabled(false)
    if (assetType === 'loading_gif') setGifEnabled(false)
    if (assetType === 'watermark_logo') setWatermarkSectionEnabled(watermarkEnabled)
  }

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
      const normalizedProjectAssets: ProjectAssetsState = {
        ...(projectAssets.cover?.url ? { cover: projectAssets.cover } : {}),
        ...(bannerEnabled && projectAssets.banner?.url ? { banner: projectAssets.banner } : {}),
        ...(posterEnabled
          ? {
              splash_poster: {
                ...(projectAssets.splash_poster || {}),
                ...(projectAssets.splash_poster?.url ? { duration_seconds: Math.max(1, Number(posterDurationSeconds) || 3) } : {}),
              },
            }
          : {}),
        ...(gifEnabled && projectAssets.loading_gif?.url ? { loading_gif: projectAssets.loading_gif } : {}),
        ...(watermarkSectionEnabled && projectAssets.watermark_logo?.url ? { watermark_logo: projectAssets.watermark_logo } : {}),
      }

      const nextCoverUrl = normalizedProjectAssets.cover?.url || ''
      const res = await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          client_name: clientName,
          description,
          type,
          status,
          cover_url: nextCoverUrl,
          ftp_ingest: {
            enabled: ftpEnabled,
            buffer_api_base_url: ftpBufferApiBaseUrl.trim(),
            project_code: ftpProjectCode.trim(),
            auto_sync_interval_seconds: Math.max(1, Number(ftpAutoSyncIntervalSeconds) || 15),
          },
          project_assets: normalizedProjectAssets,
          visual_settings: {
            watermark: {
              enabled: watermarkSectionEnabled ? watermarkEnabled : false,
              position: watermarkPosition,
              offset_x: Number(watermarkOffsetX) || 0,
              offset_y: Number(watermarkOffsetY) || 0,
              scale: Number(watermarkScale) || 1,
              opacity: clampOpacity(Number(watermarkOpacity)),
            },
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
        description,
        type,
        status,
        cover_url: nextCoverUrl,
        ftp_ingest: {
          enabled: ftpEnabled,
          buffer_api_base_url: ftpBufferApiBaseUrl.trim(),
          project_code: ftpProjectCode.trim(),
          auto_sync_interval_seconds: Math.max(1, Number(ftpAutoSyncIntervalSeconds) || 15),
        },
        project_assets: normalizedProjectAssets,
        visual_settings: {
          watermark: {
            enabled: watermarkSectionEnabled ? watermarkEnabled : false,
            position: watermarkPosition,
            offset_x: Number(watermarkOffsetX) || 0,
            offset_y: Number(watermarkOffsetY) || 0,
            scale: Number(watermarkScale) || 1,
            opacity: clampOpacity(Number(watermarkOpacity)),
          },
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

  const watermarkPreviewStyle = getWatermarkPreviewStyle(
    watermarkPosition,
    Number(watermarkOffsetX) || 0,
    Number(watermarkOffsetY) || 0,
    Number(watermarkScale) || 1,
    Number(watermarkOpacity) || 1,
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[calc(100vh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xl">
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

        <div className="space-y-4 overflow-y-auto p-6">
          <div className="space-y-4 rounded-lg border border-border bg-muted/30 p-4">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Basic Information</h3>
              <p className="text-xs text-muted-foreground">Core project details used across the dashboard.</p>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground" htmlFor="edit-name">Project Name</label>
              <input
                id="edit-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="flex h-9 w-full rounded-md border border-border bg-background px-3 py-1 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground" htmlFor="edit-client">Client Name</label>
              <input
                id="edit-client"
                type="text"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                className="flex h-9 w-full rounded-md border border-border bg-background px-3 py-1 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground" htmlFor="edit-description">Description</label>
              <textarea
                id="edit-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                className="flex w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>

            <div className="flex gap-4">
              <div className="flex-1 space-y-1.5">
                <label className="text-sm font-medium text-foreground" htmlFor="edit-type">Type</label>
                <select
                  id="edit-type"
                  value={type}
                  onChange={(e) => setType(e.target.value as ProjectType)}
                  className="flex h-9 w-full rounded-md border border-border bg-background px-3 py-1 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  {PROJECT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="flex-1 space-y-1.5">
                <label className="text-sm font-medium text-foreground" htmlFor="edit-status">Status</label>
                <select
                  id="edit-status"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as ProjectStatus)}
                  className="flex h-9 w-full rounded-md border border-border bg-background px-3 py-1 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  {PROJECT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
          </div>

          <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-4">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Project Assets</h3>
              <p className="text-xs text-muted-foreground">Manage cover, banner, poster, loading, and watermark assets without sending them into the gallery photo pipeline.</p>
            </div>

            <AssetSection
              title="Cover"
              assetKey="cover"
              asset={projectAssets.cover}
              enabled={true}
              expanded={true}
              setExpanded={() => {}}
              onUpload={handleAssetUpload}
              onDelete={handleDeleteAsset}
              uploading={assetUploading === 'cover'}
              alwaysVisible
            />

            <AssetSection
              title="Banner"
              assetKey="banner"
              asset={projectAssets.banner}
              enabled={bannerEnabled}
              setEnabled={setBannerEnabled}
              expanded={bannerExpanded}
              setExpanded={setBannerExpanded}
              onUpload={handleAssetUpload}
              onDelete={handleDeleteAsset}
              uploading={assetUploading === 'banner'}
            />

            <AssetSection
              title="Splash Poster"
              assetKey="splash_poster"
              asset={projectAssets.splash_poster}
              enabled={posterEnabled}
              setEnabled={setPosterEnabled}
              expanded={posterExpanded}
              setExpanded={setPosterExpanded}
              onUpload={handleAssetUpload}
              onDelete={handleDeleteAsset}
              uploading={assetUploading === 'splash_poster'}
            >
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">Display Duration (seconds)</label>
                <input
                  type="number"
                  min="1"
                  value={posterDurationSeconds}
                  onChange={(e) => setPosterDurationSeconds(e.target.value)}
                  className="flex h-9 w-32 rounded-md border border-border bg-background px-3 py-1 text-sm text-foreground"
                />
              </div>
            </AssetSection>

            <AssetSection
              title="Loading GIF"
              assetKey="loading_gif"
              asset={projectAssets.loading_gif}
              enabled={gifEnabled}
              setEnabled={setGifEnabled}
              expanded={gifExpanded}
              setExpanded={setGifExpanded}
              onUpload={handleAssetUpload}
              onDelete={handleDeleteAsset}
              uploading={assetUploading === 'loading_gif'}
            />

            <AssetSection
              title="Watermark"
              assetKey="watermark_logo"
              asset={projectAssets.watermark_logo}
              enabled={watermarkSectionEnabled}
              setEnabled={setWatermarkSectionEnabled}
              expanded={watermarkExpanded}
              setExpanded={setWatermarkExpanded}
              onUpload={handleAssetUpload}
              onDelete={handleDeleteAsset}
              uploading={assetUploading === 'watermark_logo'}
            >
              <div className="space-y-3">
                <label className="flex items-center gap-2 text-sm text-foreground">
                  <input type="checkbox" checked={watermarkEnabled} onChange={(e) => setWatermarkEnabled(e.target.checked)} />
                  Enable Watermark
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-foreground">Position</label>
                    <select value={watermarkPosition} onChange={(e) => setWatermarkPosition(e.target.value)} className="flex h-9 w-full rounded-md border border-border bg-background px-3 py-1 text-sm text-foreground">
                      <option value="top-left">Top Left</option>
                      <option value="top-right">Top Right</option>
                      <option value="bottom-left">Bottom Left</option>
                      <option value="bottom-right">Bottom Right</option>
                      <option value="custom">Custom</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-foreground">Scale</label>
                    <input type="number" step="0.1" value={watermarkScale} onChange={(e) => setWatermarkScale(e.target.value)} className="flex h-9 w-full rounded-md border border-border bg-background px-3 py-1 text-sm text-foreground" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-foreground">Offset X</label>
                    <input type="number" value={watermarkOffsetX} onChange={(e) => setWatermarkOffsetX(e.target.value)} className="flex h-9 w-full rounded-md border border-border bg-background px-3 py-1 text-sm text-foreground" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-foreground">Offset Y</label>
                    <input type="number" value={watermarkOffsetY} onChange={(e) => setWatermarkOffsetY(e.target.value)} className="flex h-9 w-full rounded-md border border-border bg-background px-3 py-1 text-sm text-foreground" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-foreground">Opacity</label>
                    <input type="number" step="0.1" min="0" max="1" value={watermarkOpacity} onChange={(e) => setWatermarkOpacity(e.target.value)} className="flex h-9 w-full rounded-md border border-border bg-background px-3 py-1 text-sm text-foreground" />
                  </div>
                </div>
                <div className="space-y-2">
                  <p className="text-xs font-medium text-foreground">Watermark Preview</p>
                  <div className="relative h-44 overflow-hidden rounded-md border border-border bg-gradient-to-br from-zinc-200 to-zinc-300">
                    <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.15)_25%,transparent_25%,transparent_50%,rgba(255,255,255,0.15)_50%,rgba(255,255,255,0.15)_75%,transparent_75%,transparent)] bg-[length:24px_24px] opacity-50" />
                    {projectAssets.watermark_logo?.url ? (
                      <img
                        src={projectAssets.watermark_logo.url}
                        alt="Watermark preview"
                        className="absolute max-w-none object-contain"
                        style={watermarkPreviewStyle}
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
                        No watermark logo
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </AssetSection>
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
                  <input type="text" value={ftpBufferApiBaseUrl} onChange={(e) => setFtpBufferApiBaseUrl(e.target.value)} placeholder="http://1.2.3.4:9090" className="flex h-9 w-full rounded-md border border-border bg-background px-3 py-1 text-sm text-foreground" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">Project Code</label>
                  <input type="text" value={ftpProjectCode} onChange={(e) => setFtpProjectCode(e.target.value)} placeholder="project-test" className="flex h-9 w-full rounded-md border border-border bg-background px-3 py-1 text-sm text-foreground" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">Auto Sync Interval (seconds)</label>
                  <input type="number" min="1" value={ftpAutoSyncIntervalSeconds} onChange={(e) => setFtpAutoSyncIntervalSeconds(e.target.value)} placeholder="15" className="flex h-9 w-full rounded-md border border-border bg-background px-3 py-1 text-sm text-foreground" />
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
                    <Button type="button" variant="outline" size="sm" onClick={handleLoadFtpStatus}>Refresh status</Button>
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
                      {items.length === 0 ? <p>No items</p> : items.map((item) => (
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

          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
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
              <Button type="button" variant="outline" onClick={() => setCleanupConfirmOpen(false)} disabled={cleaningOrphans}>Cancel</Button>
              <Button type="button" variant="destructive" onClick={async () => {
                await handleCleanupOrphans(['r2', 'local', 'db']);
                setCleanupConfirmOpen(false);
              }} disabled={cleaningOrphans}>
                {cleaningOrphans ? 'Cleaning…' : 'Confirm cleanup'}
              </Button>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-border px-6 py-4">
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="button" onClick={handleSave} disabled={saving || !name.trim()}>
            {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Save Changes
          </Button>
        </div>
      </div>
    </div>
  );
}
