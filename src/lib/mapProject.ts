import type { Project, ProjectStatus, ProjectType } from "@/data/mockData";
import { sanitizeProjectVisualSettings } from "@/lib/shareAccess";

const FALLBACK_COVER = "/default-cover.svg";

const PROJECT_TYPES: ProjectType[] = ["Wedding", "Event", "Campaign"];
const PROJECT_STATUSES: ProjectStatus[] = ["Draft", "Reviewing", "Delivered"];

function asProjectType(v: unknown): ProjectType {
  if (typeof v === "string" && PROJECT_TYPES.includes(v as ProjectType)) {
    return v as ProjectType;
  }
  return "Campaign";
}

function asProjectStatus(v: unknown): ProjectStatus {
  if (typeof v === "string" && PROJECT_STATUSES.includes(v as ProjectStatus)) {
    return v as ProjectStatus;
  }
  return "Draft";
}

/** Maps a Supabase `projects` row (snake_case) to dashboard `Project`. */
export function mapRowToProject(row: Record<string, unknown>): Project {
  const created = row.created_at;
  const dateFromCreated =
    typeof created === "string" && created.length >= 10 ? created.slice(0, 10) : "";
  const dateFromCol =
    typeof row.date === "string" && row.date.length >= 10 ? row.date.slice(0, 10) : "";
  const date = dateFromCol || dateFromCreated;

  const coverRaw = row.cover_url;
  const coverUrl =
    typeof coverRaw === "string" && coverRaw.length > 0 ? coverRaw : FALLBACK_COVER;

  const photoRaw = row.photo_count;
  const photoCount = typeof photoRaw === "number" ? photoRaw : 0;

  const storageUsedRaw = row.storage_used_bytes;
  const storageUsedBytes = typeof storageUsedRaw === "number" ? storageUsedRaw : 0;

  const name =
    typeof row.name === "string" && row.name.length > 0
      ? row.name
      : typeof row.title === "string"
        ? row.title
        : "";

  const clientName =
    typeof row.client_name === "string"
      ? row.client_name
      : typeof row.client === "string"
        ? row.client
        : "";

  const description =
    typeof row.description === "string"
      ? row.description
      : typeof row.summary === "string"
        ? row.summary
        : "";

  return {
    id: String(row.id ?? ""),
    name,
    type: asProjectType(row.type),
    date,
    createdByAdminUserId:
      typeof row.created_by_admin_user_id === "string" ? row.created_by_admin_user_id : undefined,
    created_at: typeof row.created_at === "string" ? row.created_at : undefined,
    cover_url: coverUrl,
    photoCount,
    storage_used_bytes: storageUsedBytes,
    status: asProjectStatus(row.status),
    clientName,
    description,
    permissions: typeof row.permissions === 'object' && row.permissions !== null ? row.permissions as { canDelete?: boolean; canManageAssignments?: boolean } : undefined,
    storage_state: typeof row.storage_state === 'object' && row.storage_state !== null ? row.storage_state as { location_mode?: 'r2' | 'node_local'; holder_node_id?: string | null; holder_node_name?: string | null; holder_node_key?: string | null } : undefined,
    ftp_ingest: typeof row.ftp_ingest === 'object' && row.ftp_ingest !== null ? row.ftp_ingest : undefined,
    project_assets: typeof row.project_assets === 'object' && row.project_assets !== null ? row.project_assets : undefined,
    visual_settings: typeof row.visual_settings === 'object' && row.visual_settings !== null ? sanitizeProjectVisualSettings(row.visual_settings) as Record<string, unknown> : undefined,
  } as Project & { ftp_ingest?: Record<string, unknown>; project_assets?: Record<string, unknown>; visual_settings?: Record<string, unknown> };
}
