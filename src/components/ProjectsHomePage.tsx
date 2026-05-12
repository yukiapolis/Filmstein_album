"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { Plus } from "lucide-react";

import Navbar from "@/components/Navbar";
import SearchBar from "@/components/SearchBar";
import ProjectGrid from "@/components/ProjectGrid";
import { Button } from "@/components/ui/button";
import CreateProjectDialog from "@/components/CreateProjectDialog";
import type { Project } from "@/data/mockData";

export default function ProjectsHomePage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);

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
      const mapped = await fetchProjects();
      if (!cancelled) {
        setProjects(mapped);
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
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Create New Project
          </Button>
        </div>
        <div className="max-w-sm">
          <SearchBar value={searchQuery} onChange={handleSearchChange} />
        </div>
        <ProjectGrid projects={pagedProjects} />
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
    </div>
  );
}
