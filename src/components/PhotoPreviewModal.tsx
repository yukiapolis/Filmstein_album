"use client";

import { useState, useEffect, useCallback } from "react";
import { X, ChevronLeft, ChevronRight, Download, Heart, Trash2 } from "lucide-react";
import type { Photo } from "@/data/mockData";
import { Button } from "@/components/ui/button";
import type { Project } from "@/data/mockData";
import { getClientWatermarkConfig } from "@/lib/clientWatermark";

interface PhotoPreviewModalProps {
  photos: Photo[];
  initialIndex: number;
  open: boolean;
  onClose: () => void;
  onDeleteCurrent?: (photo: Photo) => Promise<void> | void;
  onDeleteAllVersions?: (photo: Photo) => Promise<void> | void;
  onTogglePublish?: (photo: Photo, isPublished: boolean) => Promise<void> | void;
  clientDownloadMode?: boolean;
  project?: Project | null;
}

const PhotoPreviewModal = ({ photos, initialIndex, open, onClose, onDeleteCurrent, onDeleteAllVersions, onTogglePublish, clientDownloadMode = false, project = null }: PhotoPreviewModalProps) => {
  const [index, setIndex] = useState(initialIndex);
  const [showDownloadMenu, setShowDownloadMenu] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const prev = useCallback(() => setIndex((i) => (i > 0 ? i - 1 : photos.length - 1)), [photos.length]);
  const next = useCallback(() => setIndex((i) => (i < photos.length - 1 ? i + 1 : 0)), [photos.length]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") prev();
      if (e.key === "ArrowRight") next();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose, prev, next]);

  if (!open || photos.length === 0) return null;

  const photo = photos[index] as Photo & {
    displayUrl?: string;
    originalUrl?: string;
    retouchedOriginalUrl?: string;
    displayFileId?: string;
    versionCount?: number;
    latestVersionNo?: number;
  };

  const watermarkConfig = getClientWatermarkConfig(project)

  const openDownload = async (variant: "current" | "retouched-original" | "original" | "client-display" | "client-original") => {
    const url = clientDownloadMode
      ? `/api/photos/${photo.id}/client-render?mode=${variant === 'client-original' ? 'download' : 'download'}`
      : `/api/photos/${photo.id}/download?variant=${variant}`;
    const check = await fetch(url, { method: "HEAD" });
    if (!check.ok) {
      const body = await check.json().catch(() => ({}));
      alert(body.error || "Download failed");
      setShowDownloadMenu(false);
      return;
    }

    const a = document.createElement("a");
    a.href = url;
    a.download = photo.fileName || "photo.jpg";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setShowDownloadMenu(false);
  };

  const handleDelete = async (mode: 'current' | 'all') => {
    const action = mode === 'all' ? onDeleteAllVersions : onDeleteCurrent;
    if (!action) return;
    setDeleting(true);
    try {
      await action(photo);
      onClose();
    } finally {
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90" onClick={onClose}>
      <div className="absolute left-4 top-4 z-10 flex items-center gap-2">
        <span className="inline-flex items-center rounded-md border border-border/80 bg-white/95 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground shadow-sm">
          {(photo.versionCount || 1) > 1 ? 'retouched' : 'original'}
        </span>
        {photo.isPublished === false && (
          <span className="inline-flex items-center rounded-md bg-black/70 px-2 py-0.5 text-[10px] font-semibold text-white shadow-sm">
            未发布
          </span>
        )}
      </div>

      <div className="absolute top-4 right-4 z-10 flex items-center gap-2">
        <Button size="icon" variant="ghost" className="text-white hover:bg-white/10" onClick={(e) => { e.stopPropagation(); }}>
          <Heart className="h-5 w-5" />
        </Button>
        {onTogglePublish && (
          <Button
            size="sm"
            variant="ghost"
            className="text-white hover:bg-white/10"
            onClick={(e) => {
              e.stopPropagation();
              void onTogglePublish(photo, !photo.isPublished);
            }}
          >
            {photo.isPublished ? '取消发布' : '发布'}
          </Button>
        )}
        {onDeleteCurrent && (
          <Button size="icon" variant="ghost" className="text-white hover:bg-white/10" onClick={(e) => { e.stopPropagation(); setShowDeleteConfirm(true); }} disabled={deleting}>
            <Trash2 className="h-5 w-5" />
          </Button>
        )}
        <div className="relative">
          <Button size="icon" variant="ghost" className="text-white hover:bg-white/10" onClick={(e) => { e.stopPropagation(); setShowDownloadMenu((v) => !v); }}>
            <Download className="h-5 w-5" />
          </Button>
          {showDownloadMenu && (
            <div className="absolute right-0 top-10 z-30 min-w-40 rounded-lg border border-border bg-card p-1 text-foreground shadow-lg">
              {clientDownloadMode ? (
                <>
                  <button
                    type="button"
                    className="block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-muted"
                    onClick={(e) => {
                      e.stopPropagation();
                      void openDownload("client-display");
                    }}
                  >
                    下载带水印图片
                  </button>
                  <button
                    type="button"
                    className="block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-muted"
                    onClick={(e) => {
                      e.stopPropagation();
                      void openDownload("client-original");
                    }}
                  >
                    下载带水印大图
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-muted"
                    onClick={(e) => {
                      e.stopPropagation();
                      void openDownload("current");
                    }}
                  >
                    下载当前版本
                  </button>
                  {(photo.versionCount || 1) > 1 && (
                    <button
                      type="button"
                      className="block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-muted"
                      onClick={(e) => {
                        e.stopPropagation();
                        void openDownload("retouched-original");
                      }}
                    >
                      下载修图原图
                    </button>
                  )}
                  <button
                    type="button"
                    className="block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-muted"
                    onClick={(e) => {
                      e.stopPropagation();
                      void openDownload("original");
                    }}
                  >
                    下载最初原图
                  </button>
                </>
              )}
            </div>
          )}
        </div>
        <Button size="icon" variant="ghost" className="text-white hover:bg-white/10" onClick={onClose}>
          <X className="h-5 w-5" />
        </Button>
      </div>

      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); prev(); }}
        className="absolute left-4 z-10 rounded-full bg-white/10 p-2 text-white hover:bg-white/20 transition-colors"
      >
        <ChevronLeft className="h-6 w-6" />
      </button>

      <div className="max-h-[85vh] w-[min(92vw,1200px)]" onClick={(e) => e.stopPropagation()}>
        <div className="relative flex max-h-[85vh] items-center justify-center overflow-hidden rounded-xl bg-black/40">
          <img
            src={clientDownloadMode ? `/api/photos/${photo.id}/client-render?mode=preview` : (photo.displayUrl || photo.file_url || photo.url)}
            alt={photo.fileName}
            className="max-h-[85vh] max-w-full object-contain"
          />
          {clientDownloadMode && watermarkConfig.enabled && watermarkConfig.logoUrl && false && null}
          {photo.isPublished === false && (
            <div className="absolute inset-0 bg-black/20 pointer-events-none" />
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); next(); }}
        className="absolute right-4 z-10 rounded-full bg-white/10 p-2 text-white hover:bg-white/20 transition-colors"
      >
        <ChevronRight className="h-6 w-6" />
      </button>

      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-sm text-white/70">
        {photo.fileName} · {index + 1} / {photos.length}
      </div>

      {showDeleteConfirm && (
        <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/60" onClick={(e) => e.stopPropagation()}>
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-5 text-foreground shadow-2xl">
            <h3 className="text-base font-semibold">确认删除</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              {onDeleteCurrent && onDeleteAllVersions
                ? '你可以删除该图片当前最新版，或删除整张图片及全部版本。'
                : '这会删除当前图片的全部版本，并删除对应逻辑照片。此操作不可恢复。'}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setShowDeleteConfirm(false)} disabled={deleting}>
                取消
              </Button>
              {onDeleteCurrent && onDeleteAllVersions && (
                <Button type="button" variant="outline" onClick={() => void handleDelete('current')} disabled={deleting}>
                  {deleting ? '删除中…' : '删除当前最新版'}
                </Button>
              )}
              <Button type="button" variant="destructive" onClick={() => void handleDelete('all')} disabled={deleting}>
                {deleting ? '删除中…' : '删除整张图片'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PhotoPreviewModal;
