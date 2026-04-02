"use client";

import { Check, Heart } from "lucide-react";
import type { Photo } from "@/data/mockData";
import { colorLabelMap } from "@/data/mockData";

interface PhotoCardProps {
  photo: Photo;
  onClick?: () => void;
  /** Selection mode */
  selected?: boolean;
  onSelect?: (selected: boolean) => void;
}

const PhotoCard = ({ photo, onClick, selected, onSelect }: PhotoCardProps) => {
  const colorInfo = photo.colorLabel !== "none" ? colorLabelMap[photo.colorLabel] : null;

  const handleCheckboxClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect?.(!selected);
  };

  return (
    <div
      className="group relative overflow-hidden rounded-lg bg-muted cursor-pointer"
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

      {/* Color label dot - top left */}
      {colorInfo && (
        <div className={`absolute top-2 left-2 h-3.5 w-3.5 rounded-full ${colorInfo.bg} ring-2 ring-white/80`} />
      )}

      {/* Status badge - top left (below color dot if both exist) */}
      {photo.photoStatus === "original" && (
        <div className="absolute top-2 left-2 z-10">
          <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            original
          </span>
        </div>
      )}

      {/* Favorite/selection indicator - top right (future use) */}
      {photo.selected && (
        <div className="absolute top-2 right-2 flex h-7 w-7 items-center justify-center rounded-full bg-primary/80 backdrop-blur-sm">
          <Heart className="h-3.5 w-3.5 fill-current text-primary-foreground" />
        </div>
      )}

      {/* Download selection checkbox - bottom right */}
      {onSelect !== undefined && (
        <button
          type="button"
          onClick={handleCheckboxClick}
          className={`absolute bottom-2 right-2 z-10 flex h-9 w-9 items-center justify-center rounded-md border-2 transition-all ${
            selected
              ? "bg-primary border-primary opacity-100"
              : "bg-black/40 border-white/60 opacity-60 group-hover:opacity-100 hover:border-white"
          }`}
        >
          {selected && <Check className="h-3.5 w-3.5 text-primary-foreground" />}
        </button>
      )}

      {/* Legacy selected indicator (when selection mode is not active) */}
      {selected === undefined && photo.selected && (
        <div className="absolute bottom-2 right-2 h-6 w-6 rounded-md bg-primary flex items-center justify-center">
          <Check className="h-3.5 w-3.5 text-primary-foreground" />
        </div>
      )}

      {/* Bottom info overlay */}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-3 pt-8 opacity-0 transition-opacity group-hover:opacity-100 pointer-events-none">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-white">{photo.fileName}</p>
            <p className="text-xs text-white/70">{photo.tag}</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PhotoCard;
