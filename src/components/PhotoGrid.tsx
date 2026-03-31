"use client";

import { useState } from "react";
import { FolderOpen, ChevronRight } from "lucide-react";
import type { Photo, Album } from "@/data/mockData";
import PhotoCard from "@/components/PhotoCard";
import PhotoPreviewModal from "@/components/PhotoPreviewModal";

export type ViewMode = "browse" | "grid" | "list";

interface PhotoGridProps {
  photos: Photo[];
  viewMode?: ViewMode;
  albums?: Album[];
  onAlbumClick?: (albumId: string) => void;
}

const PhotoGrid = ({ photos, viewMode = "browse", albums = [], onAlbumClick }: PhotoGridProps) => {
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  if (viewMode === "list") {
    return (
      <>
        <div className="flex flex-col gap-1">
          {albums.map((album) => (
            <button
              key={album.id}
              type="button"
              onClick={() => onAlbumClick?.(album.id)}
              className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-left hover:bg-accent/50 transition-colors group"
            >
              <FolderOpen className="h-5 w-5 shrink-0 text-primary" />
              <span className="text-sm font-medium text-foreground flex-1 truncate">{album.name}</span>
              <span className="text-xs text-muted-foreground">{album.photoCount} photos</span>
              <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
            </button>
          ))}
          {photos.map((photo, i) => (
            <button
              key={photo.id}
              type="button"
              onClick={() => setPreviewIndex(i)}
              className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 text-left hover:bg-accent/50 transition-colors"
            >
              <img
                src={photo.url}
                alt={photo.fileName}
                className="h-10 w-10 rounded object-cover shrink-0"
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground truncate">{photo.fileName}</p>
                <p className="text-xs text-muted-foreground">{photo.tag}</p>
              </div>
              <p className="text-xs text-muted-foreground hidden sm:block">{photo.uploadedAt}</p>
              {photo.colorLabel && photo.colorLabel !== "none" && (
                <span
                  className="h-3 w-3 rounded-full shrink-0"
                  style={{
                    backgroundColor:
                      photo.colorLabel === "red" ? "hsl(0 84% 60%)" :
                      photo.colorLabel === "green" ? "hsl(142 71% 45%)" :
                      photo.colorLabel === "blue" ? "hsl(217 91% 60%)" :
                      photo.colorLabel === "yellow" ? "hsl(48 96% 53%)" :
                      "hsl(271 91% 65%)",
                  }}
                />
              )}
            </button>
          ))}
        </div>
        {previewIndex !== null && (
          <PhotoPreviewModal photos={photos} initialIndex={previewIndex} open onClose={() => setPreviewIndex(null)} />
        )}
      </>
    );
  }

  if (viewMode === "grid") {
    return (
      <>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {albums.map((album) => (
            <button
              key={album.id}
              type="button"
              onClick={() => onAlbumClick?.(album.id)}
              className="group flex flex-col items-center justify-center gap-2 rounded-xl border border-border bg-card p-6 hover:bg-accent/50 hover:border-primary/30 transition-colors aspect-square"
            >
              <FolderOpen className="h-10 w-10 text-primary opacity-80 group-hover:opacity-100 transition-opacity" />
              <span className="text-sm font-medium text-foreground truncate max-w-full">{album.name}</span>
              <span className="text-xs text-muted-foreground">{album.photoCount} photos</span>
            </button>
          ))}
          {photos.map((photo, i) => (
            <PhotoCard key={photo.id} photo={photo} onClick={() => setPreviewIndex(i)} />
          ))}
        </div>
        {previewIndex !== null && (
          <PhotoPreviewModal photos={photos} initialIndex={previewIndex} open onClose={() => setPreviewIndex(null)} />
        )}
      </>
    );
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {photos.map((photo, i) => (
          <PhotoCard key={photo.id} photo={photo} onClick={() => setPreviewIndex(i)} />
        ))}
      </div>
      {previewIndex !== null && (
        <PhotoPreviewModal photos={photos} initialIndex={previewIndex} open onClose={() => setPreviewIndex(null)} />
      )}
    </>
  );
};

export default PhotoGrid;
