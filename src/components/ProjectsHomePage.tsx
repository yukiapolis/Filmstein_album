"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { Plus, X } from "lucide-react";

import Navbar from "@/components/Navbar";
import SearchBar from "@/components/SearchBar";
import ProjectGrid from "@/components/ProjectGrid";
import { Button } from "@/components/ui/button";
import CreateProjectDialog from "@/components/CreateProjectDialog";
import ProjectStorageManagementPanel from "@/components/ProjectStorageManagementPanel";
import type { Project } from "@/data/mockData";

export default function ProjectsHomePage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [adminRole, setAdminRole] = useState<"super_admin" | "admin" | null>(null);
  const [migrationOpen, setMigrationOpen] = useState(false);
  const [selectedMigrationProjectId, setSelectedMigrationProjectId] = useState<string | null>(null);

  const fetchProjects = useCallback(async (): Promise<Project[]> => {
    const res = await fetch("/api/projects");
    const json: unknown = await res.json();
    if (typeof json !== "object" || json === null) return [];
    const body = json as { success?: boolean; data?: unknown };
    if (!body.success || !Array.isArray(body.data)) return [];
    return body.data as Project[];
  }, []);

  const refreshProjects = useCallback(async () => {
    const mapped = await fetchProjects();
    setProjects(mapped);
  }, [fetchProjects]);

  useEffect(() => {
    let cancelled = false;

    const loadProjects = async () => {
      const [mapped, adminMe] = await Promise.all([
        fetchProjects(),
        fetch('/api/admin/me').then((res) => res.json().catch(() => null)).catch(() => null),
      ]);
      if (!cancelled) {
        setProjects(mapped);
        setAdminRole(adminMe?.success === true ? adminMe?.data?.role ?? null : null);
        setSelectedMigrationProjectId((current) => {
          if (current && mapped.some((project) => project.id === current)) return current;
          return mapped[0]?.id ?? null;
        });
      }
    };

    void loadProjects();

    return () => {
      cancelled = true;
    };
  }, [fetchProjects]);

  const filteredProjects = useMemo(() => {
    const keyword = searchQuery.trim().toLowerCase();
    if (!keyword) return projects;
    return projects.filter((project) =>
      [project.name, project.clientName, project.description, project.status, project.type]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(keyword))
    );
  }, [projects, searchQuery]);

  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(filteredProjects.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pagedProjects = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredProjects.slice(start, start + pageSize);
  }, [filteredProjects, currentPage]);

  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    setPage(1);
  }, []);

  return (
    <div className="min-h-screen bg-surface">
      <Navbar />
      <main className="container py-8 space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Projects</h1>
            <p className="text-sm text-muted-foreground mt-1">{filteredProjects.length} projects</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => setDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Create New Project
            </Button>
          </div>
        </div>
        <div className="max-w-sm">
          <SearchBar value={searchQuery} onChange={handleSearchChange} />
        </div>
        <ProjectGrid
          projects={pagedProjects}
          isSuperAdmin={adminRole === 'super_admin'}
          onOpenMigration={(project) => {
            setSelectedMigrationProjectId(project.id);
            setMigrationOpen(true);
          }}
        />
        <div className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3">
          <p className="text-sm text-muted-foreground">
            Page {currentPage} of {totalPages}
          </p>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={currentPage <= 1}>
              Previous
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={currentPage >= totalPages}>
              Next
            </Button>
          </div>
        </div>
      </main>

      <CreateProjectDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSuccess={refreshProjects}
      />

      {migrationOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="flex h-[min(90vh,880px)] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <h2 className="text-base font-semibold text-foreground">Migration</h2>
                <p className="text-sm text-muted-foreground">
                  {projects.find((project) => project.id === selectedMigrationProjectId)?.name || 'Selected project'}
                </p>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => setMigrationOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4 lg:p-5">
              {selectedMigrationProjectId ? (
                <ProjectStorageManagementPanel
                  projectId={selectedMigrationProjectId}
                  projectName={projects.find((project) => project.id === selectedMigrationProjectId)?.name}
                />
              ) : (
                <div className="rounded-lg border border-dashed border-border p-8 text-sm text-muted-foreground">
                  No project selected.
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
