"use client";

import { useRef, useState, useCallback } from "react";
import { Upload, X, CheckCircle2, AlertCircle, Loader2, Clock } from "lucide-react";
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
  status: "Pending" | "Uploading" | "Completed" | "Failed";
  progress: number;
  /** Cached File object for upload; cleared after send to avoid memory leaks. */
  _raw?: File;
}

interface UploadPanelProps {
  open: boolean;
  onClose: () => void;
  projectId?: string;
  /** Called once after at least one file finishes (success or fail), with the
   *  total number of files that ended in Completed state. */
  onUploadDone?: (completedCount: number) => void;
}

const UploadPanel = ({ open, onClose, projectId, onUploadDone }: UploadPanelProps) => {
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((rawFiles: FileList | File[]) => {
    const newFiles: UploadFile[] = Array.from(rawFiles).map((f) => ({
      id: crypto.randomUUID(),
      fileName: f.name,
      size: formatFileSize(f.size),
      status: "Pending" as const,
      progress: 0,
      _raw: f,
    }));
    setFiles((prev) => [...prev, ...newFiles]);
  }, []);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addFiles(e.target.files);
    e.target.value = "";
  };

  const handleDrop = (e: React.DragEvent<HTMLElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
  };

  const handleRemove = (id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const setStatus = (id: string, status: UploadFile["status"], progress = 0) => {
    setFiles((prev) =>
      prev.map((f) => (f.id === id ? { ...f, status, progress } : f)),
    );
  };

  /** Upload a single file to POST /api/upload. Returns true on success. */
  const uploadOne = async (file: UploadFile): Promise<boolean> => {
    if (!file._raw || !projectId) return false;

    setStatus(file.id, "Uploading", 0);

    const formData = new FormData();
    formData.append("file", file._raw);
    formData.append("projectId", projectId);

    try {
      const res = await fetch("/api/upload", { method: "POST", body: formData });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        console.error(`[UploadPanel] ${file.fileName}:`, body?.error ?? `HTTP ${res.status}`);
        setStatus(file.id, "Failed", 0);
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
  const handleUpload = async () => {
    const pending = files.filter((f) => f.status === "Pending");
    if (!pending.length || !projectId) return;

    let completed = 0;

    // Sequential upload keeps the UX clearer (progress bars advance one-by-one)
    for (const file of pending) {
      const ok = await uploadOne(file);
      if (ok) completed++;
      // Trigger refresh after each file so the list updates in real time
      onUploadDone?.(completed);
    }

    // Final call in case no files were pending to begin with
    onUploadDone?.(completed);
  };

  if (!open) return null;

  const pendingCount = files.filter((f) => f.status === "Pending").length;
  const allDone = pendingCount === 0 && files.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-lg rounded-xl border border-border bg-card shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-base font-semibold text-foreground">Upload Photos</h2>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Hidden file input */}
          <input
            ref={inputRef}
            type="file"
            multiple
            accept="image/*"
            className="hidden"
            onChange={handleFileInput}
          />

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
              </div>
              <ul className="space-y-2">
                {files.map((file) => (
                  <li key={file.id} className="flex items-center gap-3 rounded-lg bg-surface px-3 py-2.5">
                    {statusIcon(file.status)}
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-sm text-foreground">{file.fileName}</p>
                      <p className="text-xs text-muted-foreground">{file.size}</p>
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
        </div>
      </div>
    </div>
  );
};

export default UploadPanel;
