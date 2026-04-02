import { resolvePhotoPublicUrl } from "@/lib/resolvePhotoPublicUrl";

function toStringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function toStringOrEmpty(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function mapRowToPhoto(row: Record<string, unknown>) {
  const originalFile = asRecord(row.original_file);
  const retouchedFile = asRecord(row.retouched_file);
  const activeFile = retouchedFile ?? originalFile ?? row;

  const url = resolvePhotoPublicUrl(activeFile as Record<string, unknown>);
  const fileUrl = toStringValue(activeFile?.file_url) || url;
  const fileName =
    toStringValue(activeFile?.file_name) ||
    toStringValue(activeFile?.original_file_name) ||
    "untitled";

  const branchType = toStringOrEmpty(activeFile?.branch_type);
  const photoStatus = branchType === "original" || branchType === "raw" ? "original" : "edited";

  return {
    id: toStringValue(row.global_photo_id) || toStringValue(row.id),
    projectId: toStringValue(row.project_id),
    url,
    file_url: fileUrl,
    fileName,
    tag: toStringValue(row.tag),
    selected: false,
    uploadedAt: toStringValue(activeFile?.created_at) || toStringValue(row.updated_at),
    status: toStringValue(row.status) || "1",
    photoStatus,
    colorLabel: toStringValue(row.color_label) || "none",
    albumId: toStringValue(row.folder_id) || undefined,
    folder: undefined,
    folderId: toStringValue(row.folder_id) || undefined,
    originalFileId: toStringValue(row.original_file_id),
    retouchedFileId: toStringValue(row.retouched_file_id),
  };
}
