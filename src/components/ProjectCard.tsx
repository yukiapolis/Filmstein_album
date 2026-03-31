"use client";

import Link from "next/link";
import { Image as ImageIcon, Calendar, Eye } from "lucide-react";
import type { Project } from "@/data/mockData";
import StatusBadge from "@/components/StatusBadge";

const ProjectCard = ({ project }: { project: Project }) => {
  return (
    <Link href={`/projects/${project.id}`} className="group block">
      <div className="overflow-hidden rounded-xl border border-border bg-card transition-shadow hover:shadow-md">
        <div className="relative aspect-[3/2] overflow-hidden bg-muted">
          <img
            src={project.coverUrl}
            alt={project.name}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        </div>
        <div className="p-4 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-medium text-foreground text-sm leading-tight">{project.name}</h3>
            <StatusBadge status={project.status} />
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                {project.date}
              </span>
              <span className="inline-flex items-center gap-1">
                <ImageIcon className="h-3 w-3" />
                {project.photoCount}
              </span>
              <span className="rounded bg-muted px-1.5 py-0.5">{project.type}</span>
            </div>
            <Link
              href={`/projects/${project.id}/preview`}
              onClick={(e) => e.stopPropagation()}
              className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-muted-foreground hover:bg-primary hover:text-primary-foreground transition-colors"
              title="Preview"
            >
              <Eye className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </div>
    </Link>
  );
};

export default ProjectCard;
