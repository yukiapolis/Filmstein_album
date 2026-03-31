import type { Project, ProjectStatus, ProjectType } from "@/data/mockData";

const FALLBACK_COVER =
  "https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=600&h=400&fit=crop";

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
  const date = typeof created === "string" && created.length >= 10 ? created.slice(0, 10) : "";

  const coverRaw = row.cover_url;
  const coverUrl =
    typeof coverRaw === "string" && coverRaw.length > 0 ? coverRaw : FALLBACK_COVER;

  const photoRaw = row.photo_count;
  const photoCount = typeof photoRaw === "number" ? photoRaw : 0;

  return {
    id: String(row.id ?? ""),
    name: typeof row.name === "string" ? row.name : "",
    type: asProjectType(row.type),
    date,
    coverUrl,
    photoCount,
    status: asProjectStatus(row.status),
    clientName: typeof row.client_name === "string" ? row.client_name : "",
    description: typeof row.description === "string" ? row.description : "",
  };
}
