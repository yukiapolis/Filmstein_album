"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { Upload, X, CheckCircle2, AlertCircle, Loader2, Clock, Folder, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const statusIcon = (status: UploadFile["status"]) => {
  switch (status) {
    case "Completed":
      return <CheckCircle2 className="h-4 w-4 text-green-600" />;
    case "Failed":
      return <AlertCircle className="h-4 w-4 text-destructive" />;
    case "Uploading":
      return <Loader2 className="h-4 w-4 text-primary animate-spin" />;
    case "Pending":
      return <Clock className="h-4 w-4 text-muted-foreground" />;
  }
};

interface UploadFile {
  id: string;
  fileName: string;
  size: string;
  status: "Pending" | "Uploading" | "Completed" | "Failed" | "Skipped";
  progress: number;
  analysisType?: "new" | "retouch" | "duplicate" | "unknown";
  classification?: "duplicate_original" | "retouch_upload" | "new_original" | "unknown" | "invalid_retouch_reference";
  matchedPhotoId?: string | null;
  matchedVersionNo?: number | null;
  nextVersionNo?: number | null;
  checksumSha256?: string;
  normalizedBaseName?: string;
  reason?: string;
  uploadDecision?: "skip" | "overwrite" | null;
  /** Cached File object for upload; cleared after send to avoid memory leaks. */
  _raw?: File;
}

interface FolderItem {
  id: string;
  name: string;
}

interface UploadPanelProps {
  open: boolean;
  onClose: () => void;
  projectId?: string;
  initialFolderId?: string;
  /** Available folders for the current project */
  folders?: FolderItem[];
  /** Called once after at least one file finishes (success or fail), with the
   *  total number of files that ended in Completed state. */
  onUploadDone?: (completedCount: number) => void;
  /** Called when a new folder is created */
  onFolderCreated?: () => void;
}

const UploadPanel = ({
  open,
  onClose,
  projectId,
  initialFolderId,
  folders = [],
  onUploadDone,
  onFolderCreated,
}: UploadPanelProps) => {
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [displayPreset, setDisplayPreset] = useState<"original" | "6000" | "4000">("4000");
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFolderId, setSelectedFolderId] = useState<string>("");
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [mixedBatchActionOpen, setMixedBatchActionOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync when panel opens
  useEffect(() => {
    if (open) {
      setSelectedFolderId(initialFolderId ?? "");
      setShowNewFolder(false);
      setNewFolderName("");
      setDisplayPreset("4000");
    }
  }, [open, initialFolderId]);

  const addFiles = useCallback(async (rawFiles: FileList | File[]) => {
    const pendingFiles: UploadFile[] = [];

    for (const f of Array.from(rawFiles)) {
      const item: UploadFile = {
        id: crypto.randomUUID(),
        fileName: f.name,
        size: formatFileSize(f.size),
        status: "Pending",
        progress: 0,
        _raw: f,
      };

      if (projectId) {
        const formData = new FormData();
        formData.append('file', f);
        formData.append('projectId', projectId);
        const res = await fetch('/api/upload?analyze=true', { method: 'POST', body: formData });
        const body = await res.json().catch(() => null);
        if (res.ok && body?.success && body?.data) {
          item.classification = body.data.classification;
          item.analysisType = body.data.classification === 'duplicate_original'
            ? 'duplicate'
            : body.data.classification === 'retouch_upload'
              ? 'retouch'
              : body.data.classification === 'new_original'
                ? 'new'
                : 'unknown';
          item.matchedPhotoId = body.data.matchedPhotoId ?? null;
          item.matchedVersionNo = body.data.matchedVersionNo ?? null;
          item.nextVersionNo = body.data.nextVersionNo ?? null;
          item.checksumSha256 = body.data.checksumSha256;
          item.normalizedBaseName = body.data.normalizedBaseName;
          item.reason = body.data.reason;
        }
      }

      pendingFiles.push(item);
    }

    setFiles((prev) => [...prev, ...pendingFiles]);
  }, [projectId]);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) void addFiles(e.target.files);
    e.target.value = "";
  };

  const handleDrop = (e: React.DragEvent<HTMLElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) void addFiles(e.dataTransfer.files);
  };

  const handleRemove = (id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const setStatus = (id: string, status: UploadFile["status"], progress = 0) => {
    setFiles((prev) =>
      prev.map((f) => (f.id === id ? { ...f, status, progress } : f)),
    );
  };

  const setUploadDecision = (id: string, uploadDecision: UploadFile['uploadDecision']) => {
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, uploadDecision } : f)));
  };

  const handleNewFolder = async () => {
    const name = newFolderName.trim();
    if (!name || !projectId) {
      setShowNewFolder(false);
      setNewFolderName("");
      return;
    }

    try {
      const res = await fetch(`/api/projects/${projectId}/folders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const body = await res.json();
      if (body.success && body.data) {
        // Add to local list and select it
        setSelectedFolderId(body.data.id);
        onFolderCreated?.();
      }
    } catch {
      // Silently ignore
    }
    setNewFolderName("");
    setShowNewFolder(false);
  };

  /** Upload a single file to POST /api/upload. Returns true on success. */
  const uploadOne = async (file: UploadFile): Promise<boolean> => {
    if (!file._raw || !projectId) return false;

    setStatus(file.id, "Uploading", 0);

    const formData = new FormData();
    formData.append("file", file._raw);
    formData.append("projectId", projectId);
    formData.append("displayPreset", displayPreset);
    if (file.classification === 'retouch_upload') {
      formData.append('uploadCategory', 'retouch');
    }
    if (file.uploadDecision === 'overwrite') {
      formData.append('uploadCategory', 'overwrite-original');
      if (file.matchedPhotoId) {
        formData.append('photoId', file.matchedPhotoId);
      }
    }
    if (selectedFolderId) {
      formData.append("folderId", selectedFolderId);
      // Also send folder name for backward compatibility
      const folder = folders.find((f) => f.id === selectedFolderId);
      if (folder) {
        formData.append("folder", folder.name);
      }
    }

    try {
      const res = await fetch("/api/upload", { method: "POST", body: formData });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        console.error(`[UploadPanel] ${file.fileName}:`, body?.error ?? `HTTP ${res.status}`);
        setFiles((prev) => prev.map((f) => f.id === file.id ? {
          ...f,
          status: 'Failed',
          progress: 0,
          classification: body?.code === 'EXACT_DUPLICATE' && f.uploadDecision === 'overwrite' ? f.classification : body?.code === 'EXACT_DUPLICATE' ? 'duplicate_original' : f.classification,
          analysisType: body?.code === 'EXACT_DUPLICATE' ? 'duplicate' : f.analysisType,
          matchedPhotoId: body?.duplicateOf?.photoId ?? f.matchedPhotoId,
          matchedVersionNo: body?.duplicateOf?.versionNo ?? f.matchedVersionNo,
        } : f));
        return false;
      }

      setStatus(file.id, "Completed", 100);
      return true;
    } catch (err) {
      console.error(`[UploadPanel] ${file.fileName} network error:`, err);
      setStatus(file.id, "Failed", 0);
      return false;
    }
  };

  /** Upload all Pending files in parallel (up to a concurrency cap) or serially. */
  const handleUploadSubset = async (subset: UploadFile[]) => {
    if (!subset.length || !projectId) return;

    let completed = 0;
    for (const file of subset) {
      if (file.classification === 'duplicate_original' || file.analysisType === 'duplicate') {
        if (file.uploadDecision === 'skip') {
          setStatus(file.id, 'Skipped', 0);
          continue;
        }
        if (file.classification === 'duplicate_original' && file.uploadDecision !== 'overwrite') {
          continue;
        }
      }
      const ok = await uploadOne(file);
      if (ok) completed++;
      onUploadDone?.(completed);
    }
    onUploadDone?.(completed);
  };

  const handleUpload = async () => {
    const pending = files.filter((f) => f.status === "Pending");
    if (!pending.length || !projectId) return;

    const actionable = pending.filter((f) => !(f.classification === 'duplicate_original' && fileNeedsDecision(f)));
    const hasRetouch = actionable.some((f) => f.classification === 'retouch_upload');
    const hasNormal = actionable.some((f) => f.classification === 'new_original' || f.classification === 'unknown');

    if (hasRetouch && hasNormal) {
      setMixedBatchActionOpen(true);
      return;
    }

    await handleUploadSubset(actionable);
  };

  if (!open) return null;

  const fileNeedsDecision = (file: UploadFile) => file.classification === 'duplicate_original' && !file.uploadDecision;

  const pendingCount = files.filter((f) => f.status === "Pending").length;
  const allDone = pendingCount === 0 && files.length > 0;
  const pendingFiles = files.filter((f) => f.status === 'Pending');
  const actionablePendingFiles = pendingFiles.filter((f) => f.classification !== 'duplicate_original');
  const pendingRetouchCount = actionablePendingFiles.filter((f) => f.classification === 'retouch_upload').length;
  const pendingNormalCount = actionablePendingFiles.filter((f) => f.classification === 'new_original' || f.classification === 'unknown').length;
  const pendingDuplicateCount = pendingFiles.filter((f) => f.classification === 'duplicate_original').length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[calc(100vh-2rem)] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-base font-semibold text-foreground">Upload Photos</h2>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-5 overflow-y-auto p-6">
          {/* Hidden file input */}
          <input
            ref={inputRef}
            type="file"
            multiple
            accept="image/*"
            className="hidden"
            onChange={handleFileInput}
          />

          {/* Folder selector */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 flex-1">
              <Folder className="h-4 w-4 text-muted-foreground" />
              <select
                value={selectedFolderId}
                onChange={(e) => setSelectedFolderId(e.target.value)}
                className="flex-1 h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
              >
                <option value="">No folder</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
            </div>
            {showNewFolder ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  placeholder="Folder name"
                  className="h-9 w-32 rounded-md border border-input bg-background px-3 py-1 text-sm"
                  onKeyDown={(e) => { if (e.key === "Enter") handleNewFolder(); if (e.key === "Escape") { setShowNewFolder(false); setNewFolderName(""); } }}
                  autoFocus
                />
                <Button size="sm" type="button" onClick={handleNewFolder}>Add</Button>
                <Button size="sm" variant="ghost" type="button" onClick={() => { setShowNewFolder(false); setNewFolderName(""); }}>Cancel</Button>
              </div>
            ) : (
              <Button size="sm" variant="outline" type="button" onClick={() => setShowNewFolder(true)}>
                <Plus className="h-4 w-4 mr-1" />
                New Folder
              </Button>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Display version
            </label>
            <select
              value={displayPreset}
              onChange={(e) => setDisplayPreset(e.target.value as "original" | "6000" | "4000")}
              className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
            >
              <option value="original">Original</option>
              <option value="6000">Max edge 6000px</option>
              <option value="4000">Max edge 4000px</option>
            </select>
            <p className="text-xs text-muted-foreground">
              Display files are prepared locally before upload to reduce bandwidth.
            </p>
          </div>

          {/* Drop zone */}
          <div
            role="button"
            tabIndex={0}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") inputRef.current?.click(); }}
            className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed bg-surface py-10 transition-colors cursor-pointer ${
              isDragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
            }`}
          >
            <Upload className="mb-3 h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">Drag & drop photos here</p>
            <p className="mt-1 text-xs text-muted-foreground">or click to browse files · JPG, PNG, RAW up to 50 MB</p>
            <Button variant="outline" size="sm" className="mt-4" type="button">
              Select Files
            </Button>
          </div>

          {files.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Files ({files.length})
                  {allDone && <span className="ml-1.5 text-green-600 normal-case font-normal tracking-normal">— All uploaded</span>}
                </p>
                {pendingCount > 0 && (
                  <Button size="sm" variant="outline" type="button" onClick={handleUpload}>
                    Upload All ({pendingCount})
                  </Button>
                )}
                {pendingDuplicateCount > 0 && (
                  <span className="text-xs text-amber-700">{pendingDuplicateCount} duplicate file(s) need decision</span>
                )}
              </div>
              <ul className="max-h-80 space-y-2 overflow-y-auto pr-1">
                {files.map((file) => (
                  <li key={file.id} className="flex items-center gap-3 rounded-lg bg-surface px-3 py-2.5">
                    {statusIcon(file.status)}
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-sm text-foreground">{file.fileName}</p>
                      <p className="text-xs text-muted-foreground">{file.size}</p>
                      <p className="text-xs text-muted-foreground">
                        {file.classification === 'new_original' && `New original${file.normalizedBaseName ? ` · ${file.normalizedBaseName}` : ''}`}
                        {file.classification === 'retouch_upload' && `Retouch upload${file.matchedPhotoId ? ` · ${file.matchedPhotoId}` : ''}${file.nextVersionNo ? ` · v${file.nextVersionNo}` : ''}`}
                        {file.classification === 'duplicate_original' && `Duplicate original${file.matchedPhotoId ? ` · ${file.matchedPhotoId}` : ''}`}
                        {file.classification === 'invalid_retouch_reference' && `Invalid retouch reference${file.reason ? ` · ${file.reason}` : ''}`}
                        {file.classification === 'unknown' && `Unknown${file.reason ? ` · ${file.reason}` : ''}`}
                        {!file.classification && 'Analyzing…'}
                      </p>
                    </div>
                    {file.status === "Uploading" && (
                      <div className="w-24">
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full bg-primary transition-all"
                            style={{ width: `${file.progress}%` }}
                          />
                        </div>
                      </div>
                    )}
                    <span className="text-xs text-muted-foreground whitespace-nowrap">{file.status}</span>
                    {file.classification === 'duplicate_original' && file.status === 'Pending' && (
                      <div className="flex flex-wrap items-center gap-2">
                        <Button size="sm" variant={file.uploadDecision === 'skip' ? 'secondary' : 'outline'} type="button" onClick={() => setUploadDecision(file.id, 'skip')}>
                          Skip
                        </Button>
                        <Button size="sm" variant={file.uploadDecision === 'overwrite' ? 'secondary' : 'outline'} type="button" onClick={() => setUploadDecision(file.id, 'overwrite')}>
                          Overwrite
                        </Button>
                      </div>
                    )}
                    {file.status === "Pending" && (
                      <button
                        type="button"
                        onClick={() => handleRemove(file.id)}
                        className="text-muted-foreground hover:text-destructive transition-colors"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                    {file.status === "Failed" && (
                      <button
                        type="button"
                        onClick={() => {
                          setFiles((prev) =>
                            prev.map((f) =>
                              f.id === file.id ? { ...f, status: "Pending", progress: 0 } : f,
                            ),
                          );
                        }}
                        className="text-xs text-primary hover:underline"
                      >
                        Retry
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {mixedBatchActionOpen && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
              <p className="font-medium">Mixed batch detected</p>
              <p className="mt-1">本批包含普通图片 {pendingNormalCount} 张，修图版本 {pendingRetouchCount} 张。这两类图片处理规则不同。</p>
              {pendingDuplicateCount > 0 && (
                <p className="mt-1 text-xs">另外有重复图片 {pendingDuplicateCount} 张，当前不会进入上传。</p>
              )}
              <ul className="mt-2 list-disc pl-5 text-xs">
                <li>普通图片会生成压缩 display</li>
                <li>修图版本会直接使用原文件作为 display</li>
              </ul>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" type="button" onClick={async () => {
                  setMixedBatchActionOpen(false);
                  await handleUploadSubset(actionablePendingFiles.filter((f) => f.classification === 'new_original' || f.classification === 'unknown'));
                }}>
                  仅上传普通图片
                </Button>
                <Button size="sm" variant="outline" type="button" onClick={async () => {
                  setMixedBatchActionOpen(false);
                  await handleUploadSubset(actionablePendingFiles.filter((f) => f.classification === 'retouch_upload'));
                }}>
                  仅上传修图版本
                </Button>
                <Button size="sm" variant="ghost" type="button" onClick={() => setMixedBatchActionOpen(false)}>
                  取消
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default UploadPanel;
