"use client";

import { useState, useEffect } from "react";
import { X, Copy, ExternalLink, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ShareModalProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  projectName: string;
}

export default function ShareModal({ open, onClose, projectId, projectName }: ShareModalProps) {
  const [copied, setCopied] = useState(false);
  const [shareUrl, setShareUrl] = useState(`/share/${projectId}`);

  useEffect(() => {
    setShareUrl(`${window.location.origin}/share/${projectId}`);
  }, [projectId]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for browsers without clipboard API
      const el = document.createElement("textarea");
      el.value = shareUrl;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleOpenAlbum = () => {
    window.open(shareUrl, "_blank", "noopener,noreferrer");
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex w-full max-w-sm flex-col rounded-xl border border-border bg-card shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">Share Album</h2>
            <p className="mt-0.5 text-xs text-muted-foreground truncate max-w-[240px]">
              {projectName}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-4 p-6">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Public Link
            </label>
            <div className="flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2">
              <span className="flex-1 truncate text-sm text-foreground">{shareUrl}</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-border px-6 py-4">
          <Button variant="outline" type="button" onClick={handleOpenAlbum}>
            <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
            Open Album
          </Button>
          <Button type="button" onClick={handleCopy}>
            {copied ? (
              <Check className="mr-1.5 h-3.5 w-3.5" />
            ) : (
              <Copy className="mr-1.5 h-3.5 w-3.5" />
            )}
            {copied ? "Copied!" : "Copy Link"}
          </Button>
        </div>
      </div>
    </div>
  );
}
