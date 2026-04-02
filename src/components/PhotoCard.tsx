"use client";

import { Check, Download } from "lucide-react";
import type { Photo } from "@/data/mockData";
import { colorLabelMap } from "@/data/mockData";
import { cn } from "@/lib/utils";

interface PhotoCardProps {
  photo: Photo;
  onClick?: () => void;
  /** Whether this photo is selected */
  selected?: boolean;
  /** Callback when user toggles selection via the checkbox */
  onSelect?: (selected: boolean) => void;
  /**
   * When true, the checkbox stays visible once any selection is made.
   * When false (default), the checkbox only appears on hover.
   */
  selectionMode?: boolean;
  /** gallery = metadata below image (DAM-style); overlay = hover-only caption on image */
  variant?: "gallery" | "overlay";
}

const PhotoCard = ({
  photo,
  onClick,
  selected,
  onSelect,
  selectionMode = false,
  variant = "gallery",
}: PhotoCardProps) => {
  const colorInfo =
    photo.colorLabel !== "none" ? colorLabelMap[photo.colorLabel] : null;
  const isEdited = photo.photoStatus === "edited";

  const handleCheckboxClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect?.(!selected);
  };

  const handleDownloadClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const href = photo.file_url || photo.url;
    if (href) window.open(href, "_blank", "noopener,noreferrer");
  };

  if (variant === "overlay") {
    return (
      <div
        className="group relative cursor-pointer overflow-hidden rounded-lg bg-muted"
        onClick={onClick}
      >
        <div className="overflow-hidden">
          <img
            src={photo.url}
            alt={photo.fileName}
            className="w-full object-cover transition-transform duration-300 group-hover:scale-105"
            loading="lazy"
          />
        </div>

        {selected && (
          <div className="absolute inset-0 z-10 bg-black/25" />
        )}

        {colorInfo && (
          <div
            className={`absolute bottom-2 left-2 z-20 h-3.5 w-3.5 rounded-full ${colorInfo.bg} ring-2 ring-white/80`}
          />
        )}

        {photo.photoStatus === "original" && (
          <div className="absolute top-2 left-2 z-20">
            <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              original
            </span>
          </div>
        )}

        {onSelect !== undefined && (
          <button
            type="button"
            onClick={handleCheckboxClick}
            className={cn(
              "absolute bottom-2 right-2 z-20 flex h-9 w-9 items-center justify-center rounded-md border-2 transition-all",
              selected
                ? "border-primary bg-primary opacity-100"
                : selectionMode
                  ? "border-white/80 bg-black/40 opacity-100"
                  : "border-white/60 bg-black/40 opacity-0 group-hover:opacity-100",
            )}
          >
            {selected && <Check className="h-3.5 w-3.5 text-primary-foreground" />}
          </button>
        )}

        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-3 pt-8 opacity-0 transition-opacity group-hover:opacity-100">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-white">{photo.fileName}</p>
              <p className="text-xs text-white/70">{photo.tag}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // —— gallery / DAM layout ——
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-all",
        selected
          ? "ring-2 ring-sky-500/70 shadow-md"
          : "hover:shadow-md",
      )}
    >
      <div
        className={cn(
          "group relative aspect-[4/3] cursor-pointer overflow-hidden bg-muted",
        )}
        onClick={onClick}
      >
        <img
          src={photo.url}
          alt={photo.fileName}
          className={cn(
            "h-full w-full object-cover transition-all duration-300",
            selected
              ? "scale-[0.97] brightness-50"
              : "group-hover:scale-[1.02]",
          )}
          loading="lazy"
        />

        {/* Selected dimming overlay */}
        {selected && (
          <div className="absolute inset-0 z-10 bg-black/20 pointer-events-none" />
        )}

        {/* Status badge — top left */}
        <div className="absolute left-2 top-2 z-20">
          <span
            className={cn(
              "inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
              isEdited
                ? "bg-sky-600 text-white shadow-sm"
                : "border border-border/80 bg-white/95 text-muted-foreground shadow-sm",
            )}
          >
            {isEdited ? "edited" : "original"}
          </span>
        </div>

        {/* Selected checkmark — top right */}
        {selected && (
          <div className="absolute right-2 top-2 z-20 flex h-6 w-6 items-center justify-center rounded-full bg-sky-600 text-white shadow-sm">
            <Check className="h-3.5 w-3.5" />
          </div>
        )}

        {/* Color label — bottom left */}
        {colorInfo && (
          <div
            className={`absolute bottom-2 left-2 z-20 h-3 w-3 rounded-full ${colorInfo.bg} ring-2 ring-white/90`}
          />
        )}

        {/* Selection checkbox — bottom right */}
        {onSelect !== undefined && (
          <button
            type="button"
            onClick={handleCheckboxClick}
            className={cn(
              "absolute bottom-2 right-2 z-20 flex h-8 w-8 items-center justify-center rounded border-2 transition-all",
              selected
                ? "border-sky-600 bg-sky-600 text-white"
                : selectionMode
                  ? "border-white/80 bg-black/40 text-white opacity-100"
                  : "border-white/80 bg-black/40 text-white opacity-0 group-hover:opacity-100",
            )}
            aria-label={selected ? "Deselect" : "Select"}
          >
            {selected && <Check className="h-4 w-4" />}
          </button>
        )}
      </div>

      <div className="flex items-start justify-between gap-2 border-t border-border/60 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "truncate text-sm font-medium transition-colors",
              selected ? "text-muted-foreground" : "text-foreground",
            )}
          >
            {photo.fileName}
          </p>
          <p
            className={cn(
              "text-xs font-medium",
              isEdited ? "text-sky-600" : "text-muted-foreground",
            )}
          >
            {isEdited ? "Edited" : "Original"}
          </p>
        </div>
        <button
          type="button"
          onClick={handleDownloadClick}
          className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="Download"
          aria-label="Download"
        >
          <Download className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};

export default PhotoCard;
