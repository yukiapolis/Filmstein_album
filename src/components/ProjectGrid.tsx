import type { Project } from "@/data/mockData";
import ProjectListRow from "@/components/ProjectListRow";

const ProjectGrid = ({
  projects,
  isSuperAdmin = false,
  onOpenMigration,
}: {
  projects: Project[]
  isSuperAdmin?: boolean
  onOpenMigration?: (project: Project) => void
}) => {
  if (projects.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card px-6 py-12 text-center">
        <p className="text-sm font-medium text-foreground">No projects yet</p>
        <p className="mt-1 text-sm text-muted-foreground">Create your first project to start organizing uploads, review flow, and delivery.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {projects.map((project) => (
        <ProjectListRow
          key={project.id}
          project={project}
          isSuperAdmin={isSuperAdmin}
          onOpenMigration={onOpenMigration}
        />
      ))}
    </div>
  );
};

export default ProjectGrid;
