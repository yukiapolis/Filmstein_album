export const runtime = 'nodejs';

import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolvePhotoPublicUrl } from "@/lib/resolvePhotoPublicUrl";
import { getFirstVersionFiles, getLatestVersionFiles, type PhotoFileRow } from '@/lib/photoVersions'

function getSupabaseAdmin() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing Supabase env");
  }

  return createClient(supabaseUrl, supabaseKey);
}

function stripLegacyDownloadPrefixes(photoId: string, baseName: string): string {
  let name = baseName.trim()

  const escapedPhotoId = photoId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const patterns = [
    new RegExp(`^${escapedPhotoId}_v\\d+_`, 'i'),
    new RegExp(`^${escapedPhotoId}_(?:original|retouched_original)_`, 'i'),
    new RegExp(`^${escapedPhotoId}_`, 'i'),
    /^\d+_(?:original|retouched_original)_/i,
  ]

  let changed = true
  while (changed) {
    changed = false
    for (const pattern of patterns) {
      const next = name.replace(pattern, '')
      if (next !== name) {
        name = next
        changed = true
      }
    }
  }

  return name || 'photo'
}

async function resolveDownload(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
  options?: { headOnly?: boolean }
) {
  try {
    const { id } = await context.params;
    const variantRaw = request.nextUrl.searchParams.get("variant") || 'current'
    const clientSafe = request.nextUrl.searchParams.get('clientSafe') === 'true'
    const variant = variantRaw === 'original' || variantRaw === 'retouched-original' || variantRaw === 'current' || variantRaw === 'client-original'
      ? variantRaw
      : 'current'
    if (clientSafe && variant !== 'current' && variant !== 'client-original') {
      return Response.json({ error: 'Client-safe downloads only allow public variants' }, { status: 403 });
    }

    if (!clientSafe && variant === 'client-original') {
      return Response.json({ error: 'client-original is only available in client-safe mode' }, { status: 400 });
    }
    const supabase = getSupabaseAdmin();

    if (clientSafe) {
      const { data: photoRow, error: photoError } = await supabase
        .from('photos')
        .select('global_photo_id, is_published')
        .eq('global_photo_id', id)
        .maybeSingle()

      if (photoError) {
        return Response.json({ error: photoError.message }, { status: 500 });
      }

      if (!photoRow || photoRow.is_published !== true) {
        return Response.json({ error: 'Photo is not available for client download' }, { status: 403 });
      }
    }

    const { data: fileRows, error } = await supabase
      .from("photo_files")
      .select("id, photo_id, branch_type, file_name, original_file_name, object_key, storage_provider, bucket_name, version_no, created_at")
      .eq("photo_id", id)
      .order('version_no', { ascending: false })
      .order('created_at', { ascending: false })

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    const rows = (fileRows ?? []) as PhotoFileRow[]
    const latestVersion = getLatestVersionFiles(rows)
    const firstVersion = getFirstVersionFiles(rows)
    const versionCount = latestVersion && firstVersion ? new Set(rows.map((row) => Number(row.version_no) || 1)).size : 0

    const file = variant === 'current'
      ? latestVersion?.byBranch.display ?? null
      : variant === 'retouched-original' || variant === 'client-original'
        ? latestVersion?.byBranch.original ?? null
        : firstVersion?.byBranch.original ?? null

    const versionNo = variant === 'original'
      ? firstVersion?.versionNo ?? null
      : latestVersion?.versionNo ?? null

    if (!file) {
      return Response.json({ error: `No downloadable file found for variant ${variant}` }, { status: 404 });
    }

    const sourceName =
      file.original_file_name || file.file_name || file.object_key?.split("/").pop() || `${id}.jpg`;
    const ext = path.extname(sourceName).toLowerCase() || '.jpg';
    const readableBase = stripLegacyDownloadPrefixes(id, path.basename(sourceName, ext).replace(/\s+/g, '_'));
    const safeVersionNo = versionNo ?? 1
    const filename = `${id}_v${safeVersionNo}_${readableBase}${ext}`;

    if (file.storage_provider === "local" && typeof file.object_key === "string" && file.object_key.trim()) {
      const localPath = path.isAbsolute(file.object_key)
        ? file.object_key
        : path.join(process.cwd(), file.object_key);
      const buffer = await readFile(localPath);
      const localExt = path.extname(filename).toLowerCase();
      const contentType =
        localExt === ".png" ? "image/png" :
        localExt === ".webp" ? "image/webp" :
        localExt === ".gif" ? "image/gif" :
        localExt === ".tif" || localExt === ".tiff" ? "image/tiff" :
        localExt === ".jpg" || localExt === ".jpeg" ? "image/jpeg" :
        "application/octet-stream";

      return new Response(options?.headOnly ? null : buffer, {
        headers: {
          "Content-Type": contentType,
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        },
      });
    }

    const src = resolvePhotoPublicUrl(file as unknown as Record<string, unknown>);
    if (!src) {
      return Response.json({ error: "Download source unavailable" }, { status: 404 });
    }

    const upstream = await fetch(src);
    if (!upstream.ok) {
      return Response.json({ error: `Upstream download failed: ${upstream.status}` }, { status: 502 });
    }

    const contentType = upstream.headers.get("content-type") || "application/octet-stream";

    return new Response(options?.headOnly ? null : upstream.body, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}

export async function HEAD(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  return resolveDownload(request, context, { headOnly: true });
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  return resolveDownload(request, context, { headOnly: false });
}
