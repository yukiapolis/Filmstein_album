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
    console.log("[DEBUG] /api/projects raw response:", json);
    if (typeof json !== "object" || json === null) return;
    const body = json as { success?: boolean; data?: unknown };
    console.log("[DEBUG] body.data first item keys:", Array.isArray(body.data) ? Object.keys(body.data[0] ?? {}) : "not array");
    if (!body.success || !Array.isArray(body.data)) return;
    const mapped = body.data.map((row) => mapRowToProject(row as Record<string, unknown>));
    console.log("[DEBUG] mapped projects[0].cover_url:", mapped[0]?.cover_url);
    setProjects(mapped);
  }, []);

  useEffect(() => {
    refreshProjects();
  }, [refreshProjects]);

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

        {/* DEBUG: show raw cover_url from first project */}
        {projects[0] && (
          <div className="rounded border border-red-500 p-4 space-y-2">
            <p className="text-xs text-red-500 font-mono">
              [DEBUG] projects[0].cover_url = {projects[0].cover_url}
            </p>
            <img
              src={projects[0].cover_url}
              alt="raw debug cover"
              className="h-48 w-full object-cover rounded"
            />
          </div>
        )}
      </main>

      <CreateProjectDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSuccess={refreshProjects}
      />
    </div>
  );
}
