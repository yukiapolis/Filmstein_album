"use client";

import { useState, useMemo } from "react";
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
  /** When set, photo cards show selection checkboxes */
  onToggleSelect?: (photoId: string, selected: boolean) => void;
  selectedIds?: string[];
  /** Card layout: gallery shows filename row below image */
  cardVariant?: "gallery" | "overlay";
}

const PhotoGrid = ({
  photos,
  viewMode = "browse",
  albums = [],
  onAlbumClick,
  onToggleSelect,
  selectedIds = [],
  cardVariant = "gallery",
}: PhotoGridProps) => {
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  const isPhotoSelected = (photoId: string) => selectedIds.includes(photoId);
  const selectionActive = Boolean(onToggleSelect);
  const selectionMode = useMemo(
    () => selectedIds.length > 0,
    [selectedIds.length],
  );

  if (viewMode === "list") {
    const isEmpty = photos.length === 0;
    return (
      <>
        <div className="flex flex-col gap-1">
          {photos.map((photo, i) => (
            <div
              key={photo.id}
              className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${
                selectionActive ? "cursor-default" : "cursor-pointer hover:bg-accent/50"
              } ${
                isPhotoSelected(photo.id)
                  ? "border-sky-400 bg-sky-50/50"
                  : "border-border bg-card"
              }`}
              onClick={() => {
                if (selectionActive) {
                  onToggleSelect?.(photo.id, !isPhotoSelected(photo.id));
                } else {
                  setPreviewIndex(i);
                }
              }}
            >
              {selectionActive && (
                <div
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 ${
                    isPhotoSelected(photo.id)
                      ? "border-sky-600 bg-sky-600"
                      : "border-muted-foreground"
                  }`}
                >
                  {isPhotoSelected(photo.id) && (
                    <span className="text-xs text-white">✓</span>
                  )}
                </div>
              )}
              <img
                src={photo.url}
                alt={photo.fileName}
                className="h-10 w-10 shrink-0 rounded object-cover"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{photo.fileName}</p>
                <p className="text-xs text-muted-foreground">{photo.tag}</p>
              </div>
              <p className="hidden text-xs text-muted-foreground sm:block">{photo.uploadedAt}</p>
              {photo.colorLabel && photo.colorLabel !== "none" && (
                <span
                  className="h-3 w-3 shrink-0 rounded-full"
                  style={{
                    backgroundColor:
                      photo.colorLabel === "red"
                        ? "hsl(0 84% 60%)"
                        : photo.colorLabel === "green"
                          ? "hsl(142 71% 45%)"
                          : photo.colorLabel === "blue"
                            ? "hsl(217 91% 60%)"
                            : photo.colorLabel === "yellow"
                              ? "hsl(48 96% 53%)"
                              : "hsl(271 91% 65%)",
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
        {previewIndex !== null && !selectionActive && (
          <PhotoPreviewModal
            photos={photos}
            initialIndex={previewIndex}
            open
            onClose={() => setPreviewIndex(null)}
          />
        )}
      </>
    );
  }

  // Grid + browse: responsive photo grid (screenshot-style)
  const isEmpty = photos.length === 0;
  return (
    <>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {photos.map((photo, i) => (
          <PhotoCard
            key={photo.id}
            photo={photo}
            variant={cardVariant}
            onClick={() => setPreviewIndex(i)}
            selected={selectionActive ? isPhotoSelected(photo.id) : undefined}
            selectionMode={selectionMode}
            onSelect={
              selectionActive ? (s) => onToggleSelect?.(photo.id, s) : undefined
            }
          />
        ))}
      </div>
      {isEmpty && (
        <EmptyPhotosState title="No photos yet" description="Upload photos to get started." />
      )}
      {previewIndex !== null && !selectionActive && (
        <PhotoPreviewModal
          photos={photos}
          initialIndex={previewIndex}
          open
          onClose={() => setPreviewIndex(null)}
        />
      )}
    </>
  );
};

export default PhotoGrid;
