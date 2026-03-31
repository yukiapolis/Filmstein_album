"use client";

import { useState } from "react";
import { Upload, X, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { mockUploadFiles, type UploadFile } from "@/data/mockData";
import { Button } from "@/components/ui/button";

const statusIcon = (status: UploadFile["status"]) => {
  switch (status) {
    case "Completed":
      return <CheckCircle2 className="h-4 w-4 text-green-600" />;
    case "Failed":
      return <AlertCircle className="h-4 w-4 text-destructive" />;
    case "Uploading":
      return <Loader2 className="h-4 w-4 text-primary animate-spin" />;
  }
};

const UploadPanel = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const [files] = useState(mockUploadFiles);

  if (!open) return null;

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
          <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-border bg-surface py-10 transition-colors hover:border-primary/40">
            <Upload className="mb-3 h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">Drag & drop photos here</p>
            <p className="mt-1 text-xs text-muted-foreground">or click to browse files · JPG, PNG, RAW up to 50 MB</p>
            <Button variant="outline" size="sm" className="mt-4">
              Select Files
            </Button>
          </div>

          {files.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Files</p>
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
