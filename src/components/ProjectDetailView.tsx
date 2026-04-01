"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft, Upload, Share2, Calendar, User, LayoutGrid, List, Columns3, Eye } from "lucide-react";
import Navbar from "@/components/Navbar";
import PhotoGrid, { type ViewMode } from "@/components/PhotoGrid";
import StatusBadge from "@/components/StatusBadge";
import AlbumTree from "@/components/AlbumTree";
import ColorFilterBar from "@/components/ColorFilterBar";
import UploadPanel from "@/components/UploadPanel";
import type { ColorLabel, Album, Project, Photo } from "@/data/mockData";
import { buildAlbumsFromPhotos } from "@/lib/albumsFromPhotos";
import { Button } from "@/components/ui/button";

const tabs = ["Photos", "Selections"] as const;

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
  const [activeAlbum, setActiveAlbum] = useState("all");
  const [colorFilter, setColorFilter] = useState<ColorLabel | "all">("all");
  const [expandedAlbums, setExpandedAlbums] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<ViewMode>("browse");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      setNotFound(false);
      setProject(null);
      setPhotos([]);

      try {
        const res = await fetch(`/api/projects/${projectId}`);
        let json: unknown = {};
        try {
          json = await res.json();
        } catch {
          json = {};
        }
        if (cancelled) return;

        if (res.status === 404) {
          setNotFound(true);
          return;
        }

        const body = json as {
          success?: boolean;
          error?: string;
          data?: { project?: Project; photos?: unknown };
        };

        if (!res.ok || body.success === false) {
          setError(body.error ?? `Request failed (${res.status})`);
          return;
        }

        if (body.data?.project && Array.isArray(body.data.photos)) {
          setProject(body.data.project);
          setPhotos(body.data.photos as Photo[]);
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

    return list;
  }, [activeAlbum, activeTab, colorFilter, photos, albumsForUi]);

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
            <Button
              type="button"
              onClick={() => setUploadOpen(true)}
              disabled={loading || Boolean(error) || notFound}
            >
              <Upload className="mr-2 h-4 w-4" />
              Upload Photos
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
            <Button variant="outline" type="button" disabled title="Coming soon">
              <Share2 className="mr-2 h-4 w-4" />
              Share
            </Button>
          </div>
        </div>

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
            <div className="hidden md:block w-52 shrink-0">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Albums</h3>
              <AlbumTree
                albums={albumsForUi}
                activeAlbumId={activeAlbum}
                onSelect={setActiveAlbum}
                expandedIds={expandedAlbums}
                onToggle={toggleExpand}
              />
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
        onUploadDone={refreshPhotos}
      />
    </div>
  );
}
