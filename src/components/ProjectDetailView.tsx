"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft, Upload, Share2, Calendar, User, LayoutGrid, List, Columns3, Eye, Pencil, Folder, Plus, X, Move, Check } from "lucide-react";
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
  const [viewMode, setViewMode] = useState<ViewMode>("browse");
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");

  // Selection state
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [moveTargetFolderId, setMoveTargetFolderId] = useState<string>("");
  const [moving, setMoving] = useState(false);

  /** Re-fetch folders from API */
  const refreshFolders = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/folders`);
      if (!res.ok) return;
      const body = await res.json();
      if (body.success && Array.isArray(body.data)) {
        setFolders(body.data);
      }
    } catch {
      // Silently ignore
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

  const albumsForUi = useMemo(() => buildAlbumsFromPhotos(photos), [photos]);

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
      list = list.filter((p) => p.albumId && ids.includes(p.albumId));
    }

    if (activeTab === "Selections") {
      list = list.filter((p) => p.selected);
    }

    if (colorFilter !== "all") {
      list = list.filter((p) => p.colorLabel === colorFilter);
    }

    // Filter by selected folder (folder_id only)
    if (selectedFolderId) {
      list = list.filter((p) => p.folderId === selectedFolderId);
    }

    return list;
  }, [activeAlbum, activeTab, colorFilter, photos, albumsForUi, selectedFolderId]);

  const childAlbums = useMemo(() => getChildAlbums(albumsForUi, activeAlbum), [activeAlbum, albumsForUi]);

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

  const showSidebar = viewMode === "browse";

  /** Re-fetch the current project's photo list without disturbing other state. */
  const refreshPhotos = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}`);
      if (!res.ok) return;
      const body = await res.json();
      if (body.success && Array.isArray(body.data?.photos)) {
        setPhotos(body.data.photos as Photo[]);
      }
    } catch {
      // Silently ignore refresh errors — the upload itself already surfaced failures.
    }
  }, [projectId]);

  /** Create folder via API, refresh list, stay on All Photos */
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
      // Silently ignore
    }
  };

  // Selection handlers
  const togglePhotoSelection = useCallback((photoId: string, selected: boolean) => {
    setSelectedPhotoIds((prev) => {
      const next = new Set(prev);
      if (selected) {
        next.add(photoId);
      } else {
        next.delete(photoId);
      }
      return next;
    });
  }, []);

  const enterSelectionMode = useCallback(() => {
    setSelectionMode(true);
    setSelectedPhotoIds(new Set());
  }, []);

  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false);
    setSelectedPhotoIds(new Set());
    setMoveTargetFolderId("");
  }, []);

  // Batch move photos
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
        exitSelectionMode();
      } else {
        console.error("Move failed:", body.error);
      }
    } catch (err) {
      console.error("Move error:", err);
    } finally {
      setMoving(false);
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
      <main className="container py-8 space-y-6">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" />
          Back to Projects
        </Link>

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-foreground">{heading}</h1>
              {showMeta && project && <StatusBadge status={project.status} />}
            </div>
            {showMeta && project && (
            <>
            <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1.5"><Calendar className="h-3.5 w-3.5" />{project.date?.trim() || "—"}</span>
              <span className="inline-flex items-center gap-1.5"><User className="h-3.5 w-3.5" />{project.clientName?.trim() || "—"}</span>
              <span className="rounded bg-muted px-2 py-0.5 text-xs">{project.type}</span>
            </div>
            <p className="text-sm text-muted-foreground max-w-xl">
              {project.description?.trim() ? project.description : "No description yet."}
            </p>
            </>
            )}
          </div>

          <div className="flex items-center gap-2">
            {!selectionMode ? (
              <Button
                type="button"
                variant="outline"
                onClick={enterSelectionMode}
                disabled={loading || Boolean(error) || notFound}
              >
                <Check className="mr-2 h-4 w-4" />
                Select
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                onClick={exitSelectionMode}
              >
                Cancel
              </Button>
            )}
            <Button
              type="button"
              onClick={() => setUploadOpen(true)}
              disabled={loading || Boolean(error) || notFound}
            >
              <Upload className="mr-2 h-4 w-4" />
              Upload Photos
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setEditOpen(true)}
              disabled={loading || Boolean(error) || notFound}
            >
              <Pencil className="mr-2 h-4 w-4" />
              Edit Project
            </Button>
            <Button variant="outline" asChild>
              <Link
                href={`/projects/${projectId}/preview`}
                className={loading || error || notFound ? "pointer-events-none opacity-50" : undefined}
                aria-disabled={loading || Boolean(error) || notFound}
                onClick={(e) => {
                  if (loading || error || notFound) e.preventDefault();
                }}
              >
                <Eye className="mr-2 h-4 w-4" />
                Preview
              </Link>
            </Button>
            <Button variant="outline" type="button" onClick={() => setShareOpen(true)} disabled={loading || Boolean(error) || notFound}>
              <Share2 className="mr-2 h-4 w-4" />
              Share
            </Button>
          </div>
        </div>

        {/* Batch Action Bar */}
        {selectionMode && selectedPhotoIds.size > 0 && (
          <div className="flex items-center gap-3 p-3 bg-primary/5 border border-primary/20 rounded-lg">
            <span className="text-sm font-medium">
              {selectedPhotoIds.size} selected
            </span>
            <div className="flex items-center gap-2 flex-1">
              <Folder className="h-4 w-4 text-muted-foreground" />
              <select
                value={moveTargetFolderId}
                onChange={(e) => setMoveTargetFolderId(e.target.value)}
                className="h-8 rounded-md border border-input bg-background px-2 py-1 text-sm"
              >
                <option value="">All Photos</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
            </div>
            <Button size="sm" onClick={handleBatchMove} disabled={moving}>
              <Move className="mr-1 h-4 w-4" />
              {moving ? "Moving..." : "Move"}
            </Button>
          </div>
        )}

        <div className={`border-b border-border ${loading ? "opacity-60 pointer-events-none" : ""}`}>
          <div className="flex gap-6">
            {tabs.map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`pb-3 text-sm font-medium transition-colors border-b-2 ${
                  activeTab === tab
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab}
                {tab === "Photos" && <span className="ml-1.5 text-xs text-muted-foreground">({photos.length})</span>}
                {tab === "Selections" && <span className="ml-1.5 text-xs text-muted-foreground">({photos.filter((p) => p.selected).length})</span>}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between">
          <ColorFilterBar active={colorFilter} onChange={setColorFilter} />
          <div className="flex items-center gap-1 rounded-lg border border-border p-1">
            {([
              { mode: "browse" as ViewMode, icon: Columns3, label: "Browse (sidebar)" },
              { mode: "grid" as ViewMode, icon: LayoutGrid, label: "Grid" },
              { mode: "list" as ViewMode, icon: List, label: "List" },
            ]).map(({ mode, icon: Icon, label }) => (
              <button
                key={mode}
                type="button"
                onClick={() => setViewMode(mode)}
                title={label}
                className={`rounded p-1.5 transition-colors ${
                  viewMode === mode
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
              >
                <Icon className="h-4 w-4" />
              </button>
            ))}
          </div>
        </div>

        {/* New Folder Input */}
        {showNewFolder && (
          <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg border border-border">
            <Folder className="h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="Enter folder name"
              className="flex-1 h-8 rounded-md border border-input bg-background px-3 py-1 text-sm"
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
              onClick={() => { setShowNewFolder(false); setNewFolderName(""); }}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {!showSidebar && (
          <div className="flex items-center gap-1.5 text-sm">
            <button
              type="button"
              onClick={() => setActiveAlbum("all")}
              className={`hover:text-foreground transition-colors ${activeAlbum === "all" ? "text-foreground font-medium" : "text-muted-foreground"}`}
            >
              All Photos
            </button>
            {albumBreadcrumb.map((crumb) => (
              <span key={crumb.id} className="flex items-center gap-1.5">
                <span className="text-muted-foreground">/</span>
                <button
                  type="button"
                  onClick={() => setActiveAlbum(crumb.id)}
                  className="text-muted-foreground hover:text-foreground transition-colors last:text-foreground last:font-medium"
                >
                  {crumb.name}
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="flex gap-6">
          {showSidebar && (
            <div className="hidden md:block w-52 shrink-0 space-y-6">
              {/* Albums Tree */}
              <div>
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Albums</h3>
                <AlbumTree
                  albums={albumsForUi}
                  activeAlbumId={activeAlbum}
                  onSelect={setActiveAlbum}
                  expandedIds={expandedAlbums}
                  onToggle={toggleExpand}
                />
              </div>

              {/* Folders List */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Folders</h3>
                  <button
                    type="button"
                    onClick={() => setShowNewFolder(true)}
                    className="text-muted-foreground hover:text-foreground"
                    title="New Folder"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
                <div className="space-y-1">
                  <button
                    type="button"
                    onClick={() => setSelectedFolderId(null)}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors ${
                      selectedFolderId === null
                        ? "bg-primary/10 text-primary font-medium"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted"
                    }`}
                  >
                    <Folder className="h-4 w-4" />
                    <span className="flex-1 text-left">All Photos</span>
                    <span className="text-xs text-muted-foreground">{photos.length}</span>
                  </button>
                  {folders.map((folder) => {
                    const count = photos.filter((p) => p.folderId === folder.id).length;
                    return (
                      <button
                        key={folder.id}
                        type="button"
                        onClick={() => setSelectedFolderId(selectedFolderId === folder.id ? null : folder.id)}
                        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors ${
                          selectedFolderId === folder.id
                            ? "bg-primary/10 text-primary font-medium"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted"
                        }`}
                      >
                        <Folder className="h-4 w-4" />
                        <span className="flex-1 text-left truncate">{folder.name}</span>
                        <span className="text-xs text-muted-foreground">({count})</span>
                      </button>
                    );
                  })}
                  {folders.length === 0 && (
                    <p className="px-2 py-1.5 text-xs text-muted-foreground">
                      No folders yet. Click + to create one.
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="flex-1 min-w-0">
            {loading && !error ? (
              <p className="py-12 text-center text-sm text-muted-foreground">Loading photos…</p>
            ) : notFound ? (
              <p className="py-12 text-center text-sm text-muted-foreground">This project could not be found.</p>
            ) : error ? (
              <p className="py-12 text-center text-sm text-muted-foreground">Photos could not be loaded.</p>
            ) : filteredPhotos.length > 0 || childAlbums.length > 0 ? (
              <PhotoGrid
                photos={filteredPhotos}
                viewMode={viewMode}
                albums={viewMode !== "browse" ? childAlbums : []}
                onAlbumClick={handleAlbumClick}
                selectionMode={selectionMode}
                selectedIds={Array.from(selectedPhotoIds)}
                onToggleSelect={togglePhotoSelection}
              />
            ) : (
              <p className="py-12 text-center text-sm text-muted-foreground">No photos match the current filters.</p>
            )}
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
