"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Download, ArrowLeft, Loader2 } from "lucide-react";
import type { Photo } from "@/data/mockData";
import PhotoPreviewModal from "@/components/PhotoPreviewModal";
import PhotoCard from "@/components/PhotoCard";
import { Button } from "@/components/ui/button";

const EmptyState = ({ message }: { message?: string }) => (
  <div className="flex flex-col items-center justify-center py-20 text-center">
    <p className="text-sm text-muted-foreground">{message ?? "No photos yet."}</p>
  </div>
);

/** Client-facing photo gallery for a project — fetches its own data reactively
 *  so new uploads are reflected immediately on navigation or refresh. */
const ClientGallery = ({ photos: externalPhotos }: { photos?: Photo[] }) => {
  const params = useParams();
  const id = params?.id as string | undefined;

  // Reactive state — updated on every navigation / re-render
  const [photos, setPhotos] = useState<Photo[]>(externalPhotos ?? []);
  const [projectName, setProjectName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** Fetch latest photos from the API on mount and whenever `id` changes. */
  useEffect(() => {
    if (!id) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const [projRes, foldersRes] = await Promise.all([
          fetch(`/api/projects/${id}`),
          fetch(`/api/projects/${id}/folders`),
        ]);
        const projBody = await projRes.json();
        const foldersBody = await foldersRes.json();

        if (!cancelled) {
          if (projRes.ok && projBody.success === true) {
            const fetched = (projBody.data?.photos ?? []) as Photo[];
            setPhotos(fetched);
            setProjectName(projBody.data?.project?.name ?? null);
          } else {
            setError("Could not load photos.");
            return;
          }

          if (foldersRes.ok && foldersBody.success === true) {
            setFolders(foldersBody.data ?? []);
          }
        }
      } catch {
        if (!cancelled) setError("Could not load photos.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [id]);

  const project = projectName ?? (
    id ? `Project ${id}` : "Project"
  );

  const [selections, setSelections] = useState<Set<string>>(
    new Set(photos.filter((p) => p.selected).map((p) => p.id)),
  );
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [activeTag, setActiveTag] = useState<string>("all");
  const [downloading, setDownloading] = useState(false);
  const [folders, setFolders] = useState<{ id: string; name: string }[]>([]);
  const [activeFolder, setActiveFolder] = useState<string>("all");

  /** Photos visible after folder filter only (used to derive tags). */
  const folderFiltered = useMemo(
    () =>
      activeFolder === "all"
        ? photos
        : photos.filter((p) => p.folderId === activeFolder),
    [photos, activeFolder],
  );

  /** Derive unique tag values from the folder-filtered photos. */
  const allTags = useMemo(
    () => Array.from(new Set(folderFiltered.map((p) => p.tag))),
    [folderFiltered],
  );

  const toggleSelect = (photoId: string) => {
    setSelections((prev) => {
      const next = new Set(prev);
      if (next.has(photoId)) next.delete(photoId);
      else next.add(photoId);
      return next;
    });
  };

  const downloadSelected = async () => {
    if (selections.size === 0) return;

    setDownloading(true);
    try {
      const photoIds = Array.from(selections);
      const res = await fetch("/api/photos/download-zip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photoIds }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Download failed");
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "photos.zip";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Download error:", err);
      alert(err instanceof Error ? err.message : "Download failed");
    } finally {
      setDownloading(false);
    }
  };

  const filtered = useMemo(
    () =>
      folderFiltered.filter((p) => activeTag === "all" || p.tag === activeTag),
    [folderFiltered, activeTag],
  );

  /** Build an index map so we can map a photo id to its position in `filtered`. */
  const photoIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    filtered.forEach((p, i) => map.set(p.id, i));
    return map;
  }, [filtered]);

  /** Distribute photos across N columns for a simple masonry layout. */
  const columns = useMemo(() => {
    const colCount = 3;
    const cols: typeof filtered[] = Array.from({ length: colCount }, () => []);
    filtered.forEach((photo, i) => cols[i % colCount].push(photo));
    return cols;
  }, [filtered]);

  return (
    <div className="min-h-screen bg-surface">
      {/* Minimal client header */}
      <header className="border-b border-border bg-card">
        <div className="container flex h-14 items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href={`/projects/${id ?? ""}`}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <span className="text-sm font-semibold text-foreground">
              {project}
            </span>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>{selections.size} selected</span>
            {selections.size > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={downloadSelected}
                disabled={downloading}
              >
                {downloading ? (
                  <>
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    Downloading...
                  </>
                ) : (
                  <>
                    <Download className="mr-1.5 h-3.5 w-3.5" />
                    Download Selected
                  </>
                )}
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => {
              if (filtered.length === 0) return;
              setDownloading(true);
              const photoIds = filtered.map((p) => p.id);
              fetch("/api/photos/download-zip", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ photoIds }),
              })
                .then((res) => res.blob())
                .then((blob) => {
                  const url = window.URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = "photos.zip";
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  window.URL.revokeObjectURL(url);
                })
                .catch(console.error)
                .finally(() => setDownloading(false));
            }}>
              <Download className="mr-1.5 h-3.5 w-3.5" />
              Download All
            </Button>
          </div>
        </div>
      </header>

      <main className="container py-8">
        {loading ? (
          <p className="py-12 text-center text-sm text-muted-foreground">Loading photos…</p>
        ) : error ? (
          <p className="py-12 text-center text-sm text-destructive" role="alert">{error}</p>
        ) : filtered.length === 0 && activeFolder !== "all" ? (
          <EmptyState message="No photos in this folder yet." />
        ) : photos.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            <div className="mb-6 space-y-1">
              <h1 className="text-xl font-semibold text-foreground">Your Photos</h1>
              <p className="text-sm text-muted-foreground">
                {photos.length} photos &middot; Select your favorites to let us know which ones you love.
              </p>
            </div>

            {/* Folder filter tabs */}
            {folders.length > 0 && (
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setActiveFolder("all")}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    activeFolder === "all"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:text-foreground"
                  }`}
                >
                  All
                </button>
                {folders.map((folder) => (
                  <button
                    key={folder.id}
                    type="button"
                    onClick={() => setActiveFolder(folder.id)}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                      activeFolder === folder.id
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {folder.name}
                  </button>
                ))}
              </div>
            )}

            {/* Tag filter pills */}
            <div className="mb-6 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setActiveTag("all")}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  activeTag === "all"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                All
              </button>
              {allTags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => setActiveTag(tag)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    activeTag === tag
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>

            {/* Masonry grid — 3 equal columns */}
            <div className="flex gap-3">
              {columns.map((col, colIdx) => (
                <div key={colIdx} className="flex flex-1 flex-col gap-3">
                  {col.map((photo) => (
                    <PhotoCard
                      key={photo.id}
                      photo={photo}
                      selected={selections.has(photo.id)}
                      onSelect={() => toggleSelect(photo.id)}
                      onClick={() =>
                        setPreviewIndex(photoIndexMap.get(photo.id) ?? 0)
                      }
                    />
                  ))}
                </div>
              ))}
            </div>
          </>
        )}
      </main>

      {/* Lightbox — shows the currently filtered set */}
      {previewIndex !== null && (
        <PhotoPreviewModal
          photos={filtered}
          initialIndex={previewIndex}
          open
          onClose={() => setPreviewIndex(null)}
        />
      )}
    </div>
  );
};

export default ClientGallery;
