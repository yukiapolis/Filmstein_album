"use client";

import { useState, useEffect, useCallback } from "react";
import { X, ChevronLeft, ChevronRight, Download, Heart } from "lucide-react";
import type { Photo } from "@/data/mockData";
import { Button } from "@/components/ui/button";

interface PhotoPreviewModalProps {
  photos: Photo[];
  initialIndex: number;
  open: boolean;
  onClose: () => void;
}

const PhotoPreviewModal = ({ photos, initialIndex, open, onClose }: PhotoPreviewModalProps) => {
  const [index, setIndex] = useState(initialIndex);

  const prev = useCallback(() => setIndex((i) => (i > 0 ? i - 1 : photos.length - 1)), [photos.length]);
  const next = useCallback(() => setIndex((i) => (i < photos.length - 1 ? i + 1 : 0)), [photos.length]);

  /** Keyboard navigation: Escape closes, ArrowLeft/ArrowRight navigate. */
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

  const photo = photos[index];

  const handleDownload = async () => {
    const src = photo.url || photo.file_url;
    const filename =
      (photo as unknown as Record<string, unknown>).original_name as string ||
      (photo as unknown as Record<string, unknown>).name as string ||
      photo.fileName ||
      "photo.jpg";

    if (!src) return;

    try {
      const res = await fetch(src);
      if (!res.ok) throw new Error("Network response was not ok");
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch {
      window.open(src, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90" onClick={onClose}>
      <div className="absolute top-4 right-4 z-10 flex items-center gap-2">
        <Button size="icon" variant="ghost" className="text-white hover:bg-white/10" onClick={(e) => { e.stopPropagation(); }}>
          <Heart className="h-5 w-5" />
        </Button>
        <Button size="icon" variant="ghost" className="text-white hover:bg-white/10" onClick={(e) => { e.stopPropagation(); handleDownload(); }}>
          <Download className="h-5 w-5" />
        </Button>
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
        <img
          src={photo.url}
          alt={photo.fileName}
          className="max-h-[85vh] max-w-[85vw] object-contain"
        />
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
    </div>
  );
};

export default PhotoPreviewModal;
