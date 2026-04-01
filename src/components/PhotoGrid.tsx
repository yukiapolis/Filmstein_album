"use client";

import { useState } from "react";
import { FolderOpen, ChevronRight } from "lucide-react";
import type { Photo, Album } from "@/data/mockData";
import PhotoCard from "@/components/PhotoCard";
import PhotoPreviewModal from "@/components/PhotoPreviewModal";
import EmptyPhotosState from "@/components/EmptyPhotosState";

export type ViewMode = "browse" | "grid" | "list";

interface PhotoGridProps {
  photos: Photo[];
  viewMode?: ViewMode;
  albums?: Album[];
  onAlbumClick?: (albumId: string) => void;
  /** Selection mode */
  selectionMode?: boolean;
  selectedIds?: string[];
  onToggleSelect?: (photoId: string, selected: boolean) => void;
}

const PhotoGrid = ({
  photos,
  viewMode = "browse",
  albums = [],
  onAlbumClick,
  selectionMode = false,
  selectedIds = [],
  onToggleSelect,
}: PhotoGridProps) => {
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  const isPhotoSelected = (photoId: string) => selectedIds.includes(photoId);

  if (viewMode === "list") {
    const isEmpty = albums.length === 0 && photos.length === 0;
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
            <div
              key={photo.id}
              className={`flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 text-left hover:bg-accent/50 transition-colors ${
                selectionMode ? "cursor-default" : "cursor-pointer"
              } ${isPhotoSelected(photo.id) ? "border-primary ring-2 ring-primary/20" : ""}`}
              onClick={() => {
                if (selectionMode) {
                  onToggleSelect?.(photo.id, !isPhotoSelected(photo.id));
                } else {
                  setPreviewIndex(i);
                }
              }}
            >
              {selectionMode && (
                <div
                  className={`h-5 w-5 rounded border-2 flex items-center justify-center shrink-0 ${
                    isPhotoSelected(photo.id)
                      ? "bg-primary border-primary"
                      : "border-muted-foreground"
                  }`}
                >
                  {isPhotoSelected(photo.id) && <span className="text-primary-foreground text-xs">✓</span>}
                </div>
              )}
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
            </div>
          ))}
        </div>
        {isEmpty && (
          <EmptyPhotosState
            title="No photos in this album"
            description="Upload photos to see them here."
          />
        )}
        {previewIndex !== null && !selectionMode && (
          <PhotoPreviewModal photos={photos} initialIndex={previewIndex} open onClose={() => setPreviewIndex(null)} />
        )}
      </>
    );
  }

  if (viewMode === "grid") {
    const isEmpty = albums.length === 0 && photos.length === 0;
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
            selectionMode ? (
              <PhotoCard
                key={photo.id}
                photo={photo}
                selected={isPhotoSelected(photo.id)}
                onSelect={(s) => onToggleSelect?.(photo.id, s)}
              />
            ) : (
              <PhotoCard key={photo.id} photo={photo} onClick={() => setPreviewIndex(i)} />
            )
          ))}
        </div>
        {isEmpty && (
          <EmptyPhotosState
            title="No photos yet"
            description="Upload photos to get started."
          />
        )}
        {previewIndex !== null && !selectionMode && (
          <PhotoPreviewModal photos={photos} initialIndex={previewIndex} open onClose={() => setPreviewIndex(null)} />
        )}
      </>
    );
  }

  // Browse mode
  return (
    <>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {photos.map((photo, i) => (
          selectionMode ? (
            <PhotoCard
              key={photo.id}
              photo={photo}
              selected={isPhotoSelected(photo.id)}
              onSelect={(s) => onToggleSelect?.(photo.id, s)}
            />
          ) : (
            <PhotoCard key={photo.id} photo={photo} onClick={() => setPreviewIndex(i)} />
          )
        ))}
      </div>
      {photos.length === 0 && (
        <EmptyPhotosState
          title="No photos yet"
          description="Upload photos to get started."
        />
      )}
      {previewIndex !== null && !selectionMode && (
        <PhotoPreviewModal photos={photos} initialIndex={previewIndex} open onClose={() => setPreviewIndex(null)} />
      )}
    </>
  );
};

export default PhotoGrid;
