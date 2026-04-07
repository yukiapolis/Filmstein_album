"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Download } from "lucide-react";
import type { Photo } from "@/data/mockData";
import { colorLabelMap } from "@/data/mockData";
import { cn } from "@/lib/utils";

interface PhotoCardProps {
  photo: Photo;
  onClick?: () => void;
  onDoubleClick?: () => void;
  selected?: boolean;
  onSelect?: (selected: boolean) => void;
  selectionMode?: boolean;
  variant?: "gallery" | "overlay";
  hideStatusBadge?: boolean;
  hideMetaOverlay?: boolean;
  hideDownloadButton?: boolean;
  clientDownloadMode?: boolean;
  forceSquare?: boolean;
}

const PhotoCard = ({
  photo,
  onClick,
  onDoubleClick,
  selected,
  onSelect,
  selectionMode = false,
  variant = "gallery",
  hideStatusBadge = false,
  hideMetaOverlay = false,
  hideDownloadButton = false,
  clientDownloadMode = false,
  forceSquare = false,
}: PhotoCardProps) => {
  const colorInfo =
    photo.colorLabel !== "none" ? colorLabelMap[photo.colorLabel] : null;
  const isEdited = (photo.versionCount || 1) > 1;
  const [showDownloadMenu, setShowDownloadMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!showDownloadMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowDownloadMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showDownloadMenu]);

  const handleCheckboxClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect?.(!selected);
  };

  const openDownload = async (variant: "current" | "retouched-original" | "original" | "client-display" | "client-original") => {
    const url = clientDownloadMode
      ? `/api/photos/${photo.id}/client-render?mode=download`
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

  const imageSrc = (photo as Photo & { thumbUrl?: string; displayUrl?: string }).thumbUrl || photo.url;
  const uploadedAt = photo.uploadedAt ? new Date(photo.uploadedAt).toLocaleString() : "Unknown time";

  if (variant === "overlay") {
    return (
      <div
        className="group relative cursor-pointer overflow-hidden rounded-2xl bg-muted/70 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md"
        onClick={onClick}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onDoubleClick?.();
        }}
      >
        <div className="overflow-hidden">
          <img
            src={imageSrc}
            alt={photo.fileName}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
            loading="lazy"
          />
        </div>

        {selected && <div className="absolute inset-0 z-10 bg-black/25" />}

        {colorInfo && (
          <div
            className={`absolute bottom-2 left-2 z-20 h-3.5 w-3.5 rounded-full ${colorInfo.bg} ring-2 ring-white/80`}
          />
        )}

        {!hideStatusBadge && photo.photoStatus === "original" && (
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
              "absolute bottom-2 right-2 z-20 flex h-9 w-9 items-center justify-center rounded-full border-2 transition-all",
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

        {!hideMetaOverlay && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-3 pt-8 opacity-0 transition-opacity group-hover:opacity-100">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-white">{photo.fileName}</p>
                <p className="text-xs text-white/70">{photo.tag}</p>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "overflow-visible border border-border bg-card shadow-sm transition-all",
        forceSquare ? "rounded-none" : "rounded-xl",
        selected ? "ring-2 ring-sky-500/70 shadow-md" : "hover:shadow-md",
      )}
    >
      <div
        className={cn("group relative cursor-pointer overflow-hidden bg-muted", forceSquare ? "aspect-square" : "aspect-[4/3] rounded-t-xl")}
        onClick={onClick}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onDoubleClick?.();
        }}
      >
        <img
          src={imageSrc}
          alt={photo.fileName}
          className={cn(
            "h-full w-full object-cover transition-all duration-300",
            selected ? "scale-[0.97] brightness-50" : "group-hover:scale-[1.02]",
          )}
          loading="lazy"
        />

        {photo.isPublished === false && (
          <div className="absolute inset-0 z-10 bg-black/35 pointer-events-none" />
        )}

        {selected && <div className="absolute inset-0 z-10 bg-black/20 pointer-events-none" />}

        {!hideStatusBadge && <div className="absolute left-2 top-2 z-20 flex flex-col gap-1">
          <span
            className={cn(
              "inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
              isEdited
                ? "bg-sky-600 text-white shadow-sm"
                : "border border-border/80 bg-white/95 text-muted-foreground shadow-sm",
            )}
          >
            {isEdited ? "retouched" : "original"}
          </span>
        </div>}

        {photo.isPublished === false && (
          <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
            <span className="inline-flex items-center rounded-md bg-black/75 px-3 py-1 text-xs font-semibold text-white shadow-sm">
              未发布
            </span>
          </div>
        )}

        {colorInfo && (
          <div
            className={`absolute bottom-2 left-2 z-20 h-3 w-3 rounded-full ${colorInfo.bg} ring-2 ring-white/90`}
          />
        )}

        {onSelect !== undefined && (
          <button
            type="button"
            onClick={handleCheckboxClick}
            className={cn(
              "absolute bottom-2 right-2 z-20 flex h-8 w-8 items-center justify-center rounded-full border-2 transition-all",
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

      <div className={cn("flex items-start justify-between gap-2 border-t border-border/60 px-3 py-2.5", forceSquare ? "rounded-none" : "") }>
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "truncate text-sm font-medium transition-colors",
              selected ? "text-muted-foreground" : "text-foreground",
            )}
          >
            {photo.fileName}
          </p>
          <p className="text-xs text-muted-foreground">{uploadedAt}</p>
        </div>
        {!hideDownloadButton && <div className="relative z-30 shrink-0" ref={menuRef}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setShowDownloadMenu((v) => !v);
            }}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="Download"
            aria-label="Download"
          >
            <Download className="h-4 w-4" />
          </button>
          {showDownloadMenu && (
            <div className="absolute right-0 top-8 z-50 min-w-40 rounded-lg border border-border bg-card p-1 shadow-lg">
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
        </div>}
      </div>
    </div>
  );
};

export default PhotoCard;
