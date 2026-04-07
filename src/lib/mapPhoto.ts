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
  const latestOriginalFile = asRecord(row.latest_original_file);
  const latestThumbFile = asRecord(row.latest_thumb_file);
  const latestDisplayFile = asRecord(row.latest_display_file);
  const firstOriginalFile = asRecord(row.first_original_file);

  const cardFile = latestThumbFile ?? latestDisplayFile ?? latestOriginalFile ?? firstOriginalFile ?? row;
  const displayActiveFile = latestDisplayFile ?? latestOriginalFile ?? firstOriginalFile ?? row;
  const downloadFile = latestDisplayFile ?? latestOriginalFile ?? firstOriginalFile ?? row;

  const thumbUrl = resolvePhotoPublicUrl(cardFile as Record<string, unknown>);
  const displayUrl = resolvePhotoPublicUrl(displayActiveFile as Record<string, unknown>);
  const downloadUrl = resolvePhotoPublicUrl(downloadFile as Record<string, unknown>);
  const retouchedOriginalUrl = latestOriginalFile ? resolvePhotoPublicUrl(latestOriginalFile) : "";
  const originalUrl = firstOriginalFile ? resolvePhotoPublicUrl(firstOriginalFile) : retouchedOriginalUrl;

  const fileName =
    toStringValue(displayActiveFile?.file_name) ||
    toStringValue(displayActiveFile?.original_file_name) ||
    toStringValue(latestOriginalFile?.file_name) ||
    toStringValue(latestOriginalFile?.original_file_name) ||
    toStringValue(firstOriginalFile?.file_name) ||
    toStringValue(firstOriginalFile?.original_file_name) ||
    "untitled";

  const versionCount = Number(row.version_count) || 1;
  const latestVersionNo = Number(row.latest_version_no) || 1;
  const firstVersionNo = Number(row.first_version_no) || latestVersionNo;
  const photoStatus = versionCount > 1 ? "edited" : "original";

  return {
    id: toStringValue(row.global_photo_id) || toStringValue(row.id),
    projectId: toStringValue(row.project_id),
    url: thumbUrl || displayUrl || downloadUrl,
    file_url: downloadUrl || displayUrl || thumbUrl,
    thumbUrl,
    displayUrl,
    downloadUrl,
    retouchedOriginalUrl,
    originalUrl,
    fileName,
    tag: toStringValue(row.tag),
    selected: false,
    uploadedAt: toStringValue(displayActiveFile?.created_at) || toStringValue(latestOriginalFile?.created_at) || toStringValue(row.updated_at),
    status: toStringValue(row.status) || "1",
    photoStatus,
    colorLabel: toStringValue(row.color_label) || "none",
    albumId: toStringValue(row.folder_id) || undefined,
    folder: undefined,
    folderId: toStringValue(row.folder_id) || undefined,
    originalFileId: toStringValue(firstOriginalFile?.id) || toStringValue(row.original_file_id),
    retouchedFileId: toStringValue(latestDisplayFile?.id) || toStringValue(row.retouched_file_id),
    thumbFileId: toStringValue(latestThumbFile?.id),
    displayFileId: toStringValue(latestDisplayFile?.id),
    versionCount,
    latestVersionNo,
    firstVersionNo,
    isPublished: row.is_published === true,
  };
}
