const R2_DEFAULT_ORIGIN = "https://photo.filmstein.com";

function trimTrailingSlash(s: string): string {
  return s.replace(/\/+$/, "");
}

/** Public origin for R2 CDN images (<img src>). */
export function getPhotoPublicBase(): string {
  const fromEnv =
    process.env.NEXT_PUBLIC_PHOTO_PUBLIC_BASE_URL ||
    process.env.R2_PUBLIC_BASE_URL ||
    R2_DEFAULT_ORIGIN;
  return trimTrailingSlash(fromEnv);
}

function isSupabaseStorageUrl(s: string): boolean {
  return s.includes("supabase.co") && s.includes("/storage/");
}

/**
 * From:
 * https://xxx.supabase.co/storage/v1/object/public/<bucket>/abc/xxx.jpg
 * return: abc/xxx.jpg (object key after bucket; bucket name is not part of R2 path)
 */
function extractPathFromSupabaseStorageUrl(urlString: string): string | null {
  const withoutHash = urlString.split("#")[0];
  try {
    const u = new URL(withoutHash);
    if (!u.hostname.includes("supabase.co")) return null;
    const p = u.pathname;
    const publicMatch = p.match(/\/storage\/v1\/object\/public\/[^/]+\/(.+)$/i);
    if (publicMatch?.[1]) {
      return decodeURIComponent(publicMatch[1].replace(/\/+$/, ""));
    }
    return null;
  } catch {
    /* relative or malformed — try regex on raw string */
    const publicMatch = withoutHash.match(
      /\/storage\/v1\/object\/public\/[^/]+\/([^?#]+)/i,
    );
    if (publicMatch?.[1]) {
      return decodeURIComponent(publicMatch[1].replace(/\/+$/, ""));
    }
    return null;
  }
}

/**
 * Build <img src>. Do not return Supabase Storage URLs; use R2 public origin + object path.
 */
export function resolvePhotoPublicUrl(row: Record<string, unknown>): string {
  const base = getPhotoPublicBase();

  const keyFields = [
    row.key,
    row.r2_key,
    row.storage_key,
    row.object_key,
    row.file_key,
    row.path,
    row.storage_path,
  ] as unknown[];

  for (const v of keyFields) {
    if (typeof v === "string" && v.length > 0) {
      const path = v.replace(/^\/+/, "").split("?")[0];
      if (path) return `${base}/${path}`;
    }
  }

  const raw = row.file_url;
  if (typeof raw === "string" && raw.length > 0) {
    const trimmed = raw.trim();

    if (trimmed.toLowerCase().startsWith(base.toLowerCase())) {
      return trimmed;
    }

    if (!/^https?:\/\//i.test(trimmed)) {
      const path = trimmed.replace(/^\/+/, "").split("?")[0];
      return path ? `${base}/${path}` : "";
    }

    if (isSupabaseStorageUrl(trimmed)) {
      const extracted = extractPathFromSupabaseStorageUrl(trimmed);
      if (extracted) return `${base}/${extracted}`;
    } else {
      return trimmed;
    }
  }

  const projectId = row.project_id;
  const fileName = row.file_name;
  if (typeof fileName === "string" && fileName.trim()) {
    const fn = fileName.trim().replace(/^\/+/, "");
    if (fn.includes("/")) return `${base}/${fn}`;
    if (typeof projectId === "string" && projectId.trim()) {
      return `${base}/${projectId.trim()}/${fn}`;
    }
  }

  if (typeof raw === "string" && isSupabaseStorageUrl(raw)) {
    return "";
  }

  return "";
}
