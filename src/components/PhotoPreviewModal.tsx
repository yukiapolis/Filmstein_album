"use client";

import { useState, useEffect, useCallback } from "react";
import { X, ChevronLeft, ChevronRight, Download, Heart, Trash2 } from "lucide-react";
import type { Photo } from "@/data/mockData";
import { Button } from "@/components/ui/button";

interface PhotoPreviewModalProps {
  photos: Photo[];
  initialIndex: number;
  open: boolean;
  onClose: () => void;
  onDeleteCurrent?: (photo: Photo) => Promise<void> | void;
  onTogglePublish?: (photo: Photo, isPublished: boolean) => Promise<void> | void;
}

const PhotoPreviewModal = ({ photos, initialIndex, open, onClose, onDeleteCurrent, onTogglePublish }: PhotoPreviewModalProps) => {
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
    displayFileId?: string;
  };

  const openDownload = (variant: "display" | "original") => {
    const a = document.createElement("a");
    a.href = `/api/photos/${photo.id}/download?variant=${variant}`;
    a.download = photo.fileName || "photo.jpg";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setShowDownloadMenu(false);
  };

  const handleDelete = async () => {
    if (!onDeleteCurrent) return;
    setDeleting(true);
    try {
      await onDeleteCurrent(photo);
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
          original
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
              <button
                type="button"
                className="block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-muted"
                onClick={(e) => {
                  e.stopPropagation();
                  openDownload("display");
                }}
              >
                下载当前版本
              </button>
              <button
                type="button"
                className="block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-muted"
                onClick={(e) => {
                  e.stopPropagation();
                  openDownload("original");
                }}
              >
                下载原图
              </button>
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

      <div className="max-h-[85vh] max-w-[85vw]" onClick={(e) => e.stopPropagation()}>
        <div className="relative">
          <img
            src={photo.displayUrl || photo.file_url || photo.url}
            alt={photo.fileName}
            className="max-h-[85vh] max-w-[85vw] object-contain"
          />
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
              这会删除当前图片的全部版本，并删除对应逻辑照片。此操作不可恢复。
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setShowDeleteConfirm(false)} disabled={deleting}>
                取消
              </Button>
              <Button type="button" variant="destructive" onClick={() => void handleDelete()} disabled={deleting}>
                {deleting ? '删除中…' : '确认删除'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PhotoPreviewModal;
