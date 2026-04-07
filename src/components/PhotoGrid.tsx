"use client";

import { useState, useMemo } from "react";
import type { Photo, Album, Project } from "@/data/mockData";
import PhotoCard from "@/components/PhotoCard";
import PhotoPreviewModal from "@/components/PhotoPreviewModal";
import EmptyPhotosState from "@/components/EmptyPhotosState";

export type ViewMode = "browse" | "grid" | "list";

interface PhotoGridProps {
  photos: Photo[];
  viewMode?: ViewMode;
  albums?: Album[];
  onAlbumClick?: (albumId: string) => void;
  onToggleSelect?: (photoId: string, selected: boolean) => void;
  selectedIds?: string[];
  cardVariant?: "gallery" | "overlay";
  hideStatusBadge?: boolean;
  hideMetaOverlay?: boolean;
  hideDownloadButton?: boolean;
  clientDownloadMode?: boolean;
  gridClassName?: string;
  onDeletePhoto?: (photo: Photo) => Promise<void> | void;
  onDeleteAllVersions?: (photo: Photo) => Promise<void> | void;
  onTogglePublish?: (photo: Photo, isPublished: boolean) => Promise<void> | void;
  forceSquareCards?: boolean;
  project?: Project | null;
}

const PhotoGrid = ({
  photos,
  viewMode = "browse",
  onToggleSelect,
  selectedIds = [],
  cardVariant = "gallery",
  hideStatusBadge = false,
  hideMetaOverlay = false,
  hideDownloadButton = false,
  clientDownloadMode = false,
  gridClassName,
  onDeletePhoto,
  onDeleteAllVersions,
  onTogglePublish,
  forceSquareCards = false,
  project = null,
}: PhotoGridProps) => {
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  const isPhotoSelected = (photoId: string) => selectedIds.includes(photoId);
  const selectionActive = Boolean(onToggleSelect);
  const selectionMode = useMemo(() => selectedIds.length > 0, [selectedIds.length]);

  if (viewMode === "list") {
    const isEmpty = photos.length === 0;
    return (
      <>
        <div className="flex flex-col gap-1">
          {photos.map((photo, i) => {
            const listThumbSrc = (photo as Photo & { thumbUrl?: string }).thumbUrl || photo.url;
            return (
              <div
                key={photo.id}
                className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${
                  isPhotoSelected(photo.id) ? "border-sky-400 bg-sky-50/50" : "border-border bg-card hover:bg-accent/50"
                }`}
                onClick={() => setPreviewIndex(i)}
              >
                {selectionActive && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleSelect?.(photo.id, !isPhotoSelected(photo.id));
                    }}
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-all ${
                      isPhotoSelected(photo.id) ? "border-sky-600 bg-sky-600" : "border-muted-foreground"
                    }`}
                  >
                    {isPhotoSelected(photo.id) && <span className="text-xs text-white">✓</span>}
                  </button>
                )}
                <img src={listThumbSrc} alt={photo.fileName} className="h-10 w-10 shrink-0 rounded object-cover" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{photo.fileName}</p>
                  <p className="text-xs text-muted-foreground">{photo.tag}</p>
                </div>
                <p className="hidden text-xs text-muted-foreground sm:block">{photo.uploadedAt}</p>
              </div>
            );
          })}
        </div>
        {isEmpty && <EmptyPhotosState title="No photos in this album" description="Upload photos to see them here." />}
        {previewIndex !== null && (
          <PhotoPreviewModal
            photos={photos}
            initialIndex={previewIndex}
            open
            onClose={() => setPreviewIndex(null)}
            onDeleteCurrent={onDeletePhoto}
            onDeleteAllVersions={onDeleteAllVersions}
            onTogglePublish={onTogglePublish}
            clientDownloadMode={clientDownloadMode}
            project={project}
          />
        )}
      </>
    );
  }

  const isEmpty = photos.length === 0;
  const isMasonry = Boolean(gridClassName?.includes('columns-'))

  return (
    <>
      <div className={gridClassName || "grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4"}>
        {photos.map((photo, i) => (
          <div key={photo.id} className={isMasonry ? 'mb-3 break-inside-avoid' : ''}>
            <PhotoCard
              photo={photo}
              variant={cardVariant}
              onClick={() => setPreviewIndex(i)}
              selected={selectionActive ? isPhotoSelected(photo.id) : undefined}
              selectionMode={selectionMode}
              onSelect={selectionActive ? (s) => onToggleSelect?.(photo.id, s) : undefined}
              hideStatusBadge={hideStatusBadge}
              hideMetaOverlay={hideMetaOverlay}
              hideDownloadButton={hideDownloadButton}
              clientDownloadMode={clientDownloadMode}
              forceSquare={forceSquareCards}
            />
          </div>
        ))}
      </div>
      {isEmpty && <EmptyPhotosState title="No photos yet" description="Upload photos to get started." />}
      {previewIndex !== null && (
        <PhotoPreviewModal
          photos={photos}
          initialIndex={previewIndex}
          open
          onClose={() => setPreviewIndex(null)}
          onDeleteCurrent={onDeletePhoto}
          onDeleteAllVersions={onDeleteAllVersions}
          onTogglePublish={onTogglePublish}
          clientDownloadMode={clientDownloadMode}
          project={project}
        />
      )}
    </>
  );
};

export default PhotoGrid;
