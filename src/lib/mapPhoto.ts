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
  const thumbFile = asRecord(row.thumb_file);
  const displayFile = asRecord(row.display_file);

  const cardFile = thumbFile ?? displayFile ?? originalFile ?? row;
  const displayActiveFile = displayFile ?? originalFile ?? row;
  const downloadFile = displayFile ?? originalFile ?? row;

  const thumbUrl = resolvePhotoPublicUrl(cardFile as Record<string, unknown>);
  const displayUrl = resolvePhotoPublicUrl(displayActiveFile as Record<string, unknown>);
  const downloadUrl = resolvePhotoPublicUrl(downloadFile as Record<string, unknown>);
  const originalUrl = originalFile ? resolvePhotoPublicUrl(originalFile) : "";

  const fileName =
    toStringValue(displayActiveFile?.file_name) ||
    toStringValue(displayActiveFile?.original_file_name) ||
    toStringValue(originalFile?.file_name) ||
    toStringValue(originalFile?.original_file_name) ||
    "untitled";

  const branchType =
    toStringOrEmpty(originalFile?.branch_type) ||
    toStringOrEmpty(displayActiveFile?.branch_type);
  const photoStatus = branchType === "original" || branchType === "raw" ? "original" : "original";

  return {
    id: toStringValue(row.global_photo_id) || toStringValue(row.id),
    projectId: toStringValue(row.project_id),
    url: thumbUrl || displayUrl || downloadUrl,
    file_url: downloadUrl || displayUrl || thumbUrl,
    thumbUrl,
    displayUrl,
    downloadUrl,
    originalUrl,
    fileName,
    tag: toStringValue(row.tag),
    selected: false,
    uploadedAt: toStringValue(displayActiveFile?.created_at) || toStringValue(row.updated_at),
    status: toStringValue(row.status) || "1",
    photoStatus,
    colorLabel: toStringValue(row.color_label) || "none",
    albumId: toStringValue(row.folder_id) || undefined,
    folder: undefined,
    folderId: toStringValue(row.folder_id) || undefined,
    originalFileId: toStringValue(originalFile?.id) || toStringValue(row.original_file_id),
    retouchedFileId: toStringValue(displayFile?.id) || toStringValue(row.retouched_file_id),
    thumbFileId: toStringValue(thumbFile?.id),
    displayFileId: toStringValue(displayFile?.id),
    isPublished: row.is_published === true,
  };
}
