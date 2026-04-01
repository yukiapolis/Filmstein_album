const R2_BASE_URL = "https://photo.filmstein.com";

function toStringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function mapRowToPhoto(row: Record<string, unknown>) {
  const fileUrl = toStringValue(row.file_url);
  const path = toStringValue(row.path);

  const url =
    fileUrl ||
    (path ? `${R2_BASE_URL}/${path.replace(/^\/+/, "")}` : "");

  return {
    id: toStringValue(row.id),
    projectId: toStringValue(row.project_id),
    url,
    file_url: toStringValue(row.file_url),
    fileName: toStringValue(row.file_name),
    tag: toStringValue(row.tag),
    selected: Boolean(row.selected),
    uploadedAt: toStringValue(row.created_at),
    status: toStringValue(row.status) || "original",
    photoStatus: toStringValue(row.photo_status) || "original",
    colorLabel: toStringValue(row.color_label) || "none",
    albumId: toStringValue(row.album_id) || undefined,
  };
}