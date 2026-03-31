import type { PhotoStatus } from "@/data/mockData";

const styles: Record<PhotoStatus, string> = {
  original: "bg-muted text-muted-foreground",
  edited: "bg-primary/10 text-primary",
};

const PhotoStatusBadge = ({ status }: { status: PhotoStatus }) => (
  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${styles[status]}`}>
    {status}
  </span>
);

export default PhotoStatusBadge;
