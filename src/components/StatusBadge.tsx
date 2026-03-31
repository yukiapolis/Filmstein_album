import type { ProjectStatus } from "@/data/mockData";

const statusStyles: Record<ProjectStatus, string> = {
  Draft: "bg-muted text-muted-foreground",
  Reviewing: "bg-primary/10 text-primary",
  Delivered: "bg-green-50 text-green-700",
};

const StatusBadge = ({ status }: { status: ProjectStatus }) => {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${statusStyles[status]}`}>
      {status}
    </span>
  );
};

export default StatusBadge;
