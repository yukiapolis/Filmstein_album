"use client";

import { Check } from "lucide-react";
import type { Photo } from "@/data/mockData";
import { colorLabelMap } from "@/data/mockData";
import PhotoStatusBadge from "@/components/PhotoStatusBadge";

interface PhotoCardProps {
  photo: Photo;
  onClick?: () => void;
}

const PhotoCard = ({ photo, onClick }: PhotoCardProps) => {
  const colorInfo = photo.colorLabel !== "none" ? colorLabelMap[photo.colorLabel] : null;

  return (
    <div className="group relative overflow-hidden rounded-lg bg-muted cursor-pointer" onClick={onClick}>
      <div className="aspect-[4/3] overflow-hidden">
        <img
          src={photo.url}
          alt={photo.fileName}
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          loading="lazy"
        />
      </div>
      {photo.selected && (
        <div className="absolute top-2 right-2 h-6 w-6 rounded-full bg-primary flex items-center justify-center">
          <Check className="h-3.5 w-3.5 text-primary-foreground" />
        </div>
      )}
      {colorInfo && (
        <div className={`absolute top-2 left-2 h-3.5 w-3.5 rounded-full ${colorInfo.bg} ring-2 ring-white/80`} />
      )}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-3 pt-8 opacity-0 transition-opacity group-hover:opacity-100">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-white">{photo.fileName}</p>
            <p className="text-xs text-white/70">{photo.tag}</p>
          </div>
          <PhotoStatusBadge status={photo.photoStatus} />
        </div>
      </div>
    </div>
  );
};

export default PhotoCard;
