"use client";

import { useEffect, useState, useCallback } from "react";
import { Plus } from "lucide-react";

import Navbar from "@/components/Navbar";
import SearchBar from "@/components/SearchBar";
import ProjectGrid from "@/components/ProjectGrid";
import { Button } from "@/components/ui/button";
import CreateProjectDialog from "@/components/CreateProjectDialog";
import type { Project } from "@/data/mockData";
import { mapRowToProject } from "@/lib/mapProject";

export default function Home() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);

  const refreshProjects = useCallback(async () => {
    const res = await fetch("/api/projects");
    const json: unknown = await res.json();
    if (typeof json !== "object" || json === null) return;
    const body = json as { success?: boolean; data?: unknown };
    if (!body.success || !Array.isArray(body.data)) return;
    setProjects(body.data.map((row) => mapRowToProject(row as Record<string, unknown>)));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/projects");
      const json: unknown = await res.json();
      if (cancelled || typeof json !== "object" || json === null) return;
      const body = json as { success?: boolean; data?: unknown };
      if (!body.success || !Array.isArray(body.data)) return;
      setProjects(body.data.map((row) => mapRowToProject(row as Record<string, unknown>)));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen bg-surface">
      <Navbar />
      <main className="container py-8 space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Projects</h1>
            <p className="text-sm text-muted-foreground mt-1">{projects.length} projects</p>
          </div>
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Create New Project
          </Button>
        </div>
        <div className="max-w-sm">
          <SearchBar />
        </div>
        <ProjectGrid projects={projects} />
      </main>

      <CreateProjectDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSuccess={refreshProjects}
      />
    </div>
  );
}
