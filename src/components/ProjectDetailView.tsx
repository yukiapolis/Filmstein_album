"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Upload,
  Share2,
  Eye,
  Pencil,
  Folder,
  Plus,
  X,
  Move,
  RefreshCw,
  SlidersHorizontal,
  Search,
  ArrowUpDown,
  LayoutGrid,
  List,
  Paintbrush,
  Settings,
} from "lucide-react";
import Navbar from "@/components/Navbar";
import PhotoGrid, { type ViewMode } from "@/components/PhotoGrid";
import StatusBadge from "@/components/StatusBadge";
import AlbumTree from "@/components/AlbumTree";
import ColorFilterBar from "@/components/ColorFilterBar";
import UploadPanel from "@/components/UploadPanel";
import ProjectEditDialog from "@/components/ProjectEditDialog";
import ShareModal from "@/components/ShareModal";
import type { ColorLabel, Album, Project, Photo } from "@/data/mockData";
import { buildAlbumsFromPhotos } from "@/lib/albumsFromPhotos";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const tabs = ["Photos", "Selections"] as const;

interface FolderItem {
  id: string;
  name: string;
}

const getAllAlbumIds = (albums: Album[]): string[] =>
  albums.flatMap((a) => [a.id, ...(a.children ? getAllAlbumIds(a.children) : [])]);

const getDescendantIds = (albums: Album[], parentId: string): string[] => {
  for (const a of albums) {
    if (a.id === parentId) return [a.id, ...(a.children ? getAllAlbumIds(a.children) : [])];
    if (a.children) {
      const found = getDescendantIds(a.children, parentId);
      if (found.length) return found;
    }
  }
  return [];
};

const findAlbum = (albums: Album[], id: string): Album | null => {
  for (const a of albums) {
    if (a.id === id) return a;
    if (a.children) {
      const found = findAlbum(a.children, id);
      if (found) return found;
    }
  }
  return null;
};

const getChildAlbums = (albums: Album[], parentId: string): Album[] => {
  if (parentId === "all") return albums;
  const parent = findAlbum(albums, parentId);
  return parent?.children ?? [];
};

export default function ProjectDetailView({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>("Photos");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [activeAlbum, setActiveAlbum] = useState("all");
  const [colorFilter, setColorFilter] = useState<ColorLabel | "all">("all");
  const [expandedAlbums, setExpandedAlbums] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState<"date" | "name">("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const [selectedPhotoIds, setSelectedPhotoIds] = useState<Set<string>>(new Set());
  const [moveTargetFolderId, setMoveTargetFolderId] = useState<string>("");
  const [moving, setMoving] = useState(false);

  const refreshFolders = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/folders`);
      if (!res.ok) return;
      const body = await res.json();
      if (body.success && Array.isArray(body.data)) {
        setFolders(body.data);
      }
    } catch {
      // ignore
    }
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      setNotFound(false);
      setProject(null);
      setPhotos([]);

      try {
        const [projectRes, foldersRes] = await Promise.all([
          fetch(`/api/projects/${projectId}`),
          fetch(`/api/projects/${projectId}/folders`),
        ]);

        if (cancelled) return;

        if (projectRes.status === 404) {
          setNotFound(true);
          return;
        }

        const projectJson: unknown = await projectRes.json().catch(() => ({}));
        const foldersJson: unknown = await foldersRes.json().catch(() => ({}));

        const projectBody = projectJson as {
          success?: boolean;
          error?: string;
          data?: { project?: Project; photos?: unknown };
        };
        const foldersBody = foldersJson as {
          success?: boolean;
          data?: FolderItem[];
        };

        if (projectRes.status >= 400 || projectBody.success === false) {
          setError(projectBody.error ?? `Request failed (${projectRes.status})`);
          return;
        }

        if (projectBody.data?.project && Array.isArray(projectBody.data.photos)) {
          setProject(projectBody.data.project);
          setPhotos(projectBody.data.photos as Photo[]);
          if (foldersBody.success && Array.isArray(foldersBody.data)) {
            setFolders(foldersBody.data);
          }
        } else {
          setError("Invalid response from server");
        }
      } catch {
        if (!cancelled) setError("Failed to load project");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [projectId]);

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

  const filteredPhotos = useMemo(() => {
    let list = photos;

    if (activeAlbum !== "all") {
      const ids = getDescendantIds(albumsForUi, activeAlbum);
      list = list.filter((p) => {
        const aid = p.albumId ?? p.folderId;
        return aid && ids.includes(aid);
      });
    }

    if (activeTab === "Selections") {
      list = list.filter((p) => p.selected);
    }

    if (colorFilter !== "all") {
      list = list.filter((p) => p.colorLabel === colorFilter);
    }

    return list;
  }, [activeAlbum, activeTab, colorFilter, photos, albumsForUi]);

  const displayPhotos = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let list = q ? filteredPhotos.filter((p) => p.fileName.toLowerCase().includes(q)) : filteredPhotos;
    const mul = sortDir === "asc" ? 1 : -1;
    list = [...list].sort((a, b) => {
      if (sortKey === "name") return mul * a.fileName.localeCompare(b.fileName);
      const ta = new Date(a.uploadedAt || 0).getTime();
      const tb = new Date(b.uploadedAt || 0).getTime();
      return mul * (ta - tb);
    });
    return list;
  }, [filteredPhotos, searchQuery, sortKey, sortDir]);

  const childAlbums = useMemo(
    () => getChildAlbums(albumsForUi, activeAlbum),
    [activeAlbum, albumsForUi],
  );

  const handleAlbumClick = (albumId: string) => {
    setActiveAlbum(albumId);
    setExpandedAlbums((prev) => new Set([...prev, albumId]));
  };

  const albumBreadcrumb = useMemo(() => {
    if (activeAlbum === "all") return [];
    const trail: { id: string; name: string }[] = [];
    const walk = (albums: Album[], target: string): boolean => {
      for (const a of albums) {
        if (a.id === target) {
          trail.push({ id: a.id, name: a.name });
          return true;
        }
        if (a.children && walk(a.children, target)) {
          trail.unshift({ id: a.id, name: a.name });
          return true;
        }
      }
      return false;
    };
    walk(albumsForUi, activeAlbum);
    return trail;
  }, [activeAlbum, albumsForUi]);

  const showSidebar = viewMode !== "list";

  const refreshPhotos = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}`);
      if (!res.ok) return;
      const body = await res.json();
      if (body.success && Array.isArray(body.data?.photos)) {
        setPhotos(body.data.photos as Photo[]);
      }
    } catch {
      // ignore
    }
  }, [projectId]);

  const handleRefresh = async () => {
    await Promise.all([refreshPhotos(), refreshFolders()]);
  };

  const handleCreateFolder = async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;

    try {
      const res = await fetch(`/api/projects/${projectId}/folders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const body = await res.json();
      if (body.success) {
        await refreshFolders();
      }
    } catch {
      // ignore
    }
  };

  const togglePhotoSelection = useCallback((photoId: string, selected: boolean) => {
    setSelectedPhotoIds((prev) => {
      const next = new Set(prev);
      if (selected) next.add(photoId);
      else next.delete(photoId);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedPhotoIds(new Set());
    setMoveTargetFolderId("");
  }, []);

  const allVisibleSelected =
    displayPhotos.length > 0 && displayPhotos.every((p) => selectedPhotoIds.has(p.id));
  const someVisibleSelected = displayPhotos.some((p) => selectedPhotoIds.has(p.id));

  const toggleSelectAllVisible = () => {
    if (allVisibleSelected) {
      setSelectedPhotoIds((prev) => {
        const next = new Set(prev);
        for (const p of displayPhotos) next.delete(p.id);
        return next;
      });
    } else {
      setSelectedPhotoIds((prev) => {
        const next = new Set(prev);
        for (const p of displayPhotos) next.add(p.id);
        return next;
      });
    }
  };

  const handleBatchMove = async () => {
    if (selectedPhotoIds.size === 0) return;

    setMoving(true);
    try {
      const folderId = moveTargetFolderId === "" ? null : moveTargetFolderId;
      const res = await fetch("/api/photos", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          photoIds: Array.from(selectedPhotoIds),
          folderId,
        }),
      });
      const body = await res.json();
      if (body.success) {
        await refreshPhotos();
        clearSelection();
      } else {
        console.error("Move failed:", body.error);
      }
    } catch (err) {
      console.error("Move error:", err);
    } finally {
      setMoving(false);
    }
  };

  const cycleSort = () => {
    if (sortKey === "date") {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    }
  };

  const heading = loading
    ? "Loading…"
    : error
      ? "Could not load project"
      : notFound
        ? "Project not found"
        : (project?.name?.trim() || "Untitled project");
  const showMeta = Boolean(project) && !notFound && !error && !loading;

  return (
    <div className="min-h-screen bg-surface">
      <Navbar />

      {/* Project toolbar — matches DAM-style screenshot */}
      <header className="border-b border-border bg-card">
        <div className="container flex h-14 items-center justify-between gap-4">
          <div className="flex min-w-0 flex-1 items-center gap-2 text-sm">
            <Link
              href="/"
              className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
            >
              Projects
            </Link>
            <span className="text-muted-foreground">/</span>
            <span className="truncate font-medium text-foreground">{heading}</span>
            {showMeta && project && <StatusBadge status={project.status} />}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9"
              title="Refresh"
              onClick={handleRefresh}
              disabled={loading || Boolean(error) || notFound}
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="hidden sm:inline-flex"
              disabled={loading || Boolean(error) || notFound}
              onClick={() => {
                /* placeholder — decoration tools */
              }}
            >
              <Paintbrush className="mr-1.5 h-3.5 w-3.5" />
              Decoration
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setEditOpen(true)}
              disabled={loading || Boolean(error) || notFound}
            >
              <Settings className="mr-1.5 h-3.5 w-3.5" />
              Settings
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link
                href={`/projects/${projectId}/preview`}
                className={
                  loading || error || notFound ? "pointer-events-none opacity-50" : undefined
                }
                onClick={(e) => {
                  if (loading || error || notFound) e.preventDefault();
                }}
              >
                <Eye className="mr-1.5 h-3.5 w-3.5" />
                Preview
              </Link>
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => setShareOpen(true)}
              disabled={loading || Boolean(error) || notFound}
            >
              <Share2 className="mr-1.5 h-3.5 w-3.5" />
              Share
            </Button>
          </div>
        </div>
      </header>

      <main className="container py-6">
        {error && (
          <p className="mb-4 text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        <div className="flex flex-col gap-6 lg:flex-row">
          {showSidebar && (
            <aside className="w-full shrink-0 space-y-4 lg:w-56">
              <div className="rounded-xl border border-border bg-card p-3">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Albums
                  </h2>
                  <button
                    type="button"
                    onClick={() => setShowNewFolder(true)}
                    className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    title="New album"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
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
            {/* Tabs + view mode */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex gap-4 border-b border-border sm:border-0">
                {tabs.map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setActiveTab(tab)}
                    className={`pb-2 text-sm font-medium transition-colors sm:pb-0 ${
                      activeTab === tab
                        ? "border-b-2 border-primary text-foreground sm:border-0"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {tab}
                    {tab === "Photos" && (
                      <span className="ml-1 text-xs text-muted-foreground">({photos.length})</span>
                    )}
                    {tab === "Selections" && (
                      <span className="ml-1 text-xs text-muted-foreground">
                        ({photos.filter((p) => p.selected).length})
                      </span>
                    )}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1 rounded-lg border border-border p-1">
                <button
                  type="button"
                  title="Grid"
                  onClick={() => setViewMode("grid")}
                  className={`rounded p-1.5 transition-colors ${
                    viewMode === "grid" || viewMode === "browse"
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

            {/* DAM toolbar */}
            <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm font-semibold text-foreground">
                  {displayPhotos.length} photos
                </span>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => setUploadOpen(true)}
                  disabled={loading || Boolean(error) || notFound}
                >
                  <Upload className="mr-1.5 h-3.5 w-3.5" />
                  Upload
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={loading || Boolean(error) || notFound}
                  onClick={() => {
                    /* compression — placeholder */
                  }}
                >
                  <SlidersHorizontal className="mr-1.5 h-3.5 w-3.5" />
                  Compress
                </Button>
                <div className="relative min-w-[160px] max-w-xs flex-1">
                  <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-9 pl-8"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <ColorFilterBar active={colorFilter} onChange={setColorFilter} />
                </div>
                <div className="ml-auto flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={cycleSort}
                    title={`Sort by ${sortKey} (${sortDir})`}
                  >
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

              {!showSidebar && (
                <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <button
                    type="button"
                    onClick={() => setActiveAlbum("all")}
                    className={`hover:text-foreground ${activeAlbum === "all" ? "font-medium text-foreground" : ""}`}
                  >
                    All Photos
                  </button>
                  {albumBreadcrumb.map((crumb) => (
                    <span key={crumb.id} className="flex items-center gap-1.5">
                      <span>/</span>
                      <button
                        type="button"
                        onClick={() => setActiveAlbum(crumb.id)}
                        className="hover:text-foreground"
                      >
                        {crumb.name}
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {showNewFolder && (
              <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/50 p-3">
                <Folder className="h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  placeholder="Album name"
                  className="h-8 flex-1 rounded-md border border-input bg-background px-3 text-sm"
                  onKeyDown={async (e) => {
                    if (e.key === "Enter" && newFolderName.trim()) {
                      await handleCreateFolder(newFolderName);
                      setNewFolderName("");
                      setShowNewFolder(false);
                    }
                    if (e.key === "Escape") {
                      setShowNewFolder(false);
                      setNewFolderName("");
                    }
                  }}
                  autoFocus
                />
                <Button
                  size="sm"
                  type="button"
                  onClick={async () => {
                    await handleCreateFolder(newFolderName);
                    setNewFolderName("");
                    setShowNewFolder(false);
                  }}
                >
                  Create
                </Button>
                <button
                  type="button"
                  onClick={() => {
                    setShowNewFolder(false);
                    setNewFolderName("");
                  }}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}

            {selectedPhotoIds.size > 0 && (
              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
                <span className="text-sm font-medium">{selectedPhotoIds.size} selected</span>
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <select
                    value={moveTargetFolderId}
                    onChange={(e) => setMoveTargetFolderId(e.target.value)}
                    className="h-8 max-w-full rounded-md border border-input bg-background px-2 text-sm"
                  >
                    <option value="">All Photos</option>
                    {folders.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </div>
                <Button size="sm" onClick={handleBatchMove} disabled={moving}>
                  <Move className="mr-1 h-4 w-4" />
                  {moving ? "Moving…" : "Move"}
                </Button>
                <Button size="sm" variant="ghost" type="button" onClick={clearSelection}>
                  Clear
                </Button>
              </div>
            )}

            {/* All files row */}
            {displayPhotos.length > 0 && (
              selectedPhotoIds.size > 0 ? (
                <div className="flex items-center gap-2 text-sm font-medium text-sky-600">
                  {selectedPhotoIds.size} photo{selectedPhotoIds.size !== 1 ? "s" : ""} selected — individual selection active
                  <button
                    type="button"
                    onClick={clearSelection}
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
                    checked={allVisibleSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someVisibleSelected && !allVisibleSelected;
                    }}
                    onChange={toggleSelectAllVisible}
                  />
                  All files
                </label>
              )
            )}

            {loading && !error ? (
              <p className="py-12 text-center text-sm text-muted-foreground">Loading photos…</p>
            ) : notFound ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                This project could not be found.
              </p>
            ) : error ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                Photos could not be loaded.
              </p>
            ) : displayPhotos.length > 0 || childAlbums.length > 0 ? (
              <PhotoGrid
                photos={displayPhotos}
                viewMode={viewMode === "browse" ? "grid" : viewMode}
                albums={viewMode !== "browse" ? childAlbums : []}
                onAlbumClick={handleAlbumClick}
                onToggleSelect={togglePhotoSelection}
                selectedIds={Array.from(selectedPhotoIds)}
                cardVariant="gallery"
              />
            ) : (
              <p className="py-12 text-center text-sm text-muted-foreground">
                No photos match the current filters.
              </p>
            )}

            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Projects
            </Link>
          </div>
        </div>
      </main>

      <UploadPanel
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        projectId={projectId}
        folders={folders}
        onFolderCreated={refreshFolders}
        onUploadDone={refreshPhotos}
      />

      {project && (
        <ProjectEditDialog
          open={editOpen}
          onClose={() => setEditOpen(false)}
          project={project}
          onSaved={(updated) => setProject(updated)}
        />
      )}

      {project && (
        <ShareModal
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          projectId={project.id}
          projectName={project.name}
        />
      )}
    </div>
  );
}
