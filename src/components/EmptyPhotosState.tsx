import { ImageOff } from "lucide-react";

interface EmptyPhotosStateProps {
  title?: string;
  description?: string;
}

const EmptyPhotosState = ({
  title = "No photos yet",
  description = "Upload photos to get started.",
}: EmptyPhotosStateProps) => (
  <div className="flex flex-col items-center justify-center py-20 text-center">
    <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-muted">
      <ImageOff className="h-7 w-7 text-muted-foreground" />
    </div>
    <h3 className="text-sm font-semibold text-foreground">{title}</h3>
    <p className="mt-1 text-xs text-muted-foreground">{description}</p>
  </div>
);

export default EmptyPhotosState;
