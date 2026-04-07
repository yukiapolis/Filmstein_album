"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  Download,
  Loader2,
  Search,
  ArrowUpDown,
  LayoutGrid,
  List,
  RefreshCw,
} from "lucide-react";
import type { Photo, Project } from "@/data/mockData";
import PhotoGrid, { type ViewMode } from "@/components/PhotoGrid";
import AlbumTree from "@/components/AlbumTree";
import ColorFilterBar from "@/components/ColorFilterBar";
import StatusBadge from "@/components/StatusBadge";
import type { ColorLabel } from "@/data/mockData";
import { buildAlbumsFromPhotos } from "@/lib/albumsFromPhotos";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const EmptyState = ({ message }: { message?: string }) => (
  <div className="flex flex-col items-center justify-center py-20 text-center">
    <p className="text-sm text-muted-foreground">{message ?? "No photos yet."}</p>
  </div>
);

const ClientGallery = ({
  photos: externalPhotos,
  presentation = "default",
}: {
  photos?: Photo[];
  presentation?: "default" | "preview";
}) => {
  const params = useParams();
  const id = params?.id as string | undefined;

  const [photos, setPhotos] = useState<Photo[]>(externalPhotos ?? []);
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [folders, setFolders] = useState<{ id: string; name: string }[]>([]);
  const [activeAlbum, setActiveAlbum] = useState("all");
  const [expandedAlbums, setExpandedAlbums] = useState<Set<string>>(new Set());
  const [activeTag, setActiveTag] = useState<ColorLabel | "all">("all");
  const [downloading, setDownloading] = useState(false);
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState<"date" | "name">("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");

  useEffect(() => {
    if (!id) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const [projRes, foldersRes] = await Promise.all([
          fetch(`/api/projects/${id}?publishedOnly=true`),
          fetch(`/api/projects/${id}/folders`),
        ]);
        const projBody = await projRes.json();
        const foldersBody = await foldersRes.json();

        if (!cancelled) {
          if (projRes.ok && projBody.success === true) {
            const fetched = (projBody.data?.photos ?? []) as Photo[];
            setPhotos(fetched);
            setProject((projBody.data?.project as Project) ?? null);
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

    return () => {
      cancelled = true;
    };
  }, [id]);

  const projectName = project?.name ?? (id ? `Project ${id}` : "Project");

  const albumsForUi = useMemo(
    () => buildAlbumsFromPhotos(photos, folders),
    [photos, folders],
  );

  useEffect(() => {
    setExpandedAlbums((prev) => {
      const next = new Set(prev);
      for (const a of albumsForUi) {
        if (a.children?.length) next.add(a.id);
      }
      return next;
    });
  }, [albumsForUi]);

  const toggleExpand = (albumId: string) => {
    setExpandedAlbums((prev) => {
      const next = new Set(prev);
      if (next.has(albumId)) next.delete(albumId);
      else next.add(albumId);
      return next;
    });
  };

  const [selections, setSelections] = useState<Set<string>>(
    new Set(photos.filter((p) => p.selected).map((p) => p.id)),
  );

  useEffect(() => {
    setSelections(new Set(photos.filter((p) => p.selected).map((p) => p.id)));
  }, [photos]);

  const folderFiltered = useMemo(() => {
    if (activeAlbum === "all") return photos;
    return photos.filter((p) => (p.folderId ?? p.albumId) === activeAlbum);
  }, [photos, activeAlbum]);

  const filtered = useMemo(() => {
    const byColor =
      activeTag === "all"
        ? folderFiltered
        : folderFiltered.filter((p) => p.colorLabel === activeTag);
    const q = searchQuery.trim().toLowerCase();
    const searched = q
      ? byColor.filter((p) => p.fileName.toLowerCase().includes(q))
      : byColor;
    const mul = sortDir === "asc" ? 1 : -1;
    return [...searched].sort((a, b) => {
      if (sortKey === "name") return mul * a.fileName.localeCompare(b.fileName);
      const ta = new Date(a.uploadedAt || 0).getTime();
      const tb = new Date(b.uploadedAt || 0).getTime();
      return mul * (ta - tb);
    });
  }, [folderFiltered, activeTag, searchQuery, sortKey, sortDir]);

  const toggleSelect = (photoId: string, selected: boolean) => {
    setSelections((prev) => {
      const next = new Set(prev);
      if (selected) next.add(photoId);
      else next.delete(photoId);
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
        body: JSON.stringify({ photoIds, clientSafe: true }),
      });

      if (!res.ok) {
        const errBody = await res.json();
        throw new Error(errBody.error || "Download failed");
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

  const handleRefresh = async () => {
    if (!id) return;
    try {
      const res = await fetch(`/api/projects/${id}?publishedOnly=true`);
      const body = await res.json();
      if (res.ok && body.success && Array.isArray(body.data?.photos)) {
        setPhotos(body.data.photos as Photo[]);
        setProject((body.data?.project as Project) ?? null);
      }
      const fr = await fetch(`/api/projects/${id}/folders`);
      const fb = await fr.json();
      if (fr.ok && fb.success) setFolders(fb.data ?? []);
    } catch {
      // ignore
    }
  };

  const cycleSort = () => {
    setSortDir((d) => (d === "desc" ? "asc" : "desc"));
  };

  const clearSelections = () => setSelections(new Set());

  const allFilteredSelected =
    filtered.length > 0 && filtered.every((p) => selections.has(p.id));
  const someFilteredSelected = filtered.some((p) => selections.has(p.id));

  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      setSelections((prev) => {
        const next = new Set(prev);
        for (const p of filtered) next.delete(p.id);
        return next;
      });
    } else {
      setSelections((prev) => {
        const next = new Set(prev);
        for (const p of filtered) next.add(p.id);
        return next;
      });
    }
  };

  const cleanPreview = presentation === "preview";
  const showSidebar = !cleanPreview && viewMode !== "list";

  if (cleanPreview) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-background via-surface to-background">
        <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8 lg:py-12">
          {loading ? (
            <p className="py-12 text-center text-sm text-muted-foreground">Loading photos…</p>
          ) : error ? (
            <p className="py-12 text-center text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : filtered.length === 0 ? (
            <EmptyState message="No published photos yet." />
          ) : (
            <div className="space-y-6 sm:space-y-8">
              <section className="space-y-5 px-1 pt-2 sm:px-2">
                <div className="relative overflow-hidden rounded-3xl bg-muted shadow-sm">
                  <div className="aspect-[16/9] sm:aspect-[16/7] lg:aspect-[16/5]">
                    <img
                      src={project?.cover_url || "/default-cover.svg"}
                      alt={projectName}
                      className="h-full w-full object-cover"
                    />
                  </div>
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-black/5" />
                  <div className="absolute inset-x-0 bottom-0 p-5 sm:p-7 lg:p-8">
                    <div className="mx-auto max-w-5xl">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-white/75">
                        Preview Gallery
                      </p>
                      <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white drop-shadow-sm sm:text-4xl lg:text-5xl">
                        {projectName}
                      </h1>
                      <p className="mt-3 max-w-2xl text-sm leading-6 text-white/80 sm:text-base">
                        Published highlights, presented in a clean gallery made for desktop review and mobile sharing.
                      </p>
                      <div className="mt-4 inline-flex items-center rounded-full border border-white/20 bg-black/25 px-4 py-1.5 text-sm text-white/85 backdrop-blur">
                        {filtered.length} published photos
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              <section className="mx-auto w-full max-w-7xl">
                <PhotoGrid
                  photos={filtered}
                  viewMode="grid"
                  selectedIds={[]}
                  cardVariant="overlay"
                  hideStatusBadge
                  hideMetaOverlay
                  hideDownloadButton
                  clientDownloadMode
                  gridClassName="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4 lg:gap-4 xl:grid-cols-5 2xl:grid-cols-6"
                />
              </section>
            </div>
          )}
        </main>
      </div>
    );
  }

  return (
    <div className={cleanPreview ? "min-h-screen bg-gradient-to-b from-background via-surface to-background" : "min-h-screen bg-surface"}>
      {!cleanPreview && <header className="border-b border-border bg-card">
        <div className="container flex h-14 items-center justify-between gap-4">
          <div className="flex min-w-0 flex-1 items-center gap-2 text-sm">
            <Link
              href="/"
              className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
            >
              Projects
            </Link>
            <span className="text-muted-foreground">/</span>
            <span className="truncate font-medium text-foreground">{projectName}</span>
            {project?.status && <StatusBadge status={project.status} />}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9"
              title="Refresh"
              onClick={handleRefresh}
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
            <span className="hidden text-sm text-muted-foreground sm:inline">
              {selections.size} selected
            </span>
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
                    Downloading…
                  </>
                ) : (
                  <>
                    <Download className="mr-1.5 h-3.5 w-3.5" />
                    下载图片
                  </>
                )}
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                if (filtered.length === 0) return;
                setDownloadingAll(true);
                try {
                  const photoIds = filtered.map((p) => p.id);
                  const res = await fetch("/api/photos/download-zip", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ photoIds, clientSafe: true }),
                  });

                  if (!res.ok) {
                    const errBody = await res.json().catch(() => ({}));
                    throw new Error(errBody.error || "Download failed");
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
                  console.error("Download all error:", err);
                  alert(err instanceof Error ? err.message : "Download failed");
                } finally {
                  setDownloadingAll(false);
                }
              }}
              disabled={downloadingAll}
            >
              {downloadingAll ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  …
                </>
              ) : (
                <>
                  <Download className="mr-1.5 h-3.5 w-3.5" />
                  下载全部图片
                </>
              )}
            </Button>
          </div>
        </div>
      </header>}

      <main className="container py-6">
        {loading ? (
          <p className="py-12 text-center text-sm text-muted-foreground">Loading photos…</p>
        ) : error ? (
          <p className="py-12 text-center text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : filtered.length === 0 && activeAlbum !== "all" ? (
          <EmptyState message="No photos in this album yet." />
        ) : photos.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="flex flex-col gap-6 lg:flex-row">
            {showSidebar && (
              <aside className="w-full shrink-0 space-y-4 lg:w-56">
                <div className="rounded-xl border border-border bg-card p-3">
                  <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Albums
                  </h2>
                  <AlbumTree
                    albums={albumsForUi}
                    activeAlbumId={activeAlbum}
                    onSelect={setActiveAlbum}
                    expandedIds={expandedAlbums}
                    onToggle={toggleExpand}
                  />
                </div>
              </aside>
            )}

            <div className="min-w-0 flex-1 space-y-4">
              {!cleanPreview && (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-1 rounded-lg border border-border p-1">
                      <button
                        type="button"
                        title="Grid"
                        onClick={() => setViewMode("grid")}
                        className={`rounded p-1.5 transition-colors ${
                          viewMode === "grid"
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground"
                        }`}
                      >
                        <LayoutGrid className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        title="List"
                        onClick={() => setViewMode("list")}
                        className={`rounded p-1.5 transition-colors ${
                          viewMode === "list"
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground"
                        }`}
                      >
                        <List className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  <div className="rounded-xl border border-border bg-card p-4">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-sm font-semibold">{filtered.length} photos</span>
                      <div className="relative min-w-[160px] max-w-xs flex-1">
                        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          placeholder="Search…"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          className="h-9 pl-8"
                        />
                      </div>
                      <ColorFilterBar active={activeTag} onChange={setActiveTag} />
                      <div className="ml-auto flex items-center gap-2">
                        <Button type="button" variant="outline" size="sm" onClick={cycleSort}>
                          <ArrowUpDown className="mr-1.5 h-3.5 w-3.5" />
                          Sort
                        </Button>
                        <select
                          value={sortKey}
                          onChange={(e) => setSortKey(e.target.value as "date" | "name")}
                          className="h-9 rounded-md border border-input bg-background px-2 text-xs"
                        >
                          <option value="date">Date</option>
                          <option value="name">Name</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  {filtered.length > 0 && (
                    selections.size > 0 ? (
                      <div className="flex items-center gap-2 text-sm font-medium text-sky-600">
                        {selections.size} photo{selections.size !== 1 ? "s" : ""} selected — individual selection active
                        <button
                          type="button"
                          onClick={clearSelections}
                          className="ml-1 text-xs underline underline-offset-2 hover:text-foreground"
                        >
                          Clear all
                        </button>
                      </div>
                    ) : (
                      <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground hover:text-sky-600 transition-colors">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-input"
                          checked={allFilteredSelected}
                          ref={(el) => {
                            if (el) el.indeterminate = someFilteredSelected && !allFilteredSelected;
                          }}
                          onChange={toggleSelectAll}
                        />
                        All files
                      </label>
                    )
                  )}
                </>
              )}

              <PhotoGrid
                photos={filtered}
                viewMode={viewMode}
                onToggleSelect={toggleSelect}
                selectedIds={Array.from(selections)}
                cardVariant="gallery"
                clientDownloadMode
              />
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default ClientGallery;
