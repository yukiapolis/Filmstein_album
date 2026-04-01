"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Download, Heart, ArrowLeft } from "lucide-react";
import type { Photo } from "@/data/mockData";
import PhotoPreviewModal from "@/components/PhotoPreviewModal";
import { Button } from "@/components/ui/button";

const EmptyState = () => (
  <div className="flex flex-col items-center justify-center py-20 text-center">
    <p className="text-sm text-muted-foreground">No photos yet.</p>
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
        const res = await fetch(`/api/projects/${id}`);
        const body = await res.json();

        if (!res.ok || body.success !== true) {
          if (!cancelled) setError("Could not load photos.");
          return;
        }

        if (!cancelled) {
          const fetched = (body.data?.photos ?? []) as Photo[];
          setPhotos(fetched);
          setProjectName(body.data?.project?.name ?? null);
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

  /** Derive unique tag values from the actual photos being displayed. */
  const allTags = useMemo(
    () => Array.from(new Set(photos.map((p) => p.tag))),
    [photos],
  );

  const [selections, setSelections] = useState<Set<string>>(
    new Set(photos.filter((p) => p.selected).map((p) => p.id)),
  );
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [activeTag, setActiveTag] = useState<string>("all");

  const toggleSelect = (photoId: string) => {
    setSelections((prev) => {
      const next = new Set(prev);
      if (next.has(photoId)) next.delete(photoId);
      else next.add(photoId);
      return next;
    });
  };

  const filtered = useMemo(
    () =>
      activeTag === "all"
        ? photos
        : photos.filter((p) => p.tag === activeTag),
    [activeTag, photos],
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
            <Button size="sm" variant="outline">
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
                  {col.map((photo) => {
                    // Vary aspect ratios for visual interest (deterministic by id)
                    const n = parseInt(photo.id, 10) % 3;
                    const aspectClass = n === 0
                      ? "aspect-[3/4]"
                      : n === 1
                        ? "aspect-[4/3]"
                        : "aspect-square";

                    return (
                      <div
                        key={photo.id}
                        className="group relative overflow-hidden rounded-lg bg-muted cursor-pointer"
                      >
                        {/* Photo image — click opens lightbox */}
                        <div
                          className={`${aspectClass} overflow-hidden`}
                          onClick={() =>
                            setPreviewIndex(photoIndexMap.get(photo.id) ?? 0)
                          }
                        >
                          <img
                            src={photo.url}
                            alt={photo.fileName}
                            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                            loading="lazy"
                          />
                        </div>

                        {/* Heart / select overlay */}
                        <button
                          type="button"
                          onClick={() => toggleSelect(photo.id)}
                          className={`absolute top-2 right-2 flex h-7 w-7 items-center justify-center rounded-full transition-all ${
                            selections.has(photo.id)
                              ? "bg-primary text-primary-foreground"
                              : "bg-black/30 text-white opacity-0 group-hover:opacity-100"
                          }`}
                        >
                          <Heart
                            className={`h-3.5 w-3.5 ${selections.has(photo.id) ? "fill-current" : ""}`}
                          />
                        </button>
                      </div>
                    );
                  })}
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
